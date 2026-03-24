"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { toast } from "@/components/toaster";

type Mode = "signin" | "signup";

export function LoginCard() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        toast(error.message, "error");
      } else {
        toast("Signed in");
        router.push("/tasks");
        router.refresh();
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: name.trim() } },
      });
      if (error) {
        setError(error.message);
        toast(error.message, "error");
      } else {
        toast("Check your email to confirm your account");
        setMode("signin");
      }
    }

    setLoading(false);
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center relative overflow-hidden">
      {/* Pastel blobs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -left-16 w-64 h-64 rounded-full opacity-50"
        style={{ background: "#C4B0E8", filter: "blur(50px)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 right-5 w-52 h-52 rounded-full opacity-50"
        style={{ background: "#F0C8D4", filter: "blur(50px)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-5 -left-8 w-40 h-40 rounded-full opacity-50"
        style={{ background: "#B8D4F0", filter: "blur(50px)" }}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8"
        style={{ boxShadow: "var(--shadow-login)" }}>

        {/* Wordmark */}
        <p className="mb-6 text-center text-xl font-semibold tracking-tight">
          hearth<span className="text-[var(--color-accent)]">.</span>
        </p>

        {/* Mode tabs */}
        <div className="mb-6 flex rounded-[10px] bg-[var(--color-accent-subtle)] p-[3px] text-sm">
          <button
            type="button"
            onClick={() => { setMode("signin"); setError(""); }}
            className={`flex-1 rounded-[8px] py-[7px] font-medium transition-colors text-sm ${
              mode === "signin"
                ? "bg-white shadow-sm text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { setMode("signup"); setError(""); }}
            className={`flex-1 rounded-[8px] py-[7px] font-medium transition-colors text-sm ${
              mode === "signup"
                ? "bg-white shadow-sm text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "signup" && (
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
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-medium text-[var(--color-text-secondary)]">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white"
              placeholder="you@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium text-[var(--color-text-secondary)]">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-[8px] bg-[var(--color-accent)] px-4 py-[10px] text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
          >
            {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
