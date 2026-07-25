import "server-only";

import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Server-side only.
//
// The `server-only` import above turns any client-component import into a build error, instead of
// silently inlining the secret into the browser bundle. The key must NOT carry a NEXT_PUBLIC_
// prefix: Next.js inlines every NEXT_PUBLIC_ value into any bundle that references it.
//
// Callers must perform their own authorization check before using this client — RLS will not do it
// for them. See tasks/lessons.md L2.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is not set");

  return createClient(url, secretKey, { auth: { persistSession: false } });
}
