# Forgot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add forgot-password and reset-password flows to the Hearth login card, and consolidate `proxy.ts` + `src/middleware.ts` into a single `proxy.ts` using the correct Next.js 16 convention.

**Architecture:** All UI states live on `/login` as new modes in the existing card component. The login page is split into a thin server wrapper (`page.tsx`) and a client component (`login-card.tsx`). The root `proxy.ts` absorbs route-guard logic from `src/middleware.ts` (which is then deleted), and the auth callback gains safe `next`-param redirect support.

**Tech Stack:** Next.js 16, TypeScript, Tailwind v4, Supabase (`@supabase/ssr`, `@supabase/supabase-js`), Jest + React Testing Library.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `proxy.ts` | Modify | Session refresh + route guards + `mode=reset` exemption |
| `src/middleware.ts` | **Delete** | Superseded by updated `proxy.ts` |
| `src/app/auth/callback/route.ts` | Modify | Safe `next`-param redirect (replaces hardcoded `/tasks`) |
| `src/app/login/page.tsx` | Modify | Thin server component; `<Suspense>` wrapper only |
| `src/app/login/login-card.tsx` | **Create** | All login logic + `forgot` and `reset` modes |
| `src/components/__tests__/login-card.test.tsx` | **Create** | RTL tests for all four card modes |
| `src/app/auth/callback/route.test.ts` | **Create** | Unit tests for `next`-param validation logic |

---

## Task 0: Update proxy.ts and delete middleware.ts

**Files:**
- Modify: `proxy.ts`
- Delete: `src/middleware.ts`

- [ ] **Step 1: Replace proxy.ts content**

Open `proxy.ts`. It currently only refreshes the session. Replace the entire file with the route-guard logic from `src/middleware.ts`, keeping the `proxy` export name and switching the env var from `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Add the `mode=reset` exemption:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute =
    pathname.startsWith("/login") || pathname.startsWith("/auth");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const isResetMode =
    request.nextUrl.searchParams.get("mode") === "reset";

  if (user && pathname === "/login" && !isResetMode) {
    const url = request.nextUrl.clone();
    url.pathname = "/tasks";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 2: Delete src/middleware.ts**

```bash
rm src/middleware.ts
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: Compiled successfully. No type errors.

- [ ] **Step 4: Commit**

```bash
git add proxy.ts
git rm src/middleware.ts
git commit -m "feat: migrate middleware to proxy.ts with route guards and mode=reset exemption"
```

---

## Task 1: Update auth callback to support next param

**Files:**
- Modify: `src/app/auth/callback/route.ts`
- Create: `src/app/auth/callback/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/auth/callback/route.test.ts`:

```ts
// We test the redirect-target resolution logic in isolation.
// Extract it so it can be tested without mocking the full Next.js runtime.

import { resolveNext } from "./route";

describe("resolveNext", () => {
  const origin = "http://localhost:3000";

  it("returns /tasks when next is absent", () => {
    expect(resolveNext(null, origin)).toBe("/tasks");
  });

  it("returns decoded path for valid same-origin next", () => {
    const encoded = encodeURIComponent("/login?mode=reset");
    expect(resolveNext(encoded, origin)).toBe("/login?mode=reset");
  });

  it("rejects external URL", () => {
    const encoded = encodeURIComponent("https://evil.com/steal");
    expect(resolveNext(encoded, origin)).toBe("/tasks");
  });

  it("rejects protocol-relative URL", () => {
    const encoded = encodeURIComponent("//evil.com");
    expect(resolveNext(encoded, origin)).toBe("/tasks");
  });

  it("falls back on malformed input", () => {
    expect(resolveNext(":::invalid", origin)).toBe("/tasks");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest src/app/auth/callback/route.test.ts --no-coverage
```

Expected: FAIL — `resolveNext` is not exported.

- [ ] **Step 3: Implement**

Replace `src/app/auth/callback/route.ts` with:

```ts
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export function resolveNext(rawNext: string | null, origin: string): string {
  if (!rawNext) return "/tasks";
  try {
    const decoded = decodeURIComponent(rawNext);
    const url = new URL(decoded, origin);
    if (url.origin === origin) return decoded;
  } catch {
    // malformed — fall through
  }
  return "/tasks";
}

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/app/auth/callback/route.test.ts --no-coverage
```

Expected: All 5 tests pass.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: Compiled successfully.

- [ ] **Step 6: Commit**

```bash
git add src/app/auth/callback/route.ts src/app/auth/callback/route.test.ts
git commit -m "feat: add safe next-param redirect support to auth callback"
```

---

## Task 2: Split login page into server wrapper + client card

This is a pure refactor — no behavior change. The goal is to allow `useSearchParams` in the card (which requires `<Suspense>` in Next.js App Router).

**Files:**
- Modify: `src/app/login/page.tsx`
- Create: `src/app/login/login-card.tsx`

- [ ] **Step 1: Create login-card.tsx**

Create `src/app/login/login-card.tsx` and paste the **entire current content** of `src/app/login/page.tsx` into it, with two changes:
1. Change the function name from `LoginPage` to `LoginCard`
2. Add `useSearchParams` to the React import (it is not used yet — just import it)

```tsx
"use client";

import { useState, useSearchParams } from "react";
// ... rest of current page.tsx content unchanged, function renamed to LoginCard
```

- [ ] **Step 2: Replace page.tsx**

Replace the entire content of `src/app/login/page.tsx` with:

```tsx
import { Suspense } from "react";
import { LoginCard } from "./login-card";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginCard />
    </Suspense>
  );
}
```

- [ ] **Step 3: Verify build and dev server**

```bash
npm run build
```

Expected: Compiled successfully. The login page should look and behave identically to before — this is a pure refactor.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx src/app/login/login-card.tsx
git commit -m "refactor: split login page into server wrapper and LoginCard client component"
```

---

## Task 3: Add forgot mode

**Files:**
- Modify: `src/app/login/login-card.tsx`
- Create: `src/components/__tests__/login-card.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/login-card.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginCard } from "../../app/login/login-card";

// Mock Next.js router and searchParams
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Supabase browser client
const mockResetPasswordForEmail = jest.fn();
jest.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      resetPasswordForEmail: mockResetPasswordForEmail,
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      updateUser: jest.fn(),
    },
  }),
}));

// Mock toast
jest.mock("@/components/toaster", () => ({
  toast: jest.fn(),
}));

describe("LoginCard — forgot mode", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows Forgot? link next to password label in signin mode", () => {
    render(<LoginCard />);
    expect(screen.getByText("Forgot?")).toBeInTheDocument();
  });

  it("does not show Forgot? link in signup mode", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(screen.queryByText("Forgot?")).not.toBeInTheDocument();
  });

  it("switches to forgot mode when Forgot? is clicked", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    expect(screen.getByText("Reset password")).toBeInTheDocument();
    expect(screen.getByText("We'll email you a link.")).toBeInTheDocument();
  });

  it("does not render password field in forgot mode", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    expect(screen.queryByPlaceholderText("••••••••")).not.toBeInTheDocument();
  });

  it("renders Back to sign in link in forgot mode", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    expect(screen.getByText(/back to sign in/i)).toBeInTheDocument();
  });

  it("returns to signin mode when Back to sign in is clicked", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    fireEvent.click(screen.getByText(/back to sign in/i));
    expect(screen.getByText("Forgot?")).toBeInTheDocument();
  });

  it("calls resetPasswordForEmail and stays in forgot mode on success", async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        expect.objectContaining({ redirectTo: expect.stringContaining("/auth/callback") })
      );
    });
    // stays in forgot mode
    expect(screen.getByText("Reset password")).toBeInTheDocument();
  });

  it("shows inline error when resetPasswordForEmail fails", async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      error: { message: "Rate limit exceeded" },
    });
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx jest src/components/__tests__/login-card.test.tsx --no-coverage
```

Expected: FAIL — `LoginCard` doesn't have `forgot` mode yet.

- [ ] **Step 3: Add forgot mode to login-card.tsx**

In `src/app/login/login-card.tsx`, make these changes:

**a) Update the Mode type:**
```tsx
type Mode = "signin" | "signup" | "forgot" | "reset";
```

**b) Add `useSearchParams` to the import** (it's already imported from step in Task 2):
```tsx
import { useState } from "react";
import { useSearchParams } from "next/navigation";
```

**c) Add "Forgot?" link — in the password field's label row, change:**
```tsx
<label htmlFor="password" className="text-xs font-medium text-[var(--color-text-secondary)]">
  Password
</label>
```
**to:**
```tsx
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
```

**d) Wrap the password field so it's hidden in `forgot` and `reset` modes:**
```tsx
{(mode === "signin" || mode === "signup") && (
  <div className="flex flex-col gap-1.5">
    {/* label row with Forgot? ... */}
    <input ... />
  </div>
)}
```

**e) Add the forgot mode card content — inside the card, before the form, add a conditional heading block that replaces the tab pills:**
```tsx
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
  /* existing tab pills JSX */
)}
```

**f) Add the forgot-mode email submit handler** — modify `handleSubmit` to handle the `forgot` case:
```tsx
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
```

**g) Add "← Back to sign in" below the submit button in forgot mode:**
```tsx
{mode === "forgot" && (
  <button
    type="button"
    onClick={() => { setMode("signin"); setError(""); }}
    className="mt-1 text-xs text-[var(--color-accent)] hover:underline text-center"
  >
    ← Back to sign in
  </button>
)}
```

**h) Update button label:**
```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/components/__tests__/login-card.test.tsx --no-coverage
```

Expected: All forgot-mode tests pass.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: Compiled successfully.

- [ ] **Step 6: Commit**

```bash
git add src/app/login/login-card.tsx src/components/__tests__/login-card.test.tsx
git commit -m "feat: add forgot-password mode to login card"
```

---

## Task 4: Add reset mode

**Files:**
- Modify: `src/app/login/login-card.tsx`
- Modify: `src/components/__tests__/login-card.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/__tests__/login-card.test.tsx`:

```tsx
describe("LoginCard — reset mode (URL param)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("initialises to reset mode when ?mode=reset is in the URL", () => {
    jest.mocked(require("next/navigation").useSearchParams).mockReturnValue(
      new URLSearchParams("mode=reset")
    );
    // user exists — show reset form
    jest.mocked(require("@/lib/supabase/browser").createClient)
      .mockReturnValue({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: { id: "u1" } },
          }),
          updateUser: jest.fn(),
          resetPasswordForEmail: jest.fn(),
          signInWithPassword: jest.fn(),
          signUp: jest.fn(),
        },
      });
    render(<LoginCard />);
    expect(screen.getByText("Set new password")).toBeInTheDocument();
  });

  it("shows expired-link message when in reset mode but no session", async () => {
    jest.mocked(require("next/navigation").useSearchParams).mockReturnValue(
      new URLSearchParams("mode=reset")
    );
    jest.mocked(require("@/lib/supabase/browser").createClient)
      .mockReturnValue({
        auth: {
          getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
          updateUser: jest.fn(),
          resetPasswordForEmail: jest.fn(),
          signInWithPassword: jest.fn(),
          signUp: jest.fn(),
        },
      });
    render(<LoginCard />);
    await waitFor(() => {
      expect(
        screen.getByText(/expired or already been used/i)
      ).toBeInTheDocument();
    });
  });

  it("shows inline error when passwords do not match", async () => {
    jest.mocked(require("next/navigation").useSearchParams).mockReturnValue(
      new URLSearchParams("mode=reset")
    );
    jest.mocked(require("@/lib/supabase/browser").createClient)
      .mockReturnValue({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: { id: "u1" } },
          }),
          updateUser: jest.fn(),
          resetPasswordForEmail: jest.fn(),
          signInWithPassword: jest.fn(),
          signUp: jest.fn(),
        },
      });
    render(<LoginCard />);
    await waitFor(() => screen.getByText("Set new password"));
    fireEvent.change(screen.getByPlaceholderText("New password"), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
      target: { value: "password2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it("calls updateUser and redirects on success", async () => {
    const mockPush = jest.fn();
    const mockRefresh = jest.fn();
    const mockUpdateUser = jest.fn().mockResolvedValue({ error: null });
    jest.mocked(require("next/navigation").useRouter).mockReturnValue({
      push: mockPush,
      refresh: mockRefresh,
    });
    jest.mocked(require("next/navigation").useSearchParams).mockReturnValue(
      new URLSearchParams("mode=reset")
    );
    jest.mocked(require("@/lib/supabase/browser").createClient)
      .mockReturnValue({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: { id: "u1" } },
          }),
          updateUser: mockUpdateUser,
          resetPasswordForEmail: jest.fn(),
          signInWithPassword: jest.fn(),
          signUp: jest.fn(),
        },
      });
    render(<LoginCard />);
    await waitFor(() => screen.getByText("Set new password"));
    fireEvent.change(screen.getByPlaceholderText("New password"), {
      target: { value: "newpass123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
      target: { value: "newpass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: "newpass123" });
      expect(mockPush).toHaveBeenCalledWith("/tasks");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx jest src/components/__tests__/login-card.test.tsx --no-coverage
```

Expected: FAIL — reset mode not implemented yet.

- [ ] **Step 3: Implement reset mode in login-card.tsx**

**a) Add `confirmPassword` state and `useSearchParams`:**
```tsx
const searchParams = useSearchParams();
const [confirmPassword, setConfirmPassword] = useState("");
```

**b) Initialise reset mode from URL on mount:**
```tsx
import { useState, useEffect } from "react";

// Inside the component, after state declarations:
useEffect(() => {
  if (searchParams.get("mode") === "reset") {
    setMode("reset");
  }
}, [searchParams]);
```

**c) Add `sessionChecked` and `hasSession` state for the session guard:**
```tsx
const [sessionChecked, setSessionChecked] = useState(false);
const [hasSession, setHasSession] = useState(false);
```

**d) Add a `useEffect` to check session when in reset mode:**
```tsx
useEffect(() => {
  if (mode !== "reset") return;
  const supabase = createClient();
  supabase.auth.getUser().then(({ data: { user } }) => {
    setHasSession(!!user);
    setSessionChecked(true);
  });
}, [mode]);
```

**e) Add reset mode form fields inside the form (after the password field block):**
```tsx
{mode === "reset" && (
  <>
    {sessionChecked && !hasSession ? (
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
    ) : sessionChecked ? (
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
            className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white"
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
            className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white"
          />
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Minimum 6 characters</p>
      </>
    ) : null}
  </>
)}
```

**f) Add reset handler in `handleSubmit`:**
```tsx
if (mode === "reset") {
  if (password !== confirmPassword) {
    setError("Passwords do not match");
    setLoading(false);
    return;
  }
  const supabase = createClient();
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
```

**g) Hide the submit button when in reset mode and session hasn't loaded or no session:**
```tsx
{!(mode === "reset" && (!sessionChecked || !hasSession)) && (
  <button type="submit" ...>
    {/* loading label */}
  </button>
)}
```

- [ ] **Step 4: Run all tests**

```bash
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: Compiled successfully with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/login/login-card.tsx src/components/__tests__/login-card.test.tsx
git commit -m "feat: add reset-password mode to login card with session guard"
```

---

## Task 5: Final smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify forgot flow**

1. Open `http://localhost:3000/login`
2. Click "Forgot?" — card should switch to "Reset password" mode, tab pills gone
3. Enter any email, click "Send reset link" — toast should appear, card should stay in forgot mode
4. Click "← Back to sign in" — card returns to sign-in mode

- [ ] **Step 3: Verify proxy redirect behaviour**

1. While signed out, visit `http://localhost:3000/tasks` — should redirect to `/login`
2. While signed in, visit `http://localhost:3000/login` — should redirect to `/tasks`
3. While signed in, visit `http://localhost:3000/login?mode=reset` — should stay on login page and show "Set new password" (or expired-link if no recovery session)

- [ ] **Step 4: Verify callback open-redirect protection**

Visit `http://localhost:3000/auth/callback?next=https%3A%2F%2Fevil.com` — should redirect to `/tasks`, not `evil.com`.

- [ ] **Step 5: Run full test suite one last time**

```bash
npx jest --no-coverage
```

Expected: All tests pass.
