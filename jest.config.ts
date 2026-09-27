import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^server-only$": "<rootDir>/__mocks__/server-only.ts",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  testMatch: [
    "**/__tests__/**/*.test.tsx",
    "**/__tests__/**/*.test.ts",
    "**/*.test.ts",
    "**/*.test.tsx",
  ],
  // e2e specs are `.spec.ts` and belong to Playwright — they import `@playwright/test`, which has
  // no jsdom equivalent.
  // Agent worktrees under .claude/ are full checkouts; running their stale copies duplicates every
  // suite and loads a second React.
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/e2e/", "/.claude/"],
  modulePathIgnorePatterns: ["<rootDir>/.claude/"],
};

export default config;
