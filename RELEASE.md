# Release

How to publish new releases for this project.

## Versioning

[semver](https://semver.org/) should be followed when deciding new release versions.

You can either set versions in the `package.json` files manually, or use the `lerna version` command to set them via the Lerna CLI. When setting versions manually, you will also need to set the git tag yourself. For this reason, it is recommended you use the `lerna version` command, which will create it automatically.

This repo uses **fixed versioning** (`lerna.json` pins one `version` for every package), so a release
produces a single tag named after the version — `v2.0.1` — not one tag per package.

Lerna will not push the commit or the tag after creating them. Push both once you are confident in
your changes: `git push --follow-tags`.

### Example

```
npx lerna version patch
```

## Publishing

### Locally: `yarn pub`

`yarn pub` runs [`scripts/publish.sh`](./scripts/publish.sh), which publishes every public
`@rsocket-ts/*` package at the version currently in its `package.json`. It only publishes versions
that do not already exist on NPM, so re-running after a partial failure is safe.

```
yarn pub --dry-run     # pack and validate everything, upload nothing
yarn pub               # the real thing (asks for confirmation)
yarn pub --help        # all options
```

Before publishing it checks the branch (`main`), that the working tree is clean, that the registry
is `registry.npmjs.org` with no `@rsocket-ts:` override, that npm is authenticated, and that all
packages share one version and are marked `publishConfig.access: public`. It then runs
`yarn lint`, `yarn test` and `yarn check:exports` (build + `attw`) before uploading anything, and
publishes in dependency order because each package's `prepublishOnly` build resolves its
`@rsocket-ts/*` dependencies through their built `dist/`.

Two things to know:

- **Do not use `lerna publish` in this repo.** `npm pack`/`npm publish` writes a `gitHead` field
  into every `package.json` it packs, which dirties the working tree; lerna's `EUNCOMMIT` pre-check
  then aborts the run before it reaches NPM. The script publishes per package instead, and reverts
  that `gitHead` pollution afterwards.
- **Publishing requires 2FA.** npm prints an auth URL on the first package; authorizing writes
  there for 5 minutes covers the entire run, which takes about 40 seconds for all packages even
  from a cold `dist/`. For a non-interactive release, configure a Granular Access Token with
  *Read and write* on the `@rsocket-ts` scope and the `rsocket-ts` organization — such a token
  bypasses the OTP prompt (mind the expiry, which npm defaults to 30 days). Note that a token too
  restricted to publish can still answer `npm whoami`, so a successful preflight is not proof that
  publishing will be authorized.

### On CI

The `Test, Build, Release` Workflow on GitHub can be run to [manually trigger](https://docs.github.com/en/actions/managing-workflow-runs/manually-running-a-workflow) publishing of packages to NPM. This workflow will only publish versions which do not already exist on NPM.

The `Test, Build, Release` Workflow will:

- Run automated linting & tests
- Compile/build various packages
- Publish built packages to NPM
