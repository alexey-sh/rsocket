import { mock } from "jest-mock-extended";
import {
  Closeable,
  ConnectionFrameHandler,
  Flags,
  FrameHandler,
  FrameTypes,
  MAX_STREAM_ID,
  Outbound,
  SetupFrame,
  StreamFrameHandler,
  StreamRequestHandler,
} from "../src";
import {
  ClientServerInputMultiplexerDemultiplexer,
  StreamIdGenerator,
} from "../src/ClientServerMultiplexerDemultiplexer";

describe("ClientServerMultiplexerDemultiplexer", function () {
  describe("handle()", () => {
    it("throws if called twice", async () => {
      // arrange
      const frameHandlerStub = mock<
        ConnectionFrameHandler & StreamRequestHandler
      >();
      const outbound = mock<Outbound & Closeable>();
      const multiplexerDemultiplexer =
        new ClientServerInputMultiplexerDemultiplexer(
          StreamIdGenerator.create(-1),
          outbound,
          outbound
        );
      // assert
      expect(
        multiplexerDemultiplexer.connectionInbound.bind(
          multiplexerDemultiplexer,
          frameHandlerStub
        )
      ).not.toThrow();
      expect(
        multiplexerDemultiplexer.connectionInbound.bind(
          multiplexerDemultiplexer,
          frameHandlerStub
        )
      ).toThrow("Connection frame handler has already been installed");
      expect(
        multiplexerDemultiplexer.handleRequestStream.bind(
          multiplexerDemultiplexer,
          frameHandlerStub
        )
      ).not.toThrow();
      expect(
        multiplexerDemultiplexer.handleRequestStream.bind(
          multiplexerDemultiplexer,
          frameHandlerStub
        )
      ).toThrow("Stream handler has already been installed");
    });
  });

  describe("when receiving data", () => {
    const setupFrame = {
      type: FrameTypes.SETUP,
      dataMimeType: "application/octet-stream",
      metadataMimeType: "application/octet-stream",
      keepAlive: 60000,
      lifetime: 300000,
      metadata: Buffer.from("hello world"),
      data: Buffer.from("hello world"),
      resumeToken: null,
      streamId: 0,
      majorVersion: 1,
      minorVersion: 0,
      flags: Flags.METADATA,
    } as SetupFrame;

    describe("when buffer contains a single frame", () => {
      it("deserializes received frames and calls the configured handler", () => {
        // arrange
        const handler = mock<ConnectionFrameHandler>();
        const outbound = mock<Outbound & Closeable>();
        const multiplexerDemultiplexer =
          new ClientServerInputMultiplexerDemultiplexer(
            StreamIdGenerator.create(-1),
            outbound,
            outbound
          );

        // act
        multiplexerDemultiplexer.connectionInbound(handler);
        multiplexerDemultiplexer.handle(setupFrame);

        // assert
        expect(handler.handle).toHaveBeenCalledTimes(1);

        const [call0] = handler.handle.mock.calls;
        const [arg0] = call0;
        expect(arg0).toMatchSnapshot();
      });
    });

    describe("when buffer contains multiple frames", () => {
      it("deserializes received frames and calls the configured handler for each frame", () => {
        // arrange
        const mockHandle = jest.fn();
        const outbound = mock<Outbound & Closeable>();
        const multiplexerDemultiplexer =
          new ClientServerInputMultiplexerDemultiplexer(
            StreamIdGenerator.create(-1),
            outbound,
            outbound
          );
        const streamHandler = mock<StreamFrameHandler>({
          streamId: 1,
          handle: mockHandle,
        });

        // act
        multiplexerDemultiplexer.connect(streamHandler);
        multiplexerDemultiplexer.handle({
          type: FrameTypes.PAYLOAD,
          flags: Flags.NEXT,
          data: Buffer.from("hello world"),
          metadata: undefined,
          streamId: 1,
        });
        multiplexerDemultiplexer.handle({
          type: FrameTypes.PAYLOAD,
          flags: Flags.NEXT,
          data: Buffer.from("hello world 2"),
          metadata: undefined,
          streamId: 1,
        });

        // assert
        expect(mockHandle).toHaveBeenCalledTimes(2);

        const [call0, call1] = mockHandle.mock.calls;

        expect(call0).toMatchSnapshot();
        expect(call1).toMatchSnapshot();
      });
    });
  });
});

describe("StreamIdGenerator", () => {
  function drawNext(
    generator: StreamIdGenerator,
    inUse: number[] = []
  ): number {
    let assigned = -1;
    generator.next((id) => {
      assigned = id;
      return true;
    }, inUse);
    return assigned;
  }

  it("produces odd ids for a client (seed -1), even ids for a server (seed 0)", () => {
    const client = StreamIdGenerator.create(-1);
    expect([drawNext(client), drawNext(client), drawNext(client)]).toEqual([
      1, 3, 5,
    ]);

    const server = StreamIdGenerator.create(0);
    expect([drawNext(server), drawNext(server), drawNext(server)]).toEqual([
      2, 4, 6,
    ]);
  });

  it("does not consume an id when the handler rejects it", () => {
    const client = StreamIdGenerator.create(-1);
    expect(drawNext(client)).toBe(1);

    // handler returns false -> currentId is not advanced
    client.next(() => false, []);

    // the rejected id (3) is offered again on the next draw
    expect(drawNext(client)).toBe(3);
  });

  it("wraps a client generator around the 31-bit boundary", () => {
    // seeded just below the largest odd stream id
    const client = StreamIdGenerator.create(MAX_STREAM_ID - 2);
    expect(drawNext(client)).toBe(MAX_STREAM_ID);
    // next would exceed 2^31-1; wrap to the lowest odd id
    expect(drawNext(client)).toBe(1);
    expect(drawNext(client)).toBe(3);
  });

  it("wraps a server generator to the lowest even id", () => {
    const server = StreamIdGenerator.create(MAX_STREAM_ID - 3);
    expect(drawNext(server)).toBe(MAX_STREAM_ID - 1);
    expect(drawNext(server)).toBe(2);
    expect(drawNext(server)).toBe(4);
  });

  it("skips ids still in use when wrapping around", () => {
    const client = StreamIdGenerator.create(MAX_STREAM_ID - 2);
    expect(drawNext(client)).toBe(MAX_STREAM_ID);
    // ids 1 and 3 are still active -> wrap must skip them
    expect(drawNext(client, [1, 3])).toBe(5);
  });
});
