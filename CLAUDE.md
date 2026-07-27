# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@rsocket-ts` is a JavaScript/TypeScript implementation of the [RSocket](https://rsocket.io/)
protocol (Reactive Streams semantics over an async binary transport, for browsers and Node.js).

This repository is a **ground-up rewrite from Flow to TypeScript** — an independent fork continuing
upstream issue #158. It is a young fork, so breaking changes are still possible between releases; the
upstream `0.x.x` sources are unrelated to work here.

It is a **Lerna + Yarn-workspaces monorepo** with packages under `packages/*` (fixed-versioned at
`2.0.0`), each published to NPM under the `@rsocket-ts` scope (e.g. `@rsocket-ts/core`). Directory
names keep the `rsocket-` prefix (`packages/rsocket-core`); the published package name does not.

## Protocol reference

The wire behavior is defined by the upstream RSocket spec, and this codebase mirrors it closely — consult it before changing frame-handling code:

- [Motivations](https://raw.githubusercontent.com/rsocket/rsocket/master/Motivations.md) — why the protocol exists (interaction models, app-level flow control, resumption).
- [FAQ](https://raw.githubusercontent.com/rsocket/rsocket/master/FAQ.md) — design rationale; note the four interaction models are specializations of request-channel.
- [Protocol](https://raw.githubusercontent.com/rsocket/rsocket/master/Protocol.md) — the wire format: frames, flags, stream IDs, flow control, resumption, error codes.

Spec → code mapping: frame types/flags → `Frames.ts`; header/length codec → `Codecs.ts`; stream-ID scheme (client odd, server even, 0 = connection) → `StreamIdGenerator` in `ClientServerMultiplexerDemultiplexer.ts`; interaction models → the four `Request*Stream.ts` machines; lease → `Lease.ts`; keepalive → `RSocketSupport.ts`; fragmentation → `Fragmenter.ts`/`Reassembler.ts`; resumption (64-bit positions, RESUME/RESUME_OK) → `Resume.ts` + the `Resumable*` multiplexers; error codes → `Errors.ts`. Two spec rules are easy to break when editing handlers: frame processing must stay **lenient** (ignore unknown stream IDs, stray frames, and unknown flag bits), and `request(n)` **credits are cumulative and non-revocable**.

## Commands

Node is pinned to **v24** (`.nvmrc`, `engines: >=22`); use `nvm use`. Package manager is **Yarn** (classic, workspaces).

From the repo root:

- `yarn build` — build all packages (`lerna run build` → `tsup` per package into `dist/`; dual CJS+ESM + `.d.ts`).
- `yarn test` — test all packages. **Note:** the `pretest` hook runs `yarn clean` first (wipes all `dist/` and `coverage/`).
- `yarn lint` / `yarn lint:fix` — ESLint over all `js,ts`. Linting is effectively **Prettier as an error rule**, so `lint:fix` = format.
- `yarn clean` — remove all `dist/` output and `coverage/`.
- `yarn check:exports` — build, then validate every package's `exports`/types with `@arethetypeswrong/cli`.

Per-package (avoids the clean-everything pretest hook):

- `yarn workspace @rsocket-ts/core test` — test one package.
- `yarn workspace @rsocket-ts/core build` — build one package.

Single test file / single test (run inside the package dir, since the package `test` script is just `yarn jest`):

- `cd packages/rsocket-core && yarn jest RSocketConnector` — files matching a pattern.
- `cd packages/rsocket-core && yarn jest -t "resumes the stream"` — tests matching a name.

Run an example (from `@rsocket-ts/examples`, uses `ts-node`):

- `yarn workspace @rsocket-ts/examples start-client-server-request-response-tcp` — see that package's `package.json` `scripts` for the full list of `start-*` targets.

### Important build/test wiring

- **Tests import source, not build output.** Each package's `jest.config.ts` uses `ts-jest` + a `moduleNameMapper` that mirrors the root `tsconfig.json` `paths`, mapping `@rsocket-ts/*` → `packages/rsocket-*/src`. So cross-package imports resolve to live TypeScript source during tests/dev, and to compiled `dist/` only after `yarn build`. You do **not** need to build dependencies before testing a package.
- Builds use `tsup` (esbuild); the `.d.ts` step type-checks against `tsconfig.build.json`, so a type error there fails the build.
- Only 6 packages have tests: `@rsocket-ts/core`, `@rsocket-ts/tcp-client`, `@rsocket-ts/tcp-server`, `@rsocket-ts/websocket-client`, `@rsocket-ts/websocket-server`, `@rsocket-ts/composite-metadata`. The rest (`@rsocket-ts/messaging`, `@rsocket-ts/adapter-rxjs`, both `graphql-*`, `examples`) have **no test suite** — verify changes to them via examples or by building.

## Architecture

### Layering (dependency direction)

```
transports          higher-level / ergonomics
tcp-{client,server}  composite-metadata → messaging → adapter-rxjs
websocket-{c,s}      graphql-apollo-{link,server}
        \                    /
         → core ←
```

All packages are published as `@rsocket-ts/*`. `@rsocket-ts/core` depends on nothing. Every other
package depends on it (directly or transitively) and packages reference each other by published name
(`@rsocket-ts/core`), never by relative path.

### @rsocket-ts/core — the protocol engine (transport-agnostic)

The mental model: **core speaks frames and Reactive-Streams callbacks; it never touches sockets and never exposes Promises/Observables.**

- **`RSocket.ts`** — the `RSocket` interface: the five interaction models (`fireAndForget`, `requestResponse`, `requestStream`, `requestChannel`, `metadataPush`). Interactions are expressed with low-level callback interfaces — `Cancellable`, `Requestable` (`request(n)`), `OnNextSubscriber`, `OnTerminalSubscriber`, `OnExtensionSubscriber` — **not** Promises. Backpressure is explicit via `request(n)`. A `SocketAcceptor.accept()` returns a `Partial<RSocket>` (the responder).
- **`RSocketConnector.ts` / `RSocketServer.ts`** — the two entry points. `connector.connect()` builds the SETUP frame and returns an `RSocket` you call as a client. `server.bind()` takes a `SocketAcceptor`; on each SETUP it wires up handlers and asks the acceptor for a responder. Both configure keepalive, lease, resume, and fragmentation here.
- **`Transport.ts`** — the pluggable-transport contracts: `ClientTransport.connect()`, `ServerTransport.bind()`, `DuplexConnection`, and the `Outbound` / `Multiplexer` / `Demultiplexer` / `*FrameHandler` interfaces that connect transports to the core.
- **`ClientServerMultiplexerDemultiplexer.ts`** — routes frames by **stream ID**: stream 0 = connection-level (setup/keepalive/lease/metadata-push), non-zero = per-request streams. Multiplexes many concurrent interactions over one connection. `Resumable*` and `ResumeOkAwaiting*` subclasses add session resumption. `StreamIdGenerator` assigns client-odd / server-even IDs.
- **`RSocketSupport.ts`** — the concrete glue between the above:
  - `RSocketRequester` — implements `RSocket` for the **outbound** (requesting) side.
  - `DefaultStreamRequestHandler` — dispatches **inbound** requests to the responder.
  - `DefaultConnectionFrameHandler`, `KeepAliveHandler` / `KeepAliveSender`, `LeaseHandler` — connection-level concerns.
- **Per-interaction state machines** — `RequestResponseStream.ts`, `RequestStreamStream.ts`, `RequestChannelStream.ts`, `RequestFnFStream.ts`. Each file implements **both the requester and responder halves** of that one interaction model.
- **Frame plumbing** — `Frames.ts` (`FrameTypes` enum, `Flags`), `Codecs.ts` (byte ⇄ frame), `Fragmenter.ts` / `Reassembler.ts` (fragmentation across MTU), `Resume.ts` (`FrameStore` for replay), `Lease.ts`, `Errors.ts` (`ErrorCodes`, `RSocketError`).

### Transports (one package per transport)

Each implements `ClientTransport`/`ServerTransport` from core and provides a `*DuplexConnection`
that turns raw bytes into frames and feeds the multiplexer/demultiplexer. They depend on core only.
`XxxClientTransport` + `XxxDuplexConnection` is the consistent shape (see `@rsocket-ts/tcp-client`,
`@rsocket-ts/websocket-client`). WebSocket client works in the browser and Node (via `ws`).

### Higher-level packages

- **`@rsocket-ts/composite-metadata`** — RSocket composite-metadata encoding plus well-known MIME
  and auth type tables (`WellKnownMimeType`, `WellKnownAuthType`), `RoutingMetadata`, `AuthMetadata`.
  This is how you attach routing keys (Spring-style `route`) and auth to payloads.
- **`@rsocket-ts/messaging`** — routing-oriented requester API built on composite-metadata.
- **`@rsocket-ts/adapter-rxjs`** — bridges core's callback/`request(n)` world to **RxJS Observables**
  (`Requesters`, `Responders`). This is where prefetching/buffering between Reactive Streams and Rx happens.
- **`@rsocket-ts/graphql-apollo-link` / `-server`** — GraphQL-over-RSocket via Apollo.

### @rsocket-ts/examples

Runnable, `private` (never published) reference programs run through `ts-node` + `tsconfig-paths`.
The best source of end-to-end usage patterns for each interaction model and transport.

## Releasing

Fixed versioning via `lerna version` (all packages share one version; creates git tags per `pkg@version`; tags are **not** auto-pushed). Packages publish to the `@rsocket-ts` npm scope (public — each has `publishConfig.access = "public"`). Publishing is done by manually triggering the `Test, Build, Release` GitHub workflow, which only publishes versions not already on NPM. Allowed release branch: `main`. See `RELEASE.md`.
