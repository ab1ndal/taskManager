#!/usr/bin/env node
/**
 * Runs a command with the e2e Supabase project's credentials in place of the development ones.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at BUILD time, not read at runtime, so
 * pointing only the server at the test project would still ship a browser bundle talking to the
 * development one. Both `next build` and `playwright test` therefore run through here.
 *
 * Usage: node scripts/e2e-env.mjs <command> [args...]
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = ".env.test.local";

/** Same hand-rolled parser `e2e/fixtures.ts` uses — four lines beats a new dependency. */
function readEnvFile(file) {
  let contents;
  try {
    contents = readFileSync(resolve(process.cwd(), file), "utf8");
  } catch {
    return null;
  }
  const out = {};
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const testEnv = readEnvFile(ENV_FILE);

if (!testEnv) {
  console.error(
    `${ENV_FILE} not found. Copy .env.example's E2E_ block into it with the test project's ` +
      `credentials — the suite refuses to run against the development project.`
  );
  process.exit(1);
}

const REQUIRED = ["E2E_SUPABASE_URL", "E2E_SUPABASE_PUBLISHABLE_KEY", "E2E_SUPABASE_SECRET_KEY"];
const missing = REQUIRED.filter((key) => !testEnv[key]);
if (missing.length) {
  console.error(`${ENV_FILE} is missing: ${missing.join(", ")}`);
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/e2e-env.mjs <command> [args...]");
  process.exit(1);
}

const env = {
  ...process.env,
  ...testEnv,
  // The app reads the ordinary names; only the source of the values changes.
  NEXT_PUBLIC_SUPABASE_URL: testEnv.E2E_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: testEnv.E2E_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: testEnv.E2E_SUPABASE_SECRET_KEY,
  // `e2e/fixtures.ts` refuses to run unless these two agree, so a bare `npx playwright test` — which
  // would pick up `.env` and the development project — fails instead of seeding real data.
  E2E_SUPABASE_URL: testEnv.E2E_SUPABASE_URL,
};

const child = spawn(command, args, { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
