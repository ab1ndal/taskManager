"use client";

import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "@/components/toaster";

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

  const display = name || email;

  return (
    <div className="flex items-center gap-3 text-sm">
      <Link
        href="/profile"
        className="hidden sm:inline font-medium text-gray-700 hover:text-gray-900 hover:underline underline-offset-2"
      >
        {display}
      </Link>
      <button
        onClick={handleLogout}
        className="rounded-md px-3 py-1.5 text-gray-500 hover:bg-gray-100 active:bg-gray-200"
      >
        Sign out
      </button>
    </div>
  );
}
