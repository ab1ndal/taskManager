"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { toast } from "@/components/toaster";

type Mode = "signin" | "signup" | "forgot" | "reset";

export function LoginCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [duplicateEmail, setDuplicateEmail] = useState(false);

  const resetParam = searchParams.get("mode") === "reset" ? "reset" : null;
  const [syncedResetParam, setSyncedResetParam] = useState<string | null>(null);
  if (syncedResetParam !== resetParam) {
    setSyncedResetParam(resetParam);
    if (resetParam === "reset") setMode("reset");
  }

  useEffect(() => {
    if (mode !== "reset") return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setHasSession(!!user);
      setSessionChecked(true);
    });
  }, [mode]);

  async function handleGoogle() {
    setError("");
    setDuplicateEmail(false);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/tasks")}`,
      },
    });
    // On success the browser is already navigating to Google, so only the failure path returns here.
    if (error) {
      setError(error.message);
      toast(error.message, "error");
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDuplicateEmail(false);
    setLoading(true);

    const supabase = createClient();

    if (mode === "reset") {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        setLoading(false);
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        toast(error.message, "error");
      } else {
        toast("Password updated");
        router.push("/tasks");
        router.refresh();
      }
      setLoading(false);
      return;
    }

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/login?mode=reset")}`,
      });
      if (error) {
        setError(error.message);
        toast(error.message, "error");
      } else {
        toast("Check your email for a reset link");
        // stay in forgot mode — intentional
      }
      setLoading(false);
      return;
    }

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
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name: name.trim() },
          // Without this the confirmation link inherits the project's Site URL, which is the app
          // root — nothing there exchanges the `code`, so the link lands the user signed out.
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/tasks")}`,
        },
      });
      if (error) {
        setError(error.message);
        toast(error.message, "error");
      } else if (data.user && data.user.identities?.length === 0) {
        // Supabase answers a signup on an existing confirmed address with an obfuscated user and no
        // error, to keep the form from revealing which addresses are registered. An empty
        // `identities` array is the only tell, and it is not part of the documented API contract —
        // if an auth-js upgrade stops emptying it, this branch goes quiet and the user sees the
        // "check your email" message again instead of a wrong one. We accept the enumeration
        // trade-off deliberately: leaving it out stranded users with no route to recovery.
        setDuplicateEmail(true);
      } else {
        toast("Check your email to confirm your account");
        setMode("signin");
      }
    }

    setLoading(false);
  }

  return (
    // No nav renders for a signed-out user, so this subtracts only the page's own `p-6` gutters —
    // using --nav-height here left the card sitting visibly above centre.
    <div className="flex min-h-[calc(100dvh-3rem)] items-center justify-center relative overflow-hidden">
      {/* Pastel blobs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -left-16 w-64 h-64 rounded-full opacity-50 dark:opacity-25"
        style={{ background: "#C4B0E8", filter: "blur(50px)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 right-5 w-52 h-52 rounded-full opacity-50 dark:opacity-25"
        style={{ background: "#F0C8D4", filter: "blur(50px)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-5 -left-8 w-40 h-40 rounded-full opacity-50 dark:opacity-25"
        style={{ background: "#B8D4F0", filter: "blur(50px)" }}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8"
        style={{ boxShadow: "var(--shadow-login)" }}>

        {/* Wordmark */}
        <p className="mb-6 text-center text-xl font-semibold tracking-tight">
          hearth<span className="text-[var(--color-accent)]">.</span>
        </p>

        {/* Mode heading or tabs */}
        {(mode === "forgot" || mode === "reset") ? (
          <div className="mb-6">
            <p className="text-base font-semibold text-[var(--color-text-primary)]">
              {mode === "forgot" ? "Reset password" : "Set new password"}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {mode === "forgot" ? "We'll email you a link." : "Choose a new password."}
            </p>
          </div>
        ) : (
          <div className="mb-6 flex rounded-md bg-[var(--color-accent-subtle)] p-[3px] text-sm">
            <button
              type="button"
              onClick={() => { setMode("signin"); setError(""); setDuplicateEmail(false); }}
              className={`flex-1 rounded-sm py-[7px] font-medium transition-colors text-sm ${
                mode === "signin"
                  ? "bg-[var(--color-surface)] shadow-sm text-[var(--color-accent)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode("signup"); setError(""); setDuplicateEmail(false); }}
              className={`flex-1 rounded-sm py-[7px] font-medium transition-colors text-sm ${
                mode === "signup"
                  ? "bg-[var(--color-surface)] shadow-sm text-[var(--color-accent)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              Sign up
            </button>
          </div>
        )}

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
                className="rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm"
                placeholder="Your name"
              />
            </div>
          )}

          {(mode === "signin" || mode === "signup" || mode === "forgot") && (
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
                className="rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm"
                placeholder="you@example.com"
              />
            </div>
          )}

          {(mode === "signin" || mode === "signup") && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-xs font-medium text-[var(--color-text-secondary)]">
                  Password
                </label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => { setMode("forgot"); setError(""); }}
                    className="text-xs text-[var(--color-accent)] hover:underline"
                  >
                    Forgot?
                  </button>
                )}
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm"
                placeholder="••••••••"
              />
            </div>
          )}

          {mode === "reset" && sessionChecked && !hasSession && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                This reset link has expired or already been used.
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setEmail("");
                  setPassword("");
                  setConfirmPassword("");
                  setError("");
                }}
                className="text-sm text-[var(--color-accent)] hover:underline text-left"
              >
                Request a new one →
              </button>
            </div>
          )}

          {mode === "reset" && (!sessionChecked || hasSession) && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="new-password" className="text-xs font-medium text-[var(--color-text-secondary)]">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  className="rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-password" className="text-xs font-medium text-[var(--color-text-secondary)]">
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm"
                />
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">Minimum 6 characters</p>
            </>
          )}

          {error && (
            <p className="rounded-sm bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
              {error}
            </p>
          )}

          {mode === "signup" && duplicateEmail && (
            <div className="flex flex-col gap-2 rounded-sm bg-[var(--color-accent-subtle)] px-3 py-2.5">
              <p className="text-sm text-[var(--color-text-secondary)]">
                That email already has an account.
              </p>
              <div className="flex gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => { setMode("signin"); setDuplicateEmail(false); }}
                  className="text-[var(--color-accent)] hover:underline"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setPassword(""); setDuplicateEmail(false); }}
                  className="text-[var(--color-accent)] hover:underline"
                >
                  Reset your password
                </button>
              </div>
            </div>
          )}

          {!(mode === "reset" && sessionChecked && !hasSession) && (
            <button
              type="submit"
              disabled={loading}
              className="mt-1 rounded-sm bg-[var(--color-accent)] px-4 py-[10px] text-sm font-medium text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
            >
              {loading
                ? mode === "forgot"
                  ? "Sending…"
                  : mode === "reset"
                  ? "Updating…"
                  : "…"
                : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                ? "Create account"
                : mode === "forgot"
                ? "Send reset link"
                : "Update password"}
            </button>
          )}

          {(mode === "signin" || mode === "signup") && (
            <>
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">or</span>
                <span className="h-px flex-1 bg-[var(--color-border)]" />
              </div>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={loading}
                className="flex items-center justify-center gap-2 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-[10px] text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-accent-subtle)] disabled:opacity-50 transition-colors"
              >
                <svg aria-hidden="true" viewBox="0 0 18 18" className="h-[18px] w-[18px]">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34A9 9 0 0 0 9 18Z" />
                  <path fill="#FBBC05" d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.34Z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z" />
                </svg>
                Continue with Google
              </button>
            </>
          )}

          {mode === "forgot" && (
            <button
              type="button"
              onClick={() => { setMode("signin"); setError(""); }}
              className="mt-1 text-xs text-[var(--color-accent)] hover:underline text-center"
            >
              ← Back to sign in
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
