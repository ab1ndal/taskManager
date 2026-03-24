"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toaster";
import { Avatar } from "@/components/avatar";

export default function ProfilePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setName(user.user_metadata?.name ?? "");
        setEmail(user.email ?? "");
      }
      setFetching(false);
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      data: { name: name.trim() },
    });
    if (error) {
      toast(error.message, "error");
    } else {
      toast("Profile updated");
      router.refresh();
    }
    setLoading(false);
  }

  if (fetching) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>;
  }

  return (
    <div className="max-w-sm">
      <h2 className="mb-6 text-xl font-semibold tracking-tight">Profile</h2>

      <div className="flex items-center gap-4 mb-6">
        <Avatar name={name} email={email} size="lg" />
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{name || "—"}</p>
          <p className="text-sm text-[var(--color-text-secondary)]">{email}</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-xs font-medium text-[var(--color-text-secondary)]">
            Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white"
            placeholder="Your name"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Email</label>
          <p className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm text-[var(--color-text-muted)]">
            {email}
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-fit rounded-[8px] bg-[var(--color-accent)] px-5 py-[10px] text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
        >
          {loading ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
