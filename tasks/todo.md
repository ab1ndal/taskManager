# Board interactions and drag polish

Approved scope (2026-08-30): board cards open a modal in place, can be edited and deleted, columns
can add a task, empty columns say so, and the drag gets real feedback.

Design review that produced this list is in the session; the short version is that the board was
built as a placement surface only. Every feature below already exists in the list view, so this is
wiring, not invention.

## Steps

- [x] 0. Fix the drag offset (`contain: paint` -> `relative`), regression test in
      `e2e/drag-offset.spec.ts`
- [x] 1. `createTaskWithSubtasks` accepts an optional `boardColumnId`; server validates it belongs to
      the workspace and is non-terminal, else falls back to the leftmost open column
- [x] 2. `loadTaskForEdit(taskId)` server action returns a full `RawTask` on demand, so the board
      query stays thin (same posture as `loadOlderDone`)
- [x] 3. `/board` page fetches workspaces with members and the caller's member ids, for the modals
- [x] 4. `BoardCard` becomes interactive: press opens the task, row menu carries edit and delete,
      title wraps to two lines instead of truncating
- [x] 5. Column footer: "Add task" per column, opening `NewTaskModal` pre-filled with that column
      and workspace; empty columns render an empty state instead of dead space
- [x] 6. Drag polish: lift on grab, drop-target tint, `cursor: grab`, all behind
      `prefers-reduced-motion`. Scroll-snap on the column strip was planned and cut: it fights the
      library's auto-scroll during a drag, and the ask was about the drag, not the scroll.
- [x] 7. Tests: unit for the column fallback and the card, e2e for open/edit/delete/add

## Constraints carried in

- Board query stays thin. Do not fetch descriptions, subtasks or recurrence for every card.
- Reuse `RowMenu`, `NewTaskModal`, `EditTaskModal`, `EmptyState`. Do not reimplement badges;
  `board-card.tsx` already duplicates `task-card.tsx`'s deadline and shared badges.
- Touch targets stay at 44px. Drag must keep its keyboard path.
- One focus treatment, defined globally. Components do not add their own rings.

## Outcome

All seven steps landed. 594 unit tests and the chromium e2e suite pass.

Surprises worth keeping:

- `contain: paint` on a scroll container makes it the containing block for *fixed* descendants, so
  @hello-pangea/dnd's lifted card (position: fixed at viewport coordinates) rendered 98px below the
  cursor. `position: relative` contains the absolutely-positioned `sr-only` live region that caused
  the original page-wide horizontal scroll, without capturing fixed ones. The two are not
  interchangeable and the difference is invisible until something is dragged.
- Every board drag test was keyboard-driven, which is why a purely visual pointer defect survived a
  suite that covers the board well. `e2e/drag-offset.spec.ts` closes that hole.
- The library puts `role="button"` on whatever carries `dragHandleProps`, so the actions menu cannot
  live inside the drag handle: axe fails it as `nested-interactive`. The handle wraps the card body,
  the menu sits beside it.
- Task mutations revalidated only `/tasks`, so a change made in the list view left the board stale
  until a hard reload. Fixed alongside, since the board now calls the same actions.

## Resume

Migrations 015-021 are applied to production and recorded (head 021). CLI is linked to dev.
`main` still has none of the 47 board commits.
