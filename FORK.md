# How this fork differs from upstream `rsocket-js`

[`alexey-sh/rsocket`](https://github.com/alexey-sh/rsocket) is an **independent fork** of
[`rsocket/rsocket-js`](https://github.com/rsocket/rsocket-js) that continues the stalled
**Flow → TypeScript 1.0 rewrite** (upstream tracking issue
[#158](https://github.com/rsocket/rsocket-js/issues/158)).

We develop **independently**: we do not open pull requests against upstream and do not track
upstream releases. Packages remain `1.0.0-alpha.*` and **UNSTABLE** — breaking changes are
expected — and the library will eventually be published under a **new npm scope** (the bare
`rsocket-*` names are owned upstream).

Everything below is what changed relative to the upstream `1.0.x-alpha` branch this fork was
started from.

## At a glance

- **Node 24** baseline (`engines: >=22`).
- **TypeScript 6** with full **`strict`** across every package.
- **Public binary type is `Uint8Array`**, not `Buffer` — browser-neutral; no `Buffer.*` call
  remains in any package's source.
- **Dual ESM + CJS** output with a proper `exports` map (was CJS-only).
- Modern toolchain: **ESLint 9** flat config, **Prettier 3**, **jest 30**, **lerna 9**,
  **Apollo Server v5 / Client v4**.
- **~20 protocol / correctness fixes**, each with regression tests.

## Platform, toolchain & build

| Area          | Upstream `1.0.x-alpha`  | This fork                                      | How                                                                                                                                                |
| ------------- | ----------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node          | 14/16-era               | **24** (`engines: >=22`)                       | `.nvmrc` + per-package `engines`                                                                                                                   |
| TypeScript    | ~4.x, non-strict        | **6.x, `strict: true`**                        | Rolled out flag-by-flag; target ES2022                                                                                                             |
| Binary type   | `Buffer` (Node-only)    | **`Uint8Array`** (browser-neutral)             | New oracle-tested `Bytes.ts` byte-helpers in core, re-exported as `Bytes`; all packages migrated                                                   |
| Module format | CJS only (`main`)       | **Dual ESM + CJS**                             | Build tool `tsc` → **tsup**; each package emits `index.{js,mjs,d.ts,d.mts}` + sourcemaps behind a package.json `exports` map + `sideEffects:false` |
| Lint / format | ESLint 8 / Prettier 2   | **ESLint 9 flat config / Prettier 3**          | `eslint.config.js`; lint = Prettier-as-error                                                                                                       |
| Test runner   | jest (older)            | **jest 30** + ts-jest; tests import **source** | `moduleNameMapper` maps `rsocket-*` → `packages/*/src`                                                                                             |
| GraphQL       | Apollo Server v3        | **Apollo Server v5 / Client v4**               | Rewrote `graphql-apollo-server`/`-link` onto the new APIs                                                                                          |
| `baseUrl`     | set (deprecated in TS6) | **removed**                                    | `paths` resolve without it since TS 5.4                                                                                                            |

## Correctness & protocol fixes

Each fix ships with a regression test.

| Fix                                                                     | How                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Responder outbound payloads never fragmented (#306/#307)                | `DefaultStreamRequestHandler` was constructed with a hardcoded `fragmentSize 0`; now threads `maxOutboundFragmentSize ?? 0` like the requester                                                                     |
| `REQUEST_N` with `requestN < 1` accepted (M1)                           | Reject at the 3 REQUEST_N consumption sites → terminate that **stream** (spec: MUST be >0; Reactive-Streams rule 3.9; signed int32 decode reads over-range values negative). Stream-scoped, not connection-killing |
| `metadataPush` length crash (C1)                                        | Guard the metadata-length read in the metadata-push path                                                                                                                                                           |
| RESUME major/minor version swap (C2)                                    | Fixed transposed major/minor fields in the RESUME frame codec                                                                                                                                                      |
| `isFragmentable` null-data crash (C3)                                   | Null-guard payload data before the size check                                                                                                                                                                      |
| tcp-server partial-first-frame DoS (C4)                                 | Bound the buffering of an incomplete first frame                                                                                                                                                                   |
| EXT frame codec + resume position (C5/M2)                               | Fixed EXT encode/decode; EXT now advances the resume position                                                                                                                                                      |
| metadata-push end-to-end (H1/H2)                                        | Wired requester → responder metadata-push                                                                                                                                                                          |
| channel deferred-error (H3)                                             | Deliver a deferred error correctly on the channel responder                                                                                                                                                        |
| websocket-server duplex close/error (H4)                                | Proper close/error propagation on the ws-server duplex                                                                                                                                                             |
| LeaseHandler pending-request hang (H5)                                  | Release lease-gated pending requests instead of hanging                                                                                                                                                            |
| metadata-flag consistency (M3), lenient stream-0 processing (M5)        | Align METADATA flag handling; ignore stray/unknown stream-0 frames                                                                                                                                                 |
| monotonic keepalive clock (#298)                                        | `performance.now()` instead of wall-clock                                                                                                                                                                          |
| websocket-server `send()`/`create()` guards (#278)                      | Guard against use-after-close                                                                                                                                                                                      |
| Initial `requestN < 1` in REQUEST_STREAM/REQUEST_CHANNEL (M1 follow-up) | Validate the initial requestN in the responder constructor, before the handler runs; terminate that stream (ERROR CANCELED). Completes M1, which covered only mid-stream REQUEST_N                                 |
| KEEPALIVE ack echoed inbound flags (M4)                                 | Reply with `Flags.NONE` instead of `flags ^ RESPOND`, so the ack never echoes IGNORE (or any other inbound flag)                                                                                                   |
| `StreamIdGenerator` overflowed past 2^31-1 (L2)                         | Wrap to the lowest id of the generator's parity at `MAX_STREAM_ID` and skip in-use ids, instead of an unbounded `+2` that encodes as a negative int32                                                              |
| Server close dropped the error to onClose (#279)                        | TCP/WS `ServerCloseable` now forwards it: `super.close(error)`                                                                                                                                                     |
| `Deferred` retained onClose callbacks forever (L1)                      | Snapshot and clear `onCloseCallbacks` in `close()` so their closures are released                                                                                                                                  |

## Ecosystem / DX

| Change                          | How                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bytes` byte-helpers exposed    | `import { Bytes } from "rsocket-core"` — BE int read/write, utf8/ascii, `concat`/`alloc`, zero-copy `subarray`                                       |
| Examples modernized             | `Buffer`→`Uint8Array`, ~59 `strict` errors cleared, `new WebSocket.Server` → `{ WebSocketServer }`, readable log output via a `bytesToUtf8()` helper |
| Package encapsulation           | The `exports` map blocks deep `/src` imports — only the public entry is importable                                                                   |
| Buffer forbidden in core source | ESLint `no-restricted-globals` bans the `Buffer` global in `rsocket-core/src` (tests + Node transports exempt)                                       |
| Exports/types validated         | `yarn check:exports` runs `@arethetypeswrong/cli` over all 10 packages (node10 / node16 CJS+ESM / bundler)                                           |

## Still planned

- Publish under a new npm scope (the bare `rsocket-*` names are owned upstream).

Investigated and intentionally left unchanged:

- **Fire-and-forget requester (L3):** it never registers in the stream registry, so its
  ERROR-handling path is unreachable — but per spec fire-and-forget expects no response, so that
  is correct and the dead code is harmless.
- **Deserializer streamId (M6):** connection frames (SETUP/KEEPALIVE/LEASE/METADATA_PUSH/RESUME/
  RESUME_OK) correctly force streamId 0, and every per-stream frame already preserves the decoded
  id — no defect found.
