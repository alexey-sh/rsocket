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

/**
 * Byte helpers for reading/writing big-endian integers and encoding strings
 * over plain `Uint8Array`s, so the protocol codec has no dependency on Node's
 * `Buffer` (making it usable unchanged in browsers).
 *
 * The read helpers return the decoded value; the write helpers return the
 * offset of the next byte (mirroring Node `Buffer.writeUIntXBE`), so callers
 * can keep the `offset = write(...)` chaining idiom. Reads/writes use manual
 * byte math (no `DataView`) to sidestep the byteOffset bookkeeping that a
 * `DataView` over a subarray view would require.
 */

// Text codecs are stateless once constructed; reuse a single instance.
const textEncoder = new TextEncoder();
const utf8Decoder = new TextDecoder(); // defaults to utf-8

// --- unsigned/signed big-endian reads --------------------------------------

export function readUInt8(buffer: Uint8Array, offset: number): number {
  return buffer[offset];
}

export function readUInt16BE(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] << 8) | buffer[offset + 1];
}

export function readInt16BE(buffer: Uint8Array, offset: number): number {
  const value = (buffer[offset] << 8) | buffer[offset + 1];
  return value & 0x8000 ? value - 0x10000 : value;
}

/**
 * Read a uint24 from a buffer starting at the given offset.
 */
export function readUInt24BE(buffer: Uint8Array, offset: number): number {
  const val1 = buffer[offset] << 16;
  const val2 = buffer[offset + 1] << 8;
  const val3 = buffer[offset + 2];
  return val1 | val2 | val3;
}

export function readUInt32BE(buffer: Uint8Array, offset: number): number {
  // Avoid the sign flip that `buffer[offset] << 24` would cause for bytes >=
  // 0x80 by scaling the high byte with multiplication instead of a shift.
  return (
    buffer[offset] * 0x1000000 +
    ((buffer[offset + 1] << 16) |
      (buffer[offset + 2] << 8) |
      buffer[offset + 3])
  );
}

export function readInt32BE(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] << 24) |
    (buffer[offset + 1] << 16) |
    (buffer[offset + 2] << 8) |
    buffer[offset + 3]
  );
}

/**
 * Read a uint64 (technically supports up to 53 bits per JS number
 * representation).
 */
export function readUInt64BE(buffer: Uint8Array, offset: number): number {
  const high = readUInt32BE(buffer, offset);
  const low = readUInt32BE(buffer, offset + 4);
  return high * 0x100000000 + low;
}

// --- big-endian writes (return the next offset) ----------------------------

export function writeUInt8(
  buffer: Uint8Array,
  value: number,
  offset: number
): number {
  buffer[offset] = value & 0xff;
  return offset + 1;
}

export function writeUInt16BE(
  buffer: Uint8Array,
  value: number,
  offset: number
): number {
  buffer[offset] = (value >>> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
  return offset + 2;
}

/**
 * Writes a uint24 to a buffer starting at the given offset, returning the
 * offset of the next byte.
 */
export function writeUInt24BE(
  buffer: Uint8Array,
  value: number,
  offset: number
): number {
  buffer[offset] = (value >>> 16) & 0xff; // 3rd byte
  buffer[offset + 1] = (value >>> 8) & 0xff; // 2nd byte
  buffer[offset + 2] = value & 0xff; // 1st byte
  return offset + 3;
}

export function writeUInt32BE(
  buffer: Uint8Array,
  value: number,
  offset: number
): number {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
  return offset + 4;
}

/**
 * Write a signed int32. Byte-identical to writeUInt32BE (`>>>` yields the
 * two's-complement representation), exposed separately for call-site clarity.
 */
export function writeInt32BE(
  buffer: Uint8Array,
  value: number,
  offset: number
): number {
  return writeUInt32BE(buffer, value, offset);
}

/**
 * Write a uint64 (technically supports up to 53 bits per JS number
 * representation).
 */
export function writeUInt64BE(
  buffer: Uint8Array,
  value: number,
  offset: number
): number {
  const high = Math.floor(value / 0x100000000);
  const low = value % 0x100000000;
  offset = writeUInt32BE(buffer, high, offset); // first half of uint64
  return writeUInt32BE(buffer, low, offset); // second half of uint64
}

// --- allocation / copying --------------------------------------------------

/**
 * Allocate a zero-filled buffer of the given size.
 */
export function alloc(size: number): Uint8Array {
  return new Uint8Array(size);
}

/**
 * Concatenate a list of buffers into a single new buffer.
 */
export function concat(chunks: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Copy `source` into `target` at `targetOffset`, returning the offset of the
 * next byte in `target` (mirroring `Buffer.copy`'s bytes-written accounting).
 */
export function copy(
  source: Uint8Array,
  target: Uint8Array,
  targetOffset: number
): number {
  target.set(source, targetOffset);
  return targetOffset + source.length;
}

// --- string encoding -------------------------------------------------------

/**
 * Number of bytes needed to encode `value` as UTF-8.
 */
export function utf8Length(value: string): number {
  return textEncoder.encode(value).length;
}

/**
 * Number of bytes needed to encode `value` as ASCII (one byte per code unit).
 */
export function asciiLength(value: string): number {
  return value.length;
}

/**
 * Encode `value` as UTF-8 into `target` at `offset`, returning the next offset.
 */
export function writeUtf8(
  target: Uint8Array,
  value: string,
  offset: number
): number {
  const bytes = textEncoder.encode(value);
  target.set(bytes, offset);
  return offset + bytes.length;
}

/**
 * Encode `value` as ASCII into `target` at `offset`, returning the next offset.
 * ASCII (RSocket MIME-type strings) is one byte per code unit.
 */
export function writeAscii(
  target: Uint8Array,
  value: string,
  offset: number
): number {
  for (let i = 0; i < value.length; i++) {
    target[offset + i] = value.charCodeAt(i) & 0xff;
  }
  return offset + value.length;
}

/**
 * Decode the `[start, end)` range of `buffer` as UTF-8.
 */
export function readUtf8(
  buffer: Uint8Array,
  start: number,
  end: number
): string {
  return utf8Decoder.decode(buffer.subarray(start, end));
}

/**
 * Decode the `[start, end)` range of `buffer` as ASCII.
 */
export function readAscii(
  buffer: Uint8Array,
  start: number,
  end: number
): string {
  let result = "";
  for (let i = start; i < end; i++) {
    result += String.fromCharCode(buffer[i]);
  }
  return result;
}

/**
 * Encode a whole string as a new UTF-8 buffer.
 */
export function fromUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}
