# rsocket-js — [alexey-sh fork](https://github.com/alexey-sh/rsocket)

> **This is an independent fork** of [`rsocket/rsocket-js`](https://github.com/rsocket/rsocket-js),
> continuing the stalled Flow → TypeScript 1.0 rewrite. **See [FORK.md](./FORK.md) for exactly how
> it differs from upstream** (Node 24, strict TypeScript 6, `Uint8Array` API, dual ESM+CJS, and
> ~20 protocol fixes).

A JavaScript implementation of the [RSocket](https://github.com/rsocket/rsocket)
protocol intended for use in browsers and/or Node.js. From [rsocket.io](http://rsocket.io/):

> [RSocket] is an application protocol providing
> [Reactive Streams](http://www.reactive-streams.org/) semantics over an
> asynchronous, binary boundary.
>
> It enables the following symmetric interaction models via async message
> passing over a single connection:
>
> - request/response (stream of 1)
> - request/stream (finite stream of many)
> - fire-and-forget (no response)
> - event subscription (infinite stream of many)
> - channel (bi-directional streams)

## Status

This fork continues the rewrite of rsocket-js from [Flow](https://flow.org/) to
[TypeScript](https://www.typescriptlang.org/) (upstream context:
[#158](https://github.com/rsocket/rsocket-js/issues/158)), and is developed **independently** of
upstream — no pull requests are sent upstream and upstream releases are not tracked.

This is a young fork — breaking changes are still possible between releases. A full, side-by-side
comparison with upstream lives in **[FORK.md](./FORK.md)**.

**For sources related to `0.x.x` versions, see the upstream [master](https://github.com/rsocket/rsocket-js/tree/master) branch.**

## Installation

Individual packages published from this monorepo are distributed via NPM.

Packages are independently versioned.

> **Note:** the npm links below are the upstream package names (`rsocket-*`, owned upstream). This
> fork is not yet published; it will ship under a new npm scope. For now, build from source.

- [rsocket-core](https://www.npmjs.com/package/rsocket-core)
- [rsocket-messaging](https://www.npmjs.com/package/rsocket-messaging)
- [rsocket-composite-metadata](https://www.npmjs.com/package/rsocket-composite-metadata)
- [rsocket-tcp-client](https://www.npmjs.com/package/rsocket-tcp-client)
- [rsocket-tcp-server](https://www.npmjs.com/package/rsocket-tcp-server)
- [rsocket-websocket-client](https://www.npmjs.com/package/rsocket-websocket-client)
- [rsocket-websocket-server](https://www.npmjs.com/package/rsocket-websocket-server)
- [rsocket-adapter-rxjs](https://www.npmjs.com/package/rsocket-adapter-rxjs)
- [rsocket-graphql-apollo-link](https://www.npmjs.com/package/rsocket-graphql-apollo-link)
- [rsocket-graphql-apollo-server](https://www.npmjs.com/package/rsocket-graphql-apollo-server)

## Contributing

TODO: add `CONTRIBUTING.md`

## Documentation & Examples

See [packages/rsocket-examples](./packages/rsocket-examples/src) for examples.

Guides for `0.x.x` versions can be found on https://rsocket.io/guides/rsocket-js.

## License

See LICENSE file.
