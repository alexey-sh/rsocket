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

import {
  Bytes,
  Closeable,
  Deferred,
  Demultiplexer,
  deserializeFrames,
  DuplexConnection,
  Frame,
  FrameHandler,
  Multiplexer,
  Outbound,
  serializeFrameWithLength,
} from "rsocket-core";
import net from "net";

export class TcpDuplexConnection
  extends Deferred
  implements DuplexConnection, Outbound
{
  private error!: Error;
  private remainingBuffer: Uint8Array = Bytes.alloc(0);

  readonly multiplexerDemultiplexer: Multiplexer & Demultiplexer & FrameHandler;

  constructor(
    private socket: net.Socket,
    frame: Frame,
    multiplexerDemultiplexerFactory: (
      frame: Frame,
      outbound: Outbound & Closeable
    ) => Multiplexer & Demultiplexer & FrameHandler
  ) {
    super();

    socket.on("close", this.handleClosed);
    socket.on("error", this.handleError);
    socket.on("data", this.handleData);

    this.multiplexerDemultiplexer = multiplexerDemultiplexerFactory(
      frame,
      this
    );
  }

  get availability(): number {
    return this.done ? 0 : 1;
  }

  close(error?: Error) {
    if (this.done) {
      super.close(error);
      return;
    }

    this.socket.off("close", this.handleClosed);
    this.socket.off("error", this.handleError);
    this.socket.off("data", this.handleData);

    this.socket.end();

    // Drop the socket reference for GC; the connection is closed after this.
    Reflect.deleteProperty(this, "socket");

    super.close(error);
  }

  send(frame: Frame): void {
    if (this.done) {
      return;
    }

    const buffer = serializeFrameWithLength(frame);

    this.socket.write(buffer);
  }

  private handleClosed = (hadError: boolean): void => {
    const message = hadError
      ? `TcpDuplexConnection: ${this.error.message}`
      : "TcpDuplexConnection: Socket closed unexpectedly.";
    this.close(new Error(message));
  };

  private handleError = (error: Error): void => {
    this.error = error;
    this.close(error instanceof Error ? error : new Error(String(error)));
  };

  private handleData = (chunks: Uint8Array): void => {
    try {
      // Combine partial frame data from previous chunks with the next chunk,
      // then extract any complete frames plus any remaining data.
      const buffer = Bytes.concat([this.remainingBuffer, chunks]);
      let lastOffset = 0;
      for (const [frame, offset] of deserializeFrames(buffer)) {
        lastOffset = offset;
        this.multiplexerDemultiplexer.handle(frame);
      }
      this.remainingBuffer = buffer.subarray(lastOffset, buffer.length);
    } catch (error) {
      this.close(error instanceof Error ? error : new Error(String(error)));
    }
  };

  static create(
    socket: net.Socket,
    connectionAcceptor: (
      frame: Frame,
      connection: DuplexConnection
    ) => Promise<void>,
    multiplexerDemultiplexerFactory: (
      frame: Frame,
      outbound: Outbound & Closeable
    ) => Multiplexer & Demultiplexer & FrameHandler
  ): void {
    // TODO: timeout on no data?
    // The first frame (SETUP/RESUME) may be split across multiple TCP packets,
    // and a packet can even be shorter than the 3-byte length prefix. Buffer
    // incoming data until a full frame is available instead of assuming the
    // first `data` event contains a complete frame (which threw a TypeError,
    // surfacing as an unhandled rejection, on short or split first packets).
    let bufferedData = Bytes.alloc(0);
    const readFirstFrame = async (chunk: Uint8Array): Promise<void> => {
      bufferedData = Bytes.concat([bufferedData, chunk]);

      let first: IteratorResult<[Frame, number]>;
      try {
        first = deserializeFrames(bufferedData).next();
      } catch (error) {
        // A complete but malformed first frame — drop the connection.
        socket.destroy(error instanceof Error ? error : new Error(`${error}`));
        return;
      }

      if (first.done) {
        // Not enough bytes for a complete frame yet; wait for more data.
        socket.once("data", readFirstFrame);
        return;
      }

      const [frame, offset] = first.value;
      const connection = new TcpDuplexConnection(
        socket,
        frame,
        multiplexerDemultiplexerFactory
      );
      if (connection.done) {
        return;
      }
      try {
        socket.pause();
        await connectionAcceptor(frame, connection);
        socket.resume();
        if (offset < bufferedData.length) {
          connection.handleData(
            bufferedData.subarray(offset, bufferedData.length)
          );
        }
      } catch (error) {
        connection.close(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    };
    socket.once("data", readFirstFrame);
  }
}
