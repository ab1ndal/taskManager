# Grocery lots — per-purchase expiry — design

Status: implemented locally, 2026-09-07. Updated following review of repeated grocery trips,
optional expiry dates and quantities, and a shopping list without categories. Supersedes the
single-stock-row and shopping-category decisions in the 2026-09-06 grocery design.

## Product and purchase batches

A product owns its name, pantry category, shopping intention (`needed`) and suggestion history.
Each purchase creates a separate stock lot, called a **batch** in the UI. A batch owns its optional
positive integer quantity, optional expiry, estimate flag and recorded timestamp.

Two trips buying milk create two batches. Two packages from one trip with different dates also
create two batches. Matching expiry dates and missing dates never merge: a later correction must
still be able to change just one purchase. Unknown quantity means “some, uncounted”, never zero.

Example: buy 2 milk cartons expiring September 12, then 3 expiring September 20. Pantry shows Milk,
5, and September 12. Removing the old batch leaves 3 and September 20. Adding an uncounted,
undated batch preserves September 20, displays both batches and hides the aggregate count.

There is no trips entity or historical purchase ledger. `created_at` records when stock was entered;
it does not identify a trip. Backfilled stock inherits its product's original creation timestamp,
which is not a recovered purchase date. The UI therefore says “Added”. Depleted batches are deleted.
Units, fractional quantities, barcode scanning and per-batch categories remain out of scope.

## Data and authorization

Migration `030_grocery_lots.sql` creates `grocery_lots` with `id`, `item_id` (cascade on product
removal), `quantity`, `expires_on`, `expiry_is_estimate` and `created_at`. An item-id index supports
loading. There is deliberately no unique expiry index. Dates must be within 2020–2100; quantities
are null or positive; an estimate flag requires a date.

The three stock-detail columns move off `grocery_items`. Every existing in-stock product gets one
batch; out-of-stock products get none. The default of `in_stock` becomes false. A batch insert/delete
trigger synchronizes `in_stock` with batch existence. Product state-change timestamps retain their
existing trigger behavior.

Authenticated users read batches through parent workspace-membership RLS. Direct authenticated
product and batch writes are revoked. Server actions authenticate the user and authorize the
stored parent workspace before using the admin client. Batch actions resolve batch → product →
workspace; client-provided workspace claims are never accepted for that resolution.

RPCs are service-role-only security-definer functions with an empty search path. Every stock RPC
locks the parent product before reading or changing batches, including when it currently has none.
Upsert acquires that lock through its conflict update. Batch writers recheck existence after
acquiring the parent lock. No RPC moves a batch to another product.

## Stock operations

- `grocery_upsert`: retain normalized product identity and category when omitted; increment
  suggestion frequency. Shopping adds set needed without creating batches. Pantry adds insert a
  new batch without erasing existing shopping intention.
- `grocery_mark_bought`: insert a new batch and clear needed atomically. Accept quantity, date and
  estimate; remove the obsolete `p_set_expiry` argument.
- `grocery_finish`: delete every batch and set needed to the user's choice.
- `grocery_adjust_quantity`: require every batch to be counted. Decrement earliest expiry first,
  undated last, with creation time and id as stable tiebreakers. Larger decrements span batches;
  reaching or exceeding the total deletes all batches and requests replenishment. Increments are
  count corrections to the latest recorded purchase, not new purchases. Use Record purchase for
  newly bought stock, whose expiry may be earlier than existing stock.
- `grocery_lot_extend`: change only one batch's date and estimate flag.
- `grocery_lot_edit`: correct one batch's quantity and date; matching dates stay separate.
- `grocery_lot_discard`: delete one batch; request replenishment if the last batch goes and the caller
  asks to keep it on the list. Never clear an existing shopping intention when another batch survives.
- `grocery_set_needed` and `grocery_forget`: retain their meanings; forgetting cascades to batches.

## Loading and derived state

The page loads products, then batches filtered to those product ids, under the user's RLS client.
Empty product results skip the batch query. Either query failure reaches the retryable error screen.
Archived products still load for autocomplete.

`lots.ts` derives stock existence, earliest dated expiry and that batch's estimate flag. Total quantity
is the sum only if every batch is counted; otherwise it is unknown and the item stepper is hidden.
No batches means out of stock with no count or expiry. Batches sort by expiry, undated last, then
creation time and id. The module is pure and does not mutate query data.

## Pantry and purchase entry

Pantry rows show name, category, earliest expiry, count when known, Need and the item menu. A native
batch disclosure is available even for a single batch. Each expanded batch displays date or No expiry
date, quantity or Quantity unknown, Added date, Edit batch, Gone, and Still good when expired.

The pantry add form has optional purchase quantity/expiry fields. Bought on a shopping row opens
Record purchase. The pantry menu also offers Record purchase for later trips. Purchase entry offers
No expiry date (default), Enter expiry date, or Estimate from pantry category. Counts are optional.
Save and add another batch supports multiple dates for one product within a trip; its dialog is
owned by the page so removing the purchased shopping row does not close it prematurely.

Blank dates are preserved as undated stock. Explicit estimates use the stored pantry category when
one is not supplied. Printed dates are explicit; editing a count preserves an unchanged estimate.
Still good changes only the selected batch date using the category shelf life, falling back to seven
days. Estimates carry `~`; expired stock uses an amber pill, preserving grocery color conventions.

An Expired batches region above the pantry list displays every expired batch, independent of the
pantry category filter. Still good and Gone operate on that batch, so clearing old milk never removes
fresh milk. New controls are at least 44px tall and must fit both 393px and 402px iPhone widths.

## Shopping list

Shopping is alphabetical and has no category selector, tags, category filtering or category sorting.
Its editor changes name only and preserves the pantry category. Adding typed names or suggestions
does not change product category. “have N” uses the derived total when known. Shopping represents
what to buy; quantity entered in Record purchase represents what was actually bought.

## Validation and rollout

Unit tests cover derivation, quantity/date input contracts, product-versus-batch edit boundaries,
action RPC arguments, workspace authorization and shopping category removal. SQL assertions in
`supabase/tests/grocery_lots.sql` cover multiple trips, same-date/undated purchases, FEFO across
batches, expiry corrections, zero crossing, constraints, cascading deletion, grants and real RLS.
The action tests stub RPC responses rather than maintaining a second implementation of SQL in the
shared Supabase fake. Run `node supabase/tests/run-grocery-lots.mjs` against linked dev after migration
030; it also exercises two real connections concurrently decrementing stock and finishing versus
purchasing. It rolls back assertion data and cleans its uniquely scoped concurrency workspace.

Browser tests cover the existing grocery lifecycle, single-batch edits, repeated purchases with
separate dates, adding another batch after the shopping row disappears, expired-batch cleanup,
unknown totals and touch targets on the expanded pantry and sweep.

Dry-run SQL inside a transaction and roll back before applying through `supabase db push` to the
linked development project. Production receives migrations through the existing main-branch
workflow. The schema change removes columns and replaces RPC signatures, so the existing app build
and migration must be released together. The previously accepted deployment window remains: old
server builds can fail reads as well as writes until the matching deployment is serving; stale
phone JavaScript may require a reload. This local implementation does not publish production.
