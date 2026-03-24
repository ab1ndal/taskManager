# Forgot Password — Design Spec

**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Add a forgot-password flow to the Hearth login card. All states live on `/login` — no new routes. The card gains two new modes: `forgot` (request reset link) and `reset` (set new password).

This change also consolidates the two competing proxy/middleware files: the root `proxy.ts` (Next.js 16 convention, session-refresh only) absorbs the route-guard logic from `src/middleware.ts`, and `src/middleware.ts` is deleted.

---

## User Flow

### 1. Request reset link (forgot mode)

1. A "Forgot?" link appears right-aligned next to the Password label in `signin` mode only. The label row always uses `justify-between`; the link is simply absent in other modes.
2. Clicking it switches to `forgot` mode — tab pills gone, heading "Reset password", sub-line "We'll email you a link."
3. Fields rendered in `forgot` mode: email only. Password is not rendered. The email field has `required` + `type="email"` (HTML validation is the intended pre-submit guard).
4. "Send reset link" button (loading: "Sending…") and "← Back to sign in" text link below.
5. On submit: `supabase.auth.resetPasswordForEmail(email, { redirectTo })`.
   - `redirectTo` = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/login?mode=reset")}`
   - Safe: `login-card.tsx` is `"use client"` — browser-only.
   - **Note:** `window.location.origin` must be in the Supabase "Redirect URLs" allow-list (e.g. `http://localhost:3000/**` for dev).
6. On success: toast "Check your email for a reset link". Card stays in `forgot` mode (Supabase returns success regardless of email existence — intentional; allows retry).
7. On error: inline error below the field.

### Fields rendered per mode

| Field | signin | signup | forgot | reset |
|---|---|---|---|---|
| Name | — | ✓ | — | — |
| Email | ✓ | ✓ | ✓ | — |
| Password | ✓ | ✓ | — | — |
| New password | — | — | — | ✓ (required) |
| Confirm password | — | — | — | ✓ (required) |

### Mode transition state clearing

| Transition | Clear |
|---|---|
| Any mode switch | `error` |
| Any → `signin` | `password`, `confirmPassword` |
| Any → `signup` | `password`, `confirmPassword` |
| `reset` → `forgot` | `email`, `password`, `confirmPassword` |
| `signin` ↔ `forgot` | _(email retained for convenience)_ |

### 2. Set new password (reset mode)

1. User clicks email link → `/auth/callback?code=xxx&next=%2Flogin%3Fmode%3Dreset`.
2. Callback decodes `next`, validates it (see Security), attempts `exchangeCodeForSession(code)` — errors are silently ignored. If `code` is absent, `next` is still honored. Redirect to `/login?mode=reset`.
   - **Rationale:** failed or missing code means no session. The session guard (step 5) shows the expired-link message. No separate error page needed.
3. `proxy.ts` detects `mode=reset`, skips the authenticated-user redirect. Unauthenticated access is unaffected — `pathname` is always `/login` regardless of query params, already covered by `isAuthRoute`.
4. `useSearchParams` (in `<Suspense fallback={null}>`) reads `?mode=reset`, sets mode to `reset`. URL left as-is.
   - The `fallback={null}` means the card is blank during the Suspense boundary. This is acceptable — the flash is sub-frame on a local network and only occurs on the reset link landing.
5. **Session guard:** call `createClient().auth.getUser()` (browser client from `@/lib/supabase/browser`). Two outcomes:
   - **No user:** show inside the card "This reset link has expired or already been used." + "Request a new one →" button → `forgot` mode. Tab pills suppressed; wordmark visible.
   - **User exists (whether recovery session or normal authenticated session):** show the reset form. An already-authenticated user landing on `?mode=reset` is allowed to change their password — this is a valid use case (e.g. forced reset by admin).
6. Reset form: heading "Set new password", "New password" field (`required`), "Confirm password" field (`required`), static hint "Minimum 6 characters", "Update password" button (loading: "Updating…"). No tab pills, no back link.
7. Client validates passwords match before submitting. Inline error if not.
8. On submit: `createClient().auth.updateUser({ password })`.
9. On success: toast "Password updated", `router.push('/tasks')`, `router.refresh()` (ensures server components receive the updated session — matches existing sign-in pattern).
10. On error: inline error.

---

## Architecture

### Files changed

| File | Action | Notes |
|---|---|---|
| `proxy.ts` (root) | Modify | Add route-guard logic; switch env var to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; add `mode=reset` exemption |
| `src/middleware.ts` | **Delete** | Superseded by updated `proxy.ts` |
| `src/app/auth/callback/route.ts` | Modify | Replace hardcoded `/tasks` redirect with `next` param support |
| `src/app/login/page.tsx` | Modify | Remove `"use client"`, become thin server component wrapping `<LoginCard>` in `<Suspense>` |
| `src/app/login/login-card.tsx` | **Create** | All existing login logic (blobs, wordmark, card, form) + new modes |

### New state (login-card.tsx)

```ts
type Mode = "signin" | "signup" | "forgot" | "reset";
const [confirmPassword, setConfirmPassword] = useState("");
// Existing: name, email, password, error, loading — unchanged
```

### proxy.ts final shape

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, // consistent with rest of project
    { cookies: { /* same getAll/setAll as current proxy.ts */ } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/auth");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const isResetMode = request.nextUrl.searchParams.get("mode") === "reset";
  if (user && pathname === "/login" && !isResetMode) {
    const url = request.nextUrl.clone();
    url.pathname = "/tasks";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

### login/page.tsx after refactor

```tsx
// No "use client" — server component
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

All existing content (blobs, wordmark, card shell, form) moves into `login-card.tsx`, which carries `"use client"`.

### callback/route.ts — replace the final redirect line

```ts
const rawNext = searchParams.get("next");
let next = "/tasks";
if (rawNext) {
  try {
    const decoded = decodeURIComponent(rawNext);
    const url = new URL(decoded, origin);
    // new URL() resolves absolute URLs, protocol-relative (//evil.com),
    // and javascript:/data: schemes — all to non-matching origins.
    if (url.origin === origin) next = decoded;
  } catch {
    // malformed — fall back to /tasks
  }
}
return NextResponse.redirect(`${origin}${next}`);
```

---

## Security

- **Open redirect:** `next` decoded, parsed with `new URL(decoded, origin)` in try/catch, `url.origin === origin` asserted. Handles absolute URLs, protocol-relative, and `javascript:`/`data:` schemes.
- **Session guard uses `getUser()`:** server-revalidated. Not `getSession()` (local-storage only).
- **Password confirmation:** client-side match check. Both reset fields have `required`. Supabase enforces minimum 6 characters server-side; form shows a static hint.

---

## UI Details

- "Forgot?" link: `text-xs`, `var(--color-accent)`, right of password label. Absent in non-`signin` modes.
- Forgot/reset headings: replace tab pills — `text-base font-semibold` + `text-xs text-[var(--color-text-muted)]`.
- "← Back to sign in": `forgot` mode only.
- Expired link state: inside card shell, no tab pills, wordmark visible. `text-sm text-[var(--color-text-secondary)]` + accent button.
- Existing Hearth token classes — no new CSS.

---

## Out of Scope

- Resend link / cooldown timer
- Magic link login
- OAuth / social login
