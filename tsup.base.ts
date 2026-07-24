import { defineConfig } from "tsup";

/**
 * Shared tsup config for every published rsocket-* package.
 *
 * Each package is a single `src/index.ts` entry and re-exports this base from
 * its own `tsup.config.ts`, so tsup runs with the package dir as cwd — `entry`,
 * `outDir`, and `tsconfig` all resolve relative to that package.
 *
 * Emits dual output: CJS (`dist/index.js`) + ESM (`dist/index.mjs`) + a bundled
 * type declaration (`dist/index.d.ts`), all with sourcemaps. Sibling rsocket-*
 * packages (and every dependency) are kept external so each package bundles
 * only its own source.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["cjs", "esm"],
  target: "es2022",
  tsconfig: "tsconfig.build.json",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Never bundle sibling workspace packages; deps/peerDeps are external by
  // default, this covers the rsocket-* graph explicitly.
  external: [/^rsocket-/],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".js" };
  },
});
