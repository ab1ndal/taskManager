# Lessons

Project-specific gotchas and corrections. Read at session start. Keep current — prune what stops
being true.

## L1 — `SECURITY DEFINER` helpers must live in a `private` schema, never `public`

**Learned:** 2026-07-25, planning phase 03.

I first proposed `public.is_workspace_member()` to break the RLS recursion. That is a vulnerability.
Postgres grants `EXECUTE` to `PUBLIC` on every new function, and `anon` / `authenticated` inherit
from `PUBLIC` — so a `SECURITY DEFINER` function in an exposed schema is a callable, RLS-bypassing
API endpoint that anyone can hit.

**Rule:** helpers go in `private`, carry `set search_path = ''`, and schema-qualify every reference
inside the body. A `SECURITY DEFINER` function without `set search_path` is itself a
privilege-escalation vector.

**Why it matters here:** the whole phase-03 fix rests on these functions. Getting the schema wrong
would have replaced one hole with another while looking like a fix.

## L2 — This codebase's RLS problems trace to one self-referential policy

`workspace_members_select` (migration 002) is defined in terms of `workspace_members`, so evaluating
it re-enters itself → Postgres `42P17`. Every policy that joins that table inherits the recursion.

Each `42P17` was then worked around by swapping in the service-role admin client — in `page.tsx`,
`workspaces/actions.ts`, and `tasks/actions.ts` — and migration 006 finished the job by replacing
real policy checks with `auth.uid() IS NOT NULL`.

**Rule:** if a Supabase query here fails with `42P17`, the fix is a `private.` security-definer
helper. Reaching for `createAdminClient()` is how the codebase got into this state. Any remaining use
of the admin client needs an authorization check above it and a comment saying why it is required.

## L3 — `NEXT_PUBLIC_` on a secret is a live hazard even when it isn't leaking yet

`admin.ts` reads `NEXT_PUBLIC_SUPABASE_SECRET_KEY`. It is not currently in the browser bundle, since
`admin.ts` is only imported from server files — but Next inlines any `NEXT_PUBLIC_` value into every
bundle that references it, so one careless import publishes the service-role key to every visitor.

**Rule:** secrets never carry the `NEXT_PUBLIC_` prefix. Server-only modules get
`import "server-only"` so a client import fails the build instead of leaking silently.

## L4 — Server actions are public endpoints; auth in `page.tsx` does not cover them

`src/app/tasks/page.tsx` checks the user. `src/app/tasks/actions.ts` does not — and it uses the admin
client, so neither the app nor the database was checking anything. Any authenticated user could
mutate any task by UUID.

**Rule:** every server action does two checks, not one: authenticated, *and* authorized for this
specific row. UI-level guards (a disabled button, a filtered list) are not access control.

## L5 — The test suite's Supabase mocks are chain-order-dependent

`actions.test.ts` builds mocks as hand-assembled method chains
(`from → select → eq → single`) sequenced with `mockReturnValueOnce`. Any change to the *number or
order* of Supabase calls inside an action breaks its tests, even when behaviour is unchanged.

**Rule:** expect large test churn from any action-internals change, and do not read it as a signal
the change is wrong. Extract a shared `mockSupabase()` builder before the change, not after.

**Resolved 2026-07-25 (`5cf8987`)** for `src/app/tasks/actions.test.ts`: replaced by
`src/test/supabase-fake.ts`, an in-memory fake that answers by table and filter. Seed rows, run the
action, assert on `fake.tables`. Adding or reordering queries inside an action no longer breaks
tests. `src/app/workspaces/actions.test.ts` still uses the old hand-rolled chains — port it when it
next needs touching.

The fake implements only what these actions use: `eq` / `in` / `is` / `order` / `limit` / `single`,
`{ count: "exact", head: true }`, and `insert` / `update` / `delete`. It does **not** implement
PostgREST embedded joins (`workspace_members!inner(...)`) — `assertTaskAssignee` was written as two
queries partly for that reason.

## L6 — `getUser()` is safe; `getSession()` is not

Supabase docs now recommend `getClaims()` server-side (verifies the JWT signature locally, no network
round trip). `getUser()` is also safe — it round-trips to the Auth server. Only `getSession()` is
unsafe in server code: it reads local storage without revalidating and can be spoofed.

**Rule:** `getClaims()` preferred, `getUser()` acceptable, `getSession()` never in server code.
Migrating `getUser()` → `getClaims()` is a performance change, not a security fix — do not let it
jump the queue ahead of actual security work.

## L7 — The repo had two disjoint histories

Local `main` and `origin/main` shared no common ancestor — an orphan planning-only re-init from
2026-03-23 ("Household Task Manager", phase `01-foundation`) sitting next to the real project
("Hearth", phase `01-workspace-directory`). Reconciled 2026-07-25 by tagging the orphan as
`orphan/local-planning-2026-03-23` and hard-resetting to origin.

**Rule:** before trusting `git status`'s ahead/behind counts here, check
`git merge-base --is-ancestor`. An empty `git merge-base --all` means disjoint histories, and "ahead
14, behind 111" means something entirely different than it appears to.

## L8 — `docs/db.md` specifies indexes that migration 001 never created

`workspace_members (auth_user_id)` and `tasks (parent_task_id)` are both named in the design doc and
absent from the schema. Existing composite indexes do not cover them — the leading column is wrong in
both cases.

**Rule:** treat `docs/db.md` as intent, not as a description of the live schema. Verify against
`supabase/migrations/` before assuming an index exists.
