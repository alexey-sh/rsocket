/*
 * Copyright 2021-2022 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

import { ApolloLink, Observable } from "@apollo/client";
import { CombinedGraphQLErrors } from "@apollo/client/errors";
import { PartialObserver } from "rxjs";
import { Bytes, MAX_REQUEST_COUNT, Payload, RSocket } from "@rsocket-ts/core";
import { ExecutionResult, print } from "graphql";
import {
  encodeCompositeMetadata,
  encodeRoutes,
  WellKnownMimeType,
} from "@rsocket-ts/composite-metadata";

type SubscribeOperation = {
  query: string;
  variables: Record<string, unknown>;
  operationName?: string;
  extensions: Record<string, unknown>;
};

type SubscriptionLinkOptions = {
  /**
   * The route that the RSocket server is listening for GraphQL messages on.
   */
  route?: string;
};

class SubscriptionClient {
  constructor(
    public readonly client: RSocket,
    private readonly options: SubscriptionLinkOptions
  ) {}

  subscribe<Data = Record<string, unknown>, Extensions = unknown>(
    operation: SubscribeOperation,
    observer: PartialObserver<ExecutionResult<Data, Extensions>>
  ): () => void {
    const metadata = new Map<WellKnownMimeType, Uint8Array>();
    metadata.set(
      WellKnownMimeType.MESSAGE_RSOCKET_MIMETYPE,
      Bytes.fromUtf8(WellKnownMimeType.APPLICATION_JSON.toString())
    );
    if (this.options?.route) {
      metadata.set(
        WellKnownMimeType.MESSAGE_RSOCKET_ROUTING,
        encodeRoutes(this.options.route)
      );
    }

    const encodedMetadata = encodeCompositeMetadata(metadata);

    const requestStream = this.client.requestStream(
      {
        data: Bytes.fromUtf8(JSON.stringify(operation)),
        metadata: encodedMetadata,
      },
      MAX_REQUEST_COUNT,
      {
        onComplete(): void {
          observer.complete?.();
        },
        onError(error: Error): void {
          observer.error?.(error);
        },
        onExtension(): void {},
        onNext(payload: Payload, isComplete: boolean): void {
          const { data } = payload;
          const decoded = Bytes.readUtf8(data!, 0, data!.length);
          const deserialized = JSON.parse(decoded) as ExecutionResult<
            Data,
            Extensions
          >;
          observer.next?.(deserialized);
          if (isComplete) {
            observer.complete?.();
          }
        },
      }
    );

    return () => {
      requestStream.cancel();
    };
  }
}

export class RSocketSubscriptionLink extends ApolloLink {
  private client: SubscriptionClient;
  constructor(
    client: RSocket,
    private readonly options: SubscriptionLinkOptions
  ) {
    super();
    this.client = new SubscriptionClient(client, options);
  }

  public request(
    operation: ApolloLink.Operation
  ): Observable<ApolloLink.Result> {
    return new Observable<ApolloLink.Result>((observer) => {
      const serializedQuery = print(operation.query);
      return this.client.subscribe(
        {
          ...operation,
          query: serializedQuery,
        },
        {
          next(value: ExecutionResult) {
            observer.next(value as ApolloLink.Result);
          },
          complete() {
            observer.complete();
          },
          error(err: unknown) {
            if (err instanceof Error) {
              return observer.error(err);
            }

            // @apollo/client v4 dropped ApolloError; the closest replacement
            // for "server returned errors, not a network exception" is
            // CombinedGraphQLErrors.
            return observer.error(
              new CombinedGraphQLErrors({
                errors: Array.isArray(err) ? err : [err],
              })
            );
          },
        }
      );
    });
  }
}
