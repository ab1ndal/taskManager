"use client";

import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "@/components/toaster";
import { Avatar } from "@/components/avatar";

export function NavUser({ name, email }: { name: string; email: string }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast(error.message, "error");
    } else {
      toast("Signed out");
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/profile"
        className="hidden sm:inline text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
      >
        {name || email}
      </Link>
      <Avatar name={name} email={email} size="sm" />
      <button
        onClick={handleLogout}
        className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
