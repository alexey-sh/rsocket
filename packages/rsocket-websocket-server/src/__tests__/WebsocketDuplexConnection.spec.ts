import { EventEmitter } from "events";
import { FrameTypes } from "rsocket-core";
import { WebsocketDuplexConnection } from "../WebsocketDuplexConnection";

function mockDuplex(): any {
  const duplex: any = new EventEmitter();
  duplex.end = jest.fn();
  duplex.write = jest.fn();
  duplex.pause = jest.fn();
  duplex.resume = jest.fn();
  duplex.destroyed = false;
  return duplex;
}

function mockFactory() {
  return jest.fn(() => ({ handle: jest.fn() } as any));
}

describe("WebsocketDuplexConnection close/error handling", () => {
  it("closes with a generic error when the duplex emits 'close' with no argument", () => {
    // Regression: handleClosed typed the argument as a browser CloseEvent and
    // read `e.reason`, but the Node ws Duplex emits "close" with no argument,
    // so this threw `TypeError: Cannot read properties of undefined`.
    const duplex = mockDuplex();
    const connection = new WebsocketDuplexConnection(
      duplex,
      {} as any,
      mockFactory()
    );
    const onClose = jest.fn();
    connection.onClose(onClose);

    expect(() => duplex.emit("close")).not.toThrow();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("closes with the emitted Error when the duplex emits 'error'", () => {
    // Regression: handleError read `e.error` off what is actually a plain
    // Error, losing the error (closing with undefined).
    const duplex = mockDuplex();
    const connection = new WebsocketDuplexConnection(
      duplex,
      {} as any,
      mockFactory()
    );
    const onClose = jest.fn();
    connection.onClose(onClose);

    const error = new Error("boom");
    duplex.emit("error", error);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toBe(error);
  });
});

describe("WebsocketDuplexConnection.send", () => {
  it("closes instead of throwing when the underlying socket write throws", () => {
    // Regression: send() wrote to the Duplex unconditionally; writing to a
    // closing/closed socket threw an unhandled exception.
    const duplex = mockDuplex();
    duplex.write = jest.fn(() => {
      throw new Error("EPIPE");
    });
    const connection = new WebsocketDuplexConnection(
      duplex,
      {} as any,
      mockFactory()
    );
    const onClose = jest.fn();
    connection.onClose(onClose);

    expect(() =>
      connection.send({
        type: FrameTypes.CANCEL,
        flags: 0,
        streamId: 1,
      } as any)
    ).not.toThrow();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe("WebsocketDuplexConnection.create", () => {
  it("drops the connection when the first message is not a valid frame", () => {
    // Regression: create() called deserializeFrame(buffer) with no guard, so a
    // malformed first message threw an unhandled rejection.
    const socket = mockDuplex();
    const factory = mockFactory();

    WebsocketDuplexConnection.create(
      socket,
      jest.fn(async () => {}),
      factory
    );

    expect(() => socket.emit("data", Buffer.from([0x00, 0x01]))).not.toThrow();
    expect(factory).not.toHaveBeenCalled();
    expect(socket.end).toHaveBeenCalled();
  });
});
