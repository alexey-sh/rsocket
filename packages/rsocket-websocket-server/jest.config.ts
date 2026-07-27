import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
  preset: "ts-jest",
  testRegex: "(\\/__tests__\\/.*|\\.(test|spec))\\.(ts)$",
  moduleNameMapper: {
    // Mirrors the rsocket-* path aliases from the root tsconfig.json,
    // inlined to stay loader-agnostic under jest 30 config resolution.
    "^@rsocket-ts/(.*)$": "<rootDir>/../../packages/rsocket-$1/src",
  },
  modulePathIgnorePatterns: [
    "<rootDir>/__tests__/test-utils",
    "<rootDir>/__tests__/*.d.ts",
  ],
  collectCoverage: true,
  collectCoverageFrom: ["<rootDir>/src/**/*.ts", "!**/node_modules/**"],
};

export default config;
