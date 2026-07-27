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

export class RoutingMetadata implements Iterable<string> {
  _buffer: Uint8Array;

  constructor(buffer: Uint8Array) {
    this._buffer = buffer;
  }

  iterator(): Iterator<string> {
    return decodeRoutes(this._buffer);
  }

  [Symbol.iterator](): Iterator<string> {
    return decodeRoutes(this._buffer);
  }
}

/**
 * Encode given set of routes into {@link Uint8Array} following the <a href="https://github.com/rsocket/rsocket/blob/master/Extensions/Routing.md">Routing Metadata Layout</a>
 *
 * @param routes non-empty set of routes
 * @returns {Uint8Array} with encoded content
 */
export function encodeRoutes(...routes: string[]): Uint8Array {
  if (routes.length < 1) {
    throw new Error("routes should be non empty array");
  }

  return Bytes.concat(routes.map((route) => encodeRoute(route)));
}

export function encodeRoute(route: string): Uint8Array {
  const encodedRoute = Bytes.fromUtf8(route);

  if (encodedRoute.length > 255) {
    throw new Error(
      `route length should fit into unsigned byte length but the given one is ${encodedRoute.length}`
    );
  }

  const encodedLength = Bytes.alloc(1);

  Bytes.writeUInt8(encodedLength, encodedRoute.length, 0);

  return Bytes.concat([encodedLength, encodedRoute]);
}

export function* decodeRoutes(
  routeMetadataBuffer: Uint8Array
): Generator<string, void, any> {
  const length = routeMetadataBuffer.byteLength;
  let offset = 0;

  while (offset < length) {
    const routeLength = Bytes.readUInt8(routeMetadataBuffer, offset++);

    if (offset + routeLength > length) {
      throw new Error(
        `Malformed RouteMetadata. Offset(${offset}) + RouteLength(${routeLength}) is greater than TotalLength`
      );
    }

    const route = Bytes.readUtf8(
      routeMetadataBuffer,
      offset,
      offset + routeLength
    );
    offset += routeLength;
    yield route;
  }
}
