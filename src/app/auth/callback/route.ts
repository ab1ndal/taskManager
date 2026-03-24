import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { resolveNext } from "./resolve-next";

export { resolveNext } from "./resolve-next";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const next = resolveNext(searchParams.get("next"), origin);
  return NextResponse.redirect(`${origin}${next}`);
}
