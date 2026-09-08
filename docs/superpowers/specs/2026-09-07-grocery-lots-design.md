# Grocery lots — per-purchase expiry — design

Status: proposed, 2026-09-07. Supersedes the one-date-per-product assumption in
`docs/superpowers/specs/2026-09-06-grocery-list-design.md`; every other decision in that document
still stands.

## The problem

Buy onions. A week later, buy onions again. The second purchase has a later expiry, and today it
overwrites the first: `grocery_items` holds one `expires_on` per product, so
`grocery_mark_bought` (migration 029) writes the fresh shelf-life estimate over the old date and the
older onions stop warning. Re-adding through the add row does the same whenever the caller names a
category with a shelf life.

There is no second row to write instead — `grocery_items_workspace_name_key` is unique on
`(workspace_id, lower(btrim(name)))`, deliberately, so autocomplete history and `times_added` survive
a re-add.

A weekly shop here is 20-30 items across all nine categories, so this is not an edge case: it happens
to every perishable bought before the previous one ran out.

## What a lot is

A **lot** is some quantity of one product that shares one expiry date. Buying onions creates a lot.
Buying onions again a week later creates a second lot. Two purchases that land on the same date are
one lot.

Undated stock — rice, salt, dish soap — is the lot with no date. That falls out of the merge rule
below rather than needing a rule of its own: every undated purchase of a product collapses into that
one lot, because a lot's identity is its date and all undated purchases share the absence of one.

> This revises what was said while brainstorming, where lots were going to be dated-only with
> undated quantity left on `grocery_items`. Allowing a null date costs nothing once merging is in
> place and buys a single home for quantity, a single home for expiry, and an exact
> `in_stock ⟺ has lots` rule. Two places to keep a count in step was the worse trade.

The clutter this avoids is real: indistinguishable undated rows piling up per purchase. It is the
merge that prevents it, not the absence of a table.

## What this deliberately is not

Inventory accounting. Five onions from last week sit in the same bowl as five from this week and
nobody can tell them apart, so any per-onion ledger is a number the app invents and the user cannot
verify. Counts stay optional exactly as they are today, lots without counts are ordinary, and a lot
ends when the user answers a question they can actually answer — "any old onions left?" — not when
arithmetic says zero.

The second failure mode this guards against: lots that never end. If clearing a stale lot is harder
than ignoring it, lots accumulate, every pantry row eventually shows "expired", and the warning
becomes wallpaper — worse than today's bug, where at least the one date shown means something. The
Expired sweep below exists for that reason and is not optional polish.

## Data model

New migration `supabase/migrations/030_grocery_lots.sql`.

```sql
create table public.grocery_lots (
  id                 uuid primary key default gen_random_uuid(),
  item_id            uuid not null references public.grocery_items(id) on delete cascade,
  quantity           int null,
  expires_on         date null,
  expiry_is_estimate boolean not null default false,
  created_at         timestamptz not null default now(),

  constraint grocery_lots_qty_positive  check (quantity is null or quantity > 0),
  constraint grocery_lots_estimate_date check (not expiry_is_estimate or expires_on is not null),
  constraint grocery_lots_expiry_sane   check (expires_on is null or
                                               expires_on between date '2020-01-01'
                                                             and date '2100-01-01')
);

-- One lot per product per date. `nulls not distinct` is what makes the undated bucket a single lot
-- instead of one row per purchase; without it Postgres treats every null date as unique.
create unique index grocery_lots_item_expiry_key
  on public.grocery_lots (item_id, expires_on) nulls not distinct;

create index grocery_lots_item_id_idx on public.grocery_lots (item_id);
```

`nulls not distinct` is Postgres 15+. Both projects are well past that, but the plan verifies it
against dev (`show server_version`) before the migration is written rather than assuming it — the
whole undated-lot design rests on that one clause. The fallback if it were ever unavailable is a
unique index on `coalesce(expires_on, date '1970-01-01')`, which is uglier and equivalent.

`quantity int null` carries the same meaning it has on `grocery_items` today: null is "some, not
counted", not zero.

`expiry_is_estimate` is not part of the unique key. Two purchases landing on the same date merge
regardless, and the merged lot keeps `old.expiry_is_estimate and new.expiry_is_estimate` — a date a
person read off a package outranks one the app guessed.

### Columns removed from `grocery_items`

`quantity`, `expires_on` and `expiry_is_estimate` move to the lot, along with the four constraints
that only exist to police them: `grocery_items_qty_in_stock`, `grocery_items_qty_positive`,
`grocery_items_expiry_stock`, `grocery_items_estimate_date`, `grocery_items_expiry_sane`.

Everything else on the item stays and keeps its current meaning: `name`, `category`, `needed`,
`times_added`, `added_by_member_id`, `state_changed_at`, and the unique name index.

### `in_stock` stays a column, maintained by a trigger

```sql
create or replace function private.sync_grocery_stock() returns trigger ...
-- after insert or delete on grocery_lots:
--   update grocery_items set in_stock = exists (select 1 from grocery_lots where item_id = ...)
```

The column default flips from `true` to `false` in the same migration, which is what lets the
trigger be the only writer of `true`: an item created straight onto the shopping list
(`p_target = 'list'`) inserts no lot, and under today's default it would land in the pantry. The
insert path therefore names no `in_stock` at all and the lot insert is what promotes the item.

Deriving `in_stock` from a join at every read was the alternative and was rejected: the four-state
model in the 2026-09-06 spec is what the whole page, both sorts and the shopping view are written
against, and shopping-list rows legitimately have no lots at all. Keeping the column and making the
trigger its single writer means `in_stock ⟺ item has at least one lot` is enforced by the database
rather than by the discipline of six RPCs.

### RLS

Same shape as `grocery_items`, reached through the parent row:

```sql
using ( exists (select 1 from public.grocery_items i
                where i.id = grocery_lots.item_id
                  and private.is_workspace_member(i.workspace_id)) )
```

`workspace_id` is deliberately not denormalised onto the lot. A second copy would need the same
cross-workspace consistency trigger `private.assert_grocery_member_workspace` exists for, to save a
join on a table holding a few hundred rows.

## RPCs

Migration 030 replaces the grocery RPC surface. Rules from the existing design hold unchanged: every
write is a `security definer` function in `public`, granted to `service_role` only, with
`set search_path = ''`; no function calls `current_date` (the caller passes `localToday()`).

| Function | Change |
|---|---|
| `grocery_upsert(p_workspace, p_name, p_category, p_target, p_quantity, p_expires_on, p_estimate, p_member)` | Signature unchanged. Item half keeps today's behaviour — category coalesce from 029, `needed = g.needed or excluded.needed`, `times_added + 1`. When `p_target = 'stock'` it then merges a lot, and that lot insert is what makes the item in stock. `in_stock` is never written by this function — see the default change below. |
| `grocery_mark_bought(p_id, p_expires_on, p_estimate, p_quantity)` | Merges a lot and sets `needed = false`. **`p_set_expiry` is dropped**: it existed only to stop a null date clobbering the single expiry column, and there is nothing left to clobber. Migration 029's defect class disappears with it. |
| `grocery_set_needed(p_id, p_needed)` | Unchanged. |
| `grocery_finish(p_id, p_keep_on_list)` | Deletes every lot for the item; `needed = p_keep_on_list`. `in_stock` follows from the trigger. Same user-facing meaning as today: we are out of this. |
| `grocery_adjust_quantity(p_id, p_delta)` | Now FEFO across lots. See below. |
| `grocery_lot_extend(p_lot, p_expires_on, p_estimate)` | Replaces `grocery_extend_expiry`. "Still good" on one lot. |
| `grocery_lot_discard(p_lot, p_keep_on_list)` | New. "Gone" on one lot. |
| `grocery_lot_edit(p_lot, p_quantity, p_expires_on, p_estimate)` | New. The edit dialog's lot half. |
| `grocery_forget(p_id)` | Unchanged; lots go with the item by cascade. |

### The merge, written once

Every entry path (`grocery_upsert`, `grocery_mark_bought`, and the two lot writers when a date change
collides) uses the same conflict clause:

```sql
insert into public.grocery_lots as l (item_id, quantity, expires_on, expiry_is_estimate)
values (p_item, p_quantity, p_expires_on, p_expires_on is not null and p_estimate)
on conflict (item_id, expires_on) do update
  set quantity           = case when l.quantity is null and excluded.quantity is null then null
                                else coalesce(l.quantity, 0) + coalesce(excluded.quantity, 0) end,
      expiry_is_estimate = l.expiry_is_estimate and excluded.expiry_is_estimate;
```

Quantities add rather than replace — the current upsert's `coalesce(excluded.quantity, g.quantity)`
replaces, which is why buying a second carton today leaves the count at one. Both sides uncounted
stays uncounted; one side counted contributes what it knows.

`grocery_lot_extend` and `grocery_lot_edit` must route a date change through this same clause: moving
a lot onto a date the item already holds is a unique violation, and the right answer is to merge the
two lots, not to fail.

### FEFO on `grocery_adjust_quantity`

`p_delta < 0` takes from the soonest-expiring lot; `p_delta > 0` adds to the last-expiring one, since
a correction upward is most likely about what was just bought. Selection is
`order by expires_on asc nulls last, created_at asc` (reversed for the increment), under
`for update` on the lot rows — the read and the write share one transaction, per lesson L10, exactly
as the current single-row version does.

A lot reaching zero is deleted. When the deleted lot was the last one, the item goes out of stock via
the trigger and `needed` is set true — today's zero-crossing behaviour, unchanged, and still undoable
by hand from the shopping view.

The function still raises when the target lot has no count (`quantity is null`); the UI only offers
the stepper when every lot is counted, so this stays the guard it is today rather than a reachable
path.

## Derived item state

The page reads items and lots and derives, in a new pure module `src/app/groceries/lots.ts`:

| Field | Rule |
|---|---|
| `expiresOn` | `min(expires_on)` across lots, nulls last. Drives the existing pantry sort and the expired pill with no change to `sort.ts`. |
| `expiryIsEstimate` | The flag of the lot that won `expiresOn`. |
| `quantity` | `sum(quantity)` when **every** lot has a count, otherwise null. |
| `lots` | Sorted soonest-first, nulls last, for the expanded row. |

The all-or-nothing quantity rule is the honest one: showing "2" for a counted lot of two beside an
uncounted lot claims knowledge the app does not have, and a stepper on that number would decrement a
fiction. Mixed state shows no count and no stepper, and resolves itself as soon as the other lot is
counted or cleared.

`lots.ts` is pure and separately unit-tested, which keeps this arithmetic out of `page.tsx` and out
of the components.

## Loading

`page.tsx` gains a second query rather than a PostgREST embedded select:

```ts
const { data: lotRows } = await supabase
  .from("grocery_lots")
  .select("id, item_id, quantity, expires_on, expiry_is_estimate, created_at")
  .in("item_id", itemIds);
```

`src/test/supabase-fake.ts` does not implement embedded joins (lesson L5), and `assertTaskAssignee`
already set the two-query precedent for the same reason. RLS still decides what comes back; the
`in` filter shapes it.

Archived items keep coming back for autocomplete and simply have no lots.

## UI

`docs/superpowers/specs/2026-09-06-grocery-list-design.md`'s colour rule is unchanged: expiry is
muted text, expired is the single amber `--color-warning-surface` pill, and the task deadline
danger/warning/success trio stays out of groceries.

**Pantry row, one lot** — identical to today. Name, category tag, date or expired pill, Still good,
stepper when counted, Need, row menu. Nothing about this feature is visible.

**Pantry row, two or more lots** — the summary line gains a lot count that expands the row
(`"2 lots"`, disclosure, `aria-expanded`). The collapsed row still shows the soonest date, so the old
onions keep nagging. Expanded, each lot is a line: date (or "no date"), count when it has one, and
its own **Still good** / **Gone**. Per-lot editing lives here; the item-level edit dialog keeps name
and category only.

**Expired sweep** — a section at the top of the pantry view listing every expired lot across all
items, each as `item name · date · Still good · Gone`. New component
`src/app/groceries/expired-sweep.tsx`, built from the same derived data, no extra query. This is the
answer to volume: after a shop, a week of stale lots clears from one screen instead of being hunted
row by row. It renders nothing when no lot is expired.

**Shopping row** — unchanged. The "have N" line reads the derived total.

**Touch targets** — every new control is 44px, and the e2e scan enumerates the expanded row and the
sweep rather than trusting the collapsed one (lesson: a green invariant test proves nothing about
surfaces it never visits).

## Actions

`src/app/groceries/actions.ts` keeps its shape — `requireUser`, `assertItemMember`, admin client,
`revalidatePath("/groceries")`.

- `markBought` loses its `p_set_expiry` reasoning and gets simpler: compute the shelf-life estimate,
  pass it, done.
- `extendExpiry` becomes `extendLot`, `editItem` splits into `editItem` (name, category) and
  `editLot` (quantity, date, estimate), and `discardLot` is new.
- A new `assertLotMember(lotId, authUserId)` mirrors `assertItemMember`: the lot id arrives from the
  network, so its item's workspace is read here rather than trusted (lesson L4).
- Schemas in `schemas.ts` follow one-to-one. `extendExpirySchema` becomes `extendLotSchema`; the
  narrowness that exists to avoid the stale-props lost update (L10) is preserved — lot functions name
  only the columns they write.

## Migration and deploy

Single migration `030_grocery_lots.sql`, in order: create table, index, constraints, RLS, trigger
function and trigger; backfill; drop columns and their constraints; replace the RPCs.

```sql
insert into public.grocery_lots (item_id, quantity, expires_on, expiry_is_estimate)
select id, quantity, expires_on, expiry_is_estimate
from public.grocery_items
where in_stock;
```

Every in-stock item becomes exactly one lot — including items with no date and no count, which become
the undated lot. Out-of-stock and archived items get none, which is what `in_stock` already says about
them. The backfill therefore cannot change what any row means.

Dry-run against dev inside `begin … rollback` before pushing; no local Postgres works on this
machine. `supabase db push` from the linked dev checkout, never out-of-band SQL (lesson L9).

**Accepted risk.** Migrations and the Vercel deploy both fire on push to `main`, so there is a short
window where a phone holding stale JS calls a signature that no longer exists and gets the generic
error toast. Two users, one household, and a reload fixes it. Shimming the old signatures for a
release is not worth the second code path.

## Tests

- `lots.test.ts` — derivation: soonest wins, nulls sort last, sum when all counted, null when mixed,
  estimate flag follows the winning lot.
- `actions.test.ts` — each action forwards the right RPC arguments; `assertLotMember` rejects a lot in
  another workspace. Clock frozen wherever an expected date is "N days from today" (lesson: a
  hardcoded future date rots).
- SQL, dry-run against dev: the merge adds quantities; `nulls not distinct` keeps one undated lot
  across two undated purchases; asserted beats estimate on merge; FEFO decrements the soonest lot;
  deleting the last lot flips `in_stock` and sets `needed`; each new constraint rejects what it
  should; the backfill produces one lot per in-stock item and none for the rest.
- `e2e/grocery.spec.ts` — the onions case end to end: buy, buy again with a different date, both lots
  present, collapsed row shows the soonest, sweep clears the expired one and the other survives. Plus
  the 44px scan on the expanded row and the sweep. Locators scope to something a suggestion chip can
  never satisfy, and seeded rows keep the `E2E ` marker with `ilike` teardown (lesson: the suggestion
  chip race).

## Out of scope

Purchase history and statistics; a trips entity (lots from one shop already share a `created_at`
date, which is free to group by if it is ever wanted); units on quantity; per-lot notes; moving a lot
between products; barcode scanning; anything else the 2026-09-06 spec already excludes.

## Rejected

- **Keep one row, add a rule that a later date never replaces an earlier one.** Twenty lines and it
  fixes the onions today. It cannot say how much of the old stock is left, and the third purchase has
  nowhere to go — the same design would be rebuilt within a month.
- **Two dates on the item, oldest and newest.** Same wall at the third purchase, and "the old one is
  gone" has no count to decrement.
- **Dated lots only, undated quantity left on the item.** Two homes for a count, and every read has
  to add them up. The merge rule makes the undated lot free.
- **Derive `in_stock` from a join instead of a trigger.** Rewrites both sorts, the view filters and
  the four-state model to save one trigger function.
- **A batch picker dialog on the stepper.** A dialog on the most-tapped control in the pantry is the
  step people skip — the same reasoning that rejected a dialog on the zero crossing.
- **Denormalising `workspace_id` onto the lot.** Buys a join, costs the cross-workspace consistency
  trigger class of bug.
