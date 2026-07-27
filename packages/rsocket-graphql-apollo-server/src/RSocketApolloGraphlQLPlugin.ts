import {
  ApolloServerPlugin,
  BaseContext,
  GraphQLServerContext,
  GraphQLServerListener,
} from "@apollo/server";
import { RSocket } from "@rsocket-ts/core";
import { RSocketApolloServer } from "./RSocketApolloServer";

type RSocketApolloGraphlQLPluginOptions = {
  apolloServer?: RSocketApolloServer;
  makeRSocketServer: ({ handler }: { handler: Partial<RSocket> }) => {
    bind(): Promise<{ close(): void }>;
  };
};

export class RSocketApolloGraphlQLPlugin<
  TContext extends BaseContext,
> implements ApolloServerPlugin<TContext> {
  private apolloServer!: RSocketApolloServer;
  constructor(private options: RSocketApolloGraphlQLPluginOptions) {}

  async serverWillStart(
    _service: GraphQLServerContext
  ): Promise<GraphQLServerListener | void> {
    if (!this.apolloServer) {
      throw new Error(
        "serverWillStart called without valid apolloServer reference. Did you forget to call setApolloServer?"
      );
    }
    const handler = this.apolloServer.getHandler();
    const rSocketServer = this.options.makeRSocketServer({ handler });
    const closeable = await rSocketServer.bind();
    return {
      async drainServer() {
        closeable.close();
      },
    };
  }

  setApolloServer(apolloServer: RSocketApolloServer) {
    this.apolloServer = apolloServer;
  }
}
