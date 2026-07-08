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
];
