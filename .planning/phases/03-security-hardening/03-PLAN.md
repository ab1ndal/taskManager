# Phase 03 — Security Hardening & Failure Visibility

Rooted in `.planning/AUDIT-2026-07-25.md` (findings S1–S4, C1–C6) and `03-RESEARCH.md` (R1–R8).

**Goal:** RLS enforces access in the database, every server action authenticates and authorizes its
caller, and every mutation failure reaches the user.

**Depends on:** nothing. Blocks everything — Task 1 rewrites policies that any later schema work
would collide with.

## Success criteria (what must be TRUE when done)

1. The service-role key is not readable from any `NEXT_PUBLIC_` variable, and the old key is revoked.
2. A user who is not assigned to a task cannot complete, edit, delete, or reorder it — proven by a
   test that fails against today's code.
3. `src/app/tasks/page.tsx` reads task data through the user-scoped client. No `42P17`.
4. Every task server action rejects unauthenticated callers and validates its input shape.
5. A failed mutation surfaces a toast and rolls back optimistic state instead of silently succeeding.
6. `npx tsc --noEmit` clean, `npx jest` green, `npm run lint` runs.

## Out of scope

Drag-to-reorder UI, task updates, speech-to-text, recurring tasks, dark mode, the accessibility pass
(audit U1–U12). Those are phases 04+. `getUser()` → `getClaims()` migration is deferred to Task 8 and
may be dropped without affecting the goal.

---

## Task 1 — Migration 007: real RLS

**Files:** `supabase/migrations/007_rls_security_definer.sql` (new)

Per R1, helpers go in a `private` schema with `set search_path = ''` — **not** `public`, which would
make them publicly callable RLS-bypassing endpoints.

```sql
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create or replace function private.is_workspace_member(ws uuid)
returns boolean
language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and auth_user_id = (select auth.uid())
  );
$$;

create or replace function private.is_task_assignee(t uuid)
returns boolean
language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_assignments ta
    join public.workspace_members wm on wm.id = ta.member_id
    where ta.task_id = t and wm.auth_user_id = (select auth.uid())
  );
$$;
```

Then drop and recreate every policy from 002/003/004/005/006 in terms of these. Each one gets
`TO authenticated`; each UPDATE gets both `USING` and `WITH CHECK` (R2). Example:

```sql
drop policy if exists "workspace_members_select" on workspace_members;
create policy "workspace_members_select" on workspace_members
  for select to authenticated
  using ( private.is_workspace_member(workspace_id) );

drop policy if exists "tasks_insert" on tasks;   -- was: auth.uid() is not null
create policy "tasks_insert" on tasks
  for insert to authenticated
  with check ( private.is_workspace_member(workspace_id) );
```

Also add the two indexes the new policies depend on (R3) — both are already specified in `docs/db.md`
and were never created:

```sql
create index if not exists workspace_members_auth_user_idx
  on workspace_members (auth_user_id);
create index if not exists tasks_parent_idx
  on tasks (parent_task_id);
```

**Verify:** apply locally; `select * from workspaces` as an authenticated user returns rows with no
`42P17`. Run `supabase db advisors` and clear what it reports.

**Commit:** `feat(db): replace recursive RLS policies with private security-definer helpers`

---

## Task 2 — Remove the service-role key from the client-exposed namespace

**Files:** `src/lib/supabase/admin.ts`, `.env.local` (user-managed), `README.md`

1. Rename `NEXT_PUBLIC_SUPABASE_SECRET_KEY` → `SUPABASE_SECRET_KEY`.
2. Add `import "server-only";` at the top of `admin.ts` so any client import becomes a build error
   rather than a silent key leak.
3. Throw a clear error at call time if the variable is missing, instead of `!`-asserting undefined.

**Requires the user:** rotate the Supabase secret key in the dashboard after this lands, and update
the deployment environment. The old key stays valid until rotated.

**Verify:** `grep -r "NEXT_PUBLIC_SUPABASE_SECRET" src/` returns nothing; `npm run build` succeeds.

**Commit:** `fix(security): move service-role key out of NEXT_PUBLIC namespace`

---

## Task 3 — Drop the admin client from the read path

**Files:** `src/app/tasks/page.tsx`

With Task 1 done, the six admin queries in `page.tsx` can go back to the user-scoped client and let
RLS do the filtering. Queries 1a/1a′/2/3a can collapse — `tasks_select` now returns exactly the
user's tasks, so the manual `myTaskIds` funnel is redundant. Redirect to `/login` when there is no
user rather than rendering an empty page.

**Verify:** the tasks page renders identical data for a seeded user; a second seeded user in a
different workspace sees none of the first user's tasks.

**Commit:** `refactor(tasks): read task data through RLS instead of the admin client`

---

## Task 4 — Authorize every task action

**Files:** `src/app/tasks/actions.ts`, `src/lib/auth.ts` (new), `src/app/tasks/actions.test.ts`

Per R4, each action needs two checks — authenticated, then *authorized for this row*. Add one shared
guard and call it first in `completeTask`, `deleteTask`, `updateTask`, `reorderTask`,
`createTask`, `createTaskWithSubtasks`:

```ts
// src/lib/auth.ts
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return { supabase, user };
}
```

For actions taking a `taskId`, verify the caller is an assignee before touching the row. For
`createTaskWithSubtasks`, verify every `memberId` belongs to `workspaceId` — that check is what
currently lets a caller assign a task to an arbitrary member row (S4).

Where an action still needs the admin client (only where a genuine RLS gap remains after Task 1),
the authorization check must precede it, and a comment must state why it is required.

**Expect ~40 existing tests to break** (R8) — the mocked call chains shift when auth calls are
inserted. Fix them by extracting a `mockSupabase()` helper rather than patching each chain by hand.

**New tests, must fail before the fix:**
- non-assignee calling `completeTask` / `updateTask` / `deleteTask` / `reorderTask` → rejected
- unauthenticated caller → rejected
- `createTaskWithSubtasks` with a `memberId` from another workspace → rejected

**Commit:** `fix(security): authenticate and authorize every task server action`

---

## Task 5 — Validate input at the boundary

**Files:** `package.json`, `src/app/tasks/schemas.ts` (new), `src/app/tasks/actions.ts`

Add `zod` (R7). One schema per action, `safeParse` as the first statement after `requireUser()`.
Cover: `z.uuid()` on all ids, `.min(1).max(200)` on title, `.max(2000)` on description, `.max(50)` on
the subtasks array, ISO-date check on `dueAt`.

Reuse the same schemas in `new-task-modal.tsx` / `edit-task-modal.tsx` so client and server agree.

**Verify:** oversized title and malformed UUID are both rejected with a field-level message.

**Commit:** `feat(tasks): validate server action input with zod schemas`

---

## Task 6 — Make failures visible (audit C1)

**Files:** `src/app/tasks/actions.ts`, `src/components/toaster.tsx`,
`src/app/tasks/tasks-page-client.tsx`, `src/app/tasks/error.tsx` + `loading.tsx` (new)

Every mutation currently discards `{ error }`. Change the actions to return
`{ ok: true } | { ok: false, error: string }`, surface failures through the existing toaster, and roll
back optimistic state in `handleTaskCreated`'s error path. Add `error.tsx` and `loading.tsx` for the
tasks route (C4).

**Verify:** force a DB error (delete a task twice); the user sees a toast and the row returns.

**Commit:** `fix(tasks): surface mutation failures instead of failing silently`

---

## Task 7 — Fix `completeTask`'s parent/child rule (audit C2)

**Files:** `src/app/tasks/actions.ts`, `src/components/task-card.tsx`

`docs/product.md`: *"A task is completed when the entire task and all its subtasks are marked as
complete."* Today completing the last subtask completes the parent, but completing a parent directly
does nothing to its children — and the UI hides that by disabling the parent's button whenever a
subtask is open, so a parent with subtasks can only ever be completed indirectly.

Decide and implement one rule: completing a parent completes its subtasks. Re-enable the button.

**Verify:** test both directions — last-subtask-completes-parent, and parent-completes-children.

**Commit:** `fix(tasks): completing a parent task completes its subtasks`

---

## Task 8 — Cleanup (audit C5, C6; research R5)

**Files:** `.gitignore`, `package.json`, `eslint.config.mjs` (new)

- `git rm --cached tsconfig.tsbuildinfo supabase/.temp/cli-latest`, add to `.gitignore`; remove the
  stray `.claude/worktrees/` gitlink.
- Replace the dead `next lint` script with `eslint .` and a flat config.
- Optional, non-blocking: `getUser()` → `getClaims()` in `proxy.ts` / `layout.tsx` / `page.tsx` (R5).
  Performance only — `getUser()` is already safe. Drop this if the phase runs long.

**Commit:** `chore: fix lint script, untrack build artifacts`

---

## Sequencing

Tasks 1 → 2 → 3 are strictly ordered; 3 cannot be verified until 1 is applied. Task 4 depends on 1
(it decides which actions still need the admin client). Tasks 5–8 are independent of each other once
4 lands. Task 8 can be done at any point.

Suggested commit boundaries are per-task — each should compile and pass tests standing alone.

## Risks

| Risk | Mitigation |
|---|---|
| Rewriting every policy at once breaks reads in a way tests do not catch — the suite mocks Supabase and never exercises real RLS | Apply 007 to a local Supabase instance and verify with two seeded users in separate workspaces before pushing |
| Task 4 churns ~40 tests; large diff, easy to lose a real assertion in the noise | Extract the mock builder first as its own commit, then add auth — keeps the security diff readable |
| Key rotation (Task 2) is a live-environment action outside the repo | Flag it explicitly at handoff; deploy is broken until the env var is updated |
| `.planning/STATE.md` is already stale against three off-workflow commits | Reconcile it as part of this phase's wrap-up, and renumber the roadmap — "Phase 3: Task Detail & Editing" is largely built already |
