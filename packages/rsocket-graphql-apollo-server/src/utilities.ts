import { Bytes, Payload } from "@rsocket-ts/core";
import {
  decodeCompositeMetadata,
  decodeRoutes,
  WellKnownMimeType,
} from "@rsocket-ts/composite-metadata";
import MESSAGE_RSOCKET_ROUTING = WellKnownMimeType.MESSAGE_RSOCKET_ROUTING;

const APPLICATION_GRAPHQL_JSON = "application/graphql+json";

function hasGraphQLJsonMimeType(metadata: Map<string, any>) {
  return (
    metadata.get(WellKnownMimeType.MESSAGE_RSOCKET_MIMETYPE.toString()) ===
    APPLICATION_GRAPHQL_JSON
  );
}

export function parsePayloadForQuery(payload: Payload) {
  const { data } = payload;
  const decoded = Bytes.readUtf8(data!, 0, data!.length);
  return JSON.parse(decoded);
}

export function mapMetadata(payload: Payload) {
  const mappedMetaData = new Map<string, any>();
  if (payload.metadata) {
    const decodedCompositeMetaData = decodeCompositeMetadata(payload.metadata);

    for (let metaData of decodedCompositeMetaData) {
      switch (metaData.mimeType) {
        case MESSAGE_RSOCKET_ROUTING.toString(): {
          const tags = [];
          for (let decodedRoute of decodeRoutes(metaData.content)) {
            tags.push(decodedRoute);
          }
          const joinedRoute = tags.join(".");
          mappedMetaData.set(MESSAGE_RSOCKET_ROUTING.toString(), joinedRoute);
          break;
        }
        default: {
          mappedMetaData.set(
            metaData.mimeType!,
            Bytes.readUtf8(metaData.content, 0, metaData.content.length)
          );
          break;
        }
      }
    }
  }
  return mappedMetaData;
}

export function isObject(val: unknown): val is Record<PropertyKey, unknown> {
  return typeof val === "object" && val !== null;
}

export function isAsyncGenerator<T = unknown>(
  val: unknown
): val is AsyncGenerator<T> {
  return (
    isObject(val) &&
    typeof Object(val)[Symbol.asyncIterator] === "function" &&
    typeof val.return === "function"
  );
}
