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

import { Bytes } from "@rsocket-ts/core";
import { WellKnownMimeType } from "./WellKnownMimeType";

export class CompositeMetadata implements Iterable<Entry> {
  _buffer: Uint8Array;

  constructor(buffer: Uint8Array) {
    this._buffer = buffer;
  }

  iterator(): Iterator<Entry> {
    return decodeCompositeMetadata(this._buffer);
  }

  [Symbol.iterator](): Iterator<Entry> {
    return decodeCompositeMetadata(this._buffer);
  }
}

export function encodeCompositeMetadata(
  metadata:
    | Map<string | WellKnownMimeType | number, Uint8Array | (() => Uint8Array)>
    | Array<
        [string | WellKnownMimeType | number, Uint8Array | (() => Uint8Array)]
      >
): Uint8Array {
  let encodedCompositeMetadata: Uint8Array = Bytes.alloc(0);
  for (const [metadataKey, metadataValue] of metadata) {
    const metadataRealValue =
      typeof metadataValue === "function" ? metadataValue() : metadataValue;

    if (
      metadataKey instanceof WellKnownMimeType ||
      typeof metadataKey === "number" ||
      metadataKey.constructor.name === "WellKnownMimeType"
    ) {
      encodedCompositeMetadata = encodeAndAddWellKnownMetadata(
        encodedCompositeMetadata,
        metadataKey as WellKnownMimeType | number,
        metadataRealValue
      );
    } else {
      encodedCompositeMetadata = encodeAndAddCustomMetadata(
        encodedCompositeMetadata,
        metadataKey,
        metadataRealValue
      );
    }
  }

  return encodedCompositeMetadata;
}

// see #encodeMetadataHeader(ByteBufAllocator, String, int)
export function encodeAndAddCustomMetadata(
  compositeMetaData: Uint8Array,
  customMimeType: string,
  metadata: Uint8Array
): Uint8Array {
  return Bytes.concat([
    compositeMetaData,
    encodeCustomMetadataHeader(customMimeType, metadata.byteLength),
    metadata,
  ]);
}

// see #encodeMetadataHeader(ByteBufAllocator, byte, int)
export function encodeAndAddWellKnownMetadata(
  compositeMetadata: Uint8Array,
  knownMimeType: WellKnownMimeType | number,
  metadata: Uint8Array
): Uint8Array {
  let mimeTypeId: number;

  if (Number.isInteger(knownMimeType)) {
    mimeTypeId = knownMimeType as number;
  } else {
    mimeTypeId = (knownMimeType as WellKnownMimeType).identifier;
  }

  return Bytes.concat([
    compositeMetadata,
    encodeWellKnownMetadataHeader(mimeTypeId, metadata.byteLength),
    metadata,
  ]);
}

export function decodeMimeAndContentBuffersSlices(
  compositeMetadata: Uint8Array,
  entryIndex: number
): Uint8Array[] {
  const mimeIdOrLength: number = Bytes.readInt8(compositeMetadata, entryIndex);
  let mime: Uint8Array;
  let toSkip = entryIndex;
  if (
    (mimeIdOrLength & STREAM_METADATA_KNOWN_MASK) ===
    STREAM_METADATA_KNOWN_MASK
  ) {
    mime = compositeMetadata.subarray(toSkip, toSkip + 1);
    toSkip += 1;
  } else {
    // M flag unset, remaining 7 bits are the length of the mime
    const mimeLength = (mimeIdOrLength & 0xff) + 1;

    if (compositeMetadata.byteLength > toSkip + mimeLength) {
      // need to be able to read an extra mimeLength bytes (we have already read one so byteLength should be strictly more)
      // here we need a way for the returned ByteBuf to differentiate between a
      // 1-byte length mime type and a 1 byte encoded mime id, preferably without
      // re-applying the byte mask. The easiest way is to include the initial byte
      // and have further decoding ignore the first byte. 1 byte buffer == id, 2+ byte
      // buffer == full mime string.
      mime = compositeMetadata.subarray(toSkip, toSkip + mimeLength + 1);

      // we thus need to skip the bytes we just sliced, but not the flag/length byte
      // which was already skipped in initial read
      toSkip += mimeLength + 1;
    } else {
      throw new Error(
        "Metadata is malformed. Inappropriately formed Mime Length"
      );
    }
  }

  if (compositeMetadata.byteLength >= toSkip + 3) {
    // ensures the length medium can be read
    const metadataLength = Bytes.readUInt24BE(compositeMetadata, toSkip);
    toSkip += 3;
    if (compositeMetadata.byteLength >= metadataLength + toSkip) {
      const metadata = compositeMetadata.subarray(
        toSkip,
        toSkip + metadataLength
      );
      return [mime, metadata];
    } else {
      throw new Error(
        "Metadata is malformed. Inappropriately formed Metadata Length or malformed content"
      );
    }
  } else {
    throw new Error(
      "Metadata is malformed. Metadata Length is absent or malformed"
    );
  }
}

export function decodeMimeTypeFromMimeBuffer(
  flyweightMimeBuffer: Uint8Array
): string {
  if (flyweightMimeBuffer.length < 2) {
    throw new Error("Unable to decode explicit MIME type");
  }
  // the encoded length is assumed to be kept at the start of the buffer
  // but also assumed to be irrelevant because the rest of the slice length
  // actually already matches _decoded_length
  return Bytes.readAscii(flyweightMimeBuffer, 1, flyweightMimeBuffer.length);
}

export function encodeCustomMetadataHeader(
  customMime: string,
  metadataLength: number
): Uint8Array {
  // allocate one byte + the length of the mimetype
  const metadataHeader: Uint8Array = Bytes.alloc(4 + customMime.length);
  // Bytes.alloc zero-fills, so no explicit clear is needed.

  // write the custom mime as ASCII (1 byte per char) and validate it below;
  // ASCII chars are encoded on 1 byte, matching the header layout.
  Bytes.writeAscii(metadataHeader, customMime, 1);
  const customMimeLength: number = customMime.length;
  if (!isAscii(metadataHeader, 1)) {
    throw new Error("Custom mime type must be US_ASCII characters only");
  }
  if (customMimeLength < 1 || customMimeLength > 128) {
    throw new Error(
      "Custom mime type must have a strictly positive length that fits on 7 unsigned bits, ie 1-128"
    );
  }
  // encoded length is one less than actual length, since 0 is never a valid length, which gives
  // wider representation range
  Bytes.writeUInt8(metadataHeader, customMimeLength - 1, 0);

  Bytes.writeUInt24BE(metadataHeader, metadataLength, customMimeLength + 1);

  return metadataHeader;
}

export function encodeWellKnownMetadataHeader(
  mimeType: number,
  metadataLength: number
): Uint8Array {
  const buffer: Uint8Array = Bytes.alloc(4);

  Bytes.writeUInt8(buffer, mimeType | STREAM_METADATA_KNOWN_MASK, 0);
  Bytes.writeUInt24BE(buffer, metadataLength, 1);

  return buffer;
}

export function* decodeCompositeMetadata(
  buffer: Uint8Array
): Generator<Entry, void, any> {
  const length = buffer.byteLength;
  let entryIndex = 0;

  while (entryIndex < length) {
    const headerAndData = decodeMimeAndContentBuffersSlices(buffer, entryIndex);

    const header = headerAndData[0];
    const data = headerAndData[1];

    entryIndex = computeNextEntryIndex(entryIndex, header, data);

    if (!isWellKnownMimeType(header)) {
      const typeString = decodeMimeTypeFromMimeBuffer(header);
      if (!typeString) {
        throw new Error("MIME type cannot be null");
      }

      yield new ExplicitMimeTimeEntry(data, typeString);
      continue;
    }

    const id = decodeMimeIdFromMimeBuffer(header);
    const type = WellKnownMimeType.fromIdentifier(id);
    if (WellKnownMimeType.UNKNOWN_RESERVED_MIME_TYPE === type) {
      yield new ReservedMimeTypeEntry(data, id);
      continue;
    }

    yield new WellKnownMimeTypeEntry(data, type);
  }
}

export interface Entry {
  /**
   * Returns the un-decoded content of the {@link Entry}.
   *
   * @return the un-decoded content of the {@link Entry}
   */
  readonly content: Uint8Array;

  /**
   * Returns the MIME type of the entry, if it can be decoded.
   *
   * @return the MIME type of the entry, if it can be decoded, otherwise {@code null}.
   */
  readonly mimeType?: string;
}

export class ExplicitMimeTimeEntry implements Entry {
  constructor(
    readonly content: Uint8Array,
    readonly type: string
  ) {}
}

export class ReservedMimeTypeEntry implements Entry {
  constructor(
    readonly content: Uint8Array,
    readonly type: number
  ) {}

  /**
   * Since this entry represents a compressed id that couldn't be decoded, this is
   * always {@code null}.
   */
  get mimeType(): string | undefined {
    return undefined;
  }
}

export class WellKnownMimeTypeEntry implements Entry {
  constructor(
    readonly content: Uint8Array,
    readonly type: WellKnownMimeType
  ) {}

  get mimeType(): string {
    return this.type.string;
  }
}

function decodeMimeIdFromMimeBuffer(mimeBuffer: Uint8Array): number {
  if (!isWellKnownMimeType(mimeBuffer)) {
    return WellKnownMimeType.UNPARSEABLE_MIME_TYPE.identifier;
  }
  return Bytes.readInt8(mimeBuffer, 0) & STREAM_METADATA_LENGTH_MASK;
}

function computeNextEntryIndex(
  currentEntryIndex: number,
  headerSlice: Uint8Array,
  contentSlice: Uint8Array
): number {
  return (
    currentEntryIndex +
    headerSlice.byteLength + // this includes the mime length byte
    3 + // 3 bytes of the content length, which are excluded from the slice
    contentSlice.byteLength
  );
}

function isWellKnownMimeType(header: Uint8Array): boolean {
  return header.byteLength === 1;
}

const STREAM_METADATA_KNOWN_MASK = 0x80; // 1000 0000
const STREAM_METADATA_LENGTH_MASK = 0x7f; // 0111 1111

function isAscii(buffer: Uint8Array, offset: number): boolean {
  let isAscii = true;
  for (let i = offset, length = buffer.length; i < length; i++) {
    if (buffer[i] > 127) {
      isAscii = false;
      break;
    }
  }

  return isAscii;
}
