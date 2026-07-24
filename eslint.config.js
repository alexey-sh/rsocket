const tsParser = require("@typescript-eslint/parser");
const prettierPlugin = require("eslint-plugin-prettier");

// Flat config (ESLint 9). Linting is effectively "Prettier as an error rule":
// the TypeScript parser lets ESLint read .ts, and the only enabled rule runs
// Prettier. Extension filtering lives in `files`, ignores replace .eslintignore.
module.exports = [
  {
    ignores: ["**/dist/**", "**/build/**", "**/coverage/**"],
  },
  {
    files: ["**/*.js", "**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // rsocket-core is transport-agnostic and browser-neutral: it must not
    // depend on Node's Buffer. Use Uint8Array + the Bytes helpers (Bytes.ts).
    // Scoped to source only -- tests and the Node transports may use Buffer.
    files: ["packages/rsocket-core/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "Buffer",
          message:
            "rsocket-core must stay browser-neutral: use Uint8Array and the Bytes helpers instead of Buffer.",
        },
      ],
    },
  },
];
