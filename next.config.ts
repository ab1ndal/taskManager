import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Type checking runs as `npm run typecheck` (TypeScript 7 via tsgo) ahead of `next build`
    // in the `build` script, so the in-process checker would only duplicate it — on the older
    // TypeScript 6 API at that, since the `typescript` package here is the 6.0 compatibility
    // shim that typescript-eslint and ts-jest need. `experimental.useTypeScriptCli` is not an
    // option: it looks for `typescript/bin/tsc`, which the shim does not ship.
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      // Grocery dictation uploads its recording to a server action (transcribe-actions.ts). The
      // default 1 MB would reject a long list; transcribe-schema.ts caps the audio at 2 MB, and
      // the extra room covers multipart overhead. Stays under Vercel's 4.5 MB request limit.
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
