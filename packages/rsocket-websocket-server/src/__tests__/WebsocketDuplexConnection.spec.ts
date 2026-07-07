import { EventEmitter } from "events";
import { WebsocketDuplexConnection } from "../WebsocketDuplexConnection";

function mockDuplex(): any {
  const duplex: any = new EventEmitter();
  duplex.end = jest.fn();
  duplex.write = jest.fn();
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
    expect(onClose).toBeCalledTimes(1);
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

    expect(onClose).toBeCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toBe(error);
  });
});
