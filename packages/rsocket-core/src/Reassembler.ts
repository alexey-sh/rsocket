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

import { Payload } from "./RSocket";
import * as Bytes from "./Bytes";

export interface FragmentsHolder {
  hasFragments: boolean;
  data: Uint8Array | undefined | null;
  metadata: Uint8Array | undefined | null;
}

export function add(
  holder: FragmentsHolder,
  dataFragment: Uint8Array | null | undefined,
  metadataFragment?: Uint8Array | undefined | null
): boolean {
  if (!holder.hasFragments) {
    holder.hasFragments = true;
    holder.data = dataFragment;
    if (metadataFragment) {
      holder.metadata = metadataFragment;
    }
    return true;
  }

  // TODO: add validation
  // A metadata-only fragment carries no data, so only extend when present.
  if (dataFragment) {
    holder.data = holder.data
      ? Bytes.concat([holder.data, dataFragment])
      : dataFragment;
  }
  if (holder.metadata && metadataFragment) {
    holder.metadata = Bytes.concat([holder.metadata, metadataFragment]);
  }

  return true;
}

export function reassemble(
  holder: FragmentsHolder,
  dataFragment: Uint8Array | null | undefined,
  metadataFragment: Uint8Array | undefined | null
): Payload {
  // TODO: add validation
  holder.hasFragments = false;

  const data =
    holder.data && dataFragment
      ? Bytes.concat([holder.data, dataFragment])
      : (holder.data ?? dataFragment);

  holder.data = undefined;

  if (holder.metadata) {
    const metadata = metadataFragment
      ? Bytes.concat([holder.metadata, metadataFragment])
      : holder.metadata;

    holder.metadata = undefined;

    return {
      data,
      metadata,
    };
  }

  return {
    data,
  };
}

export function cancel(holder: FragmentsHolder): void {
  holder.hasFragments = false;
  holder.data = undefined;
  holder.metadata = undefined;
}
