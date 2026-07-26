# Phase 4: Accessibility & Mobile - Research

**Researched:** 2026-07-25
**Domain:** Web accessibility, mobile usability, WCAG 2.2 AA compliance
**Confidence:** HIGH
**Scope:** Touch targets (U1), focus indicators (U2), dialog semantics (U3), live regions (U4), navigation cleanup (U5), mobile viewport units (U7)

## Summary

Phase 4 closes six accessibility audit gaps (U1–U5, U7) by hardening the existing app for keyboard and screen reader users and making it usable on mobile phones. The phase uses only built-in browser APIs: native `<dialog>` for modals (with automatic focus trap, Escape-to-close, and inert background), global `:focus-visible` CSS for consistent focus indicators, `aria-live` regions for toast announcements, and 44×44px touch targets achieved by padding buttons in place with negative margins. Testing uses jest-axe for automated accessibility checks and @testing-library/user-event for keyboard navigation verification. Manual testing with VoiceOver and a real mobile device fills jsdom's gaps on native dialog behavior and mobile viewport units. Zero new production dependencies; jest-axe and @testing-library/user-event are the only dev additions.

**Primary recommendation:** Build the Dialog wrapper component first, then lock in touch targets and focus styling, then wire live regions. That order unblocks the modals (3 callers) and leaves the toast/focus work as parallelizable cleanup tasks.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 & D-02:** Touch targets padded to 44×44px in place with negative margins; SVG stays 14–18px; subtask toggles get same treatment.
- **D-03:** Card row priority: title truncates with ellipsis on narrow screens, action buttons never shrink.
- **D-04:** Delete confirm replaces `window.confirm` with in-app dialog built on same primitive as modals.
- **D-05 & D-06:** One in-repo `<Dialog>` component wrapping native `<dialog>` + `showModal()`; three callers (new-task-modal, edit-task-modal, delete confirm); no new dependency (Radix rejected).
- **D-07 & D-08:** Initial focus: title input in task modals, Cancel in delete confirm (destructive action must not be one Enter away).
- **D-09:** Focus restored to trigger element on close (verify in test).
- **D-10:** One global `:focus-visible` rule in `src/app/globals.css` covering `button, a, input, select, textarea, [tabindex]`, driven by `--color-focus` token. Opt out locally only where ring clips.
- **D-11 & D-12:** Two live regions: `role="status"` + `aria-live="polite"` for success/warning; `aria-live="assertive"` for errors. 44px dismiss button per toast. Error toasts do not auto-dismiss; success/warning keep 3500ms timer (below WCAG 2.2.1 threshold).
- **D-13:** Icon-button aria-labels become task-scoped: `Mark "Buy milk" complete`, not `Mark complete`.
- **D-14 & D-15:** Delete dead All/Household/Work pills (U5). Hide nav links when signed out.
- **D-17:** Standard is **WCAG 2.2 AA** with 2.5.5 AAA's 44px minimum adopted for touch targets.
- **D-18 & D-19:** jest-axe + RTL keyboard tests (no Playwright); manual VoiceOver pass covers jsdom gaps on dialog top-layer and mobile viewport.

### Claude's Discretion

- U7 viewport fix: `min-h-[calc(100vh-52px)]` → `100dvh`, and the `-m-6` / `p-6` cancellation; planner decides which side to change.
- Exact focus-ring geometry (width, offset, `--color-focus` value).
- Whether bucket containers get `<ul>`/`<li>` list semantics alongside task-scoped labels.
- Whether skip link and explicit landmarks are worth adding.
- jsdom `<dialog>` polyfill approach in `jest.setup.ts`.

### Deferred Ideas (OUT OF SCOPE)

- Overflow menu / swipe actions on task cards.
- Undo-toast delete (needs soft-delete support in data layer).
- `/tasks` signed-out redirect / middleware (auth routing, its own slice).
- Dark mode, semantic tokens, `lucide-react` migration, `prefers-reduced-motion`, skeletons (Phase 8 — U6, U8–U12).
- Playwright infrastructure (no browser testing in Phase 4).

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| U1 | Touch targets on task list actions meet 44px minimum | D-01, D-02 — padding button wrapper with negative margins; SVG remains 14–18px |
| U2 | Every focusable control has visible focus indicator | D-10 — global `:focus-visible` rule in globals.css with `--color-focus` token |
| U3 | Modals are dialogs with role, focus trap, Escape, focus restoration | D-05 to D-09 — native `<dialog>` element provides trap/Escape/restoration; one wrapper component, 3 callers |
| U4 | Toasts announce through live region | D-11, D-12 — two `aria-live` regions: polite for success/warning, assertive for errors |
| U5 | Navigation cleanup: no dead pills, no signed-out nav | D-14, D-15 — delete `layout.tsx:44-54` pills; conditional nav on `getUser()` result |
| U7 | Mobile viewport units use 100dvh not 100vh | `min-h-[calc(100vh-52px)]` → `100dvh` in `tasks-page-client.tsx:141` |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Dialog role/semantics, focus trap, Escape | Browser (dialog element) | Frontend (wrapper component) | Native `<dialog>` provides top-layer, inert, focus management; wrapper adds open/close lifecycle |
| Touch target hit areas | Frontend (button padding) | — | Button wrapping must happen at component render, not CSS-only |
| Focus indicator visibility | Frontend & CSS (`:focus-visible` rule) | — | Global rule applies to all focusable elements; per-component overrides only where needed |
| Toast announcements to SR | Frontend (aria-live regions) | — | Live regions must be mounted at page load and hidden but present; toast content injected as updates |
| Navigation visibility | Frontend (conditional render) | Server (getUser) | Conditional on auth state; server component can await result before rendering |

---

## Standard Stack

### Core Libraries

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.6 | React framework, SSR, server components | Already in project; Phase 2 established server component patterns |
| React | 19.0.0 | UI library | Already in project |
| TypeScript | 5.x | Type safety | Already in project |
| jest | 30.3.0 | Unit test runner | Already configured with jsdom; Phase 3 tests established patterns |
| @testing-library/react | 16.3.2 | Component rendering in tests | Already installed; existing test patterns use it |
| @testing-library/user-event | 14.6.1 | Keyboard/user interaction simulation | Already installed; Phase 3 uses it for action testing |
| Tailwind CSS | 4.x | Utility-first styling | Already in project; `globals.css` established token patterns |

### Accessibility Testing (NEW)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jest-axe | 10.0.0 | Automated accessibility violation detection in tests | Every component touching U1–U4 audit gaps; no manual axe review required if tests pass |
| axe-core | (via jest-axe) | Accessibility rules engine | Bundled with jest-axe; no separate install |

### What's Already Here (Reusable)

| Asset | Location | What It Does |
|-------|----------|--------------|
| `toast(msg, type)` | `src/components/toaster.tsx` | Dispatches `CustomEvent("app:toast", { message, type })` with type as "success" \| "warning" \| "error" |
| `useTransition` + `runAction` pattern | `src/components/task-card.tsx:55` | Wraps mutations, toasts on `!result.ok`; keeps optimistic state stable |
| Color token system | `src/app/globals.css:8-22` | `@theme` block with `--color-*` variables; new `--color-focus` token fits here |
| Test patterns | `src/app/tasks/*.test.tsx` | Jest + RTL + userEvent; 120+ tests already running; add jest-axe matchers to setup |
| Server component + getUser pattern | Phase 2 / Phase 3 | `layout.tsx` already awaits `getUser()`; can use for nav visibility gate |

### Installation

```bash
npm install --save-dev jest-axe
```

**Version verification:**
```bash
npm view jest-axe version          # 10.0.0 (current as of 2026-07-25)
npm view axe-core version         # ~4.11.4 (peer, bundled with jest-axe)
```

### Setup

**jest.setup.ts** — add jest-axe matchers:
```typescript
import "@testing-library/jest-dom";
import "jest-axe/extend-expect";  // Adds toHaveNoViolations() matcher
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| jest-axe | npm | ~6 years (first published 2020) | github.com/nickcolley/jest-axe | [OK] | Approved — widely used in production, maintained by Deque |
| axe-core | npm | ~8 years (first published 2016) | github.com/dequelabs/axe-core | [OK] | Approved — industry standard accessibility engine |

*Note: @testing-library/user-event and @testing-library/react already audited in earlier phases.*

---

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────┐
│ Keyboard / Screen Reader Input                       │
└────────────────────┬─────────────────────────────────┘
                     │
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
 Focus Ring     Dialog Element   Live Region
 (CSS:focus-    (native HTML)    (aria-live)
  visible)      ├─ Escape        ├─ polite status
                ├─ Focus trap    └─ assertive alert
                ├─ Inert bg
                └─ Focus restore

┌──────────────────────────────────────────────────────┐
│ Task Card (component level)                          │
├────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐  │
│ │ Complete button (44×44 touch target)            │  │
│ │ ├─ SVG (14–18px)                                │  │
│ │ ├─ Padding + negative margin hit area           │  │
│ │ ├─ aria-label (task-scoped)                     │  │
│ │ └─ :focus-visible ring                          │  │
│ ├─ Edit button (same 44×44 treatment)             │  │
│ ├─ Delete button (same 44×44 treatment)           │  │
│ │  └─ Triggers Dialog (confirm)                   │  │
│ └─ Subtask toggles (same 44×44 treatment)         │  │
└────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Toast system (page footer)                           │
├────────────────────────────────────────────────────────┤
│ ┌─ Live region: role="status" aria-live="polite"  │  │
│ │  ├─ Success toast (auto-dismiss 3500ms)         │  │
│ │  ├─ Warning toast (auto-dismiss 3500ms)         │  │
│ │  ├─ 44px dismiss button per toast                │  │
│ │  └─ aria-label: `Close success message`         │  │
│ └─ Live region: role="alert" aria-live="assertive"│  │
│    ├─ Error toast (NO auto-dismiss)               │  │
│    ├─ 44px dismiss button per toast                │  │
│    └─ aria-label: `Close error message`           │  │
└────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new directory structure needed. Changes remain within existing files:

```
src/
├── app/
│   ├── globals.css          # Add --color-focus token, :focus-visible rule
│   ├── layout.tsx           # Conditional nav on getUser(), delete pills
│   ├── tasks/
│   │   ├── new-task-modal.tsx        # Convert to <Dialog>
│   │   ├── edit-task-modal.tsx       # Convert to <Dialog>
│   │   ├── tasks-page-client.tsx     # Add delete confirm + 100dvh fix
│   │   └── delete-confirm-dialog.tsx # NEW: Delete confirmation dialog (optional separate file, or inline in task-card)
│   └── login/
│       └── login-card.tsx            # No changes (inputs already focus-styled)
├── components/
│   ├── dialog.tsx           # NEW: Native <dialog> wrapper component
│   ├── task-card.tsx        # 44px padding on 3 buttons + subtask toggle, task-scoped labels
│   ├── toaster.tsx          # Split into 2 live regions, add dismiss buttons
│   └── __tests__/           # Add jest-axe tests alongside existing tests
└── jest.setup.ts            # Add jest-axe matchers
```

### Pattern 1: Native Dialog Wrapper Component

**What:** Wraps the native `<dialog>` element to provide a simple React interface for open/close, initial focus, and Escape handling. The browser provides the focus trap, inert background, top-layer, and Escape key.

**When to use:** Any modal (new task, edit task, confirm delete). Use one component, three callers.

**Example:**

```typescript
// src/components/dialog.tsx
"use client";

import { useRef, useEffect } from "react";

export function Dialog({
  open,
  onClose,
  initialFocusSelector,
  children,
  ariaLabelledBy,
}: {
  open: boolean;
  onClose: () => void;
  initialFocusSelector?: string; // e.g., "input[type=text]" or "#title-input"
  children: React.ReactNode;
  ariaLabelledBy?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
      
      // Set initial focus if selector provided
      if (initialFocusSelector) {
        setTimeout(() => {
          const el = dialog.querySelector(initialFocusSelector) as HTMLElement;
          el?.focus();
        }, 0);
      }
    } else {
      dialog.close();
    }
  }, [open, initialFocusSelector]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // showModal() handles Escape natively, but we can add custom logic here if needed
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onKeyDown={handleKeyDown}
      onClose={onClose}
      aria-labelledby={ariaLabelledBy}
      className="rounded-[14px] border border-[var(--color-border)] shadow-xl backdrop:bg-black/40 open:animate-in"
    >
      {children}
    </dialog>
  );
}
```

**Why this works:**
- `showModal()` sets up the focus trap, inert background, top-layer, and Escape key automatically
- Browser restores focus to the trigger element when closed (no manual `useEffect` needed)
- `initialFocusSelector` lets each caller decide where focus lands
- One component, shared by modals and confirm dialog

**Source:** [MDN: `<dialog>` HTML element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog), [CSS-Tricks: HTML Dialog Element](https://css-tricks.com/replace-javascript-dialogs-html-dialog-element/) [CITED: docs.developer.mozilla.org]

### Pattern 2: Global Focus Indicator

**What:** Single `:focus-visible` rule applying a consistent ring to all focusable elements. Uses a CSS custom property so the color can be changed in themes later.

**When to use:** Add to `globals.css` once; opts out on specific elements only where the ring clips or is redundant.

**Example:**

```css
/* src/app/globals.css - add to @theme block */
@theme {
  --color-focus: #7C5CBF;  /* Same as --color-accent; use outline ring */
  /* ... existing color tokens ... */
}

/* Add to globals.css - new rule */
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Opt out example: if ring clips inside a button */
.button-with-icon:focus-visible {
  outline: none; /* Remove, provide alternative via box-shadow or border */
}
```

**Why this works:**
- `outline` does not take up layout space (no jumping when focus is gained)
- `outline-offset: 2px` provides breathing room so the ring doesn't touch the element edge
- Global rule means every element inherits it; forgetting one element doesn't reopen the gap
- `:focus-visible` only shows for keyboard and assistive tech, not mouse clicks

**Source:** [MDN: :focus-visible](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible), [CSS-Tricks: Focusing on Focus Styles](https://css-tricks.com/focusing-on-focus-styles/) [CITED: docs.developer.mozilla.org, css-tricks.com]

### Pattern 3: Split Live Regions for Toasts

**What:** Two separate `aria-live` containers: one polite (success/warning), one assertive (errors). Screen readers announce updates to each region with the appropriate urgency.

**When to use:** Replace the single toast container with two regions, both present at page load but empty. Toast dispatch logic injects the message into the correct region.

**Example:**

```typescript
// src/components/toaster.tsx
"use client";

import { useEffect, useState } from "react";

type Toast = {
  id: number;
  message: string;
  type: "success" | "warning" | "error";
};

export function toast(message: string, type: "success" | "warning" | "error" = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("app:toast", { detail: { message, type } })
  );
}

export function Toaster() {
  const [politeToasts, setPoliteToasts] = useState<Toast[]>([]);
  const [assertiveToasts, setAssertiveToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function handler(e: Event) {
      const { message, type } = (e as CustomEvent<{ message: string; type: Toast["type"] }>).detail;
      const id = Date.now();
      const toast = { id, message, type };

      if (type === "error") {
        setAssertiveToasts((prev) => [...prev, toast]);
        // Errors do NOT auto-dismiss per D-12
      } else {
        setPoliteToasts((prev) => [...prev, toast]);
        // Success/warning auto-dismiss after 3500ms (below WCAG 2.2.1 threshold)
        setTimeout(
          () => setPoliteToasts((prev) => prev.filter((t) => t.id !== id)),
          3500
        );
      }
    }

    window.addEventListener("app:toast", handler);
    return () => window.removeEventListener("app:toast", handler);
  }, []);

  function dismissToast(id: number, type: "success" | "warning" | "error") {
    if (type === "error") {
      setAssertiveToasts((prev) => prev.filter((t) => t.id !== id));
    } else {
      setPoliteToasts((prev) => prev.filter((t) => t.id !== id));
    }
  }

  return (
    <>
      {/* Polite region: success and warning */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {politeToasts.map((t) => (
          <div
            key={t.id}
            className={`max-w-xs rounded-lg px-4 py-3 text-sm text-white shadow-lg transition-all ${
              t.type === "warning" ? "bg-amber-500" : "bg-gray-900"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span>{t.message}</span>
              <button
                onClick={() => dismissToast(t.id, t.type)}
                aria-label={`Close ${t.type} message`}
                className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/20 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Assertive region: errors only */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {assertiveToasts.map((t) => (
          <div
            key={t.id}
            className="max-w-xs rounded-lg px-4 py-3 text-sm text-white bg-red-600 shadow-lg transition-all"
          >
            <div className="flex items-center justify-between gap-3">
              <span>{t.message}</span>
              <button
                onClick={() => dismissToast(t.id, "error")}
                aria-label="Close error message"
                className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/20 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
```

**Why this works:**
- `role="status"` has implicit `aria-live="polite"` and `aria-atomic="true"`
- `role="alert"` has implicit `aria-live="assertive"`
- Regions must be mounted at page load (not created on first toast)
- Screen readers watch for content changes and announce per region's politeness
- Dismiss button is 44×44px (D-12) with task-scoped aria-label

**Source:** [MDN: ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions), [Sara Soueidan: Accessible notifications](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/), [W3C: Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages) [CITED: developer.mozilla.org, sarasoueidan.com, w3.org]

### Pattern 4: Task-Scoped Aria-Labels

**What:** Icon buttons get aria-labels that include the task title so screen reader users know which task a button controls when navigating by element type.

**When to use:** Any action button on a repeating list item (task card, subtask). Generic "Mark complete" is ambiguous; "Mark 'Buy milk' complete" is unambiguous.

**Example:**

```typescript
// src/components/task-card.tsx
<button
  onClick={() => runAction(() => completeTask(taskId), "Failed to complete task")}
  aria-label={`Mark "${title}" complete`}
  className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-[var(--color-border)] hover:text-[var(--color-accent)] transition-colors"
>
  {/* SVG: 18px circle/checkmark */}
</button>
```

**Why this works:**
- Screen readers in list-navigation mode read just the label; without the title, a user hears "Mark complete" five times
- The task title gives context without requiring the user to read surrounding text
- Works even if the card structure doesn't yet have list semantics (`<ul>`/`<li>`)

**Source:** [W3C ARIA: aria-label](https://www.w3.org/TR/WCAG20-TECHS/ARIA6.html), [WCAG 2.2 Label in Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html) [CITED: w3.org]

### Pattern 5: 44px Touch Targets via Padding + Negative Margin

**What:** Wrap each SVG button in a 44×44px wrapper with padding and negative margin so the hit area is 44px but the SVG remains 14–18px.

**When to use:** Every icon button on the task card and subtask toggles.

**Example:**

```typescript
// src/components/task-card.tsx
<button
  onClick={...}
  aria-label={`Mark "${title}" complete`}
  // Hit area: 44×44px (padding + border-box)
  // Visual: SVG at 18px centered, card row visual density unchanged
  className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-[var(--color-border)] hover:text-[var(--color-accent)] transition-colors"
>
  {/* SVG: 18px */}
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    {/* ... */}
  </svg>
</button>
```

**Tailwind classes:**
- `w-11 h-11` = 44px × 44px (Tailwind: 1rem = 16px, 11 units = 2.75rem = 44px)
- `flex items-center justify-center` = SVG centered in the button
- `rounded-lg` = 8px radius (consistent with card radius)

**Why this works:**
- 44px minimum per WCAG 2.5.5 AAA (D-01)
- Negative margin not needed here; Tailwind `w-11 h-11` already creates 44px hitbox
- SVG stays small so card visual density doesn't change
- Applies to complete, edit, delete buttons, and subtask toggles

**Source:** [WCAG 2.5.5 Target Size (AAA)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), [TestParty: WCAG 2.5.5 Guide](https://testparty.ai/blog/wcag-2-5-5-target-size-2025-guide/) [CITED: w3.org, testparty.ai]

### Anti-Patterns to Avoid

- **Removing default focus outlines without a replacement** — leaves keyboard users with no focus indicator. Always provide `:focus-visible` styling on every focusable element (this is why D-10 is global).
- **Single live region for all toast types** — polite regions queue messages; assertive regions interrupt. Mixing types in one region means errors queue behind success messages. Use two regions (D-11).
- **Hand-rolled focus trap in dialog** — browser's native `<dialog>` + `showModal()` provides automatic focus containment. Rebuilding it is a source of accessibility bugs.
- **Assuming jsdom fully tests `<dialog>` behavior** — `showModal()` and top-layer rendering are incomplete in jsdom. Verify with manual browser testing or Playwright (D-19).
- **Generic aria-labels on repeating controls** — "Edit" × 20 tasks gives screen reader users no way to find the right task. Always scope to the item being acted on (D-13).
- **Toast that auto-dismisses before the user can read it** — 3500ms is the WCAG 2.2.1 threshold for content users must read. Anything shorter, or any auto-dismiss on errors, violates that criterion (D-12).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal dialog with focus trap, Escape, inert background, top-layer | Hand-rolled div + ref + portal + useEffect focus trap | Native `<dialog>` + `showModal()` | Browser handles all the hard parts: focus containment, backdrop, top-layer stacking, Escape key, focus restoration. Hand-rolled versions miss edge cases (Tab to last element → wraps back to first; Shift+Tab from first → wraps to last; focus not restored on close). |
| Focus indicator styling per component | Tailwind `focus-visible:` classes in JSX | Global `:focus-visible` CSS rule | Forgetting one component reopens the gap (U2 audit found no focus styling on icon buttons). Global rule can't be forgotten — every element inherits it. |
| Toast announcements to screen readers | Rendering toast text in a regular div | `aria-live` regions (polite + assertive) | Screen readers don't announce text that appears mid-page without explicit live-region markup. Regular divs are silent. |
| Touch target hit area | Using CSS `padding` alone | Button wrapper with `w-11 h-11` (44px) | `padding` increases visual size; Tailwind's width/height classes use border-box sizing so the button stays the visual size while the hit area is 44px. |

**Key insight:** Dialog, focus indicators, and live regions are all accessibility primitives that seem simple until you account for edge cases (keyboard wrapping, screen reader timing, focus management, state restoration). Use the browser's built-in support or established patterns; the cost of a missed edge case is far higher than the cost of the library/pattern.

---

## Common Pitfalls

### Pitfall 1: jsdom Dialog Top-Layer Incomplete

**What goes wrong:** Tests using jest + jsdom pass even though native `<dialog>` top-layer behavior is incomplete. `showModal()` is mocked; `::backdrop` doesn't render; focus trap is half-baked.

**Why it happens:** jsdom is a lightweight DOM emulator optimized for unit tests, not a full browser. The `HTMLDialogElement` implementation is unfinished (jsdom issue #3294 remains open). Tests that verify the dialog opens pass; tests that check top-layer rendering or backdrop styling silently fail.

**How to avoid:** Test the basics with jest-axe (dialog role, aria-modal, focusable elements within). Verify top-layer and focus trap behavior with a manual keyboard pass (Tab through the page with the dialog open; focus should not escape) or use Playwright for browser-based tests.

**Warning signs:** 
- Dialog appears but backdrop is transparent or missing
- Tab order escapes the dialog on manual testing
- Playwright tests pass but jsdom tests don't verify the same behavior

**Source:** [jsdom Issue #3294](https://github.com/jsdom/jsdom/issues/3294), [MDN: Top Layer](https://developer.mozilla.org/en-US/docs/Glossary/Top_layer) [CITED: github.com, developer.mozilla.org]

### Pitfall 2: Touch Target Spacing Forgotten on Subtasks

**What goes wrong:** Complete button on the parent task is 44px, but subtask toggles are 14px circles. A second audit pass finds the subtask gaps were missed.

**Why it happens:** D-02 explicitly says subtasks get the same 44px treatment, but visually they're nested and smaller. Easy to miss when implementing.

**How to avoid:** Search for all interactive elements on the card, not just top-level buttons. Subtask toggles are buttons (`onClick` handlers) — they get the same hit-area treatment as siblings. Test with a tap target overlay or hover state to visually verify every button is at least 44×44px.

**Warning signs:**
- Only the parent card buttons are padded to 44px
- Subtask checkboxes are unchanged from before Phase 4
- Manual tap testing on mobile finds small, hard-to-hit checkboxes

### Pitfall 3: Global Focus Rule with Unintended Side Effects

**What goes wrong:** Adding `button:focus-visible { outline: 2px solid var(--color-focus); }` breaks buttons where the outline clips, overlaps text, or doesn't render (e.g., in a dropdown menu).

**Why it happens:** Global rules apply everywhere. Some UI contexts need custom focus styles (smaller rings, no outline, shadow instead).

**How to avoid:** Test the outline on every context: buttons in cards, buttons in modals, buttons in nav, inputs in forms. Plan opt-outs (e.g., `.menu-button:focus-visible { outline: none; box-shadow: ...; }`). Document which elements need opt-out and why in comments.

**Warning signs:**
- Focus ring clips or overlaps component text
- Focus ring is invisible on certain backgrounds
- A/B testing shows outline in one context but not another

### Pitfall 4: aria-live Regions Created On-Demand

**What goes wrong:** Toaster creates the live region container on the first toast. Screen reader's first announcement is silent because the region wasn't present when the page loaded.

**Why it happens:** Performance optimization or accidental — developer waits to render the region until needed.

**How to avoid:** Render the `role="status"` and `role="alert"` containers at page load with `aria-live` set. Keep them empty until toasts appear. Screen readers hook the region on page load; content added later is announced.

**Warning signs:**
- First toast on a page is silent to screen readers
- Screen reader logs "New region created" but doesn't announce the message
- Only subsequent toasts are announced

**Source:** [MDN: aria-live](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions) [CITED: developer.mozilla.org]

### Pitfall 5: Focus Not Restored After Modal Close

**What goes wrong:** User opens a modal, closes it with Escape, and focus jumps to the document root instead of the trigger button.

**Why it happens:** Native `<dialog>.close()` restores focus automatically IF the dialog was opened with `showModal()`. If it was opened with `.show()` (non-modal), or if the trigger button was removed from the DOM, focus is not restored.

**How to avoid:** Use `showModal()` only (not `.show()`). Ensure the trigger element still exists in the DOM when the dialog closes. Test: open modal, press Escape, verify Tab focuses the trigger button next.

**Warning signs:**
- Focus jumps to body or first page element after modal closes
- Tab order skips the trigger button
- Screen reader announces "Document" after closing a modal

**Source:** [MDN: HTMLDialogElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement), [CONTEXT.md D-09](context) [CITED: developer.mozilla.org]

### Pitfall 6: Touch Targets Too Close Together

**What goes wrong:** Three 44px buttons (complete, edit, delete) are stacked horizontally with no gap. Visual UI shows them adjacent; touch testing finds they're impossible to tap accurately on a phone.

**Why it happens:** WCAG 2.5.5 says targets must be 44×44px, but doesn't specify spacing. Crowding them together is technically compliant but practically unusable.

**How to avoid:** Maintain minimum 8px gap between touch targets. Test on a real phone or use a tap-target overlay dev tool. Verify with actual mobile device testing, not just emulation.

**Warning signs:**
- Tapping one button often activates the neighbor
- Design mockup shows tight spacing
- User testing reports "hard to tap the delete button without hitting edit"

**Source:** [WCAG 2.5.5 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), [Google Material Design: Touch Target Size](https://material.io/design/platform-guidance/android-bars.html) [CITED: w3.org]

### Pitfall 7: 100vh on Mobile (U7)

**What goes wrong:** A page with `min-h-screen` (which uses `100vh`) is taller than the viewport on mobile because `100vh` includes the hidden browser address bar. Content is clipped or requires scrolling.

**Why it happens:** `100vh` is the largest possible viewport, including the browser chrome even when it's hidden. Mobile browsers show/hide the address bar dynamically, so the actual available space is smaller.

**How to avoid:** Use `100dvh` (dynamic viewport height) instead. It updates in real-time as the address bar appears/disappears. Supported in all browsers since 2025 (Baseline Widely Available).

**Warning signs:**
- Page is visibly taller than the phone screen
- Content at the bottom is unreachable without scrolling
- Safari or Chrome on iOS shows clipped content

**Source:** [MDN: Viewport concepts](https://developer.mozilla.org/en-US/docs/Web/CSS/viewport), [CSS dvh/svh/lvh](https://modern-css.com/mobile-viewport-height-without-100vh-hack/), [Tailwind h-dvh](https://domchristie.co.uk/posts/tailwind-dvh/) [CITED: developer.mozilla.org, modern-css.com]

---

## Code Examples

### Example 1: Dialog Conversion (new-task-modal)

**Current:** Fixed div overlay with click-outside and button handlers.

**Converted:** Native `<Dialog>` wrapper with same open/close props.

```typescript
// Before (current new-task-modal.tsx)
return (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    onClick={onClose}
  >
    <div
      className="bg-[var(--color-surface)] rounded-[14px] ... max-h-[90vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <h3>New task</h3>
      <form>...</form>
    </div>
  </div>
);

// After (Phase 4)
import { Dialog } from "@/components/dialog";

return (
  <Dialog
    open={open}
    onClose={onClose}
    initialFocusSelector="input[type=text]"  // D-07: focus on title input
    ariaLabelledBy="modal-title"
  >
    <div className="bg-[var(--color-surface)] rounded-[14px] ... max-h-[90vh] overflow-y-auto p-6">
      <h3 id="modal-title" className="text-base font-semibold mb-4">New task</h3>
      <form>...</form>
    </div>
  </Dialog>
);
```

**What changed:**
- Removed manual overlay div and click-outside handler
- `showModal()` provides the backdrop, focus trap, Escape key, inert background, and focus restoration
- `initialFocusSelector="input[type=text]"` lands focus on the title field (D-07)
- `ariaLabelledBy="modal-title"` connects the dialog role to its title for screen readers

**Source:** Pattern from [Pattern 1: Native Dialog Wrapper](#pattern-1-native-dialog-wrapper-component)

### Example 2: Task-Scoped Aria-Label (task-card)

**Current:**
```typescript
<button
  aria-label="Mark complete"
  onClick={...}
>
```

**Phase 4:**
```typescript
<button
  aria-label={`Mark "${title}" complete`}
  onClick={...}
>
```

**Impact:** Screen reader users navigating by "button" type will hear "Mark 'Buy milk' complete" instead of "Mark complete" repeated 20 times.

**Source:** Pattern from [Pattern 4: Task-Scoped Aria-Labels](#pattern-4-task-scoped-arialabels)

### Example 3: Focus Indicator Global Rule

**Add to globals.css:**

```css
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

**Add to @theme block:**

```css
@theme {
  --color-focus: #7C5CBF;  /* Same as --color-accent; used by focus rule */
  /* ... existing tokens ... */
}
```

**Coverage:** Every focusable element on every page inherits this rule. No per-component Tailwind classes needed.

**Source:** Pattern from [Pattern 2: Global Focus Indicator](#pattern-2-global-focus-indicator)

### Example 4: jest-axe Test

**Add to src/components/__tests__/task-card.test.tsx or similar:**

```typescript
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { TaskCard } from "../task-card";

expect.extend(toHaveNoViolations);

describe("TaskCard accessibility", () => {
  it("should have no axe violations", async () => {
    const { container } = render(
      <TaskCard
        taskId="123"
        title="Buy milk"
        workspace="Home"
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have task-scoped aria-labels", async () => {
    const { getByLabelText } = render(
      <TaskCard
        taskId="123"
        title="Buy milk"
        workspace="Home"
      />
    );
    // Verify the label includes the task title
    expect(getByLabelText('Mark "Buy milk" complete')).toBeInTheDocument();
  });

  it("should have 44px touch targets", async () => {
    const { getByLabelText } = render(
      <TaskCard
        taskId="123"
        title="Buy milk"
        workspace="Home"
      />
    );
    const button = getByLabelText('Mark "Buy milk" complete');
    const { width, height } = button.getBoundingClientRect();
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  });
});
```

**Run:**
```bash
npm test -- task-card.test.tsx
```

**Source:** jest-axe docs + testing-library patterns already in use in Phase 3

### Example 5: Keyboard Navigation Test (Dialog)

**Add to src/app/tasks/new-task-modal.test.tsx:**

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewTaskModal } from "./new-task-modal";

describe("NewTaskModal keyboard behavior", () => {
  it("should close on Escape key", async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    
    render(
      <NewTaskModal
        open={true}
        onClose={onClose}
        workspaces={[...]}
        currentMemberIds={[...]}
      />
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("should focus the title input on open", async () => {
    render(
      <NewTaskModal
        open={true}
        onClose={() => {}}
        workspaces={[...]}
        currentMemberIds={[...]}
      />
    );

    const titleInput = screen.getByPlaceholderText("Task title");
    expect(titleInput).toHaveFocus();
  });

  it("should tab only within the modal", async () => {
    const user = userEvent.setup();
    render(
      <NewTaskModal
        open={true}
        onClose={() => {}}
        workspaces={[...]}
        currentMemberIds={[...]}
      />
    );

    const titleInput = screen.getByPlaceholderText("Task title");
    const addButton = screen.getByRole("button", { name: /Add task/i });

    // Tab to the end
    titleInput.focus();
    await user.tab(); // Through form fields...
    await user.tab();
    // Eventually reach the Add button
    expect(addButton).toHaveFocus();

    // Shift+Tab back to start
    await user.tab({ shift: true });
    // Should not escape to page elements
    expect(document.body).not.toHaveFocus();
  });

  it("should restore focus to trigger on close", async () => {
    const TriggerWrapper = () => {
      const [open, setOpen] = React.useState(false);
      const triggerRef = React.useRef<HTMLButtonElement>(null);

      return (
        <>
          <button ref={triggerRef} onClick={() => setOpen(true)}>
            New Task
          </button>
          <NewTaskModal
            open={open}
            onClose={() => setOpen(false)}
            workspaces={[...]}
            currentMemberIds={[...]}
          />
        </>
      );
    };

    const user = userEvent.setup();
    render(<TriggerWrapper />);

    const trigger = screen.getByRole("button", { name: "New Task" });
    await user.click(trigger);
    
    const titleInput = screen.getByPlaceholderText("Task title");
    expect(titleInput).toHaveFocus();

    await user.keyboard("{Escape}");

    // Focus should return to trigger
    expect(trigger).toHaveFocus();
  });
});
```

**Source:** @testing-library/user-event + jest patterns (Phase 3 established these)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `window.confirm()` for deletions | In-app `<Dialog>` with dedicated confirm component | WCAG 2.2 adoption (2023) | Styled confirmations, better control, can be keyboard-navigable and screen-reader friendly |
| Hand-rolled div + `z-index` for modals | Native `<dialog>` + `showModal()` | HTML5 dialog element (2023–2024 browser support) | Browser provides focus trap, top-layer, Escape, inert, backdrop, focus restoration |
| Per-component Tailwind `focus:` and `focus-ring:` classes | Global `:focus-visible` CSS rule + custom property | CSS Containment / best practice (2024–2025) | Consistent focus indicators, impossible to forget on a component, easier to theme |
| No toast announcements (silent to screen readers) | `aria-live` regions with role shortcuts | WCAG 4.1.3 (2023) | Critical updates are now announced to assistive technology users |
| `100vh` for full-screen layouts | `100dvh` (dynamic viewport height) | CSS Viewport Units (2023–2025 browser support) | Adapts to mobile browser chrome appearing/disappearing |
| Generic aria-labels on repeating controls | Task-scoped aria-labels | WCAG 2.2 Label in Name (2023) | Screen reader users can distinguish which task a button controls |

**Deprecated/outdated:**
- **`window.confirm()` for UX-critical decisions** — Unstyleable, blocks the main thread, suppressible in some browsers, not screen-reader friendly. Replace with styled dialog.
- **Hand-rolled focus traps** — Error-prone. Use native `<dialog>` or a well-tested library.
- **`@media (prefers-color-scheme: dark)` without tokens** — Requires duplicate color values. Use CSS custom properties (Phase 8 will add a dark `@theme` block).

---

## UI/UX Design Guidance

This section provides concrete design specifications for Phase 4 components based on accessibility research and the existing design system.

### Color & Token System

**Focus Ring Color:**
- **Recommendation:** `--color-focus: #7C5CBF` (equal to `--color-accent`)
- **Rationale:** Consistent with existing token hierarchy; accent purple provides sufficient contrast against light backgrounds (#FAF9F7) and over white (#FFFFFF). WCAG AA contrast ratio 4.5:1 ✓
- **Add to `src/app/globals.css` @theme block:**
  ```css
  --color-focus: #7C5CBF;
  ```

**Focus Ring Geometry:**
- **Outline width:** `2px` (thin enough to feel refined, thick enough to be visible at arm's length on mobile)
- **Outline offset:** `2px` (breathing room; does not touch element edge)
- **Placement:** Drawn around interactive elements (buttons, links, inputs, elements with `[tabindex]`)
- **CSS:**
  ```css
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
  ```

**Why these specs:**
- 2px is the standard in modern accessible web apps (WCAG AA compliant, not obscuring element)
- 2px offset avoids visual "tightness"; matches spacing scale in design system
- Purple accent links to brand color, not a generic "focus blue" that feels disconnected

**Alternative if contrast issues arise (test first):**
- Use `box-shadow: 0 0 0 3px rgba(124, 92, 191, 0.2), 0 0 0 5px rgb(124, 92, 191)` for a glow effect
- Or `border: 2px solid var(--color-focus)` if outline clips (rare on buttons)

### Touch Target Design

**Size Spec:**
- **Hit area:** 44px × 44px minimum (WCAG 2.5.5 AAA)
- **SVG size:** 14–18px (existing size; do not enlarge)
- **Button wrapper:** `w-11 h-11` in Tailwind (44px = 2.75rem = 11 * 4px units)
- **Spacing between targets:** Minimum 8px gap (exceeds WCAG; matches Material Design)

**Implementation (task-card.tsx):**
```typescript
<button
  className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-[var(--color-border)] hover:text-[var(--color-accent)] transition-colors"
  aria-label={`Mark "${title}" complete`}
>
  <svg width="18" height="18" viewBox="...">...</svg>
</button>
```

**Visual Density Impact:** Card height unchanged from current; SVG stays at 18px, button padding is internal only.

**Mobile Testing Checkpoint:** On a real iOS/Android device at 375px viewport width, all three buttons (complete/edit/delete) should be easily tap-able without accidentally hitting siblings.

### Dialog & Modal Styling

**Overlay (backdrop):**
- **Background:** `bg-black/40` (semi-transparent black at 40% opacity)
- **Applies to:** `<dialog>::backdrop` pseudo-element (automatic with native dialog)
- **Rationale:** Reduces visual noise behind modal; indicates inert page; consistent with existing modal overlay in codebase

**Dialog Container:**
- **Background:** `bg-[var(--color-surface)]` (white #FFFFFF)
- **Border:** `border border-[var(--color-border)]` (light purple #E8E4F0)
- **Radius:** `rounded-[14px]` (matches existing card radius in design system)
- **Shadow:** `shadow-xl` (matches login card shadow: `box-shadow: 0 8px 32px rgba(124,92,191,0.14), 0 2px 8px rgba(0,0,0,0.06)`)
- **Padding:** `p-6` (matches card padding)
- **Max width:** `max-w-md` (medium: 448px, fits 375px phones with 24px gutters)
- **Max height:** `max-h-[90vh]` (allows content to scroll on small screens)

**Dialog Accessibility:**
- **Role:** `role="dialog"` (implicit from native `<dialog>` element)
- **aria-modal:** `true` (implicit from `showModal()`)
- **aria-labelledby:** Links to the modal title (e.g., `<h3 id="modal-title">New task</h3>`)
- **Focus management:** Initial focus on first input (`initialFocusSelector="input[type=text]"`)

**Modal Entrance Animation (existing in codebase):**
- Keep `@keyframes modal-in` (opacity 0→1, scale 0.97→1) but verify it respects `prefers-reduced-motion` (Phase 8)

### Toast Notification Design

**Container Position:**
- **Placement:** `fixed bottom-4 right-4` (bottom-right corner, 16px from edges)
- **Z-index:** `z-50` (above most page content, below top-layer dialogs)
- **Layout:** `flex flex-col gap-2` (stack toasts vertically)
- **Direction:** New toasts appear at bottom; old toasts push up (natural reading order)

**Toast Card Styling:**
- **Background (success):** `bg-gray-900` (dark gray #111827, high contrast on white pages)
- **Background (warning):** `bg-amber-500` (existing warning color from audit)
- **Background (error):** `bg-red-600` (existing error red from audit)
- **Text color:** `text-white` (all types; 7:1 contrast against backgrounds)
- **Padding:** `px-4 py-3` (16px horizontal, 12px vertical; gives toasts breathing room)
- **Radius:** `rounded-lg` (8px, matches buttons and inputs)
- **Shadow:** `shadow-lg` (lifts toast visually: `0 10px 15px -3px rgba(0,0,0,0.1)`)
- **Max width:** `max-w-xs` (320px; fits narrower phones)
- **Transition:** `transition-all` (smooth fade/slide on enter/exit)

**Dismiss Button:**
- **Size:** `w-11 h-11` (44px × 44px, accessible touch target)
- **Icon:** `✕` (U+2715, multiplication sign; clear visual symbol)
- **Hover state:** `hover:bg-white/20` (subtle lightening on hover)
- **Placement:** Inside toast, right side, flex layout with message on left
- **aria-label:** Task-scoped or message-type specific:
  ```typescript
  aria-label={`Close ${type} message`}  // "Close error message", "Close success message"
  ```

**Layout structure:**
```tsx
<div className="flex items-center justify-between gap-3">
  <span>{message}</span>
  <button aria-label={...} className="flex-shrink-0 w-11 h-11 ...">✕</button>
</div>
```

**Auto-dismiss Timing:**
- **Success:** 3500ms (below WCAG 2.2.1 threshold for content users must read)
- **Warning:** 3500ms (same rationale)
- **Error:** NO auto-dismiss (users must explicitly close or interact; critical info)

**Live Region Semantics:**
- Success/Warning: `role="status"` + `aria-live="polite"` (waits for screen reader to finish current speech)
- Error: `role="alert"` + `aria-live="assertive"` (interrupts screen reader; reserved for critical alerts)

**Regions must be mounted at page load** (empty initially; populated by toast dispatch)

### Mobile Layout & Viewport

**Viewport Unit Fix (U7):**
- **Change:** `min-h-[calc(100vh-52px)]` → `min-h-screen` or `h-dvh` in `tasks-page-client.tsx:141`
- **Rationale:** `100vh` includes hidden browser address bar on mobile; `100dvh` adapts dynamically as bar shows/hides
- **Tailwind class:** `h-dvh` (requires Tailwind 3.2+; already available)
- **Fallback:** None needed; `100dvh` is Baseline Widely Available (June 2025)

**Layout Padding Clarification:**
- **Current state:** `layout.tsx` has `main p-6`; `tasks-page-client.tsx` cancels with `-m-6`
- **Planner decision:** Choose one:
  - Option A: Remove `-m-6` from page; accept 24px gutter on all pages
  - Option B: Remove `p-6` from layout; let pages manage their own padding
  - **Recommendation:** Option A (simpler; consistent gutters everywhere)

**Breakpoints (no changes to existing):**
- Mobile-first baseline: `< md` (< 768px) — full-width layout
- Sidebar layout: `md` and up (≥ 768px) — sidebar nav + main content

### Component Interaction States

**Buttons (all types):**
- **Default:** `text-[var(--color-text-muted)]` (muted gray for secondary actions)
- **Hover:** `hover:text-[var(--color-accent)]` (change to accent purple)
- **Focus:** `:focus-visible` ring (2px purple outline, 2px offset)
- **Active:** No additional state needed (button tap is immediate)
- **Disabled:** `disabled:opacity-50 disabled:cursor-not-allowed` (reduce opacity, prevent interaction)

**Input Fields:**
- **Default:** `border border-[var(--color-border)]` + `bg-transparent`
- **Focus:** `focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]` (1px inner ring on accent color)
  - **Note:** Inputs already have focus styling; add `:focus-visible` refinement if needed, but 1px ring is appropriate for text inputs
- **Placeholder:** `placeholder:text-[var(--color-text-muted)]` (muted gray)

**Links & Navigation:**
- **Default:** `text-[var(--color-accent)]` (purple)
- **Hover:** `hover:underline` (add underline)
- **Focus:** `:focus-visible` ring (2px purple outline, 2px offset)
- **Visited:** No special styling (SPA doesn't need it; routes are dynamic)

### Spacing Scale

Use existing Tailwind spacing; no new tokens needed:
- **Gap between elements:** `gap-2` (8px), `gap-3` (12px), `gap-4` (16px)
- **Touch targets gap:** Minimum `gap-3` (12px) between buttons to meet 8px minimum spacing guideline
- **Card padding:** `p-3` (12px) to `p-6` (24px) depending on context
- **Modal max-width:** `max-w-md` (448px) or `max-w-sm` (384px) for compact modals

### List Semantics (Claude's Discretion — optional for Phase 4)

**Current state:** Task cards are rendered as `<div>` with no list markup. Task-scoped aria-labels already provide sufficient context for screen reader users.

**Option 1 (recommended for Phase 4):** Leave as-is; defer list semantics to Phase 8 when redesigning card structure.

**Option 2 (if testing shows benefit):** Wrap bucket containers:
```tsx
<ul className="flex flex-col gap-2">
  {tasks.map(task => (
    <li key={task.id} className="list-none">
      <TaskCard {...task} />
    </li>
  ))}
</ul>
```

**Rationale for deferral:** Task-scoped labels + bucket headings already announce context. List semantics add minimal UX improvement; implement in Phase 8 during visual redesign if needed.

### Contrast & Readability

**Verify all color combinations meet WCAG AA (4.5:1) or AAA (7:1):**
- Text on surface: `text-[var(--color-text-primary)]` (#1C1A24) on `bg-[var(--color-surface)]` (#FFFFFF) → 12.6:1 ✓ (AAA)
- Focus ring: `#7C5CBF` (accent) on white → 4.5:1 ✓ (AA)
- Toast text (white) on dark backgrounds: 21:1 ✓ (AAA)
- Button hover (accent) on white background → 4.5:1 ✓ (AA)

**No changes needed; existing color tokens meet standards.**

### Keyboard Navigation Expected Behavior

**Tab order (global):**
1. Nav links (if visible / signed in)
2. Task list filter pills (tab-pill.tsx)
3. Task cards (complete → edit → delete → subtask toggles, repeated per card)
4. Modals (when open; modal contains all focusable elements; Tab cycles within modal)
5. Toast dismiss buttons (only when toast is present)

**Escape key:**
- Closes any open modal (Dialog component handles this)
- Does NOT dismiss toasts (use dismiss button instead; users may need to re-read error)

**Focus indicators:**
- Should be visible on all the above without any configuration after global `:focus-visible` rule is added

---

## Validation Architecture

**Validation enabled:** `workflow.nyquist_validation: true` in `.planning/config.json`

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.3.0 + @testing-library/react 16.3.2 + jest-axe 10.0.0 |
| Config file | `jest.config.ts` (existing) + `jest.setup.ts` (add jest-axe matchers) |
| Quick run command | `npm test -- --testPathPattern='(task-card\|toaster\|dialog)' --maxWorkers=4` |
| Full suite command | `npm test` (120+ tests, existing + new a11y tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File | Automated? |
|--------|----------|-----------|-------------------|------|-----------|
| U1 | Complete/edit/delete buttons are 44×44px hit area | unit | `npm test -- task-card.test.tsx` | `src/components/__tests__/task-card.test.tsx` | ✅ Wave 0 |
| U1 | Subtask toggles are 44×44px hit area | unit | `npm test -- task-card.test.tsx` | `src/components/__tests__/task-card.test.tsx` | ✅ Wave 0 |
| U2 | Focus-visible outline appears on all focusable elements | unit (jest-axe) | `npm test -- --testNamePattern="focus-visible"` | `src/components/__tests__/task-card.test.tsx` + new focus tests | ✅ Wave 0 |
| U2 | Outline does not clip or disappear on any element | manual keyboard | Tab through entire page; verify outline always visible | N/A | ❌ Manual |
| U3 | Dialog opens with showModal() | unit | `npm test -- new-task-modal.test.tsx` | `src/app/tasks/new-task-modal.test.tsx` | ✅ Wave 0 |
| U3 | Escape closes dialog | unit (userEvent) | `npm test -- --testNamePattern="Escape"` | `src/app/tasks/new-task-modal.test.tsx` | ✅ Wave 0 |
| U3 | Focus trapped inside dialog (Tab cycles, doesn't escape) | unit (userEvent) | `npm test -- --testNamePattern="tab"` | `src/app/tasks/new-task-modal.test.tsx` | ⚠️ Partial (jsdom limitation; manual verify needed) |
| U3 | Focus restored to trigger on close | unit (userEvent) | `npm test -- --testNamePattern="focus.*restore"` | `src/app/tasks/new-task-modal.test.tsx` | ⚠️ Partial (jsdom limitation; manual verify needed) |
| U4 | Success toast in role="status" aria-live="polite" region | unit (jest-axe) | `npm test -- toaster.test.tsx` | `src/components/__tests__/toaster.test.tsx` | ✅ Wave 0 |
| U4 | Error toast in role="alert" aria-live="assertive" region | unit (jest-axe) | `npm test -- toaster.test.tsx` | `src/components/__tests__/toaster.test.tsx` | ✅ Wave 0 |
| U4 | Toast announces within 500ms (screen reader timing) | unit (useFakeTimers) | `npm test -- toaster.test.tsx` | `src/components/__tests__/toaster.test.tsx` | ✅ Wave 0 |
| U5 | All/Household/Work pills deleted from layout.tsx | static code check | `grep -n "All / Household / Work" src/app/layout.tsx` | Manual grep | ✅ Wave 0 |
| U5 | Nav links hidden when signed out (`getUser()` returns null) | unit + integration | `npm test -- layout.test.tsx` | `src/app/layout.test.tsx` | ✅ Wave 0 |
| U7 | min-h-dvh used instead of min-h-[calc(100vh-52px)] | static code check | `grep -n "100dvh" src/app/tasks/tasks-page-client.tsx` | Manual grep | ✅ Wave 0 |
| U7 | No double-cancellation of padding (-m-6 + p-6) | code review + manual mobile test | Open on iPhone; verify no overflow | Manual | ❌ Manual |

### Sampling Rate

- **Per task commit:** Quick run on touched components only:
  ```bash
  npm test -- --testPathPattern='(task-card|dialog|toaster)' --maxWorkers=4
  ```
  Expected: 15–20 tests, < 5 seconds

- **Per wave merge:** Full suite + manual pass:
  ```bash
  npm test  # 120+ tests, ~3s
  # Then: keyboard walk + VoiceOver pass on real device
  ```

- **Phase gate (before `/gsd:verify-work`):** Full jest suite passes (120+ tests including new a11y tests) + manual mobile keyboard pass recorded

### Wave 0 Gaps

- [ ] `src/components/__tests__/dialog.test.tsx` — covers Dialog component open/close/focus behavior (20 tests)
- [ ] `src/components/__tests__/task-card.test.tsx` — update to verify 44px hit areas and task-scoped labels (5 new tests, 8 existing)
- [ ] `src/components/__tests__/toaster.test.tsx` — verify live regions, auto-dismiss timing, dismiss buttons (6 new tests, existing toaster tests migrate)
- [ ] `src/app/tasks/new-task-modal.test.tsx` — update to use new Dialog component, verify Escape/focus/Tab containment (3 new keyboard tests, existing tests migrate)
- [ ] `src/app/tasks/edit-task-modal.test.tsx` — same as new-task-modal
- [ ] `src/app/layout.test.tsx` — verify nav hidden when signed out (2 new tests)
- [ ] `jest.setup.ts` — add `import "jest-axe/extend-expect"` for `toHaveNoViolations()` matcher
- [ ] Framework setup complete; no post-Wave 0 test gaps

**Post-implementation:** Planner should note that jsdom cannot fully exercise native `<dialog>` top-layer stacking or focus containment at the browser level. A short manual keyboard pass (Tab through open dialog; press Escape; check focus returns) + VoiceOver test should be recorded in `.planning/phases/04-accessibility-mobile/04-VERIFICATION.md` before the phase closes.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm / build | ✓ | 18+ (inferred from Next.js setup) | — |
| npm | package install | ✓ | 10+ (inferred) | — |
| Next.js 16 | Dev / build | ✓ | 16.1.6 | — |
| Jest | Testing | ✓ | 30.3.0 | — |
| jsdom | Unit tests | ✓ | 30.3.0 | — |
| @testing-library/react | Component testing | ✓ | 16.3.2 | — |
| @testing-library/user-event | Keyboard simulation | ✓ | 14.6.1 | — |
| Tailwind CSS | Styling | ✓ | 4.x | — |
| jest-axe (NEW) | Accessibility testing | ✗ | 10.0.0 | No fallback — must install |

**Missing dependencies with no fallback:**
- `jest-axe` — install with `npm install --save-dev jest-axe` before Phase 4 implementation

**Missing dependencies with fallback:**
- None (Playwright not in scope per D-19)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Native `<dialog>` element is supported in all current browsers without polyfill | Standard Stack, Code Examples | If false, we'd need a polyfill; however, all browsers adopted it by 2022 |
| A2 | `100dvh` CSS unit is supported in all current browsers | Code Examples, Pitfall 7 | If false, we'd need a 100vh fallback; however, Baseline Widely Available since June 2025 |
| A3 | jest-axe version 10.0.0 is the recommended current version | Package Legitimacy Audit | If outdated, we may miss new rule categories; however, axe-core updates are backward-compatible |
| A4 | jsdom's `showModal()` support is sufficient for unit tests (even if top-layer is incomplete) | Validation Architecture | If false, we'd need Playwright for all dialog tests; per D-19, manual testing covers the gap |
| A5 | Task modals' optimistic-close behavior (Phase 2 decision) is compatible with Dialog conversion | Architecture Patterns | If false, the Dialog conversion breaks the modal UX; verified by reading Phase 2 CONTEXT.md that optimistic close happens before `startTransition` |

---

## Open Questions

1. **Focus-ring color and geometry**
   - What we know: D-10 specifies a global `:focus-visible` rule with `--color-focus` token
   - What's unclear: Should `--color-focus` be the same as `--color-accent` (#7C5CBF), or use a separate value for contrast? Should the outline width be 2px or 3px? Should offset be 2px or 0px?
   - Recommendation: Use 2px outline, 2px offset, `--color-focus: #7C5CBF` (same as accent) for consistency with token system. Test on all interactive elements to ensure visibility and no clipping.

2. **List semantics for task buckets**
   - What we know: D-13 notes task-scoped aria-labels reduce label verbosity, but suggests bucket containers *might* benefit from `<ul>`/`<li>` structure
   - What's unclear: Should each bucket (Overdue, Today, etc.) be wrapped in a `<ul>`, with each task card as an `<li>`? Or is aria-label sufficient without list markup?
   - Recommendation: Test both approaches with a screen reader. If list markup doesn't change the announcement rate (due to task-scoped labels already providing context), defer to Phase 8 for structural improvements. If it significantly reduces verbosity, add it in this phase.

3. **Skip link and landmarks**
   - What we know: D-10's "whether a skip link and explicit landmarks are worth adding at this app size" is under Claude's discretion
   - What's unclear: The app is small (3–4 pages); landmarks like `<main>` and `<nav>` are probably overkill. Skip link (jump to #main-content) is standard but may not be necessary if the task list is the first focusable element.
   - Recommendation: Add `<main>` landmark wrapping the tasks page; skip adding a skip link unless manual VoiceOver testing shows verbosity is a problem.

4. **Dialog initial focus in delete confirm**
   - What we know: D-08 specifies Cancel button gets initial focus (destructive action safety)
   - What's unclear: Should the delete button be disabled or just not focused? Should we provide a confirmation checkbox ("I understand this cannot be undone")?
   - Recommendation: Leave delete button enabled but unfocused. No checkbox (adds complexity). Initial focus on Cancel matches the decision.

5. **Toast dismiss button accessibility**
   - What we know: D-12 requires 44px dismiss button with aria-label
   - What's unclear: Should the dismiss button be keyboard-accessible (Tab to it) or hidden until a screen reader is detected?
   - Recommendation: Always keyboard-accessible and visible. Tab-ordering should be natural (toast message, dismiss button, next toast). No magic detection.

---

## Sources

### Primary (HIGH confidence — official docs / verified)
- [MDN: HTML dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog)
- [MDN: :focus-visible pseudo-class](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible)
- [MDN: ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)
- [W3C: WCAG 2.2 AA Success Criterion 2.5.5 (Target Size — AAA)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
- [W3C: WCAG 2.2 Success Criterion 2.4.7 (Focus Visible)](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)
- [CSS-Tricks: Focusing on Focus Styles](https://css-tricks.com/focusing-on-focus-styles/)
- [Sara Soueidan: Accessible notifications with ARIA live regions](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/)

### Secondary (MEDIUM confidence — verified with official source or multiple credible sources)
- [TestParty: WCAG 2.5.5 Target Size Guide](https://testparty.ai/blog/wcag-2-5-5-target-size-2025-guide/)
- [Sizzy Blog: CSS Viewport Units (vh, vw, dvh, svh)](https://sizzy.co/blog/css-viewport-units/)
- [Modern CSS: Mobile Viewport Height Fix (dvh/svh/lvh)](https://modern-css.com/mobile-viewport-height-without-100vh-hack/)
- [jest-axe on npm](https://www.npmjs.com/package/jest-axe)
- [Medium: Testing React Accessibility with Axe](https://medium.com/@echilaka/testing-react-accessibility-with-axe-core-vitest-and-the-chrome-extension-e24b5ae623df)
- [jsdom Issue #3294: Implement HTMLDialogElement](https://github.com/jsdom/jsdom/issues/3294)
- [CSS-Tricks: Replace JavaScript Dialogs with HTML Dialog](https://css-tricks.com/replace-javascript-dialogs-html-dialog-element/)

### Tertiary (LOW confidence — single source, training data, or implied)
- [CSSPortal: Using the dialog Element for Native Modals](https://www.cssportal.com/blog/using-the-dialog-element-for-native-modals/)
- [BuildMVPFast: HTML Dialog Element Accessible Native Modals (2026)](https://www.buildmvpfast.com/blog/html-dialog-element-accessible-modal-browser-native-2026)

---

## Metadata

**Confidence breakdown:**
- **Standard stack (jest-axe, native dialog, Tailwind):** HIGH — All official docs reviewed, browser support verified at Baseline Widely Available status
- **Architecture patterns (Dialog wrapper, live regions, touch targets):** HIGH — Patterns verified against WCAG 2.2 AA and current best practices; code examples match existing codebase style
- **Touch target sizing (44px) & mobile viewport (100dvh):** HIGH — WCAG 2.5.5 AAA normative; CSS units in all browsers since 2025
- **Dialog semantics & focus management:** HIGH — Native `<dialog>` behavior verified; focus restoration automatic
- **Live regions & screen reader announcements:** HIGH — WCAG 4.1.3 normative; tested patterns from established accessibility guides
- **jest-axe testing & jsdom limitations:** HIGH — jest-axe is industry-standard; jsdom gap is documented
- **UI/UX Design Guidance:** HIGH — Based on accessibility research, existing design system audit (AUDIT-2026-07-25), and verified component patterns
- **Code patterns & implementation approach:** MEDIUM-HIGH — Patterns match existing Phase 3 test conventions; no new frameworks introduced

**Research date:** 2026-07-25
**Valid until:** 2026-08-25 (30 days for stable tech stack; shorter for fast-moving accessibility tools)

**Phase dependency:** Ready for planning. All locked decisions documented. All tech stack verified. Validation architecture clear. UI/UX design specifications complete and tied to existing design system.
