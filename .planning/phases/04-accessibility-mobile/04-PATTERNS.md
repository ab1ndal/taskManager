# Phase 4: Accessibility & Mobile - Pattern Map

**Mapped:** 2026-07-25
**Files analyzed:** 11 (new + modified)
**Analogs found:** 9 / 11

---

## File Classification

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `src/components/dialog.tsx` (NEW) | component | request-response | `src/app/tasks/new-task-modal.tsx` | exact |
| `src/components/task-card.tsx` | component | CRUD | `src/components/task-card.tsx` (itself) | self-reference |
| `src/components/toaster.tsx` | component | event-driven | `src/components/toaster.tsx` (itself) | self-reference |
| `src/app/globals.css` | config/styling | styling | `src/app/globals.css` (itself) | self-reference |
| `src/app/layout.tsx` | layout | request-response | `src/app/layout.tsx` (itself) | self-reference |
| `src/app/tasks/new-task-modal.tsx` | component | request-response | `src/app/tasks/new-task-modal.tsx` (itself) | self-reference |
| `src/app/tasks/edit-task-modal.tsx` | component | request-response | `src/app/tasks/new-task-modal.tsx` | exact |
| `src/app/tasks/tasks-page-client.tsx` | component | request-response | `src/app/tasks/tasks-page-client.tsx` (itself) | self-reference |
| `jest.setup.ts` | config | configuration | `jest.setup.ts` (itself) | self-reference |
| Delete confirm dialog (inline or separate) | component | request-response | `src/app/tasks/new-task-modal.tsx` | exact |
| Accessibility test files | test | testing | `src/app/tasks/new-task-modal.test.tsx` | exact |

---

## Pattern Assignments

### `src/components/dialog.tsx` (NEW component, request-response)

**Analog:** `src/app/tasks/new-task-modal.tsx` (lines 1–30 modal structure, lines 182–189 overlay pattern)

**Import pattern** (from new-task-modal.tsx, lines 1–6):
```typescript
"use client";

import { useState, useTransition, useRef } from "react";
```

**Modal overlay structure pattern** (new-task-modal.tsx, lines 182–189):
```typescript
return (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    onClick={onClose}
  >
    <div
      className="bg-[var(--color-surface)] rounded-[14px] border border-[var(--color-border)] p-6 w-full max-w-md mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
```

**What to replace:** Native `<dialog>` element will replace the fixed overlay div pattern above. Use `showModal()` for focus trap, Escape handling, inert background, top-layer, and focus restoration (all browser-native). Reference: RESEARCH.md § "Pattern 1: Native Dialog Wrapper Component" (lines 213–288).

---

### `src/components/task-card.tsx` (component, CRUD)

**Current state:** File exists at `src/components/task-card.tsx` (lines 1–163).

**Analogs for reference:**

1. **Button structure with aria-label** (task-card.tsx, lines 69–89, complete button):
```typescript
<button
  onClick={() => {
    if (!completed) runAction(() => completeTask(taskId), "Failed to complete task");
  }}
  aria-label={completed ? "Completed" : "Mark complete"}
  disabled={completed}
  className="flex-shrink-0 text-[var(--color-border)] hover:text-[var(--color-accent)] disabled:cursor-default transition-colors"
>
  {completed ? (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* checkmark SVG */}
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* empty circle SVG */}
    </svg>
  )}
</button>
```

2. **Error handling pattern** (task-card.tsx, lines 55–60, runAction):
```typescript
function runAction(action: () => Promise<{ ok: boolean; error?: string }>, fallback: string) {
  startTransition(async () => {
    const result = await action();
    if (!result.ok) toast(result.error ?? fallback, "error");
  });
}
```

3. **Delete call site** (task-card.tsx, lines 114–127):
```typescript
{!completed && (
  <button
    onClick={() => {
      if (!window.confirm(`Delete "${title}"?`)) return;
      runAction(() => deleteTask(taskId), "Failed to delete task");
    }}
    aria-label="Delete task"
    className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
  >
    {/* delete SVG */}
  </button>
)}
```

**Changes in Phase 4:**
- Wrap all buttons (complete, edit, delete, subtask toggles) with `w-11 h-11 flex items-center justify-center` (44×44px hit area)
- Task-scoped aria-labels: `aria-label={`Mark "${title}" complete`}` (see RESEARCH.md § "Pattern 4: Task-Scoped Aria-Labels", lines 462–486)
- Replace `window.confirm` delete with in-app Dialog component (import at top, open delete confirm dialog on button click)

---

### `src/components/toaster.tsx` (component, event-driven)

**Current state:** File exists at `src/components/toaster.tsx` (lines 1–52).

**Event dispatch pattern** (lines 12–17):
```typescript
export function toast(message: string, type: "success" | "warning" | "error" = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("app:toast", { detail: { message, type } })
  );
}
```

**Event listener setup** (lines 22–34):
```typescript
useEffect(() => {
  function handler(e: Event) {
    const { message, type } = (e as CustomEvent<{ message: string; type: Toast["type"] }>).detail;
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      3500
    );
  }
  window.addEventListener("app:toast", handler);
  return () => window.removeEventListener("app:toast", handler);
}, []);
```

**Changes in Phase 4:**
- Split toast array into `politeToasts` and `assertiveToasts` (see RESEARCH.md § "Pattern 3: Split Live Regions for Toasts", lines 332–450)
- Render two live regions: `role="status" aria-live="polite"` for success/warning, `role="alert" aria-live="assertive"` for errors
- Add 44×44px dismiss button per toast with `aria-label={`Close ${type} message`}`
- Error toasts: NO auto-dismiss (user must click dismiss); success/warning: keep 3500ms timer
- Regions must be mounted at page load (empty initially, not created on first toast)

**Test pattern reference** (from new-task-modal.test.tsx, lines 7, 15):
```typescript
jest.mock("@/components/toaster", () => ({ toast: jest.fn() }));
```

---

### `src/app/globals.css` (config, styling)

**Current state:** File exists at `src/app/globals.css` (lines 1–32).

**Color token pattern** (lines 8–22, @theme block):
```css
@theme {
  /* Colors */
  --color-bg: #FAF9F7;
  --color-surface: #FFFFFF;
  --color-border: #E8E4F0;
  --color-text-primary: #1C1A24;
  --color-text-secondary: #6B6878;
  --color-text-muted: #A09CB0;
  --color-accent: #7C5CBF;
  --color-accent-hover: #6A4DAD;
  --color-accent-subtle: #EDE8F8;
  --color-accent-text: #5B3FA8;
  --color-deadline-red: #E05252;
  --color-deadline-yellow: #D4A017;
  --color-deadline-green: #4A9B6F;
  /* ... */
}
```

**Changes in Phase 4:**
- Add `--color-focus: #7C5CBF;` to @theme block (same as accent purple)
- Add global `:focus-visible` rule below @theme (see RESEARCH.md § "Pattern 2: Global Focus Indicator", lines 291–329):
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

**Keyframe reference** (lines 3–6, already exists; preserve):
```css
@keyframes modal-in {
  from { opacity: 0; transform: scale(0.97); }
  to   { opacity: 1; transform: scale(1); }
}
```

---

### `src/app/layout.tsx` (layout, request-response)

**Current state:** File exists at `src/app/layout.tsx` (lines 1–71).

**Server component + getUser pattern** (lines 16–25):
```typescript
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
```

**Navigation structure** (lines 29–63):
```typescript
<nav className="h-[52px] border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-5 gap-4">
  {/* Wordmark */}
  <Link href="/tasks" className="...">
    hearth<span className="text-[var(--color-accent)]">.</span>
  </Link>

  {/* Nav links */}
  <Link href="/tasks" className="...">Tasks</Link>
  <Link href="/workspaces" className="...">Workspaces</Link>

  {/* Workspace tab pills (DEAD BUTTONS — DELETE THESE) */}
  <div className="flex items-center gap-[3px] bg-[var(--color-accent-subtle)] p-[3px] rounded-[9px] text-sm">
    <button className="...">All</button>
    <button className="...">Household</button>
    <button className="...">Work</button>
  </div>

  <div className="ml-auto">
    {user && (
      <NavUser
        name={user.user_metadata?.name ?? ""}
        email={user.email ?? ""}
      />
    )}
  </div>
</nav>
```

**Changes in Phase 4:**
- Delete lines 43–54 (dead workspace filter pills)
- Wrap nav content in `{user && <nav>...</nav>}` conditional to hide nav when signed out (reuse `user` already available from `getUser()`)

---

### `src/app/tasks/new-task-modal.tsx` (component, request-response)

**Current state:** File exists at `src/app/tasks/new-task-modal.tsx` (lines 1–341).

**Modal structure pattern** (lines 181–189):
```typescript
return (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    onClick={onClose}
  >
    <div
      className="bg-[var(--color-surface)] rounded-[14px] border border-[var(--color-border)] p-6 w-full max-w-md mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="text-base font-semibold mb-4">New task</h3>
```

**Form submission pattern** (lines 89–151):
```typescript
function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  const parsed = createTaskWithSubtasksSchema.safeParse({
    // validation
  });
  if (!parsed.success) {
    toast(parsed.error.issues[0].message, "error");
    return;
  }
  const input = parsed.data;
  // ... build optimistic task ...
  
  // Optimistic close: fire callback, close modal, reset form, toast BEFORE server resolves
  onTaskCreated?.(optimisticTask);
  resetForm();
  onClose();
  toast("Task created");

  startTransition(async () => {
    const result = await createTaskWithSubtasks(input);
    if (!result.ok) {
      onTaskError?.(tempId);
      toast(result.error, "error");
      return;
    }
    // ... handle subtask errors ...
  });
}
```

**Input field pattern** (lines 193–201, title input):
```typescript
<input
  type="text"
  placeholder="Task title"
  value={title}
  onChange={(e) => setTitle(e.target.value)}
  disabled={disabled}
  className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
  autoFocus
/>
```

**Changes in Phase 4:**
- Replace fixed overlay div (lines 182–189) with `<Dialog>` component import and wrapper
- Pass `open={open}` and `onClose={onClose}` props to Dialog
- Pass `initialFocusSelector="input[type=text]"` to focus title input on open (D-07)
- Pass `ariaLabelledBy="modal-title"` and add `id="modal-title"` to h3
- Keep optimistic close behavior exactly as-is (tested in phase 2)

**Test pattern reference** (from new-task-modal.test.tsx):
- Lines 45–56: Test helper `renderModal()`
- Lines 313–324: Optimistic close test (MUST PASS after Dialog conversion)

---

### `src/app/tasks/edit-task-modal.tsx` (component, request-response)

**Current state:** File exists at `src/app/tasks/edit-task-modal.tsx` (lines 1–~100).

**Analog:** `src/app/tasks/new-task-modal.tsx` (lines 181–189 overlay, lines 89–151 form submission)

**Same pattern applies:**
- Replace fixed overlay div with `<Dialog>` component
- Pass `open={open}` and `onClose={onClose}` props
- Pass `initialFocusSelector="input[type=text]"` to focus title input on open (D-07)
- Pass `ariaLabelledBy="modal-title"` and add `id="modal-title"` to h3

**Form submission behavior (differs from new-task-modal):**
- edit-task-modal closes modal BEFORE server resolves (line 57: `onClose()` before `startTransition`)
- No optimistic update to task list; server revalidation drives the update
- Success/error toasts fire AFTER result (lines 63–64)

---

### `src/app/tasks/tasks-page-client.tsx` (component, request-response)

**Current state:** File exists at `src/app/tasks/tasks-page-client.tsx` (lines 1–150+).

**Main layout div** (line 146):
```typescript
<div className="flex min-h-[calc(100vh-52px)] -m-6">
```

**Changes in Phase 4 (U7 viewport fix):**
- Change `min-h-[calc(100vh-52px)]` to `min-h-dvh` (dynamic viewport height)
- Rationale: `100vh` includes hidden browser address bar on mobile, causing content overflow; `100dvh` adapts dynamically
- Also decide: remove `-m-6` (negative margin) OR remove `p-6` from layout.tsx. Recommendation: remove `-m-6` for consistent 24px gutters everywhere.

**Modal integration** (lines 126–143):
```typescript
<NewTaskModal
  open={modalOpen}
  onClose={() => setModalOpen(false)}
  workspaces={workspaces}
  currentMemberIds={currentMemberIds}
  onTaskCreated={handleTaskCreated}
  onTaskError={handleTaskError}
/>

{editingTask && (
  <EditTaskModal
    open={!!editingTask}
    task={editingTask}
    workspaces={workspaces}
    currentMemberIds={currentMemberIds}
    onClose={() => setEditingTask(null)}
  />
)}
```

**No changes needed to modal integration** — Dialog conversion happens inside the modals, not here.

**Delete confirm dialog integration** (NEW — insert near line 143, after EditTaskModal):
```typescript
{deleteConfirmTaskId && (
  <DeleteConfirmDialog
    open={!!deleteConfirmTaskId}
    taskTitle={deleteConfirmTaskTitle}
    onConfirm={() => {
      // Call deleteTask action, then close dialog
      runAction(() => deleteTask(deleteConfirmTaskId), "Failed to delete task");
      setDeleteConfirmTaskId(null);
    }}
    onCancel={() => setDeleteConfirmTaskId(null)}
  />
)}
```

---

### `jest.setup.ts` (config, configuration)

**Current state:** File exists at `jest.setup.ts` (line 1):
```typescript
import "@testing-library/jest-dom";
```

**Changes in Phase 4:**
- Add jest-axe matchers (line 2):
```typescript
import "jest-axe/extend-expect";
```

**Installation prerequisite:**
```bash
npm install --save-dev jest-axe
```

---

### Delete confirm dialog (NEW component, request-response)

**Analog:** `src/app/tasks/new-task-modal.tsx` (lines 182–189 overlay, lines 320–336 button pattern)

**Location:** Either inline in `task-card.tsx` with state management, or separate file `src/app/tasks/delete-confirm-dialog.tsx` (cleaner, allows reuse).

**Recommendation:** Separate file `src/app/tasks/delete-confirm-dialog.tsx` for clarity.

**Pattern from new-task-modal.tsx button structure** (lines 320–336):
```typescript
<div className="flex justify-end gap-2 pt-2">
  <button
    type="button"
    onClick={onClose}
    disabled={disabled}
    className="px-4 py-2 text-sm rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors disabled:opacity-50"
  >
    Cancel
  </button>
  <button
    type="submit"
    disabled={!title.trim() || selectedMemberIds.length === 0 || pending}
    className="px-4 py-2 text-sm font-medium rounded-[8px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
  >
    {pending ? "Adding…" : "Add task"}
  </button>
</div>
```

**Delete confirm specific:**
- Initial focus: Cancel button (D-08: destructive action must not be one Enter away)
- Button labels: "Cancel" and "Delete"
- Dialog title: `"Delete "${taskTitle}"?"`
- Dialog body: `"This cannot be undone."` (or similar, per UI-SPEC)
- Both buttons must be 44×44px touch targets (D-12)

---

## Accessibility Test File Pattern

**Analog:** `src/app/tasks/new-task-modal.test.tsx` (lines 1–465)

**jest-axe integration pattern** (to add to test files):
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
        workspace="Household"
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have task-scoped aria-labels on action buttons", () => {
    const { getByLabelText } = render(
      <TaskCard
        taskId="123"
        title="Buy milk"
        workspace="Household"
      />
    );
    expect(getByLabelText('Mark "Buy milk" complete')).toBeInTheDocument();
  });

  it("should have 44px touch targets on all buttons", () => {
    const { getByLabelText } = render(
      <TaskCard
        taskId="123"
        title="Buy milk"
        workspace="Household"
      />
    );
    const button = getByLabelText('Mark "Buy milk" complete');
    const { width, height } = button.getBoundingClientRect();
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  });
});
```

**Test files to create/update:**
- `src/components/__tests__/dialog.test.tsx` (NEW) — test Dialog open/close, focus restore, Escape-closes
- `src/components/__tests__/toaster.test.tsx` (NEW) — test live regions, dismiss buttons, auto-dismiss timing
- Update `src/components/__tests__/task-card.test.tsx` — add axe violation checks, task-scoped label tests
- Update `src/app/tasks/new-task-modal.test.tsx` — add Dialog tests, focus tests
- Update `src/app/tasks/edit-task-modal.test.tsx` — add Dialog tests, focus tests

---

## Shared Patterns

### Authentication & Server Components
**Source:** `src/app/layout.tsx` (lines 16–25, getUser pattern)
**Apply to:** `src/app/layout.tsx` (conditional nav render on user)
```typescript
const supabase = await createClient();
const {
  data: { user },
} = await supabase.auth.getUser();

// Then later:
{user && (
  <NavUser
    name={user.user_metadata?.name ?? ""}
    email={user.email ?? ""}
  />
)}
```

### Error Handling & Toast Feedback
**Source:** `src/components/task-card.tsx` (lines 55–60, runAction)
**Apply to:** All components that trigger mutations (task-card, modals, delete confirm)
```typescript
function runAction(action: () => Promise<{ ok: boolean; error?: string }>, fallback: string) {
  startTransition(async () => {
    const result = await action();
    if (!result.ok) toast(result.error ?? fallback, "error");
  });
}
```

### Client Component + useTransition Pattern
**Source:** `src/app/tasks/new-task-modal.tsx` (lines 1, 42)
**Apply to:** All components that call server actions
```typescript
"use client";
import { useTransition } from "react";

const [pending, startTransition] = useTransition();
```

### CSS Token Usage (Tailwind Arbitrary Values)
**Source:** `src/app/globals.css` (lines 8–22)
**Apply to:** All components — use `var(--color-*)` for colors, avoid raw palette classes
```typescript
className="bg-[var(--color-surface)] text-[var(--color-text-primary)]"
// NOT: className="bg-white text-black"
```

---

## No Analog Found

Files with no close codebase match (planner should use RESEARCH.md reference patterns):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All files have analogs in the existing codebase or self-reference |

**Note:** The codebase has excellent coverage. Every new/modified file can reference existing patterns (modals, toasts, server components, test setup). No new architectural patterns are needed beyond those already in use.

---

## Metadata

**Analog search scope:** `src/components/`, `src/app/`, `jest.setup.ts`
**Files scanned:** 43 TypeScript/TSX files + 1 CSS file
**Pattern extraction date:** 2026-07-25

---

## Key Implementation Notes

### Dialog Component Focus Management
Native `<dialog>` handles:
- Focus trap (Tab cycles within dialog only)
- Escape-to-close (browser native)
- Inert background (browser native)
- Top-layer stacking (browser native)
- Focus restoration to trigger on close (browser native if `showModal()` used)

Wrapper component provides:
- React open/close lifecycle (`open` prop → `showModal()` / `.close()`)
- Initial focus selector (`initialFocusSelector` prop)
- Accessibility attributes (`aria-labelledby`, `aria-modal` implicit)

### Split Live Regions for Toasts
Critical: **Regions must be mounted at page load** (empty initially, not created on first toast). Screen readers hook the region on load; content added later is announced per region's politeness.

- `role="status"` + `aria-live="polite"` (default ARIA role) → success/warning queue behind current speech
- `role="alert"` + `aria-live="assertive"` (default ARIA role) → errors interrupt current speech

### 44px Touch Targets
Achieved with Tailwind `w-11 h-11` (44px × 44px):
- SVG icon stays 14–18px (no visual inflation)
- Padding is internal; button hit area is full 44px
- Apply to: complete, edit, delete buttons, subtask toggles, toast dismiss buttons
- Spacing between targets: minimum 8px gap (exceed WCAG minimum)

### Optimistic Close Behavior (Phase 2 Lock)
**new-task-modal.tsx:** Modal closes immediately on submit, BEFORE server resolves. Toast fires optimistically. If server rejects, `onTaskError` callback removes the optimistic row, error toast fires.

**edit-task-modal.tsx:** Modal closes immediately on submit, but NO optimistic update to task list. Server revalidation drives the update (different from create).

**Dialog conversion must preserve this behavior** — the Dialog component is a transparent wrapper; the modal close logic remains unchanged.

### Jest-axe Setup
Add to `jest.setup.ts`:
```typescript
import "jest-axe/extend-expect";
```

This registers the `toHaveNoViolations()` matcher globally. Use in every test that touches U1–U4 audit gaps (touch targets, focus, dialogs, live regions).

---

*Phase: 04-accessibility-mobile*
*Pattern mapping complete: 2026-07-25*
