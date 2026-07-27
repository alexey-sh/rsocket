import { EventEmitter } from "events";
import { FrameTypes, serializeFrameWithLength } from "@rsocket-ts/core";
import { TcpDuplexConnection } from "../TcpDuplexConnection";

function mockSocket(): any {
  const socket: any = new EventEmitter();
  socket.pause = jest.fn();
  socket.resume = jest.fn();
  socket.end = jest.fn();
  socket.destroy = jest.fn();
  socket.write = jest.fn();
  return socket;
}

describe("TcpDuplexConnection.create", () => {
  it("buffers a first frame split across data events shorter than the length prefix", async () => {
    // Regression: create() assumed the first `data` event held a whole frame
    // and destructured `deserializeFrames(buffer).next().value`, throwing a
    // TypeError (surfacing as an unhandled rejection) on a short or split
    // first packet.
    const socket = mockSocket();
    const multiplexer = { handle: jest.fn() };
    const factory = jest.fn(() => multiplexer as any);
    const acceptor = jest.fn(async () => {});

    TcpDuplexConnection.create(socket, acceptor, factory);

    const frame = serializeFrameWithLength({
      type: FrameTypes.CANCEL,
      flags: 0,
      streamId: 1,
    } as any);

    // First event carries fewer bytes than the 3-byte length prefix.
    socket.emit("data", frame.slice(0, 2));
    expect(factory).not.toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();

    // Remaining bytes complete the frame; the connection is now established.
    socket.emit("data", frame.slice(2));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(socket.destroy).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(acceptor).toHaveBeenCalledTimes(1);
  });
});
