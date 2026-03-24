import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
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
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
};

export default config;
