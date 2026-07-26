---
phase: 05-task-prioritization
status: pending
---

# Phase 5 — Manual Verification Checklist

> Checks that can't be automated with this repo's Jest-only test infrastructure. Fill in Result
> and flip `status: pending` → `status: complete` once all pass. Same pattern as
> `.planning/phases/04-accessibility-mobile/04-VERIFICATION.md`.

| # | Behavior | Why Manual | Test Instructions | Result |
|---|----------|-------------|--------------------|--------|
| 0 | **Pre-flight: apply migration `008_atomic_next_sort_key.sql`** | Deploy ordering isn't checkable from the app | Apply `supabase/migrations/008_atomic_next_sort_key.sql` to the target Supabase project **before** this code is deployed. `nextSortKey()` in `src/app/tasks/actions.ts` now calls the `next_sort_key` RPC unconditionally from three call sites (task creation, subtask creation, assignee-add). If the migration is missing, all three fail — that breaks task creation and assignee changes entirely, not just reordering. Confirm with `select public.next_sort_key('<any member_id>'::uuid);` in the SQL editor. | ⬜ pending |
| 1 | Keyboard reorder (Space to lift, arrows to move, Space to drop, Escape to cancel) | `@hello-pangea/dnd`'s real keyboard sensor isn't meaningfully unit-testable — it listens to real `keydown` events with its own internal state machine | Run `npm run dev`. Tab to a task card's drag handle (grip icon). Press Space to lift it — confirm a "you have lifted an item" style live-region announcement (the library provides this by default). Press Arrow Down/Up to move it within the bucket. Press Space to drop — confirm the task's new position persists after a page refresh. Press Escape mid-lift on another task — confirm it cancels and the task returns to its original position. | ⬜ pending |
| 2 | Mouse/touch drag on a real device | Automated tests call `buildDragEndHandler` directly (see `tasks-page-client.test.tsx`), not through real pointer sensors | On a touch device or with a mouse, drag a task card by its handle to a new position within the same bucket. Confirm it moves instantly (optimistic) and stays after refresh. Attempt to drag a card from one bucket into another — confirm it snaps back (cross-bucket is out of scope, disabled at the handler level). | ⬜ pending |
| 3 | `next_sort_key` concurrency (audit C3 regression check) | No pgTAP/integration-test harness exists in this repo to fire real concurrent Postgres sessions | Open two Supabase SQL editor tabs. In both, prepare (but don't yet run) `select public.next_sort_key('<same member_id>'::uuid);`. Execute both as close to simultaneously as possible. Confirm the two returned values are different (not both `max+1000` for the same stale max) — this proves the advisory lock serialized them. **This manual check is currently the only verification of the C3 atomicity fix — there is no automated regression test for it** (the Jest suite only asserts the RPC call site, and no pgTAP harness exists here to drive real Postgres concurrency). | ⬜ pending |

## Sign-off

- [ ] All four checks recorded pass (including the migration 008 pre-flight)
- [ ] `status: complete` set in frontmatter above
