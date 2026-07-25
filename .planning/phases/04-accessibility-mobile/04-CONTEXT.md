# Phase 4: Accessibility & Mobile - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the surfaces that already exist — the task list, both task modals, the toaster, and the root
nav — usable on a phone, with a keyboard, and with a screen reader. This is audit items U1–U5 and U7
from `.planning/AUDIT-2026-07-25.md`: touch targets, focus indicators, dialog semantics, live
regions, dead navigation, and the mobile viewport unit.

No new product capability. No visual redesign. Dark mode, semantic color tokens, the `lucide-react`
icon migration, reduced-motion, and skeletons are Phase 8 (audit U6, U8–U12) and stay out of this
phase even though they touch the same files.

</domain>

<decisions>
## Implementation Decisions

### Touch targets and card layout

- **D-01:** Icon buttons in `task-card.tsx` get padded in place to a 44×44 hit area — the SVG stays
  14–18px, the button wraps it with padding and negative margins so visual density barely shifts.
  No overflow menu, no swipe actions.
- **D-02:** Subtask toggles get the same 44px treatment as the parent's controls. WCAG 2.5.5 makes
  no exception for nested controls, and a subtask toggle is a primary action.
- **D-03:** Card row keeps its current priority on narrow screens: the title truncates with an
  ellipsis, action buttons never shrink. Predictable tap positions across every card matters more
  than seeing the full title.
- **D-04:** `window.confirm` for delete is replaced by an in-app confirm dialog built on the same
  primitive as the modals (see D-05). `window.confirm` blocks the main thread, cannot be styled,
  and is suppressible in some mobile browsers.

### Dialog primitive

- **D-05:** One in-repo `<Dialog>` component wrapping the native `<dialog>` element and
  `showModal()`. The browser supplies the focus trap, Escape-to-close, inert background, and
  top-layer placement. **No new dependency** — Radix was considered and rejected; the codebase has
  no UI library and pulling one in for a single primitive is not warranted.
- **D-06:** Three callers: `new-task-modal.tsx`, `edit-task-modal.tsx`, and the new delete confirm.
  One implementation, one set of a11y tests. Do not convert the modals and leave `window.confirm`
  behind — that contradicts D-04.
- **D-07:** Initial focus in the task modals lands on the title input. Users open these to type.
- **D-08:** Initial focus in the delete confirm lands on **Cancel**. A destructive, undoable-only-by-
  recreating action must never be one Enter keypress away.
- **D-09:** Focus is restored to the trigger element on close (native `<dialog>` does this when the
  dialog is closed properly — verify it in the test rather than assuming).

### Focus indicators and live regions

- **D-10:** One global `:focus-visible` rule in `src/app/globals.css` covering
  `button, a, input, select, textarea, [tabindex]`, driven by a new `--color-focus` token. Not
  per-component Tailwind classes — forgetting one is exactly how the current gap appeared. Opt out
  locally only where the ring clips.
- **D-11:** Two live regions in `toaster.tsx`: `role="status"` / `aria-live="polite"` for success and
  warning, `aria-live="assertive"` for errors. Politeness is fixed per region, so one container
  cannot serve both, and a failed mutation is something the user must hear now.
- **D-12:** Each toast gets a 44px dismiss button. **Error toasts do not auto-dismiss**; success and
  warning keep the 3500ms timer. WCAG 2.2.1 puts 3500ms below the threshold for content the user
  must read, and errors are the ones worth re-reading.
- **D-13:** Icon-button `aria-label`s become task-scoped — `Mark complete` → `Mark "Buy milk"
  complete`, same for edit, delete, and subtask toggles. With many cards on screen, identical labels
  give a screen-reader user no way to tell which task a button belongs to.

### Navigation cleanup

- **D-14:** Delete the All / Household / Work pills at `layout.tsx:44-54`. They are handler-less
  `<button>`s that duplicate the real filters already owned by the tasks page (`tab-pill.tsx`). A
  control that looks interactive and does nothing is worse than no control, and it pollutes the tab
  order.
- **D-15:** Hide the nav links (and any remaining chrome) when signed out. `layout.tsx` already
  awaits `getUser()`, so this is a conditional on `user`. **Not** a route-group restructure — that is
  larger than this phase needs.
- **D-16:** The missing `/tasks` signed-out redirect (open item in STATE.md) stays **out** of this
  phase. It is auth routing, not accessibility.

### Verification

- **D-17:** Standard is **WCAG 2.2 AA**, with 2.5.5 AAA's 44px minimum adopted for touch targets
  (per D-01/D-02). State this bar explicitly so the phase verification is checkable.
- **D-18:** `jest-axe` added to the existing Jest/RTL suite (134 tests today). Assert zero axe
  violations per touched component, plus `@testing-library/user-event` tests for Escape-closes,
  focus restore, and tab containment. Runs in CI, no browser needed.
- **D-19:** No Playwright. It is not set up in this repo, and standing up browser infrastructure is
  not part of this phase. **Known limit:** jsdom cannot fully exercise native `<dialog>` top-layer
  behavior or a real mobile viewport — the planner should note what jest-axe cannot cover and cover
  those points with a short manual keyboard + VoiceOver pass recorded in phase verification.

### Claude's Discretion

- **U7 viewport fix** was not discussed and is mechanical: `min-h-[calc(100vh-52px)]` at
  `tasks-page-client.tsx:141` → `100dvh`, and the `-m-6` there cancelling `layout.tsx`'s `main p-6`.
  Planner decides whether to drop the layout padding or the negative margin; the page should not be
  undoing padding the layout adds.
- Exact focus-ring geometry (width, offset, color value for `--color-focus`).
- Whether bucket containers get list semantics (`<ul>`/`<li>`) alongside the task-scoped labels —
  likely yes, and it reduces how verbose D-13's labels need to be.
- Whether a skip link and explicit landmarks are worth adding at this app size.
- jsdom setup for native `<dialog>` (jsdom's `showModal` support is incomplete; a small polyfill in
  `jest.setup.ts` will likely be needed — confirm during research).

### Manual task for the user (no code)

- **Enable leaked-password protection** in the Supabase Auth dashboard settings. Carried here from
  STATE.md. One toggle, unrelated to the code in this phase, but it is parked under Phase 04 and
  should be done before the phase closes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase source of truth
- `.planning/AUDIT-2026-07-25.md` — the U1–U5, U7 findings this phase closes (lines 155–161); also
  U6, U8–U12 which are explicitly Phase 8 and must not be pulled forward
- `.planning/ROADMAP.md` § "Phase 4: Accessibility & Mobile" — goal and four success criteria
- `.planning/STATE.md` — accumulated decisions, open concerns, and the leaked-password item
- `tasks/todo.md` § "Phase 04 — Accessibility & mobile" — the deferred list written during Phase 3

### Product and conventions
- `docs/product.md` — product requirements; task visibility rules constrain what a label may reveal
- `.planning/codebase/CONVENTIONS.md` — naming, import order, Tailwind/CSS-variable style. Arbitrary
  values with `var(--color-*)` are the house style; raw palette classes are not.
- `.planning/codebase/TESTING.md` — existing test conventions the new a11y tests must match

### Files this phase changes
- `src/components/task-card.tsx` — icon buttons (U1), aria-labels (D-13), delete confirm call site
- `src/components/toaster.tsx` — live regions (U4), dismiss button, error persistence
- `src/app/layout.tsx:44-54` — dead pills (U5); `getUser()` already available for D-15
- `src/app/tasks/new-task-modal.tsx`, `src/app/tasks/edit-task-modal.tsx` — dialog conversion (U3)
- `src/app/tasks/tasks-page-client.tsx:141` — `100dvh` and the `-m-6` (U7)
- `src/app/globals.css` — `--color-focus` token and the global `:focus-visible` rule (U2)
- `src/app/tasks/tab-pill.tsx` — the real filter control; focus styling must reach it

### Test patterns to follow
- `src/app/tasks/new-task-modal.test.tsx`, `src/app/tasks/edit-task-modal.test.tsx`
- `src/app/tasks/tasks-page-client.test.tsx`
- `src/components/__tests__/` — component test conventions
- `jest.setup.ts` — where a `<dialog>` polyfill and `jest-axe` matchers would be registered

### Prior context
- `.planning/phases/02-task-creation/02-CONTEXT.md` — optimistic close behavior in the modals, which
  the dialog conversion must not break
- `tasks/lessons.md` — project gotchas

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/toaster.tsx` — `toast(msg, "success" | "warning" | "error")` dispatches a
  `CustomEvent`; the type is already carried through, so splitting polite/assertive regions is a
  render-side change, not an API change
- `src/app/tasks/tab-pill.tsx` — the working filter control the dead nav pills duplicate
- `src/app/globals.css` — existing `--color-*` token block is where `--color-focus` belongs
- `src/app/tasks/action-result.ts` — the `{ ok, error }` result shape the confirm dialog's delete
  path must keep honoring

### Established Patterns
- Client components marked `"use client"`; server components fetch and pass down
- `useTransition` for pending state; `task-card.tsx` already wraps mutations in `runAction` and
  toasts on `!result.ok` — the confirm dialog slots in front of that call, not around it
- Tailwind arbitrary values over `var(--color-*)`; raw palette classes are a known smell (U10) and
  should not spread further, but fixing existing ones is Phase 8
- Jest + RTL + `@testing-library/user-event` already installed and configured

### Integration Points
- `<Dialog>` is a new component — `src/components/dialog.tsx` fits the existing flat `components/`
  layout (no subdirectories in use)
- Both task modals currently render their own fixed-position overlay; converting them to `<Dialog>`
  must preserve the optimistic-close behavior locked in Phase 2 (modal closes before the server
  resolves in the create path; the edit path waits for the result)
- Delete currently calls `window.confirm` inline in `task-card.tsx:117` — the confirm dialog needs
  local open state on the card, or a single dialog hoisted to the list with the target task in state
- `layout.tsx` `main` has `p-6`; `tasks-page-client.tsx` cancels it with `-m-6` — changing one
  affects every other page (`/workspaces`, `/profile`, `/login`). Grep before touching.

### Known Constraints
- 134 tests pass today; `npx tsc --noEmit` is clean; `npm run lint` reports 1 pre-existing error
  (`react-hooks/set-state-in-effect` at `login-card.tsx:26`) which **belongs to this phase** per
  `tasks/todo.md`, plus 3 unused-variable warnings that do not
- No Playwright, no Docker/local Supabase. Verification is unit-level plus a manual pass.

</code_context>

<specifics>
## Specific Ideas

- The 44px hit area should not visually inflate the card — padding plus negative margin, so the card
  looks close to what it looks like now
- Error toasts staying on screen is deliberate: the user should be able to re-read what failed
- Task-scoped labels read as `Mark "Buy milk" complete` / `Edit "Buy milk"` / `Delete "Buy milk"`

</specifics>

<deferred>
## Deferred Ideas

- **Overflow menu / swipe actions on task cards** — rejected in favor of padding in place. Revisit
  only if the card row gets crowded by future actions.
- **Undo-toast delete** (delete immediately, offer Undo) — needs soft-delete or restore support in
  the server action. Data-layer change; not this phase.
- **`/tasks` signed-out redirect / middleware** (D-16) — auth routing, its own slice.
- **Route group `(auth)` with a bare layout for `/login`** — cleaner long-term separation than the
  conditional in D-15, but a restructure. Note for whenever auth surfaces grow.
- **Dark mode, semantic tokens for deadline/toast surfaces, `lucide-react` migration,
  `prefers-reduced-motion`, loading skeletons** — audit U6, U8–U12, all Phase 8.
- **Playwright infrastructure** — would let us test native `<dialog>` top-layer and real mobile
  viewports. Worth standing up eventually; out of scope here (D-19).

</deferred>

---

*Phase: 04-accessibility-mobile*
*Context gathered: 2026-07-25*
</content>
