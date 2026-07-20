import {
  Cancellable,
  OnExtensionSubscriber,
  OnNextSubscriber,
  OnTerminalSubscriber,
  Payload,
  Requestable,
  RSocket,
} from "rsocket-core";
import {
  ApolloServer,
  ApolloServerOptions,
  ApolloServerOptionsWithSchema,
  BaseContext,
} from "@apollo/server";
import {
  ExecutionResult,
  GraphQLSchema,
  parse,
  subscribe,
  Source,
} from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { isAsyncGenerator, parsePayloadForQuery } from "./utilities";
import { defer, from, Observable, of, switchMap } from "rxjs";

export interface RSocketContext {
  payload: Payload;
}

type RSocketOperation = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  extensions?: Record<string, unknown>;
};

/**
 * Config accepted by RSocketApolloServer. Mirrors the subset of
 * ApolloServerOptions we support, plus explicit typeDefs/resolvers so we can
 * build the schema up front for the subscription path (which calls graphql's
 * subscribe() directly, bypassing @apollo/server).
 *
 * `context` is a user-supplied factory called per RSocket request with the
 * incoming Payload; whatever it returns is the `contextValue` handed to
 * ApolloServer.executeOperation and graphql.subscribe.
 */
export type RSocketApolloServerConfig<TContext extends BaseContext> = Omit<
  ApolloServerOptions<TContext>,
  "gateway" | "schema"
> & {
  typeDefs: string | Source | (string | Source)[];
  // resolvers are passed straight through to makeExecutableSchema; keep the
  // type loose to match what @graphql-tools/schema accepts.
  resolvers?: unknown;
  context?: (params: RSocketContext) => TContext | Promise<TContext>;
};

export class RSocketApolloServer<
  TContext extends BaseContext = RSocketContext,
> {
  private readonly schema: GraphQLSchema;
  private readonly server: ApolloServer<TContext>;
  private readonly contextFactory: (
    params: RSocketContext
  ) => TContext | Promise<TContext>;

  constructor(config: RSocketApolloServerConfig<TContext>) {
    this.schema = makeExecutableSchema({
      typeDefs: config.typeDefs,
      resolvers: config.resolvers as any,
    });
    const {
      typeDefs: _typeDefs,
      resolvers: _resolvers,
      context,
      ...rest
    } = config;
    this.contextFactory =
      context ??
      // Default: expose {payload} as the context, matching the v3 behavior of
      // this package where resolvers received {payload} unless overridden.
      ((params: RSocketContext) => params as any as TContext);
    this.server = new ApolloServer<TContext>({
      ...(rest as Omit<ApolloServerOptionsWithSchema<TContext>, "schema">),
      schema: this.schema,
    });
  }

  async start(): Promise<void> {
    await this.server.start();
  }

  async stop(): Promise<void> {
    await this.server.stop();
  }

  /** Underlying ApolloServer, exposed for plugin lifecycle wiring. */
  getApolloServer(): ApolloServer<TContext> {
    return this.server;
  }

  public getHandler(): Partial<RSocket> {
    return {
      // handle single Query/Mutation
      requestResponse: (
        payload: Payload,
        responderStream: OnTerminalSubscriber &
          OnNextSubscriber &
          OnExtensionSubscriber
      ): Cancellable & OnExtensionSubscriber => {
        const subscription = this.runQueryOperation(payload).subscribe(
          this.queryOperationSubscriber(responderStream)
        );

        return {
          cancel(): void {
            subscription.unsubscribe();
          },
          onExtension(): void {},
        };
      },

      // handle Subscriptions
      requestStream: (
        payload: Payload,
        initialRequestN: number,
        responderStream: OnTerminalSubscriber &
          OnNextSubscriber &
          OnExtensionSubscriber
      ): Requestable & Cancellable & OnExtensionSubscriber => {
        const subscription = this.runSubscriptionOperation(payload).subscribe(
          this.subscriptionOperationSubscriber(responderStream)
        );

        return {
          cancel(): void {
            subscription.unsubscribe();
          },
          onExtension(): void {},
          request(_requestN: number): void {},
        };
      },
    };
  }

  private queryOperationSubscriber(
    responderStream: OnTerminalSubscriber &
      OnNextSubscriber &
      OnExtensionSubscriber
  ) {
    return {
      next(graphqlResponse: string) {
        responderStream.onNext(
          {
            data: Buffer.from(graphqlResponse),
          },
          true
        );
      },
      error(e: Error) {
        responderStream.onError(e);
      },
    };
  }

  private runQueryOperation(payload: Payload): Observable<string> {
    const parsed = parsePayloadForQuery(payload) as RSocketOperation;

    return defer(() => from(this.executeOperation(parsed, payload)));
  }

  private async executeOperation(
    operation: RSocketOperation,
    payload: Payload
  ): Promise<string> {
    const contextValue = await this.contextFactory({ payload });

    // @apollo/server v5 replaces v3's runHttpQuery. executeOperation auto-starts
    // the server if start() hasn't been called yet, so no extra await needed.
    const response = await this.server.executeOperation(
      {
        query: operation.query,
        variables: operation.variables,
        operationName: operation.operationName,
        extensions: operation.extensions,
      },
      {
        contextValue,
      }
    );

    if (response.body.kind === "single") {
      return JSON.stringify(response.body.singleResult);
    }

    // Incremental delivery (@defer/@stream) only ships with graphql@17; we pin
    // graphql@16, so this branch is defensive.
    throw new Error(
      "Incremental delivery responses are not supported by RSocketApolloServer"
    );
  }

  private subscriptionOperationSubscriber(
    subscriber: OnTerminalSubscriber & OnNextSubscriber & OnExtensionSubscriber
  ) {
    return {
      next(graphqlResponse: ExecutionResult) {
        subscriber.onNext(
          {
            data: Buffer.from(JSON.stringify(graphqlResponse)),
          },
          false
        );
      },
      error() {},
      complete() {
        return subscriber.onComplete();
      },
    };
  }

  private runSubscriptionOperation(
    payload: Payload
  ): Observable<ExecutionResult> {
    const runSubscription = async () => {
      const operation = JSON.parse(
        payload.data!.toString()
      ) as RSocketOperation;
      const document = parse(operation.query);
      const contextValue = await this.contextFactory({ payload });
      return subscribe({
        document,
        operationName: operation.operationName,
        schema: this.schema,
        variableValues: operation.variables,
        contextValue,
      });
    };

    return defer(() => from(runSubscription())).pipe(
      switchMap((result) => {
        return isAsyncGenerator<ExecutionResult>(result)
          ? from(result)
          : of(result);
      })
    );
  }
}
