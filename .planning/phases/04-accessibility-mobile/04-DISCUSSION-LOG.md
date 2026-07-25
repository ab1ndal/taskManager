# Phase 4: Accessibility & Mobile - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-25
**Phase:** 04-accessibility-mobile
**Areas discussed:** Touch targets & card layout, Dialog implementation, Focus & live-region style, Nav cleanup & verification

---

## Touch targets & card layout

### How should the task card's action controls reach 44px on mobile?

| Option | Description | Selected |
|--------|-------------|----------|
| Pad in place | Wrap each SVG in a 44×44 button with negative margins; visual density barely changes | ✓ |
| Overflow menu on mobile | Edit + delete move into a ⋮ menu; removes delete/edit adjacency but needs a new accessible menu component | |
| Swipe actions | Swipe-left reveals edit/delete; native-feeling but no keyboard equivalent, largest build | |

**User's choice:** Pad in place
**Notes:** Matches the audit's own recommended fix; no layout rethink.

### Delete is destructive and will sit within thumb reach. What guard?

| Option | Description | Selected |
|--------|-------------|----------|
| Accessible confirm dialog | Replace `window.confirm` with the same dialog primitive built for the modals | ✓ |
| Keep window.confirm | Native and accessible, zero build, but unstyleable and suppressible on mobile | |
| Undo toast instead | Delete immediately with an Undo toast; needs soft-delete support in the data layer | |

**User's choice:** Accessible confirm dialog
**Notes:** Reuses one focus-trap implementation across all three dialogs.

### Card row priority on a narrow phone

| Option | Description | Selected |
|--------|-------------|----------|
| Title truncates, actions fixed | Current behavior; predictable tap positions across all cards | ✓ |
| Title wraps to two lines | Full title visible, variable card height, less predictable targeting | |
| You decide | Planner picks once 44px targets are in | |

**User's choice:** Title truncates, actions fixed

### Subtask checkboxes — same treatment?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — 44px too | WCAG 2.5.5 makes no exception for nested controls | ✓ |
| Minimum 24px only | WCAG 2.2 AA (2.5.8) weaker bar; keeps subtask lists compact | |
| You decide | Planner picks per the phase's WCAG level | |

**User's choice:** Yes — 44px too

---

## Dialog implementation

### How should the dialog primitive be built?

| Option | Description | Selected |
|--------|-------------|----------|
| Native `<dialog>` wrapper | ~60-line in-repo component over `showModal()`; browser supplies trap, Escape, inert, top-layer. Zero new deps | ✓ |
| Hand-rolled div + focus trap | Full control over existing overlay markup, but reinvents a focus trap | |
| Add Radix UI Dialog | Battle-tested, but a new dependency and styling layer on a codebase with no UI library | |

**User's choice:** Native `<dialog>` wrapper
**Notes:** No UI library installed today (deps are zod, supabase, @hello-pangea/dnd only).

### How far does the refactor go?

| Option | Description | Selected |
|--------|-------------|----------|
| Shared primitive, 3 callers | new-task-modal, edit-task-modal, and the new delete confirm | ✓ |
| Modals only, confirm later | Smaller diff, but contradicts the delete-confirm decision already made | |

**User's choice:** Shared primitive, 3 callers

### Initial focus when a task modal opens

| Option | Description | Selected |
|--------|-------------|----------|
| First input (title field) | Matches intent for create/edit forms | ✓ |
| Dialog container | SR announces title/description first; one extra tab for everyone else | |
| You decide | Planner picks | |

**User's choice:** First input (title field)

### Initial focus in the delete confirm

| Option | Description | Selected |
|--------|-------------|----------|
| Cancel | Destructive action should never be one Enter keypress away | ✓ |
| Delete button | Fastest for the common case, but a stray Enter deletes with no undo | |

**User's choice:** Cancel

---

## Focus & live-region style

### How should the visible focus indicator be applied?

| Option | Description | Selected |
|--------|-------------|----------|
| Global `:focus-visible` in globals.css | One rule + a `--color-focus` token; nothing can be missed, future components inherit it | ✓ |
| Tailwind `focus-visible:` per control | Explicit in the JSX, but easy to forget — how the gap appeared | |
| Both — global base + local overrides | Most control, largest diff | |

**User's choice:** Global `:focus-visible` in globals.css

### Toast politeness

| Option | Description | Selected |
|--------|-------------|----------|
| `role=status` + `aria-live=assertive` for errors | Two containers, since politeness is fixed per region; errors interrupt | ✓ |
| Single polite region for everything | Simplest fix, satisfies U4, but errors queue behind current speech | |
| You decide | Planner picks based on two-container cost | |

**User's choice:** `role=status` polite + assertive for errors

### Toast auto-dismiss at 3500ms

| Option | Description | Selected |
|--------|-------------|----------|
| Add dismiss button; errors persist | 3500ms is below the WCAG 2.2.1 threshold for content the user must read | ✓ |
| Keep auto-dismiss, add dismiss button | Smaller change, still fails 2.2.1 strictly | |
| Leave timing alone | Only add the live region; defer timing to Phase 8 | |

**User's choice:** Add dismiss button; errors persist

### Screen-reader labels

| Option | Description | Selected |
|--------|-------------|----------|
| Task-scoped labels | `Mark "Buy milk" complete` — identical labels across cards give SR users no context | ✓ |
| Keep generic labels | Rely on card structure, which does not yet have list/heading markup | |
| You decide | Planner picks | |

**User's choice:** Task-scoped labels

---

## Nav cleanup & verification

### Dead All/Household/Work pills in layout.tsx:44-54

| Option | Description | Selected |
|--------|-------------|----------|
| Delete them | Real filtering already lives on /tasks; a fake control is worse than none | ✓ |
| Wire to the real filter | Lift filter state to the layout; duplicates a control the tasks page owns | |
| Keep, mark decorative | `aria-hidden` fixes the SR problem but leaves a visual lie | |

**User's choice:** Delete them

### Nav rendering for signed-out visitors on /login

| Option | Description | Selected |
|--------|-------------|----------|
| Conditional nav on `user` | Layout already awaits `getUser()`; one-line change | ✓ |
| Route group with its own layout | Cleaner long-term, larger restructure than this phase needs | |
| Add middleware redirect too | Real gap, but auth routing rather than accessibility | |

**User's choice:** Conditional nav on `user`
**Notes:** The `/tasks` signed-out redirect stays out of Phase 4 (see Deferred).

### How do we prove the a11y work landed?

| Option | Description | Selected |
|--------|-------------|----------|
| jest-axe + RTL keyboard tests | Fits the existing 134-test Jest/RTL suite; runs in CI, no browser | ✓ |
| Playwright keyboard walkthrough | Only way to truly test `<dialog>` top-layer and mobile viewport; not set up in this repo | |
| Both | Strongest coverage, most setup | |
| Manual checklist | No new deps, nothing stops regression | |

**User's choice:** jest-axe + RTL keyboard tests
**Notes:** jsdom cannot cover native `<dialog>` top-layer or a real mobile viewport — CONTEXT.md
records a short manual keyboard + VoiceOver pass to close that gap.

### WCAG bar for this phase

| Option | Description | Selected |
|--------|-------------|----------|
| WCAG 2.2 AA, 44px targets | AA compliance plus 2.5.5 AAA's 44px, consistent with the card decision | ✓ |
| WCAG 2.2 AA strictly | 24px minimum per 2.5.8; contradicts the 44px card decision | |
| You decide | Planner infers the bar | |

**User's choice:** WCAG 2.2 AA, 44px targets

---

## Claude's Discretion

- U7 viewport fix (`100vh` → `100dvh`, and the `-m-6` / `p-6` cancellation) — not discussed,
  mechanical, planner decides which side to change
- Focus-ring geometry and the `--color-focus` value
- Whether bucket containers get list semantics alongside task-scoped labels
- Whether a skip link and explicit landmarks are worth adding at this app size
- jsdom `<dialog>` polyfill approach in `jest.setup.ts`

## Deferred Ideas

- Overflow menu / swipe actions on task cards — rejected in favor of padding in place
- Undo-toast delete — needs soft-delete support in the data layer
- `/tasks` signed-out redirect / middleware — auth routing, its own slice
- `(auth)` route group with a bare layout for `/login`
- Dark mode, semantic deadline/toast tokens, `lucide-react` migration, `prefers-reduced-motion`,
  skeletons — audit U6, U8–U12, all Phase 8
- Playwright infrastructure

## Side item recorded, not discussed

- Enable leaked-password protection in the Supabase Auth dashboard — a manual toggle carried over
  from STATE.md, parked under Phase 04. User chose to keep it noted here rather than defer it.
</content>
