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

`admin.ts` used to read `NEXT_PUBLIC_SUPABASE_SECRET_KEY`. It was never actually in the browser
bundle, since `admin.ts` is only imported from server files — but Next inlines any `NEXT_PUBLIC_`
value into every bundle that references it, so one careless import would have published the
service-role key to every visitor.

Renamed to `SUPABASE_SECRET_KEY` on 2026-07-25. The Vercel side of that rename was missed and only
completed on 2026-07-27 — see L15. The key was rotated then, because it had carried the prefix for
119 days.

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

## L9 — Migration history: broken 2026-07-25, complete on both projects since

**Resolved 2026-07-27.** Both projects now report a full, matching history, verified with
`supabase migration list --linked`:

- `mcdpiuiayfljzvnhtqto` (task-manager-dev) — created empty and took all nine through one clean
  `db push`.
- `xamdgvxziobpptcfymug` (production) — lists 001-009, confirmed in the `repair-migration-history`
  workflow run of 2026-07-27, which then reported "Remote database is up to date". The deploy path
  in `.github/workflows/deploy-migrations.yml` works.

**What was true on 2026-07-25, and why this lesson still exists:** migrations 001-006 were applied to
production out-of-band, so `supabase_migrations.schema_migrations` was empty until 007 went through
the Supabase MCP server and recorded one row, `20260725220330 rls_security_definer`. In that state a
`db push` would have tried to replay 001-006 against a schema that already had them. The history was
completed at some point between then and 2026-07-27; this lesson was not updated, and on 2026-07-27
it caused a followup (F14) to be raised against a problem that no longer existed.

**Rule, unchanged:** applying a migration outside `supabase db push` — MCP, the SQL editor, psql —
leaves the history table disagreeing with the schema, and every later push inherits that. If you do
it, repair immediately: `supabase migration repair --status applied <version>`. Note `db push` needs
`SUPABASE_DB_PASSWORD` on this project; the CLI's passwordless login-role fallback fails with
"permission denied to alter role".

**Detection and recovery, used again on 2026-08-29 (kanban board, migrations 015-021).** It happened
again despite the rule above, so the procedure matters more than a stronger prohibition:

1. Detect by inspecting the objects, not the history table: `pg_policies`, `pg_proc`, `pg_indexes`
   and `information_schema.columns` say what the database actually has. Compare that against the
   migration files, one file at a time, oldest first.
2. Establish parity with the last migration that is both applied and recorded: drop or re-create the
   objects the out-of-band statements left behind so the schema matches that file exactly.
3. Re-apply forward with `supabase db push`, which then records every version it runs.
4. Confirm with `supabase migration list --linked` — local and remote columns must match.

**Second rule, learned the hard way here:** a lesson that records a broken state must be re-verified
before it is acted on, not quoted. `migration list --linked` is one command and would have shown the
truth immediately.

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

## L15 — An env var rename is only half done until every environment has it

The 2026-07-25 rename of `NEXT_PUBLIC_SUPABASE_SECRET_KEY` to `SUPABASE_SECRET_KEY` was applied to
`admin.ts`, `.env.example` and `.env.local`. Vercel kept the old name on Production, Preview and
Development. Every `createAdminClient()` path therefore threw from that deploy until 2026-07-27:
`/workspaces` rendered a bare Next error digest, and all twelve call sites in `tasks/actions.ts`
returned "Something went wrong. Please try again."

Local everything stayed green — tests, typecheck, build, e2e — because `.env.local` was correct. The
failure existed only where the env differed, and nothing in the repo could detect it.

Two things made it expensive to find. The generic catch in `actions.ts` made a permanent config error
look transient, and it went unnoticed for two days because nobody had exercised an authenticated page
on production since the deploy.

**Rule:** renaming or adding a server env var means updating Vercel in the same change —
`vercel env ls production --project task-manager --scope abhinav-bindals-projects` to see what is
actually there, and remember env changes need a redeploy to take effect. When production behaves
unlike local, read the Vercel runtime logs (`vercel logs <domain>`) before theorising; the digest in
the browser error means nothing on its own, and the log line named the missing variable outright.

## L16 — Supabase answers a duplicate signup with success, not an error

`auth.signUp()` on an email that already has a confirmed account returns `error === null` and an
obfuscated user object. No email is sent. This is deliberate anti-enumeration: the response is
indistinguishable from a real signup so the form cannot be used to discover which addresses have
accounts. Confirmed in the Supabase JS spec.

Treating `error === null` as "signup succeeded" therefore tells the user to check mail that was never
sent, with no route to recovery. That was the whole of F20 — reported as "the confirmation email never
arrives", which sent the first look at SMTP, the wrong place.

The only tell is `data.user.identities` being empty. `login-card.tsx` uses it to offer Sign in and
Reset your password. That reveals the address is registered, which the owner accepted on 2026-07-27 for
this personal app. The signal is not part of the documented contract, so the branch degrades to the
generic message if a future auth-js stops emptying the array.

Related: `signUp()` also needs an explicit `emailRedirectTo`. Without one the link inherits the
project's Site URL — the app root, where nothing exchanges the `code` — so even a delivered link
leaves the user signed out.

**Rule:** for any Supabase auth call, ask what the deliberately-ambiguous response looks like before
treating a null error as success.

## L17 — A plan's verbatim code is not verified code

**Learned:** 2026-07-28/29, phase 07 (recurring tasks).

Tasks 2-9 copied migration SQL and TypeScript straight from the plan, as instructed, into files
that a green test suite then passed. The review loop still caught, in code transcribed exactly as
written: an infinite loop (a `case` with no `else` returning `NULL`, so `exit when v_next > now()`
never fired and nothing was ever raised for the exception handler to catch), `due_at` anchored to
the wrong occurrence, a zod datetime validator that silently accepted the one input shape it was
supposed to reject, a `"use server"` export that would have become an unauthenticated endpoint the
moment something imported it, a ghost-row failure mode with no atomicity, an inert error toast
behind an open dialog, and a feature (pause) that quietly destroyed the data it claimed to preserve.
None of these were caught by the suite being green — each needed a reviewer reading the code for
what it does, not what it was supposed to do.

**Rule:** "the plan says to write this exactly" is not a reason to skip review. A detailed plan
raises confidence in the design, not in the transcription — every plan-to-code step still needs the
same review a from-scratch implementation would get, and "tests pass" is a different claim from
"the code is correct," especially for logic a jsdom/jest suite cannot exercise (timing, loop
termination, transaction boundaries, module export surface).

## L18 — jsdom cannot see layout, and two shipped defects lived exactly there

**Learned:** 2026-08-30, kanban board (Task 14, e2e).

Two defects survived a green 574-test jest suite, a typecheck, a lint pass and a code review, and
both were caught by the first e2e run that touched them:

- The colour picker's twenty swatches overlapped each other. The popover is absolutely positioned
  inside a 44px-wide trigger wrapper, so its shrink-to-fit width resolved to roughly one swatch and
  the five 44px buttons in each grid row stacked on top of one another. Every unit test passed
  because `getByRole("radio")` finds an element jsdom never lays out; Playwright failed with
  "tab20-cyan-light intercepts pointer events", which is what a real user's click would have hit.
  Fix: `w-max` on the grid.
- `/board`'s column strip made the whole page scroll sideways by 134px — nav included — even though
  the strip itself clips and scrolls correctly. Its scrollable overflow propagated to the document;
  `contain-paint` on the strip stops it.

**Rule:** a test that queries the accessibility tree proves the element exists and is labelled, not
that it is reachable, sized or on top. Anything whose correctness is geometric — overlap, hit
targets, scroll containment, sticky headers, truncation — needs a real engine. When a component's
review findings are about sizes (44px targets, grid columns, popover placement), that is the signal
to add or run the e2e case rather than to trust the unit test that just went green.

## A test that only walks the happy path proves nothing about the paths it skips

The 44px scan in `e2e/layout.spec.ts` passed for months while fourteen controls violated the rule.
It walked `/tasks` with no dialog open, and every violation lived in a modal, on the login screen or
on the workspaces screen. Widening the same assertion to run inside an open dialog found four more
defects in the task form within a minute of first running.

**Rule:** when a rule is meant to hold everywhere, the test must enumerate the surfaces, not one
representative surface. Before trusting a green invariant test, ask which screens it never visits —
and note that scan exemptions need thought too: a checkbox is 12px, but its label is the real target,
so the rule needs the exemption rather than the checkbox needing a fix.

## Breakpoint boundaries hide defects exactly at the shipping width

The nav's intrinsic width was 387px against a 393px test device — passing by 6px, with "Sign out"
already wrapping to two lines. Below 387px the whole page scrolled sideways. A single phone project
at the widest target device is the same blind spot as testing one browser.

**Rule:** test at the narrowest width that ships, not a representative one, and add a project per
real target device. Measure intrinsic width when a flex row "just fits" — fitting and fitting well
are different, and `flex-shrink-0` on every child means the last child absorbs everything.

## Vercel's Sensitive env vars pull as empty strings, so production secrets are unreachable locally

**Learned:** 2026-09-06, trying to send a one-off verification push.

`vercel env pull --environment=production` writes `KEY=""` for every variable Vercel marks
Sensitive — here `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `SUPABASE_SECRET_KEY` and both `GMAIL_*`. It
exits successfully and the file looks complete; only the value is missing. Sensitive values are
write-only once created, so the dashboard cannot show them either. The plain variables
(`NEXT_PUBLIC_*`, `VAPID_SUBJECT`, `REMINDER_APP_URL`) do come through.

The failure this produces is misleading: the script read an empty `SUPABASE_SECRET_KEY` and
PostgREST answered `401 {"message":"No API key found in request"}`, which reads like a wrong key or
a header bug rather than an empty one.

**Rule:** check value *lengths* in a pulled env file before debugging anything that uses it
(`awk -F= '{print $1, length($0)-length($1)-1}'`). And any operation that needs a production secret
has to run where the secret already is — the deployed app, a Vercel function, the cron endpoint —
not from a laptop. Keep a copy outside Vercel only if the workflow genuinely needs local access.

## Verify platform behaviour against the platform, not against memory

Three things in this work would have been wrong if taken from memory: Skew Protection looked like
the answer for propagating deploys (it needs Pro; this project is Hobby), the service worker looked
like the natural update signal (`sw.js` is byte-identical across deploys, so `controllerchange` never
fires), and `min-h-11` looked sufficient for every control (WebKit ignores `min-height` on a menulist
`<select>`). The plan, dashboard settings and live response headers all came from the Vercel API and
curl against production.

**Rule:** check the account, the plan and the live deployment before designing around a platform
feature. And when research says a claim is anecdote rather than spec — such as whether iOS keeps
stale JS across an app-switcher resume — design for both branches instead of picking one.

## `locator("li", { hasText })` can match the add row's own suggestion chip, and the chip wins the race

**Learned:** 2026-09-06/07, grocery list e2e re-add test (commit `9450b9e`).

The re-add test's final assertion was `locator("li", { hasText: ITEM }).toHaveCount(1)`. The add
row's history-backed autocomplete renders each suggestion as an `<li>` too, and that chip — drawn
client-side straight from the input's uncommitted text — satisfied the locator before the test's own
re-add POST had landed server-side. The test returned early on that false positive, and its
still-in-flight write was then cancelled by the next test's context teardown, landing afterwards with
a lowercased name (the unique index is on `lower(btrim(name))`). `cleanupUiWrites()`'s
case-sensitive `.like("name", "E2E %")` never matched that lowercased name, so the row leaked
permanently into the shared dev project and tripped Playwright's strict-mode error in whatever ran
next, reading as an unrelated flake.

**Rule:** scope a locator that means "the item row" to something the row has and a transient
suggestion never does — here, an `<li>` filtered to one that carries the row's own Actions menu —
so the assertion can only be satisfied once the real write has landed. And any teardown filter
matching a seeded-data prefix needs `ilike`, not `like`: a case mismatch anywhere upstream (a bug
like this one, or a legitimately lowercased name) otherwise leaks a row into the shared dev project
permanently rather than failing loudly.

## A hardcoded future date in a test rots the moment the calendar catches up to it

**Learned:** 2026-09-07, `src/app/groceries/actions.test.ts` re-add case (commit `0b73b15`).

A re-add test asserted `expires_on: "2026-09-13"` as a literal. `addGroceryItem` computes that date
from produce's shelf life against the real clock (an explicit `expiresOn` is the only thing that
skips the computation, and migration 028's null-preserving fix doesn't apply here since the input
isn't null), so the literal was only ever right because "today" happened to still be far enough
before it — it would have gone red with no code change once today's date closed the gap, reading as
a regression rather than what it was.

**Rule:** a test whose expected value is "N days from today" must freeze the clock
(`jest.useFakeTimers()` / `setSystemTime`) rather than hardcode a date computed once from the real
one. This is the same category of bug `localToday()` exists to prevent in the app itself — it
applies to test code with the same force it applies to product code.

## L19 — Two silent-data-loss bugs a per-task review couldn't see, only the whole-branch review could

**Learned:** 2026-09-07/08, `feat/grocery-list` branch review (merged as `a6c994c`).

All twelve plan tasks were complete and individually reviewed; the whole-branch review still found
two Criticals invisible at task scope:

- Re-adding an item by **typing its name** rewrote its stored category to `pantry`, because the
  upsert's conflict branch overwrote `category` unconditionally and the add row's selector defaults.
  The column drives shelf-life estimates and list ordering, so the loss was permanent and invisible.
- **Bought erased a user-entered expiry** for the five categories with no shelf life, because the
  RPC could not distinguish "no date supplied" from "explicitly no expiry".

Migration `029_grocery_expiry_and_category.sql` fixed both server-side and added
`grocery_extend_expiry` so the "Still good" nudge stops writing back stale columns.

**Rule:** a per-task review checks whether each task does what it says; only a whole-branch review
catches a later task's default silently undoing an earlier task's guarantee. Budget for one before
merging a multi-task branch, especially around upsert conflict paths and any RPC that must
distinguish "field omitted" from "field explicitly cleared".

## L20 — This machine's Playwright memory ceiling, and a stale-server false failure

**Learned:** 2026-09-07/08, verifying the `feat/grocery-list` branch.

The full five-Playwright-project matrix does not fit in memory on this machine — run **per project
with `--workers=1`**. Baseline pass counts here: chromium 93, webkit 83, iphone 99, iphone-16-pro 87.

Separately: a stale `next start` left running on port 3100 handed the suite a server whose `.next`
had been rebuilt underneath it — `reuseExistingServer: true` reused it anyway, and every server
action 404'd, which read as four unrelated grocery failures. Kill any stale `next start` on that
port before an e2e run.

**Rule:** treat a sudden batch of unrelated-looking e2e failures as a stale-server symptom before
debugging the feature; check `lsof -i :3100` first. And run this suite per-project, not as one pass.
