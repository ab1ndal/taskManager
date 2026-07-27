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

## L9 — The PRODUCTION database has almost no CLI migration history

Applies to `xamdgvxziobpptcfymug` (task-manager, production) **only** — not to `mcdpiuiayfljzvnhtqto`
(task-manager-dev), which was created empty on 2026-07-27 and took all nine migrations through a
clean `supabase db push`, so its history is complete. See L14 for which project is which.

Learned 2026-07-25. On production, migrations 001-006 were applied out-of-band, so
`supabase_migrations.schema_migrations` was **empty** until 007 was applied through the Supabase MCP
server, which recorded a single row: `20260725220330 rls_security_definer`.

**Rule:** never run `supabase db push` against production without first repairing the history — it
would try to replay 001-006 against a schema that already has them. `supabase link` works, but
`db push` needs `SUPABASE_DB_PASSWORD`: the CLI's passwordless login-role fallback fails on this
project with "permission denied to alter role".

**This is not hypothetical any more.** `.github/workflows/deploy-migrations.yml` links
`xamdgvxziobpptcfymug` and runs `supabase db push` on every push to `main` that touches
`supabase/migrations/**`. Until the history is repaired, the first such push fails — 001 issues bare
`create table`, so the run aborts rather than corrupting anything, but production migrations do not
deploy. Repair with `supabase migration repair --status applied <version>` for each migration
production already has, confirmed against `supabase migration list --linked`, before relying on that
workflow.

**How to verify DB behaviour without Docker or a password** — run SQL as the querying role:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<auth_user_id>","role":"authenticated"}';
select count(*) from tasks;   -- what that user actually sees
rollback;
```

This is how 007 and Task 3 were verified. It exercises the real policies, which the jest suite
cannot do — the suite mocks Supabase entirely.

## L10 — `pg_advisory_xact_lock` only protects what happens inside the same transaction

Migration 008 wrapped a `SELECT MAX(...)` in `pg_advisory_xact_lock`, computed a sort key, and
returned it to the app — which then did a *separate* `.insert()` call. The lock released the moment
the RPC's own transaction ended, before the insert ever ran. Two concurrent callers could both pass
the lock, both read the same stale `MAX`, and both insert the same key — the exact race the lock was
meant to prevent, just moved one step later. Fixed in 009 by folding the read and the write into one
function call, so the lock spans both.

**Rule:** an advisory-lock-guarded read is only as atomic as the transaction it's called in. If the
value it protects gets used in a later, separate query or round trip, the lock already released and
protected nothing. The read and every write that depends on it must share one function call (one
transaction), not be split across an RPC call and a follow-up `.insert()`/`.update()`.

**How this was first (wrongly) "verified":** a manual SQL-editor test called the read-only RPC twice
with nothing inserted in between and got the same value back — which proves nothing, since a
pure read of unchanged state returns the same answer regardless of locking. A concurrency test has
to include the write, or it can't distinguish "lock works" from "nothing happened between the calls."

## L11 — A `<dialog>` open via `showModal()` makes ALL other content inert, including popovers

Learned 2026-07-26, phase 04 verification. An error toast fired while a modal was still open
(client-side validation failure in `new-task-modal.tsx`/`edit-task-modal.tsx`) had an unreachable
dismiss button — `focus()` silently no-op'd, and a real mouse click at the button's screen
coordinates hit the `<dialog>` element instead (`document.elementFromPoint` returned `DIALOG`).

First hypothesis was a paint-order/z-index issue, since the toast is a plain `position:fixed;
z-50` div and the dialog's `::backdrop` is native top-layer content. Tried promoting the toaster
itself into the top layer via the Popover API (`popover="manual"` + `showPopover()`), including
re-promoting it on every new toast to force it to the top of the top-layer stack. Still failed.

**Root cause, confirmed with a bare HTML repro with no React/Next involved:** a `<dialog>` shown
via `showModal()` marks everything else in the document inert per spec — and that inertness is
NOT scoped to "non-top-layer content." It also catches other top-layer elements, including
`popover="manual"` elements. Order of promotion (dialog-then-popover vs. popover-then-dialog)
makes no difference; the popover is inert either way while any modal dialog is open.

**Rule:** the Popover API cannot be used to make anything interactive while a native `<dialog>` is
`showModal()`-open — there is no known escape hatch. If something must stay interactive during a
modal (an error toast, a status indicator), it has to live inside that dialog's own subtree, not
in a separate top-layer or fixed-position element outside it.

**How to verify a "does X escape/survive an open modal" claim before committing to a fix:** write
the smallest possible reproduction outside the app and framework (a bare `.html` file opened
directly in a real browser via Playwright) before spending time wiring the fix into React. Ruling
out a fix approach this way took a few minutes; discovering it was wrong after fully wiring it into
`toaster.tsx` (state, refs, effects, CSS resets for the UA popover default styles) took much
longer and had to be reverted.

## L12 — With the app in `src/`, a root-level `proxy.ts` is silently ignored

**Learned:** 2026-07-27, phase 6.5 verification.

`proxy.ts` (Next 16's rename of `middleware.ts`) sat at the repository root and had been there since
phase 03, holding both auth redirects. It never ran. Next resolves the proxy file relative to the app
directory, so with the app under `src/` the root-level file is not discovered. There is no warning:
the build succeeds, the file type-checks, and nothing in the app misbehaves in a way that points at
it. `/tasks` rendering empty for a signed-out user looked like an RLS outcome, and was filed as one
in `STATE.md` for two phases.

**Rule:** `src/proxy.ts` when the app is in `src/`. Verify registration rather than assuming it —
`next build` prints a `ƒ Proxy (Middleware)` line, and `.next/server/middleware-manifest.json` is
non-empty, only when the file was actually picked up.

**Why it matters here:** a middleware that is not registered fails open. Every route it was supposed
to guard is unguarded, and the code reads as though it is protected.

## L13 — jsdom reports every element as 0×0, so layout assertions there always pass

**Learned:** 2026-07-27, phase 6.5 verification.

`06.5-AUDIT.md` recorded "touch targets are 44px throughout". Measured in a real browser, ten
controls were not — nav links at 20px, the sidebar's New task button at 38, the completed-section
toggle at 16. The existing jsdom test could not have caught any of it: `getBoundingClientRect()`
returns all zeros there, so any "is this element big enough" check passes vacuously, as does any
overlap, overflow or truncation check.

The same blind spot produced the five defects the first visual pass found (dialogs pinned to the
top-left, an invisible complete circle, a 12px alignment error) and the two the user reported
afterwards (a collapsed subtask textarea, a 96px date input in Safari).

**Rule:** anything whose failure mode is *geometric* — size, position, overlap, overflow, truncation,
contrast against what was actually painted — belongs in the Playwright suite under `e2e/`, not in
jest. Use jest for logic, and do not let a green jsdom test stand in for a claim about layout.

## L14 — Two Supabase projects: which one each thing talks to

**Established:** 2026-07-27, closing followup F2.

| Project | Ref | Reached by | Migrations arrive via |
|---|---|---|---|
| `task-manager` (production) | `xamdgvxziobpptcfymug` | deployed app only — Vercel/GitHub env vars, and `.env.production` locally | the `deploy-migrations` GitHub workflow on push to `main` |
| `task-manager-dev` | `mcdpiuiayfljzvnhtqto` | `npm run dev`, all local work, and the whole e2e suite — via `.env.local` | `supabase db push` from a local checkout linked to this ref |

`task-manager-dev` mirrors production's schema; it is the only project a developer or a test run
writes to. `.env.local` overrides `.env.production` in a production build too, so a local
`next build && playwright test` reaches dev, not production — including the browser bundle, where
`NEXT_PUBLIC_*` values are inlined at build time rather than read at runtime.

**The guard is an absence.** `E2E_SUPABASE_URL` lives only in `.env.local` and declares "this project
is disposable". `e2e/fixtures.ts` refuses to build a client when it is unset or disagrees with
`NEXT_PUBLIC_SUPABASE_URL`, so a run that picked up production env — CI, Vercel, `.env.production` —
fails before it seeds. Verified by running with the production URL forced: the run aborts in global
setup with "Refusing to run".

Scoping still matters, because dev is shared with everyday local work: `teardown()` deletes only the
`e2e-phase65 Household` workspace and the two `e2e-phase65@…` users, and `cleanupUiWrites()` deletes
only rows carrying the `E2E `/`Filler ` markers inside that workspace. Two concurrent runs still
collide — `seed()` calls `teardown()` first — so run the suite once at a time.

**Rule:** anything a spec creates gets a marked, scoped delete, never a filter looser than "seeded
workspace plus marker". And keep `E2E_SUPABASE_URL` out of every environment except `.env.local` —
adding it to CI or Vercel silently disarms the only thing standing between the suite and real data.

**Gotcha for a second machine:** `supabase projects api-keys` prints the `sb_secret_…` key masked
(41 chars, 401s on every request). Use the legacy `service_role` key, or copy the real secret from
the dashboard.
