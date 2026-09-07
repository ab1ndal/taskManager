# Shared grocery list — design

Date: 2026-09-06
Status: approved for planning

A fourth destination, `/groceries`, holding one grocery list shared by every member of a household
workspace. Two views over one table: what we have (pantry) and what to buy (shopping list). An item
can be in both at once, which is the low-stock case.

This is the first feature in the app whose visibility comes from **workspace membership** rather
than a per-user assignment row. That departure is deliberate and is the single most important thing
to know when reading the rest of this document.

## Decisions and why

| Decision | Rationale |
|---|---|
| One table, two boolean facts (`in_stock`, `needed`) | An item can be owned and wanted at the same time. A single `state` enum cannot express "we have bananas and need more", which was the first thing the design got wrong. |
| Deleting archives; a product keeps one row forever | Autocomplete needs history, and re-adding a product should resurrect what we knew about it rather than opening a second row. One disposal path instead of two. |
| Every write behind a `security definer` RPC | The check constraints reject partial updates, three transitions touch four or five columns at once, and two flows are read-then-write races. See "Why RPCs and not table writes". |
| Expiry estimated from a per-category shelf life | Produce carries no printed date, and an undated row sorts last — exactly backwards for the fastest-spoiling thing in the kitchen. |
| Estimates apply on the bought path too | "Bought" is how nearly every item enters the pantry. Prefilling only on manual adds would leave the mechanism unused on the common path. |
| Quantity is a plain integer, pantry only | One number shown in both views is ambiguous — "2" reads as either "have 2" or "buy 2". |
| A 20-second foreground poll, not Realtime | The repo has no realtime code today. Twenty seconds is inside the time it takes to walk to the next aisle, and this reuses the `ResumeRefresh` pattern rather than introducing a subscription lifecycle, a publication to enable in two Supabase projects, and a new failure mode. |
| Shopping list is the default view | It is the view with a deadline attached: someone is standing in a shop. |
| Groceries replaces Workspaces in the top nav | The nav measures ~355px intrinsic on a 393px phone (`src/app/layout.tsx:53-55`); a fourth link overflows it. `/workspaces` is already linked from the `/tasks` sidebar and is a rare setup screen. |
| No meat or seafood category | Both users are vegetarian. |

### Rejected, with reasons

- **Two tables (pantry + shopping list).** The same product would exist as two unrelated rows, and
  the link between "we finished this" and "we need this" would be lost.
- **A single `state` enum.** Cannot represent low stock. This is the defect that reshaped the model.
- **Editable categories per workspace.** A second CRUD surface, its own RLS, and a
  delete-with-reassign flow, for a list two people set once. The fixed slug list mirrors how
  `board_columns.color` already works.
- **Supabase Realtime.** See the table above. Revisit if 20 seconds proves too stale in practice.
- **A toast with Undo.** `src/components/toaster.tsx:19` dismisses success at 3500ms and supports
  message and type only — no action affordance — and per lesson L11 a toast is inert behind an open
  `<dialog>`. Every transition is instead reversible from the row itself, which still works after
  the toast is gone.
- **A dialog when the quantity stepper reaches zero.** Friction at the worst moment, and it would
  make the rest of the screen inert. Reaching zero means "out and on the list", undoable by hand.
- **A per-item note.** Deferred; not in this phase.
- **Units on quantity, aisle ordering, purchase statistics, auto-reorder thresholds.** Out of scope.

## Data model

Migration `supabase/migrations/026_grocery_items.sql`.

```sql
create table grocery_items (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  name                text not null,
  category            text not null default 'pantry',
  in_stock            boolean not null default true,
  needed              boolean not null default false,
  quantity            int null,
  expires_on          date null,
  expiry_is_estimate  boolean not null default false,
  times_added         int not null default 1,
  added_by_member_id  uuid null references workspace_members(id) on delete set null,
  created_at          timestamptz not null default now(),
  state_changed_at    timestamptz not null default now(),

  constraint grocery_items_name_len      check (length(btrim(name)) between 1 and 100),
  constraint grocery_items_category      check (category in ('produce','dairy','frozen','baked',
                                                'pantry','spices','beverages','snacks','household')),
  constraint grocery_items_qty_in_stock  check (in_stock or quantity is null),
  constraint grocery_items_qty_positive  check (quantity is null or quantity > 0),
  constraint grocery_items_expiry_stock  check (in_stock or expires_on is null),
  constraint grocery_items_estimate_date check (not expiry_is_estimate or expires_on is not null),
  constraint grocery_items_expiry_sane   check (expires_on is null or
                                                expires_on between date '2020-01-01' and date '2100-01-01')
);

create unique index grocery_items_workspace_name_key
  on grocery_items (workspace_id, lower(btrim(name)));
```

`btrim` appears in both the length check and the unique index so `'Milk '` cannot shadow `'Milk'`.
No other index ships: two low-cardinality booleans over a few hundred rows will never be chosen by
the planner, and the unique index already leads with `workspace_id`. Add one when a query is
measurably slow.

### The four states

| `in_stock` | `needed` | Meaning | Appears in |
|---|---|---|---|
| true | false | Have it | Pantry |
| true | true | Have it, buy more (low stock) | Pantry and Shopping |
| false | true | Out, on the list | Shopping |
| false | false | Archived — history only | Neither; feeds autocomplete |

Archived rows are why there is no `check (in_stock or needed)`. Re-adding a product hits the unique
index and resurrects the same row via `on conflict … do update`, incrementing `times_added`, which
is what autocomplete ranks by.

### Triggers

- `state_changed_at` is maintained by a `before update` trigger firing only when
  `(old.in_stock, old.needed)` is distinct from the new pair. Without it the column is a lie — a
  `default now()` that never advances.
- `added_by_member_id` is checked against the row's own workspace, the same defect class that
  `private.assert_board_column_workspace` (migration 015) already solves. Member ids are
  workspace-scoped, so nothing else stops a Work member id landing on a Household row.

### Categories

`src/app/groceries/categories.ts` holds, per slug: label, display position, and `shelfLifeDays`
(produce 7, dairy 10, baked 4, frozen 180; pantry, spices, beverages, snacks and household have
none). The slug list is duplicated in the check constraint. `docs/db.md` must state that the two
change together, exactly as it does for `TAB20_SLUGS` and `board_columns_color_valid`.

## Why RPCs and not table writes

Three reasons, each a defect found while reviewing the first draft of this design:

1. **The constraints reject partial updates.** "Finished" sent as
   `set in_stock = false, needed = true` violates `grocery_items_qty_in_stock` whenever a quantity
   is set, and `grocery_items_expiry_stock` whenever an expiry is. The write has to set five
   columns in one statement. A client that forgets one gets a `23514` on a path the user thinks is
   a single tap.
2. **"Add to shopping list" is a check-then-insert race.** Two phones add "Milk", neither sees a
   row, both insert, and one receives `23505`. PostgREST cannot name an expression index as a
   conflict target, so `on conflict (workspace_id, lower(btrim(name)))` must live in a function.
3. **The quantity stepper loses updates.** Both phones read 3, both write 2, one decrement
   disappears. Neither a constraint nor RLS catches it, because 2 is a valid value.

### The RPCs

All are `security definer`, in `public`, with `set search_path = ''`, and follow the grant shape of
`018_board_column_rpcs.sql:94-97` — `revoke execute … from public, anon, authenticated` then
`grant execute … to service_role`.

| RPC | Signature | Guarantee |
|---|---|---|
| `grocery_upsert` | `(p_workspace uuid, p_name text, p_category text, p_target text, p_quantity int, p_expires_on date, p_estimate boolean)` | One `insert … on conflict … do update`. Resurrects archived rows, bumps `times_added`. `p_target` is `'stock'` or `'list'`. |
| `grocery_set_needed` | `(p_id uuid, p_needed boolean)` | Idempotent list toggle; concurrent taps converge. |
| `grocery_mark_bought` | `(p_id uuid, p_expires_on date, p_estimate boolean)` | `in_stock = true, needed = false` and the expiry, in one statement. |
| `grocery_finish` | `(p_id uuid, p_keep_on_list boolean)` | Writes `in_stock`, `quantity`, `expires_on`, `expiry_is_estimate` and `needed` together. |
| `grocery_adjust_quantity` | `(p_id uuid, p_delta int)` | Relative `set quantity = quantity + p_delta`, so concurrent decrements compose. **The zero-crossing runs inside this same call** — if the result would reach zero the function performs the finish transition itself rather than returning 1 and letting the client send a second write. |
| `grocery_forget` | `(p_id uuid)` | A real `delete`, for a typo. The only path that loses history. |

No RPC calls `current_date`. The database session is UTC, so between 17:00 and midnight Pacific
`current_date` is already tomorrow — every expiry comparison would be a day early each evening.
The **action** computes the local date using `APP_TIME_ZONE` (`src/app/tasks/recurrence-time.ts:12`)
and passes an explicit `date`.

`grocery_adjust_quantity` needs no advisory lock and no `FOR UPDATE`. A conditional relative UPDATE
under READ COMMITTED blocks the second writer on the row lock and re-evaluates against the
committed row. Migration 021 exists because `FOR UPDATE` was bolted onto an aggregate query and
shipped broken.

## Server actions

`src/app/groceries/actions.ts`, mirroring `src/app/board/actions.ts`:

- `"use server"`, every export wrapped in `run("actionName", …)` from `src/app/tasks/action-run.ts`.
- `requireUser()`, then `parseInput(schema, input)` from `src/app/tasks/schemas.ts`.
- `assertItemMember(itemId, authUserId)` reads `workspace_id` **from the row** and calls
  `assertWorkspaceMember`. The item id arrives from the network, so its workspace is never trusted
  from the caller — the same reason `assertColumnMember` exists.
- `revalidatePath("/groceries")` after every mutation. Next 16 also exposes `refresh()` from
  `next/cache`, but every action in this repo uses `revalidatePath`; consistency wins.
- Returns `ActionResult` from `src/app/tasks/action-result.ts`.

Actions: `addGroceryItem`, `setNeeded`, `markBought`, `finishItem`, `adjustQuantity`, `editItem`,
`forgetItem`.

`src/app/groceries/rpc-errors.ts` lists only the failure messages the migration itself raises,
in the shape of `src/app/board/rpc-errors.ts`; anything else falls through to `GENERIC_ERROR`.
A `23505` becomes a `ValidationError` naming **which view already holds the name**, because
"already used in this workspace" is baffling when the collision is with an archived row.

RLS: all four policies on `grocery_items`, `to authenticated`, gated on
`private.is_workspace_member(workspace_id)`. Migration 007's policies carry `to authenticated` and
015's do not; follow 007, since 007 revoked `usage on schema private from anon` and an `anon`
evaluation would raise `42501` rather than return empty. These policies are defence in depth: the
actions use the admin client, so authorization is the action's job (lesson L4).

## UI

Files under `src/app/groceries/`: `page.tsx` (server; RLS-scoped read of every row for the
workspace, archived included), `groceries-client.tsx`, `item-row.tsx`, `add-row.tsx`, `actions.ts`,
`schemas.ts`, `categories.ts`, `rpc-errors.ts`, `sort.ts`, `loading.tsx`, `error.tsx`, plus
colocated tests.

**Views.** `/groceries?view=buy` (shopping, the default) and `?view=stock` (pantry), using the
existing `TabPill` with `matchKey="view"` on both pills. `/groceries` redirects to the canonical
view so the active pill is never ambiguous.

**Rows.**

```
PANTRY                                        SHOPPING LIST
┌──────────────────────────────────┐          ┌──────────────────────────────────┐
│ Spinach          Produce         │          │ ○  Milk            Dairy         │
│ ~Sep 13                   [Need] │          │    have 1                        │
├──────────────────────────────────┤          ├──────────────────────────────────┤
│ Bananas          Produce         │          │ ○  Coriander       Produce       │
│ 6  [−][+]                 [Need] │          ├──────────────────────────────────┤
├──────────────────────────────────┤          │ ○  Bananas         Produce       │
│ Milk             Dairy    ●Need  │          │    have 6                        │
│ Sep 12                           │          └──────────────────────────────────┘
└──────────────────────────────────┘
```

- Quantity shows in the pantry only, as a stepper on rows that have a count. A shopping row shows
  `have 6` as a subtitle instead — the fact you want at the shelf.
- `[Need]` is a one-tap toggle, outline when off and solid when on. No dialog. This is the
  cooking-and-noticing gesture and it must stay one tap.
- The whole shopping row is the bought target, minimum 44px tall.
- Expiry is muted secondary text; an estimate carries a leading `~`.
- Icons from `lucide-react` at `ICON_SECONDARY` / `ICON_STROKE`, matching `task-card.tsx`.

**Colour.** Grocery expiry never uses the `--color-danger-*`, warning or success trio that
`task-card.tsx` uses for task deadlines. Expiry is neutral muted text; an expired item gets one
amber `--color-warning-surface` pill reading "expired" plus a one-tap **Still good** that pushes the
date out by the category's shelf life. Keeping red exclusive to task deadlines is what stops
grocery noise devaluing it app-wide.

**Sort.** A segmented Expiry / Name control, shown in the pantry only — the shopping list holds no
expiry data, so the control would be inert there. Expiry order: expired first, then soonest,
undated last, name as tiebreak. The shopping list sorts by category position then name, which walks
a store roughly in aisle order.

**Category filter chips** appear only once a view exceeds fifteen rows.

**Add row** is sticky above the keyboard: one text field where Enter commits and keeps focus, so
several items go in without re-tapping. Category defaults to `pantry` and is editable afterwards.
Suggestions come from the already-loaded rows ranked by `times_added` — no endpoint, no round trip.

**Empty states.** Pantry: "Nothing tracked yet. Add what's in your kitchen." Shopping: "List is
empty. Tap Need on anything in the pantry."

**Freshness.** A client hook calls `router.refresh()` every 20 seconds while `/groceries` is
foregrounded and stops when the page is hidden, alongside the existing `ResumeRefresh`.

**Navigation.** `src/components/nav-links.tsx` swaps the `/workspaces` entry for `/groceries`.
`/workspaces` remains reachable from the `/tasks` sidebar (`tasks-page-client.tsx:291`) and by URL.

## Tests

`src/test/supabase-fake.ts:311` already dispatches `rpc` by name with an `unknown rpc` fallback, so
the six grocery RPCs get fake handlers there.

**Jest.** `sort.ts` ordering in both views; shelf-life arithmetic **at the 17:00 Pacific boundary**,
which is where a UTC `toISOString().slice(0,10)` prefill lands a day early; suggestion ranking
including archived rows; `schemas.ts` validation; `rpc-errors.ts` fragment matching; every action's
transition against the fake.

**Database**, dry-run against the dev project inside `begin … rollback` (no local Postgres works
here). Each constraint rejects what it should: `quantity = 0`, an expiry on an out-of-stock row, a
whitespace-only name, `'Milk '` against `'Milk'`, an estimate flag with no date, a year of 9999.
RLS verified with the `set local role authenticated` plus `request.jwt.claims` recipe from lesson
L9 — a non-member sees zero rows. **Two concurrent sessions decrementing one row**, asserting both
decrements land and the zero-crossing runs once; per lesson L10 that test must include the writes,
not two reads.

**Playwright**, on both phone projects and desktop. `/groceries` joins `PAGES` in
`e2e/layout.spec.ts` for the no-horizontal-scroll, single-`main` and 44px checks, the last with the
add row focused and its suggestion list open. A new `e2e/grocery.spec.ts` covers add → Need →
bought → finish → archived → re-add resurrects the row with `times_added` bumped, the sort toggle,
and the expired pill with "Still good". Seeded rows carry the `E2E ` marker and the scoped teardown
from lesson L14, because the dev project is shared with everyday local work.

## Documentation

In the same change: `docs/db.md` gains the table, the four-state table, the trigger notes and the
"category list is duplicated in `categories.ts`" warning; `docs/product.md` gains a Groceries
section stating plainly that visibility here is workspace membership, not assignment.

## Migration path

`026_grocery_items.sql` goes to the dev project with `supabase db push`, then to production through
the `deploy-migrations` GitHub workflow on merge to `main`. Not MCP, not the SQL editor — lesson L9
records that this repo has broken its migration history twice that way.

## Accepted risk

`007_rls_security_definer.sql:134` makes `workspaces_select` `using (true)`, and
`workspace_members_insert_self` constrains only `auth_user_id`, not which workspace. Production has
`disable_signup: false` with email and Google enabled. Any person who signs up can therefore join
the Household workspace and read the grocery list. The owner accepted this on 2026-09-06 rather
than delay the feature; `tasks/todo.md` records it, along with the one-toggle mitigation (disable
new signups) and the proper fix (narrow `workspaces_select`, gate self-join behind an invite).

Groceries is the first household *content* to sit behind membership alone. Tasks are not exposed by
this, because they still require an assignment row.

## Out of scope

Units on quantity; per-item notes; aisle or store ordering; purchase history and statistics;
auto-reorder thresholds; barcode scanning; offline writes; Realtime; recipes; sharing the list
outside the workspace.
