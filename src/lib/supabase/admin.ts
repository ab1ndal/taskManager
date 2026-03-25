import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS. Only use in server-side code.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  );
}
