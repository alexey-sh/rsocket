import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "tsdown";

const RE_DTS = /\.d\.[cm]?ts$/;
const RE_STALE_DTS_SOURCEMAP =
  /\n?\/\/# sourceMappingURL=\S+\.d\.[cm]?ts\.map\s*$/;

/**
 * Shared tsdown config for every published @rsocket-ts/* package.
 *
 * Each package is a single `src/index.ts` entry and re-exports this base from
 * its own `tsdown.config.ts`, so tsdown runs with the package dir as cwd —
 * `entry`, `outDir`, and `tsconfig` all resolve relative to that package.
 *
 * Emits dual output: CJS (`dist/index.js` + `dist/index.d.ts`) + ESM
 * (`dist/index.mjs` + `dist/index.d.mts`), all with sourcemaps. Sibling
 * @rsocket-ts/* packages (and every dependency) are kept external so each
 * package bundles only its own source.
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
  // tsdown defaults to fixed `.cjs`/`.mjs` extensions on the node platform.
  // Opt out so extensions follow the package type instead (no `"type"` field →
  // CJS `.js`/`.d.ts` + ESM `.mjs`/`.d.mts`), matching the published
  // package.json `exports` maps.
  fixedExtension: false,
  deps: {
    // Never bundle sibling workspace packages; deps/peerDeps are external by
    // default, this covers the @rsocket-ts/* graph explicitly.
    neverBundle: [/^@rsocket-ts\//],
  },
  // Rolldown emits its ESM runtime helpers (`__exportAll`, needed by
  // `export * as Bytes from …`) as a sibling chunk next to `index.mjs` rather
  // than inlining them the way it does for CJS. Drop the content hash so that
  // chunk keeps a stable `rolldown-runtime.mjs` name across builds; it is
  // imported relatively by `index.mjs` and ships inside `dist/`.
  hash: false,
  hooks: {
    /**
     * `sourcemap: true` applies to every chunk, so rolldown appends a
     * `//# sourceMappingURL=index.d.ts.map` comment to the declaration chunks
     * too — but rolldown-plugin-dts then drops those `.map` assets (it only
     * keeps them when its own `dts.sourcemap` is on, and even then strips
     * `sourcesContent`). Left alone, every published `.d.ts` points at a file
     * that does not exist. Strip the stale reference instead.
     */
    "build:done": async ({ chunks, options }) => {
      for (const { fileName } of chunks) {
        if (!RE_DTS.test(fileName)) continue;
        const file = path.resolve(options.cwd, options.outDir, fileName);
        const code = await readFile(file, "utf8");
        const stripped = code.replace(RE_STALE_DTS_SOURCEMAP, "\n");
        if (stripped !== code) await writeFile(file, stripped);
      }
    },
  },
});
