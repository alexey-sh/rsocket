/*
 * Copyright 2021-2024 the original author or authors.
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

import { Bytes, Payload, RSocket, RSocketConnector } from "rsocket-core";
import { bytesToUtf8 } from "../../shared/bytesToUtf8";
import { TcpClientTransport } from "rsocket-tcp-client";
import {
  encodeBearerAuthMetadata,
  encodeCompositeMetadata,
  encodeRoute,
  WellKnownMimeType,
} from "rsocket-composite-metadata";
import { exit } from "process";
import Logger from "../../shared/logger";
import MESSAGE_RSOCKET_ROUTING = WellKnownMimeType.MESSAGE_RSOCKET_ROUTING;
import MESSAGE_RSOCKET_AUTHENTICATION = WellKnownMimeType.MESSAGE_RSOCKET_AUTHENTICATION;

function makeMetadata(bearerToken?: string, route?: string) {
  const map = new Map<WellKnownMimeType, Uint8Array>();

  if (bearerToken) {
    map.set(
      MESSAGE_RSOCKET_AUTHENTICATION,
      encodeBearerAuthMetadata(Bytes.fromUtf8(bearerToken))
    );
  }

  if (route) {
    const encodedRoute = encodeRoute(route);
    map.set(MESSAGE_RSOCKET_ROUTING, encodedRoute);
  }

  return encodeCompositeMetadata(map);
}

function makeConnector(token: string) {
  // NOTE: THIS EXAMPLE DOES NOT COVER TLS.
  //       ALWAYS USE A SECURE CONNECTION SUCH AS TLS WHEN TRANSMITTING SENSITIVE INFORMATION SUCH AS AUTH TOKENS.
  return new RSocketConnector({
    transport: new TcpClientTransport({
      connectionOptions: {
        host: "127.0.0.1",
        port: 9090,
      },
    }),
    setup: {
      payload: {
        data: Bytes.alloc(0),
        metadata: makeMetadata(token),
      },
    },
  });
}

async function requestResponse(
  rsocket: RSocket,
  compositeMetaData: Uint8Array,
  message: string = ""
): Promise<Payload> {
  return new Promise((resolve, reject) => {
    return rsocket.requestResponse(
      {
        data: Bytes.fromUtf8(message),
        metadata: compositeMetaData,
      },
      {
        onError: (e) => {
          reject(e);
        },
        onNext: (payload, isComplete) => {
          Logger.info(
            `onNext payload[data: ${bytesToUtf8(payload.data)}; metadata: ${payload.metadata}]|${isComplete}`
          );
          resolve(payload);
        },
        onComplete: () => {},
        onExtension: () => {},
      }
    );
  });
}

async function main() {
  try {
    // we expect this connection to fail because we aren't passing a valid token
    const connector = makeConnector("");
    const rsocket = await connector.connect();
    await new Promise(function (resolve, reject) {
      Logger.info("Rejecting once socket closes...");
      rsocket.onClose((e) => {
        reject(e);
      });
    });
  } catch (e) {
    Logger.error(`Expected error: ${e}`);
  }

  // NOTE: YOU SHOULD NEVER HARD CODE AN AUTH TOKEN IN A FILE IN THIS WAY. THIS IS PURELY FOR EXAMPLE PURPOSES.
  // The SHA1 HASH of rsocket-js-2024-10
  const exampleToken = "8a7d50f76ef86c75bd3563e55f8835515189dbff";

  // we expect this connection to succeed because we pass a valid token
  const connector = makeConnector(exampleToken);
  const rsocket = await connector.connect();

  // this request SHOULD pass
  const echoResponse = await requestResponse(
    rsocket,
    makeMetadata(undefined, "EchoService.echo"),
    "Hello World"
  );
  Logger.info(
    `EchoService.echo response: ${Bytes.readUtf8(
      echoResponse.data!,
      0,
      echoResponse.data!.length
    )}`
  );

  // this request will reject (unknown route)
  try {
    await requestResponse(
      rsocket,
      makeMetadata(undefined, "UnknownService.unknown"),
      "Hello World"
    );
  } catch (e) {
    Logger.error(`Expected error: ${e}`);
  }

  // this request will reject (no routing data)
  try {
    await requestResponse(rsocket, makeMetadata(undefined), "Hello World");
  } catch (e) {
    Logger.error(`Expected error: ${e}`);
  }

  const whoAmiResponse = await requestResponse(
    rsocket,
    makeMetadata(exampleToken, "AuthService.whoAmI")
  );
  Logger.info(
    `AuthService.whoAmI response: ${Bytes.readUtf8(
      whoAmiResponse.data!,
      0,
      whoAmiResponse.data!.length
    )}`
  );
}

main()
  .then(() => exit())
  .catch((error: Error) => {
    Logger.error(error);
    setTimeout(() => {
      exit(1);
    });
  });
