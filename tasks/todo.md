# Kanban board completion

Current audit: 2026-09-05. The original implementation plan's Tasks 1–15 and the August 30
interaction polish are on `main`. The old resume note saying the board was unmerged was stale.

## Completion pass

- [x] Read project memory and the saved board implementation ledger; reconcile the later UI decisions.
- [x] Replace the card-opening test's fixed completion date with the current time so its fixture
      stays in the rolling seven-day window.
- [x] Add a card-menu “Move to column…” dialog for keyboard and touch access to offscreen columns,
      with completion/reopening explanations, inline errors and preserved personal priority.
- [x] Update the design and product records to distinguish the delivered UI from the original draft.
- [x] Verify the completion pass: 598 unit tests, typecheck and production build pass; lint has
      zero errors and one existing unrelated warning. All 13 focused browser checks pass across
      Chromium, WebKit, Firefox and iPhone emulation, including offscreen moves, reopening,
      deletion and immediate navigation after a drop. Scoped dev fixtures were removed.
- [ ] Resolve the original completed-column selector requirement: the design specifies a radio,
      but the later implementation plan and delivered UI only label the seeded Completed column.
      User preference requested during this audit; no change to completion-role behavior yet.

The older ledger's claim that navigation loses a drop did not reproduce in any of the four browser
projects; `e2e/board.spec.ts` now tests immediate navigation before waiting for the write. This
verifies in-app navigation, not closing the browser during a request. A preliminary WebKit deletion
test timed out while its save was pending; the focused rerun passed on all four projects. The
completion pass did not rerun the entire application E2E/screenshot suite.

## Other saved discussions

The approved [iPhone install and daily reminders design](../docs/superpowers/specs/2026-08-31-ios-pwa-and-reminders-design.md)
is separate work in Phases 8 and 9 and remains unimplemented. The board's live cross-user updates,
subtasks on cards, WIP limits and Notion sync remain outside its agreed scope.

## August 30 interaction polish

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

All steps landed. The August 30 verification recorded 594 passing unit tests and the Chromium E2E
suite. Current completion-pass results are listed above.

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

## Environment record

The August 30 notes report migrations 015–021 applied and recorded in production. This completion
pass does not independently verify production's migration ledger or deployment. Browser tests run
against the development Supabase project; they create and remove only the scoped E2E fixtures.
