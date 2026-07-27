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

import { Bytes } from "@rsocket-ts/core";

/**
 * Decodes payload bytes to a UTF-8 string for human-readable logging.
 *
 * Payload data is a `Uint8Array`, whose default `toString()` (used when it is
 * interpolated into a template literal) yields a comma-joined list of byte
 * values rather than text. These examples send UTF-8 text, so decode it for
 * display. `null`/`undefined` are passed through as-is so log lines stay
 * informative when a payload carries no data.
 */
export function bytesToUtf8(data?: Uint8Array | null): string {
  return data == null ? String(data) : Bytes.readUtf8(data, 0, data.length);
}
