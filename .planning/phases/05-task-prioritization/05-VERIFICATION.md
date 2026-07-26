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
| 0 | ~~Pre-flight: apply migration `008_atomic_next_sort_key.sql`~~ | — | **Done 2026-07-26.** Applied via `.github/workflows/deploy-migrations.yml` (manual `workflow_dispatch` run). One-time wrinkle: migrations 001-007 had been applied directly through the Supabase SQL editor before this workflow existed, so the CLI's migration history table had no record of them — confirmed via a read-only `supabase db dump` that the live schema already had `private` schema + `task_assignments.member_sort_key` (both present) and no `next_sort_key` function (absent, i.e. exactly pre-008 state) before repairing history with `supabase migration repair --status applied 001..007` and retiring an orphan remote-only entry. `supabase db push` then applied 008 cleanly. Confirmed live: `next_sort_key` RPC now exists in `public` schema, service_role-only. | ✅ done |
| 1 | Keyboard reorder (Space to lift, arrows to move, Space to drop, Escape to cancel) | `@hello-pangea/dnd`'s real keyboard sensor isn't meaningfully unit-testable — it listens to real `keydown` events with its own internal state machine | Run `npm run dev`. Tab to a task card's drag handle (grip icon). Press Space to lift it — confirm a "you have lifted an item" style live-region announcement (the library provides this by default). Press Arrow Down/Up to move it within the bucket. Press Space to drop — confirm the task's new position persists after a page refresh. Press Escape mid-lift on another task — confirm it cancels and the task returns to its original position. | ⬜ pending |
| 2 | Mouse/touch drag on a real device | Automated tests call `buildDragEndHandler` directly (see `tasks-page-client.test.tsx`), not through real pointer sensors | On a touch device or with a mouse, drag a task card by its handle to a new position within the same bucket. Confirm it moves instantly (optimistic) and stays after refresh. Attempt to drag a card from one bucket into another — confirm it snaps back (cross-bucket is out of scope, disabled at the handler level). | ⬜ pending |
| 3 | `next_sort_key` concurrency (audit C3 regression check) | No pgTAP/integration-test harness exists in this repo to fire real concurrent Postgres sessions | Open two Supabase SQL editor tabs. In both, prepare (but don't yet run) `select public.next_sort_key('<same member_id>'::uuid);`. Execute both as close to simultaneously as possible. Confirm the two returned values are different (not both `max+1000` for the same stale max) — this proves the advisory lock serialized them. **This manual check is currently the only verification of the C3 atomicity fix — there is no automated regression test for it** (the Jest suite only asserts the RPC call site, and no pgTAP harness exists here to drive real Postgres concurrency). | ⬜ pending |

## Sign-off

- [ ] All four checks recorded pass (including the migration 008 pre-flight)
- [ ] `status: complete` set in frontmatter above
