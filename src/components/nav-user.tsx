"use client";

import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toaster";

export function NavUser({ email }: { email: string }) {
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
    <div className="flex items-center gap-3 text-sm text-gray-500">
      <span className="hidden sm:inline">{email}</span>
      <button
        onClick={handleLogout}
        className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-100 active:bg-gray-200"
      >
        Sign out
      </button>
    </div>
  );
}
