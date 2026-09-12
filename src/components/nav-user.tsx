"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "@/components/toaster";
import { Avatar } from "@/components/avatar";

export function NavUser({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast(error.message, "error");
      setSigningOut(false);
    } else {
      toast("Signed out");
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/settings?tab=profile"
        className="hidden sm:inline-flex items-center min-h-11 text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
      >
        {name || email}
      </Link>
      {/*
        The avatar carries the same link as the name beside it, because the name is hidden below
        `sm` and settings has no other entry point: it is absent from `NavLinks`, so on a phone
        there was no route to it at all — including the Notifications tab that enables push.
      */}
      <Link
        href="/settings?tab=profile"
        aria-label="Settings"
        className="inline-flex items-center justify-center w-11 h-11 -mx-1 rounded-full transition-opacity hover:opacity-80"
      >
        <Avatar name={name} email={email} size="sm" />
      </Link>
      <button
        onClick={handleLogout}
        disabled={signingOut}
        className="inline-flex items-center min-h-11 whitespace-nowrap text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50 disabled:pointer-events-none"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
