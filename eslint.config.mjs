import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next 16 exports native flat configs, so no FlatCompat shim is needed.
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "supabase/.temp/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    // Jest mock factories are hoisted above imports, so lazily pulling a mocked module
    // in with require() is the intended pattern rather than a style lapse.
    files: ["**/*.test.ts", "**/*.test.tsx", "jest.setup.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
