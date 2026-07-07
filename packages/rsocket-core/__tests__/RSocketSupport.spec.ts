import { mock } from "jest-mock-extended";
import {
  DefaultConnectionFrameHandler,
  KeepAliveHandler,
  LeaseHandler,
  RSocketRequester,
} from "../src/RSocketSupport";
import {
  Closeable,
  Demultiplexer,
  DuplexConnection,
  Flags,
  FrameHandler,
  FrameTypes,
  Multiplexer,
  OnTerminalSubscriber,
  Outbound,
  RSocket,
  StreamFrameHandler,
  StreamLifecycleHandler,
} from "../src";

describe("RSocketRequester.metadataPush", () => {
  it("sends a METADATA_PUSH frame on stream 0 and completes the responder", () => {
    // Regression: metadataPush threw "Method not implemented."
    const mockOutbound = mock<Outbound>();
    const mockMux = mock<
      Multiplexer & Demultiplexer & FrameHandler & Closeable
    >({ connectionOutbound: mockOutbound });
    const mockConnection = mock<DuplexConnection>({
      multiplexerDemultiplexer: mockMux,
    });
    const requester = new RSocketRequester(mockConnection, 0, undefined);
    const responderStream = mock<OnTerminalSubscriber>();
    const metadata = Buffer.from("metadata-push");

    requester.metadataPush(metadata, responderStream);

    expect(mockOutbound.send).toBeCalledWith({
      type: FrameTypes.METADATA_PUSH,
      streamId: 0,
      flags: Flags.METADATA,
      metadata,
    });
    expect(responderStream.onComplete).toBeCalledTimes(1);
  });
});

describe("DefaultConnectionFrameHandler METADATA_PUSH", () => {
  it("dispatches an inbound METADATA_PUSH to the responder", () => {
    // Regression: the handler case was commented out, silently dropping it.
    const mockConnection = mock<DuplexConnection>();
    const keepAliveHandler = mock<KeepAliveHandler>();
    const responder = { metadataPush: jest.fn() };
    const handler = new DefaultConnectionFrameHandler(
      mockConnection,
      keepAliveHandler,
      undefined,
      undefined,
      responder as Partial<RSocket>
    );
    const metadata = Buffer.from("inbound");

    handler.handle({
      type: FrameTypes.METADATA_PUSH,
      streamId: 0,
      flags: Flags.METADATA,
      metadata,
    } as any);

    expect(responder.metadataPush).toBeCalledTimes(1);
    expect(responder.metadataPush.mock.calls[0][0]).toEqual(metadata);
  });
});

describe("LeaseHandler.close", () => {
  it("rejects all pending (lease-queued) requests when the connection closes", () => {
    // Regression: pending requests awaiting a LEASE grant were never rejected
    // on close, so their subscribers hung forever.
    const multiplexer = mock<Multiplexer>();
    const leaseHandler = new LeaseHandler(256, multiplexer);
    const h1 = mock<StreamFrameHandler & StreamLifecycleHandler>();
    const h2 = mock<StreamFrameHandler & StreamLifecycleHandler>();

    // No lease granted yet, so both queue as pending.
    leaseHandler.requestLease(h1);
    leaseHandler.requestLease(h2);

    leaseHandler.close();

    expect(h1.handleReject).toBeCalledTimes(1);
    expect(h2.handleReject).toBeCalledTimes(1);
  });
});
