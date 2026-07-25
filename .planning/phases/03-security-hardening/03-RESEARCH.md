# Research — Phase 03 Security Hardening

Date: 2026-07-25. Feeds `03-PLAN.md`. Sources are official docs fetched during this session, not recall.

## R1. The recursion has a documented, official fix

Supabase's RLS guide names this exact failure and prescribes `SECURITY DEFINER` helper functions. The
function runs with its creator's privileges, so it does not re-enter RLS on the table it reads, which
breaks the `42P17` cycle.

Two constraints came out of the docs that change what the audit originally proposed:

1. **The helper must not live in an exposed schema.** Postgres grants `EXECUTE` to `PUBLIC` on every
   new function, and `anon` / `authenticated` inherit from `PUBLIC`. A `SECURITY DEFINER` function in
   `public` is therefore a callable, RLS-bypassing API endpoint. Docs: *"Security-definer functions
   should never be created in a schema in the 'Exposed schemas'."* → create a `private` schema.
2. **`set search_path = ''`** is required on the function, and all references inside it must be
   schema-qualified. Without it, the function is a privilege-escalation vector.

Reference shape, from the Supabase pgTAP guide:

```sql
create schema if not exists private;

create or replace function private.get_user_org_role(org_id bigint, user_id uuid)
returns text
set search_path = ''
as $$
  select role from public.org_members where org_id = $1 and user_id = $2;
$$ language sql security definer;
```

**Correction to the audit:** it suggested `public.is_workspace_member(...)`. That is wrong — it would
be publicly callable. Use `private.`.

## R2. Three policy rules the current migrations violate

From the RLS guide and the Supabase security checklist:

- **`TO authenticated` alone is authorization theatre.** It checks the role, not the row. It must be
  paired with an ownership predicate in `USING`. Migrations 004/005/006 use bare
  `auth.uid() IS NOT NULL`, which is the same mistake — and it breaks outright if anonymous sign-ins
  are ever enabled, since anonymous users also carry the `authenticated` role.
- **UPDATE needs `USING` *and* `WITH CHECK`.** Without `WITH CHECK` a user can rewrite the row's
  ownership column. Migration 003 got this right for `tasks`; nothing else does.
- **UPDATE also needs a SELECT policy.** Postgres must SELECT the row before updating it. Missing
  SELECT → the update silently affects 0 rows, no error. Worth knowing when the admin client is
  removed and things start "not saving" for no visible reason.

## R3. Performance numbers justify the shape of the policies

Benchmarks in the RLS guide:

| Change | Reported gain |
|---|---|
| `(select auth.uid())` instead of bare `auth.uid()` | ~95% — caches per statement instead of per row |
| Index on the column referenced in the policy | ~99.9% |
| `TO authenticated` on the policy | ~99.8% — skips evaluation for `anon` |

All three apply here, and the index one has a live gap:

- `workspace_members` has `unique (workspace_id, auth_user_id)`. The helper function looks up by
  `auth_user_id` **alone**, which cannot use that index — `workspace_id` is the leading column. A
  dedicated index on `auth_user_id` is needed. `docs/db.md` already specifies it; migration 001 never
  created it.
- `tasks` has `(workspace_id, parent_task_id)`. The subtask fetch in `page.tsx:120` filters on
  `parent_task_id` alone — same leading-column problem. `docs/db.md` specifies this index too.

So the index work is not an optimization; it is closing a documented gap that the new policies will
lean on.

## R4. Next.js treats Server Actions as public endpoints

Next.js docs, `data-security` and `authentication` guides: *"Server Actions should be treated with
the same security considerations as public-facing API endpoints"* — verify authorization inside each
action, never rely on UI-level checks. Their canonical example is precisely the IDOR the audit found:

```ts
'use server'
export async function deletePost(postId: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  const post = await db.post.findUnique({ where: { id: postId } })
  if (post.authorId !== session.user.id) throw new Error('Forbidden')
  await db.post.delete({ where: { id: postId } })
}
```

Note the two distinct checks — authenticated, then *owns this specific row*. The current task actions
have neither.

## R5. `getClaims()`, not `getUser()` / `getSession()`

The Supabase Next.js server-side auth guide now recommends `getClaims()` for Server Components and
Server Actions: it reads the access token and verifies its signature on every call. `getSession()` is
explicitly unsafe server-side — *"isn't guaranteed to revalidate the Auth token"* and can be spoofed
when storage is shared with the client.

Current code uses `getUser()` in `proxy.ts`, `layout.tsx`, `page.tsx`, and `workspaces/actions.ts`.
`getUser()` is *safe* — it round-trips to the Auth server — just slower than `getClaims()`, which
verifies locally against the project's public keys. Migrating is a performance win, not a security
fix, so it is sequenced after the security work and kept out of the critical path.

## R6. API keys — no naming change to chase

Fetched `supabase.com/changelog.md` and scanned 2026 entries for `breaking-change`: nothing affecting
auth, API key naming, or RLS. The publishable/secret key names in use are current.

The security checklist does state the rule directly: *"Never expose the `service_role` or secret key
in public clients… In Next.js, any `NEXT_PUBLIC_` env var is sent to the browser."* That is the S1
finding, confirmed by the vendor, and the fix is a rename plus rotation.

## R7. Zod v4 API notes

Not currently a dependency. If added, v4 changed the idiomatic form:

- `z.uuid()` is the recommended entry point; `z.string().uuid()` still works but is deprecated.
- `.max()` on strings and arrays is unchanged from v3.
- `.safeParse()` is unchanged.

One dependency, ~14KB, and it lets one schema serve both the action boundary and the form. Consistent
with the "prefer an existing dep, justify a new one" rule — there is no existing validator, and
hand-rolled checks across six actions would be worse.

## R8. Constraint discovered in the test suite

`src/app/tasks/actions.test.ts` mocks the Supabase client as hand-built method chains
(`from → update → eq`, ordered via `mockReturnValueOnce`). Adding an auth check plus an ownership
lookup to each action inserts new calls into those chains, so **every existing task-action test
breaks** — roughly 40 of the 120. This is expected and is the main cost driver of Task 4; it is not a
sign the change is wrong. A shared `mockSupabase()` builder in `jest.setup.ts` would stop the next
change from causing the same churn.

## What turned out NOT to be true

- **The audit's `public.is_workspace_member` proposal was unsafe** — see R1.
- **The service-role key is not currently in the browser bundle.** `admin.ts` is imported only from
  server files. The finding is real but is latent exposure, not active exposure. Severity stands
  because the rename is cheap and the failure mode is total.
- **`getUser()` is not itself a vulnerability.** Only `getSession()` is unsafe server-side. The task
  actions' problem is the total absence of any check, not the choice of method.
