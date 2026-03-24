# Forgot Password — Design Spec

**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Add a forgot-password flow to the Hearth login card. All states live on the existing `/login` page — no new routes for the user-facing UI. The login card gains two new modes: `forgot` (request reset link) and `reset` (set new password).

---

## User Flow

### 1. Request reset link (forgot mode)

1. On the sign-in form, a "Forgot?" link appears inline next to the "Password" label.
2. Clicking it switches the card to `forgot` mode — the tab pills disappear, replaced by a heading "Reset password" and a sub-line "We'll email you a link."
3. The form shows a single email field and a "Send reset link" button, plus a "← Back to sign in" text link below.
4. On submit, `supabase.auth.resetPasswordForEmail(email, { redirectTo })` is called.
   - `redirectTo` = `{origin}/auth/callback?next=/login?mode=reset`
5. On success: toast "Check your email for a reset link", card returns to `signin` mode.
6. On error: inline error message below the field (same pattern as existing sign-in errors).

### 2. Set new password (reset mode)

1. User clicks the link in their email → lands on `/auth/callback?code=xxx&next=/login?mode=reset`.
2. Callback exchanges the code for a session, reads the `next` param, redirects to `/login?mode=reset`.
3. Login page mounts, reads `?mode=reset` from `searchParams`, initialises state to `reset` mode.
4. Card shows heading "Set new password", two password fields ("New password", "Confirm password"), and an "Update password" button. No tab pills, no back link.
5. Client validates passwords match before submitting.
6. On submit: `supabase.auth.updateUser({ password })`.
7. On success: toast "Password updated", redirect to `/tasks`.
8. On error: inline error message.

---

## Architecture

### Files changed

| File | Change |
|---|---|
| `src/app/login/page.tsx` | Add `forgot` and `reset` modes to existing `Mode` type and card UI |
| `src/app/auth/callback/route.ts` | Support `next` query param for post-exchange redirect (validated as relative path) |

### Mode state

```ts
type Mode = "signin" | "signup" | "forgot" | "reset";
```

`reset` mode is initialised from `?mode=reset` in the URL on component mount (`useSearchParams`). All other mode transitions are client-side state only.

### Security

- The `next` param in the callback is validated to be a relative path (starts with `/`, no `//` or protocol) to prevent open redirect attacks.
- Password confirmation validation is client-side only (UX convenience) — Supabase enforces minimum password length server-side.

---

## UI Details

- **"Forgot?" link:** `text-xs` inline link in `var(--color-accent)`, right-aligned next to the Password label. Visible only in `signin` mode.
- **Forgot/reset card heading:** replaces the tab pills — `text-base font-semibold` title + `text-xs text-muted` subtitle.
- **"← Back to sign in":** text link in `forgot` mode only. Not shown in `reset` mode (user should complete the reset or close the tab).
- All inputs and buttons use existing Hearth token classes — no new CSS.

---

## Out of Scope

- Resend link / cooldown timer
- Magic link login
- OAuth / social login
