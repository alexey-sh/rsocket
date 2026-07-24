import net from "net";
import { TcpServerTransport } from "../TcpServerTransport";

/**
 * A net.Server whose listen() resolves bind() synchronously (by emitting
 * "listening") and whose close() is a no-op, so no real port is bound.
 */
function stubbedServer(): net.Server {
  const server = new net.Server();
  jest.spyOn(server, "listen").mockImplementation((() => {
    server.emit("listening");
    return server;
  }) as unknown as net.Server["listen"]);
  jest
    .spyOn(server, "close")
    .mockImplementation((() => server) as unknown as net.Server["close"]);
  return server;
}

function bind(server: net.Server) {
  const transport = new TcpServerTransport({
    listenOptions: { port: 0 },
    socketCreator: () => server,
  });
  return transport.bind(
    async () => {},
    () => ({}) as never
  );
}

describe("TcpServerTransport", () => {
  describe("bind() -> Closeable", () => {
    it("closes the underlying server and reports the error to onClose (#279)", async () => {
      const server = stubbedServer();
      const closeable = await bind(server);

      const onClose = jest.fn();
      closeable.onClose(onClose);

      const error = new Error("boom");
      closeable.close(error);

      // the listening socket is closed and the error reaches onClose listeners
      expect(server.close).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledWith(error);
    });

    it("completes onClose without an error on a clean close", async () => {
      const server = stubbedServer();
      const closeable = await bind(server);

      const onClose = jest.fn();
      closeable.onClose(onClose);

      closeable.close();

      expect(server.close).toHaveBeenCalledTimes(1);
      // a clean close forwards no error, so onClose is called with no argument
      expect(onClose).toHaveBeenCalledWith();
    });
  });
});
