# Shared Grocery List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/groceries`, one grocery list shared by every member of a household workspace, with a pantry view and a shopping-list view over a single table.

**Architecture:** One `grocery_items` table carrying two independent booleans (`in_stock`, `needed`) so an item can be owned and wanted at once; deleting archives the row so autocomplete has history and a re-add resurrects it. Every state transition goes through a `security definer` RPC, because the check constraints reject partial updates and two flows are read-then-write races. Server actions authorize with `requireUser()` plus a membership assertion read from the row, exactly as `src/app/board/actions.ts` does.

**Tech Stack:** Next.js 16 (App Router, server actions), TypeScript, Tailwind, Supabase Postgres, zod, lucide-react, Jest + Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-grocery-list-design.md`

## Global Constraints

- Migrations are files under `supabase/migrations/`, applied to dev with `supabase db push` and to production only through the `deploy-migrations` GitHub workflow. Never MCP, never the SQL editor (`tasks/lessons.md` L9).
- No local Postgres works on this machine. Verify SQL against the **dev** project (`mcdpiuiayfljzvnhtqto`) inside `begin … rollback`.
- Every `security definer` function lives in `public` (RPCs) or `private` (helpers), carries `set search_path = ''`, and schema-qualifies every reference (L1).
- RPC grants: `revoke execute … from public, anon, authenticated` then `grant execute … to service_role` (pattern: `supabase/migrations/018_board_column_rpcs.sql:94-97`).
- RLS policies carry `to authenticated` (pattern: migration 007, **not** 015).
- Every server action: `requireUser()` **and** an explicit authorization check for the named row. RLS is defence in depth only (L4).
- Category slugs: `produce, dairy, frozen, baked, pantry, spices, beverages, snacks, household`. No meat or seafood — both users are vegetarian.
- Timezone: `APP_TIME_ZONE` = `"America/Los_Angeles"` from `src/app/tasks/recurrence-time.ts`. Never `current_date` in SQL; the database session is UTC.
- Touch targets ≥ 44px. Grocery expiry must never use `--color-danger-*`; those tokens belong to task deadlines.
- Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx playwright test`.

---

### Task 1: Categories and expiry-date arithmetic

**Files:**
- Create: `src/app/groceries/categories.ts`
- Test: `src/app/groceries/categories.test.ts`

**Interfaces:**
- Consumes: `APP_TIME_ZONE` from `@/app/tasks/recurrence-time`.
- Produces: `GROCERY_CATEGORIES` (readonly array of `{ slug, label, position, shelfLifeDays }`), `CATEGORY_SLUGS: readonly string[]`, `type CategorySlug`, `categoryLabel(slug)`, `categoryPosition(slug)`, `localToday(now?)`, `addDays(date, days)`, `estimatedExpiry(slug, now?)`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/groceries/categories.test.ts
import {
  CATEGORY_SLUGS,
  addDays,
  categoryLabel,
  estimatedExpiry,
  localToday,
} from "./categories";

describe("categories", () => {
  it("has nine slugs and no meat or seafood", () => {
    expect(CATEGORY_SLUGS).toHaveLength(9);
    expect(CATEGORY_SLUGS).toContain("produce");
    expect(CATEGORY_SLUGS.join(" ")).not.toMatch(/meat|seafood|fish/);
  });

  it("labels a slug", () => {
    expect(categoryLabel("dairy")).toBe("Dairy & eggs");
  });
});

describe("localToday", () => {
  // 2026-09-06T01:30:00Z is 2026-09-05 18:30 Pacific. A UTC-based
  // toISOString().slice(0, 10) would answer "2026-09-06" — a day early, every
  // evening. This is the bug the helper exists to prevent.
  it("uses the Pacific calendar date, not UTC", () => {
    expect(localToday(new Date("2026-09-06T01:30:00Z"))).toBe("2026-09-05");
  });

  it("agrees with UTC during Pacific daytime", () => {
    expect(localToday(new Date("2026-09-06T18:00:00Z"))).toBe("2026-09-06");
  });
});

describe("addDays", () => {
  it("adds days without drifting across a DST boundary", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("rolls over a month end", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
  });
});

describe("estimatedExpiry", () => {
  it("returns a date for a category with a shelf life", () => {
    expect(estimatedExpiry("produce", new Date("2026-09-06T18:00:00Z"))).toBe("2026-09-13");
  });

  it("returns null for a category without one", () => {
    expect(estimatedExpiry("pantry", new Date("2026-09-06T18:00:00Z"))).toBeNull();
  });

  it("bases the estimate on the Pacific date", () => {
    expect(estimatedExpiry("baked", new Date("2026-09-06T01:30:00Z"))).toBe("2026-09-09");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/app/groceries/categories.test.ts`
Expected: FAIL — `Cannot find module './categories'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/groceries/categories.ts
import { APP_TIME_ZONE } from "@/app/tasks/recurrence-time";

/**
 * The grocery categories, and how long each kind of thing tends to last.
 *
 * `shelfLifeDays` is the estimate used when an item enters the pantry without a printed date —
 * produce and bread carry no label, and an undated row sorts last, which is backwards for the
 * fastest-spoiling thing in the kitchen. `null` means "this does not meaningfully expire", and
 * those items simply have no date.
 *
 * The slug list is duplicated in the `grocery_items_category` check constraint (migration 026).
 * The two must change together — the same arrangement `TAB20_SLUGS` has with
 * `board_columns_color_valid`, recorded in docs/db.md.
 *
 * There is deliberately no meat or seafood category: both users are vegetarian.
 */
export const GROCERY_CATEGORIES = [
  { slug: "produce", label: "Produce", position: 1, shelfLifeDays: 7 },
  { slug: "dairy", label: "Dairy & eggs", position: 2, shelfLifeDays: 10 },
  { slug: "baked", label: "Baked", position: 3, shelfLifeDays: 4 },
  { slug: "frozen", label: "Frozen", position: 4, shelfLifeDays: 180 },
  { slug: "pantry", label: "Pantry & dry goods", position: 5, shelfLifeDays: null },
  { slug: "spices", label: "Spices & condiments", position: 6, shelfLifeDays: null },
  { slug: "beverages", label: "Beverages", position: 7, shelfLifeDays: null },
  { slug: "snacks", label: "Snacks", position: 8, shelfLifeDays: null },
  { slug: "household", label: "Household", position: 9, shelfLifeDays: null },
] as const;

export type CategorySlug = (typeof GROCERY_CATEGORIES)[number]["slug"];

export const CATEGORY_SLUGS: readonly CategorySlug[] = GROCERY_CATEGORIES.map((c) => c.slug);

const bySlug = new Map(GROCERY_CATEGORIES.map((c) => [c.slug as string, c]));

export function categoryLabel(slug: string): string {
  return bySlug.get(slug)?.label ?? slug;
}

/** Sort position for the shopping view, which walks a store roughly in aisle order. */
export function categoryPosition(slug: string): number {
  return bySlug.get(slug)?.position ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Today's calendar date in the app's timezone, as `YYYY-MM-DD`.
 *
 * `toISOString().slice(0, 10)` is a UTC date and is a day ahead for the whole Pacific evening, so
 * every expiry comparison and prefill would be off by one after 5pm. `en-CA` formats as
 * `YYYY-MM-DD`, which is the shape `date` columns and `<input type="date">` both want.
 */
export function localToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Calendar arithmetic on a bare `YYYY-MM-DD` string.
 *
 * Done in UTC deliberately: these are calendar dates with no clock time, so adding 7 days must
 * always land on the same weekday-shifted date regardless of a DST transition in between. Doing it
 * with local `Date` mutation would shift by an hour across a boundary and can roll the date.
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`;
}

/** The prefilled expiry for a category, or null when that category does not expire. */
export function estimatedExpiry(slug: string, now: Date = new Date()): string | null {
  const shelfLife = bySlug.get(slug)?.shelfLifeDays ?? null;
  return shelfLife === null ? null : addDays(localToday(now), shelfLife);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/app/groceries/categories.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/app/groceries/categories.ts src/app/groceries/categories.test.ts
git commit -m "feat(groceries): add categories and timezone-safe expiry dates"
```

---

### Task 2: Sorting

**Files:**
- Create: `src/app/groceries/sort.ts`
- Test: `src/app/groceries/sort.test.ts`

**Interfaces:**
- Consumes: `categoryPosition` from `./categories`.
- Produces: `type SortMode = "expiry" | "name"`, `type SortableItem = { name: string; category: string; expiresOn: string | null }`, `sortPantry(items, mode)`, `sortShopping(items)`, `isExpired(expiresOn, today)`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/groceries/sort.test.ts
import { isExpired, sortPantry, sortShopping } from "./sort";

const item = (name: string, category: string, expiresOn: string | null = null) => ({
  name,
  category,
  expiresOn,
});

describe("sortPantry by expiry", () => {
  it("puts dated items first, soonest first, and undated last", () => {
    const sorted = sortPantry(
      [
        item("Rice", "pantry"),
        item("Milk", "dairy", "2026-09-12"),
        item("Spinach", "produce", "2026-09-07"),
      ],
      "expiry",
    );
    expect(sorted.map((i) => i.name)).toEqual(["Spinach", "Milk", "Rice"]);
  });

  it("breaks a date tie by name", () => {
    const sorted = sortPantry(
      [item("Yogurt", "dairy", "2026-09-10"), item("Apples", "produce", "2026-09-10")],
      "expiry",
    );
    expect(sorted.map((i) => i.name)).toEqual(["Apples", "Yogurt"]);
  });

  it("sorts undated items among themselves by name", () => {
    const sorted = sortPantry([item("Rice", "pantry"), item("Chana", "pantry")], "expiry");
    expect(sorted.map((i) => i.name)).toEqual(["Chana", "Rice"]);
  });
});

describe("sortPantry by name", () => {
  it("is case-insensitive and ignores expiry", () => {
    const sorted = sortPantry(
      [item("banana", "produce", "2026-09-30"), item("Apple", "produce", "2026-09-07")],
      "name",
    );
    expect(sorted.map((i) => i.name)).toEqual(["Apple", "banana"]);
  });
});

describe("sortShopping", () => {
  it("orders by category position then name", () => {
    const sorted = sortShopping([
      item("Soap", "household"),
      item("Bread", "baked"),
      item("Spinach", "produce"),
      item("Apples", "produce"),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(["Apples", "Spinach", "Bread", "Soap"]);
  });
});

describe("isExpired", () => {
  it("is true strictly before today", () => {
    expect(isExpired("2026-09-05", "2026-09-06")).toBe(true);
  });

  it("is false on the day itself", () => {
    expect(isExpired("2026-09-06", "2026-09-06")).toBe(false);
  });

  it("is false with no date", () => {
    expect(isExpired(null, "2026-09-06")).toBe(false);
  });
});

it("does not mutate its input", () => {
  const items = [item("B", "pantry"), item("A", "pantry")];
  sortPantry(items, "name");
  expect(items.map((i) => i.name)).toEqual(["B", "A"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/app/groceries/sort.test.ts`
Expected: FAIL — `Cannot find module './sort'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/groceries/sort.ts
import { categoryPosition } from "./categories";

export type SortMode = "expiry" | "name";

export type SortableItem = {
  name: string;
  category: string;
  expiresOn: string | null;
};

/** `YYYY-MM-DD` strings compare correctly as strings, which is why no Date is involved here. */
export function isExpired(expiresOn: string | null, today: string): boolean {
  return expiresOn !== null && expiresOn < today;
}

const byName = (a: SortableItem, b: SortableItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Pantry order.
 *
 * Expiry mode needs no separate "expired first" rule: an expired date is simply the earliest date,
 * so ascending order puts it on top for free. Undated items go last — no date means nothing is
 * urgent about them — and ties fall back to name so the order never shuffles between renders.
 */
export function sortPantry(items: readonly SortableItem[], mode: SortMode): SortableItem[] {
  const sorted = [...items];

  if (mode === "name") return sorted.sort(byName);

  return sorted.sort((a, b) => {
    if (a.expiresOn === null && b.expiresOn === null) return byName(a, b);
    if (a.expiresOn === null) return 1;
    if (b.expiresOn === null) return -1;
    if (a.expiresOn !== b.expiresOn) return a.expiresOn < b.expiresOn ? -1 : 1;
    return byName(a, b);
  });
}

/**
 * Shopping order: category position, then name.
 *
 * The shopping view holds no expiry data — `grocery_finish` clears the date on the way out of the
 * pantry — so the pantry's sort control is deliberately not offered here. Category position
 * approximates walking a store aisle by aisle.
 */
export function sortShopping(items: readonly SortableItem[]): SortableItem[] {
  return [...items].sort((a, b) => {
    const positions = categoryPosition(a.category) - categoryPosition(b.category);
    return positions !== 0 ? positions : byName(a, b);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/app/groceries/sort.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/app/groceries/sort.ts src/app/groceries/sort.test.ts
git commit -m "feat(groceries): add pantry and shopping sort orders"
```

---

### Task 3: Migration 026 — table, triggers, RLS

**Files:**
- Create: `supabase/migrations/026_grocery_items.sql`

**Interfaces:**
- Consumes: `private.is_workspace_member(uuid)` from migration 007/011.
- Produces: table `public.grocery_items`; triggers `grocery_items_touch_state`, `grocery_items_member_workspace`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/026_grocery_items.sql
--
-- A grocery list shared by every member of a workspace.
--
-- This is the first content table in the schema whose visibility is workspace membership rather
-- than a per-user assignment row: the list is shared property, and every member may read, add,
-- edit and delete any item in it. Tasks are unaffected — they still require task_assignments.
--
-- Two independent booleans rather than one state column, because an item can be owned and wanted
-- at the same time ("we have bananas and need more"). The four reachable combinations are:
--
--   in_stock  needed   meaning
--   --------  ------   -------------------------------------------
--   true      false    have it                     -> pantry view
--   true      true     have it, buy more           -> both views
--   false     true     out, on the list            -> shopping view
--   false     false    archived, history only      -> neither view
--
-- Archived rows are why there is no `check (in_stock or needed)`: "delete" archives, so a product
-- keeps one row forever, autocomplete can rank by times_added, and re-adding resurrects what we
-- already knew instead of opening a second row. public.grocery_forget does a real delete.

create table public.grocery_items (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  name                text not null,
  category            text not null default 'pantry',
  in_stock            boolean not null default true,
  needed              boolean not null default false,
  quantity            int null,
  expires_on          date null,
  expiry_is_estimate  boolean not null default false,
  times_added         int not null default 1,
  added_by_member_id  uuid null references public.workspace_members(id) on delete set null,
  created_at          timestamptz not null default now(),
  state_changed_at    timestamptz not null default now(),

  -- btrim, not length alone: '   ' is not a name, and 'Milk ' must not slip past the unique index
  -- below by hiding behind trailing whitespace. board_columns got this right in migration 015.
  constraint grocery_items_name_len      check (length(btrim(name)) between 1 and 100),
  -- Duplicated in src/app/groceries/categories.ts. The two change together; see docs/db.md.
  constraint grocery_items_category      check (category in ('produce','dairy','frozen','baked',
                                                'pantry','spices','beverages','snacks','household')),
  -- Quantity and expiry describe something you have. An out-of-stock row carries neither, which is
  -- what makes grocery_finish a five-column write rather than a flag flip.
  constraint grocery_items_qty_in_stock  check (in_stock or quantity is null),
  constraint grocery_items_qty_positive  check (quantity is null or quantity > 0),
  constraint grocery_items_expiry_stock  check (in_stock or expires_on is null),
  constraint grocery_items_estimate_date check (not expiry_is_estimate or expires_on is not null),
  -- A fat-fingered year would otherwise pin itself to the top of the expiry sort forever.
  constraint grocery_items_expiry_sane   check (expires_on is null or
                                                expires_on between date '2020-01-01'
                                                              and date '2100-01-01')
);

-- One row per product per workspace, matched case- and whitespace-insensitively. This is also the
-- conflict target public.grocery_upsert relies on, which is why it is an expression index and why
-- the upsert has to live in a function: PostgREST cannot name an expression index in on_conflict.
create unique index grocery_items_workspace_name_key
  on public.grocery_items (workspace_id, lower(btrim(name)));

-- state_changed_at answers "when did this become needed / get bought". A default alone would leave
-- it frozen at creation time, i.e. a column that lies. Only the two lifecycle flags count as a
-- state change; renaming an item or correcting its date does not.
create or replace function private.touch_grocery_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.state_changed_at := now();
  return new;
end;
$$;

create trigger grocery_items_touch_state
  before update on public.grocery_items
  for each row
  when ((old.in_stock, old.needed) is distinct from (new.in_stock, new.needed))
  execute function private.touch_grocery_state();

-- Member ids are workspace-scoped, so nothing else stops a Work member id being stamped on a
-- Household row. Same defect class private.assert_board_column_workspace solves in migration 015.
-- The message wording matches the "is not in workspace" fragment the actions forward to the user.
create or replace function private.assert_grocery_member_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  if new.added_by_member_id is null then
    return new;
  end if;

  select workspace_id into v_workspace
  from public.workspace_members
  where id = new.added_by_member_id;

  if v_workspace is distinct from new.workspace_id then
    raise exception 'member % is not in workspace %', new.added_by_member_id, new.workspace_id;
  end if;

  return new;
end;
$$;

create trigger grocery_items_member_workspace
  before insert or update of added_by_member_id, workspace_id on public.grocery_items
  for each row
  execute function private.assert_grocery_member_workspace();

-- RLS is defence in depth: the server actions use the service-role client and assert membership
-- themselves (tasks/lessons.md L4). `to authenticated` follows migration 007 rather than 015 —
-- 007 revoked `usage on schema private` from anon, so an anon evaluation of the helper would raise
-- 42501 instead of simply returning no rows.
alter table public.grocery_items enable row level security;

create policy "grocery_items_select" on public.grocery_items
  for select to authenticated
  using ( private.is_workspace_member(workspace_id) );

create policy "grocery_items_insert" on public.grocery_items
  for insert to authenticated
  with check ( private.is_workspace_member(workspace_id) );

create policy "grocery_items_update" on public.grocery_items
  for update to authenticated
  using ( private.is_workspace_member(workspace_id) )
  with check ( private.is_workspace_member(workspace_id) );

create policy "grocery_items_delete" on public.grocery_items
  for delete to authenticated
  using ( private.is_workspace_member(workspace_id) );
```

- [ ] **Step 2: Dry-run the migration against dev inside a rollback**

There is no local Postgres. Paste the whole migration into a transaction against the dev project, followed by the constraint probes below, then roll back. Every probe must raise:

```sql
begin;

-- (paste 026 here)

-- Reachable-state probes. Each of these must fail.
insert into public.grocery_items (workspace_id, name, category)
  values ('00000000-0000-0000-0000-000000000000', '   ', 'produce');            -- name_len
insert into public.grocery_items (workspace_id, name, in_stock, quantity)
  values ('00000000-0000-0000-0000-000000000000', 'Zero', true, 0);             -- qty_positive
insert into public.grocery_items (workspace_id, name, in_stock, needed, quantity)
  values ('00000000-0000-0000-0000-000000000000', 'Out', false, true, 2);       -- qty_in_stock
insert into public.grocery_items (workspace_id, name, in_stock, needed, expires_on)
  values ('00000000-0000-0000-0000-000000000000', 'Out2', false, true, date '2026-09-30');
                                                                               -- expiry_stock
insert into public.grocery_items (workspace_id, name, expiry_is_estimate)
  values ('00000000-0000-0000-0000-000000000000', 'Est', true);                -- estimate_date
insert into public.grocery_items (workspace_id, name, expires_on)
  values ('00000000-0000-0000-0000-000000000000', 'Far', date '9999-01-01');   -- expiry_sane

rollback;
```

- [ ] **Step 3: Verify the unique index is whitespace- and case-insensitive**

Run against dev inside `begin … rollback`, using a real workspace id from `select id from public.workspaces limit 1`:

```sql
begin;
insert into public.grocery_items (workspace_id, name) values ('<ws>', 'Milk');
insert into public.grocery_items (workspace_id, name) values ('<ws>', 'milk ');  -- must raise 23505
rollback;
```

Expected: the second insert fails with `23505` naming `grocery_items_workspace_name_key`.

- [ ] **Step 4: Verify RLS hides other workspaces**

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<an auth_user_id with no membership>","role":"authenticated"}';
select count(*) from public.grocery_items;   -- must be 0
rollback;
```

- [ ] **Step 5: Apply to dev and commit**

```bash
supabase db push
supabase migration list --linked   # local and remote columns must match
git add supabase/migrations/026_grocery_items.sql
git commit -m "feat(groceries): add grocery_items with member-scoped RLS"
```

---

### Task 4: Migration 027 — the transition RPCs

**Files:**
- Create: `supabase/migrations/027_grocery_rpcs.sql`

**Interfaces:**
- Consumes: `public.grocery_items` from Task 3.
- Produces: `public.grocery_upsert`, `public.grocery_set_needed`, `public.grocery_mark_bought`, `public.grocery_finish`, `public.grocery_adjust_quantity`, `public.grocery_forget` — each returning `public.grocery_items` except `grocery_forget`, which returns `void`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/027_grocery_rpcs.sql
--
-- Every grocery state transition, as a function.
--
-- Three reasons this is not a set of table writes from the client:
--
-- 1. The check constraints in 026 reject partial updates. Sending
--    `set in_stock = false, needed = true` violates grocery_items_qty_in_stock whenever a quantity
--    is set and grocery_items_expiry_stock whenever an expiry is, so "finished" is a five-column
--    write that has to happen in one statement.
-- 2. "Add to the list" is a check-then-insert race between two phones. The fix is
--    `on conflict … do update`, and the conflict target is an expression index, which PostgREST
--    cannot name — so the upsert must live here.
-- 3. The quantity stepper loses updates if it reads then writes. Nothing catches it, because the
--    losing value is perfectly valid. See tasks/lessons.md L10.
--
-- No function below calls current_date. These connections run in UTC, so current_date is already
-- tomorrow for the whole Pacific evening; the caller computes the local date (localToday() in
-- src/app/groceries/categories.ts) and passes it in.

-- Adds a product, or brings an existing one back.
--
-- p_target is 'stock' (we have it) or 'list' (we need it). The conflict branch is additive on
-- purpose: adding something to the list while it sits in the pantry sets `needed` and leaves
-- `in_stock` alone, which is the low-stock case, not an error.
create or replace function public.grocery_upsert(
  p_workspace  uuid,
  p_name       text,
  p_category   text,
  p_target     text,
  p_quantity   int     default null,
  p_expires_on date    default null,
  p_estimate   boolean default false,
  p_member     uuid    default null
)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.grocery_items;
  v_stock   boolean := p_target = 'stock';
begin
  if p_target not in ('stock', 'list') then
    raise exception 'p_target must be stock or list';
  end if;

  insert into public.grocery_items as g (
    workspace_id, name, category, in_stock, needed,
    quantity, expires_on, expiry_is_estimate, added_by_member_id
  )
  values (
    p_workspace, btrim(p_name), p_category, v_stock, not v_stock,
    case when v_stock then p_quantity end,
    case when v_stock then p_expires_on end,
    case when v_stock and p_expires_on is not null then p_estimate else false end,
    p_member
  )
  on conflict (workspace_id, lower(btrim(name))) do update
    set category           = excluded.category,
        in_stock           = g.in_stock or excluded.in_stock,
        needed             = g.needed or excluded.needed,
        quantity           = case when excluded.in_stock then excluded.quantity
                                  else g.quantity end,
        expires_on         = case when excluded.in_stock then excluded.expires_on
                                  else g.expires_on end,
        expiry_is_estimate = case when excluded.in_stock then excluded.expiry_is_estimate
                                  else g.expiry_is_estimate end,
        times_added        = g.times_added + 1
  returning * into v_row;

  return v_row;
end;
$$;

-- The one-tap Need toggle. Idempotent, so two phones tapping it converge instead of clobbering.
create or replace function public.grocery_set_needed(p_id uuid, p_needed boolean)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.grocery_items;
begin
  update public.grocery_items
     set needed = p_needed
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  return v_row;
end;
$$;

-- Bought: back into the pantry, off the list, expiry written in the same statement.
create or replace function public.grocery_mark_bought(
  p_id         uuid,
  p_expires_on date    default null,
  p_estimate   boolean default false
)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.grocery_items;
begin
  update public.grocery_items
     set in_stock           = true,
         needed             = false,
         expires_on         = p_expires_on,
         expiry_is_estimate = p_expires_on is not null and p_estimate
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  return v_row;
end;
$$;

-- Finished: five columns at once, which is the write the constraints reject piecemeal.
-- p_keep_on_list false leaves both flags false — archived, still there for autocomplete.
create or replace function public.grocery_finish(p_id uuid, p_keep_on_list boolean)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.grocery_items;
begin
  update public.grocery_items
     set in_stock           = false,
         needed             = p_keep_on_list,
         quantity           = null,
         expires_on         = null,
         expiry_is_estimate = false
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  return v_row;
end;
$$;

-- The stepper.
--
-- `for update` locks the single row so two concurrent decrements serialise and both land — the
-- plain read-then-write version loses one silently. The zero crossing runs inside this same call
-- rather than returning 1 and letting the client send a second write, which is exactly the split
-- lesson L10 records: the read and every write depending on it share one transaction.
--
-- Note this is a single-row lock, not the aggregate-query `for update` that migration 021 had to
-- undo.
create or replace function public.grocery_adjust_quantity(p_id uuid, p_delta int)
returns public.grocery_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity int;
  v_row      public.grocery_items;
begin
  select quantity into v_quantity
  from public.grocery_items
  where id = p_id
  for update;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;

  if v_quantity is null then
    raise exception 'grocery item % has no quantity to adjust', p_id;
  end if;

  if v_quantity + p_delta > 0 then
    update public.grocery_items
       set quantity = v_quantity + p_delta
     where id = p_id
    returning * into v_row;
  else
    -- Reaching zero *is* finishing. Out, and on the list, which is the overwhelmingly likely
    -- intent; the row stays on screen in the shopping view to undo by hand.
    update public.grocery_items
       set in_stock           = false,
           needed             = true,
           quantity           = null,
           expires_on         = null,
           expiry_is_estimate = false
     where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- A real delete, for a typo. The only path that loses history.
create or replace function public.grocery_forget(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.grocery_items where id = p_id;

  if not found then
    raise exception 'grocery item % not found', p_id;
  end if;
end;
$$;

revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from public;
revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from anon;
revoke execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) from authenticated;
grant  execute on function public.grocery_upsert(uuid, text, text, text, int, date, boolean, uuid) to service_role;

revoke execute on function public.grocery_set_needed(uuid, boolean) from public;
revoke execute on function public.grocery_set_needed(uuid, boolean) from anon;
revoke execute on function public.grocery_set_needed(uuid, boolean) from authenticated;
grant  execute on function public.grocery_set_needed(uuid, boolean) to service_role;

revoke execute on function public.grocery_mark_bought(uuid, date, boolean) from public;
revoke execute on function public.grocery_mark_bought(uuid, date, boolean) from anon;
revoke execute on function public.grocery_mark_bought(uuid, date, boolean) from authenticated;
grant  execute on function public.grocery_mark_bought(uuid, date, boolean) to service_role;

revoke execute on function public.grocery_finish(uuid, boolean) from public;
revoke execute on function public.grocery_finish(uuid, boolean) from anon;
revoke execute on function public.grocery_finish(uuid, boolean) from authenticated;
grant  execute on function public.grocery_finish(uuid, boolean) to service_role;

revoke execute on function public.grocery_adjust_quantity(uuid, int) from public;
revoke execute on function public.grocery_adjust_quantity(uuid, int) from anon;
revoke execute on function public.grocery_adjust_quantity(uuid, int) from authenticated;
grant  execute on function public.grocery_adjust_quantity(uuid, int) to service_role;

revoke execute on function public.grocery_forget(uuid) from public;
revoke execute on function public.grocery_forget(uuid) from anon;
revoke execute on function public.grocery_forget(uuid) from authenticated;
grant  execute on function public.grocery_forget(uuid) to service_role;
```

- [ ] **Step 2: Verify the transitions against dev inside a rollback**

```sql
begin;
-- <ws> is a real workspace id.
select id from public.grocery_upsert('<ws>', 'Bananas', 'produce', 'stock', 6, date '2026-09-13', true) \gset
-- finish clears quantity and expiry in one write, which a plain UPDATE could not do
select in_stock, needed, quantity, expires_on, expiry_is_estimate
from public.grocery_finish((select id from public.grocery_items where name = 'Bananas'), true);
-- expect: f, t, null, null, f
-- re-adding resurrects the same row and bumps times_added
select times_added from public.grocery_upsert('<ws>', 'bananas ', 'produce', 'stock', 3, null, false);
-- expect: 2
select count(*) from public.grocery_items where workspace_id = '<ws>' and lower(name) = 'bananas';
-- expect: 1
rollback;
```

- [ ] **Step 3: Verify the concurrent decrement (the L10 regression test)**

Two psql sessions against dev. Session A holds a transaction open so B must block on the row lock; both decrements must land.

```sql
-- session A
begin;
select id from public.grocery_upsert('<ws>', 'E2E Bananas', 'produce', 'stock', 3, null, false);
commit;

begin;
select public.grocery_adjust_quantity('<id>', -1);   -- leaves 2, transaction still open

-- session B (blocks here until A commits)
select public.grocery_adjust_quantity('<id>', -1);

-- session A
commit;
```

Expected: after both commit, `quantity` is 1 — not 2. Then run one more decrement in each session against `quantity = 1` and confirm the row ends `in_stock = false, needed = true, quantity = null` and that the finish transition ran once.

- [ ] **Step 4: Apply to dev and commit**

```bash
supabase db push
supabase migration list --linked
git add supabase/migrations/027_grocery_rpcs.sql
git commit -m "feat(groceries): add transition RPCs with an atomic zero crossing"
```

---

### Task 5: Input schemas and RPC error mapping

**Files:**
- Create: `src/app/groceries/schemas.ts`, `src/app/groceries/rpc-errors.ts`
- Test: `src/app/groceries/schemas.test.ts`, `src/app/groceries/rpc-errors.test.ts`

**Interfaces:**
- Consumes: `CATEGORY_SLUGS` from `./categories`; `z` from zod.
- Produces: `addGroceryItemSchema`, `setNeededSchema`, `markBoughtSchema`, `finishItemSchema`, `adjustQuantitySchema`, `editItemSchema`, `forgetItemSchema` and their `…Input` types; `knownGroceryRpcFailure(message): string | null`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/groceries/schemas.test.ts
import { addGroceryItemSchema, adjustQuantitySchema, editItemSchema } from "./schemas";

const workspaceId = "11111111-1111-4111-8111-111111111111";

describe("addGroceryItemSchema", () => {
  it("accepts a minimal item and trims the name", () => {
    const parsed = addGroceryItemSchema.parse({
      workspaceId,
      name: "  Oat milk ",
      category: "dairy",
      target: "list",
    });
    expect(parsed.name).toBe("Oat milk");
  });

  it("rejects a whitespace-only name", () => {
    expect(addGroceryItemSchema.safeParse({
      workspaceId, name: "   ", category: "dairy", target: "list",
    }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(addGroceryItemSchema.safeParse({
      workspaceId, name: "Chicken", category: "meat", target: "list",
    }).success).toBe(false);
  });

  it("rejects a quantity of zero", () => {
    expect(addGroceryItemSchema.safeParse({
      workspaceId, name: "Eggs", category: "dairy", target: "stock", quantity: 0,
    }).success).toBe(false);
  });

  it("rejects an expiry that is not a calendar date", () => {
    expect(addGroceryItemSchema.safeParse({
      workspaceId, name: "Milk", category: "dairy", target: "stock",
      expiresOn: "2026-09-12T00:00:00Z",
    }).success).toBe(false);
  });
});

describe("adjustQuantitySchema", () => {
  it("accepts -1 and 1", () => {
    expect(adjustQuantitySchema.safeParse({ itemId: workspaceId, delta: -1 }).success).toBe(true);
    expect(adjustQuantitySchema.safeParse({ itemId: workspaceId, delta: 1 }).success).toBe(true);
  });

  it("rejects a delta of zero", () => {
    expect(adjustQuantitySchema.safeParse({ itemId: workspaceId, delta: 0 }).success).toBe(false);
  });
});

describe("editItemSchema", () => {
  it("allows clearing the expiry with null", () => {
    const parsed = editItemSchema.parse({
      itemId: workspaceId, name: "Milk", category: "dairy", expiresOn: null, quantity: null,
    });
    expect(parsed.expiresOn).toBeNull();
  });
});
```

```typescript
// src/app/groceries/rpc-errors.test.ts
import { knownGroceryRpcFailure } from "./rpc-errors";

it("forwards a message the migration raises", () => {
  expect(knownGroceryRpcFailure("grocery item abc not found")).toBe("grocery item abc not found");
  expect(knownGroceryRpcFailure("grocery item abc has no quantity to adjust")).not.toBeNull();
  expect(knownGroceryRpcFailure("member m is not in workspace w")).not.toBeNull();
  expect(knownGroceryRpcFailure("p_target must be stock or list")).not.toBeNull();
});

it("withholds anything we did not author", () => {
  expect(knownGroceryRpcFailure('relation "grocery_items" does not exist')).toBeNull();
  expect(knownGroceryRpcFailure("permission denied for schema private")).toBeNull();
  expect(
    knownGroceryRpcFailure('new row violates check constraint "grocery_items_qty_positive"'),
  ).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/app/groceries/schemas.test.ts src/app/groceries/rpc-errors.test.ts`
Expected: FAIL — both modules missing

- [ ] **Step 3: Write the implementations**

```typescript
// src/app/groceries/schemas.ts
import { z } from "zod";

import { CATEGORY_SLUGS } from "./categories";

/**
 * Input contracts for the grocery server actions.
 *
 * Actions are public endpoints: arguments arrive from the network, so the form's own checks are
 * convenience. These schemas are the boundary, and the client imports the same ones so the two can
 * never disagree. Mirrors src/app/tasks/schemas.ts.
 */

const uuid = z.uuid("Expected a UUID");

const name = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(100, "Name must be 100 characters or fewer");

const category = z.enum(CATEGORY_SLUGS as unknown as [string, ...string[]], {
  message: "Pick one of the listed categories",
});

/** Bare calendar dates only. `date` columns hold no clock time and neither does an estimate. */
const expiresOn = z.iso.date("Expiry must be in YYYY-MM-DD format");

const quantity = z
  .number()
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be at least 1")
  .max(999, "Quantity must be 999 or fewer");

export const addGroceryItemSchema = z.object({
  workspaceId: uuid,
  name,
  category,
  /** 'stock' puts it in the pantry, 'list' puts it on the shopping list. */
  target: z.enum(["stock", "list"]),
  quantity: quantity.nullish(),
  expiresOn: expiresOn.nullish(),
});

export const setNeededSchema = z.object({ itemId: uuid, needed: z.boolean() });

export const markBoughtSchema = z.object({
  itemId: uuid,
  /** Omitted means "use the category's shelf life"; null means "no expiry at all". */
  expiresOn: expiresOn.nullish(),
});

export const finishItemSchema = z.object({ itemId: uuid, keepOnList: z.boolean() });

export const adjustQuantitySchema = z.object({
  itemId: uuid,
  delta: z
    .number()
    .int("Delta must be a whole number")
    .refine((value) => value !== 0, "Delta must not be zero")
    .refine((value) => Math.abs(value) <= 99, "Delta must be 99 or fewer"),
});

export const editItemSchema = z.object({
  itemId: uuid,
  name,
  category,
  expiresOn: expiresOn.nullable(),
  quantity: quantity.nullable(),
});

export const forgetItemSchema = z.object({ itemId: uuid });

export type AddGroceryItemInput = z.input<typeof addGroceryItemSchema>;
export type SetNeededInput = z.input<typeof setNeededSchema>;
export type MarkBoughtInput = z.input<typeof markBoughtSchema>;
export type FinishItemInput = z.input<typeof finishItemSchema>;
export type AdjustQuantityInput = z.input<typeof adjustQuantitySchema>;
export type EditItemInput = z.input<typeof editItemSchema>;
export type ForgetItemInput = z.input<typeof forgetItemSchema>;
```

```typescript
// src/app/groceries/rpc-errors.ts
/**
 * The grocery RPC failures the caller is meant to see.
 *
 * Same reasoning as src/app/board/rpc-errors.ts: messages we wrote ourselves in migration 027 are
 * user-facing conditions and pass through, while anything else is an unexpected failure that goes
 * back through the generic path and is logged server-side. Forwarding Postgres's own text would
 * leak constraint names, casts and permission detail.
 *
 * Every fragment below was checked against 026/027 directly rather than remembered.
 */
const KNOWN_GROCERY_RPC_FAILURES = [
  // "grocery item % not found" — every RPC that takes an id (027)
  "not found",
  // grocery_adjust_quantity, when the row has no count to step (027)
  "has no quantity to adjust",
  // grocery_upsert's argument guard (027)
  "p_target must be stock or list",
  // private.assert_grocery_member_workspace (026)
  "is not in workspace",
] as const;

/** The message to show the user, or null when this is not a condition we authored. */
export function knownGroceryRpcFailure(message: string): string | null {
  return KNOWN_GROCERY_RPC_FAILURES.some((fragment) => message.includes(fragment))
    ? message
    : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/app/groceries/schemas.test.ts src/app/groceries/rpc-errors.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/app/groceries/schemas.ts src/app/groceries/schemas.test.ts \
        src/app/groceries/rpc-errors.ts src/app/groceries/rpc-errors.test.ts
git commit -m "feat(groceries): add input schemas and RPC error mapping"
```

---

### Task 6: Server actions

**Files:**
- Create: `src/app/groceries/actions.ts`
- Test: `src/app/groceries/actions.test.ts`
- Modify: `src/test/supabase-fake.ts` (add grocery RPC handlers to the `rpc` dispatcher at line 311)

**Interfaces:**
- Consumes: `run`, `assertNoError` from `@/app/tasks/action-run`; `parseInput`, `ValidationError` from `@/app/tasks/schemas`; `requireUser`, `assertWorkspaceMember`, `memberIdsForUser` from `@/lib/auth`; `createAdminClient` from `@/lib/supabase/admin`; schemas from `./schemas`; `estimatedExpiry`, `localToday` from `./categories`; `knownGroceryRpcFailure` from `./rpc-errors`.
- Produces: `addGroceryItem`, `setNeeded`, `markBought`, `finishItem`, `adjustQuantity`, `editItem`, `forgetItem` — all returning `ActionResult<{ itemId: string }>` except `forgetItem`, which returns `ActionResult`.

- [ ] **Step 1: Add grocery RPC handlers to the fake**

In `src/test/supabase-fake.ts`, inside the `rpc` function (after the existing `move_task_workspace` branch), add:

```typescript
      // Mirrors migration 027. These are the transitions the constraints in 026 would reject as
      // partial writes, so the fake applies the same whole-row effects the RPCs do.
      if (fnName.startsWith("grocery_")) {
        const rows = (tables.grocery_items ?? []) as Row[];
        tables.grocery_items = rows;
        const find = (id: unknown) => rows.find((r) => r.id === id);

        if (fnName === "grocery_upsert") {
          const wanted = String(params.p_name).trim().toLowerCase();
          const stock = params.p_target === "stock";
          const existing = rows.find(
            (r) =>
              r.workspace_id === params.p_workspace &&
              String(r.name).trim().toLowerCase() === wanted,
          );

          if (existing) {
            existing.category = params.p_category;
            existing.in_stock = Boolean(existing.in_stock) || stock;
            existing.needed = Boolean(existing.needed) || !stock;
            if (stock) {
              existing.quantity = params.p_quantity ?? null;
              existing.expires_on = params.p_expires_on ?? null;
              existing.expiry_is_estimate =
                params.p_expires_on != null && Boolean(params.p_estimate);
            }
            existing.times_added = Number(existing.times_added ?? 1) + 1;
            return { data: existing, error: null };
          }

          const row: Row = {
            id: `grocery-${rows.length + 1}`,
            workspace_id: params.p_workspace,
            name: String(params.p_name).trim(),
            category: params.p_category,
            in_stock: stock,
            needed: !stock,
            quantity: stock ? (params.p_quantity ?? null) : null,
            expires_on: stock ? (params.p_expires_on ?? null) : null,
            expiry_is_estimate:
              stock && params.p_expires_on != null && Boolean(params.p_estimate),
            times_added: 1,
            added_by_member_id: params.p_member ?? null,
          };
          rows.push(row);
          return { data: row, error: null };
        }

        const row = find(params.p_id);
        if (!row) {
          return { data: null, error: { message: `grocery item ${params.p_id} not found` } };
        }

        if (fnName === "grocery_set_needed") {
          row.needed = params.p_needed;
          return { data: row, error: null };
        }

        if (fnName === "grocery_mark_bought") {
          row.in_stock = true;
          row.needed = false;
          row.expires_on = params.p_expires_on ?? null;
          row.expiry_is_estimate = params.p_expires_on != null && Boolean(params.p_estimate);
          return { data: row, error: null };
        }

        if (fnName === "grocery_finish" || fnName === "grocery_adjust_quantity") {
          // The zero crossing lives inside grocery_adjust_quantity, so the fake has to model it
          // here too — a decrement to zero finishes the item rather than storing 0.
          if (fnName === "grocery_adjust_quantity") {
            if (row.quantity == null) {
              return {
                data: null,
                error: { message: `grocery item ${params.p_id} has no quantity to adjust` },
              };
            }
            const next = Number(row.quantity) + Number(params.p_delta);
            if (next > 0) {
              row.quantity = next;
              return { data: row, error: null };
            }
          }

          row.in_stock = false;
          row.needed = fnName === "grocery_finish" ? Boolean(params.p_keep_on_list) : true;
          row.quantity = null;
          row.expires_on = null;
          row.expiry_is_estimate = false;
          return { data: row, error: null };
        }

        if (fnName === "grocery_forget") {
          rows.splice(rows.indexOf(row), 1);
          return { data: null, error: null };
        }
      }
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/app/groceries/actions.test.ts
import type { Tables } from "@/test/supabase-fake";
import { createFakeSupabase } from "@/test/supabase-fake";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const ITEM = "grocery-1";

let fake: ReturnType<typeof createFakeSupabase>;

jest.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

function seed(extra: Tables = {}): Tables {
  return {
    workspace_members: [
      { id: "member-1", workspace_id: WORKSPACE, auth_user_id: "auth-user-1" },
      { id: "member-9", workspace_id: OTHER_WORKSPACE, auth_user_id: "auth-user-9" },
    ],
    grocery_items: [
      {
        id: ITEM,
        workspace_id: WORKSPACE,
        name: "Bananas",
        category: "produce",
        in_stock: true,
        needed: false,
        quantity: 3,
        expires_on: "2026-09-13",
        expiry_is_estimate: true,
        times_added: 1,
      },
    ],
    ...extra,
  };
}

describe("grocery actions", () => {
  beforeEach(() => {
    jest.resetModules();
    fake = createFakeSupabase({ tables: seed() });
  });

  it("adds an item with the category shelf life when no expiry is given", async () => {
    const { addGroceryItem } = await import("./actions");
    const result = await addGroceryItem({
      workspaceId: WORKSPACE,
      name: "Spinach",
      category: "produce",
      target: "stock",
    });

    expect(result.ok).toBe(true);
    const added = (fake.tables.grocery_items ?? []).find((r) => r.name === "Spinach");
    expect(added?.expires_on).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(added?.expiry_is_estimate).toBe(true);
  });

  it("does not estimate an expiry for a category without a shelf life", async () => {
    const { addGroceryItem } = await import("./actions");
    await addGroceryItem({
      workspaceId: WORKSPACE, name: "Rice", category: "pantry", target: "stock",
    });

    const added = (fake.tables.grocery_items ?? []).find((r) => r.name === "Rice");
    expect(added?.expires_on).toBeNull();
    expect(added?.expiry_is_estimate).toBe(false);
  });

  it("adds to the shopping list without an expiry", async () => {
    const { addGroceryItem } = await import("./actions");
    await addGroceryItem({
      workspaceId: WORKSPACE, name: "Coriander", category: "produce", target: "list",
    });

    const added = (fake.tables.grocery_items ?? []).find((r) => r.name === "Coriander");
    expect(added).toMatchObject({ in_stock: false, needed: true, expires_on: null });
  });

  it("refuses a workspace the user does not belong to", async () => {
    const { addGroceryItem } = await import("./actions");
    const result = await addGroceryItem({
      workspaceId: OTHER_WORKSPACE, name: "Soap", category: "household", target: "list",
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Forbidden") });
    expect(fake.tables.grocery_items).toHaveLength(1);
  });

  it("refuses an item in another workspace, reading the workspace from the row", async () => {
    fake = createFakeSupabase({
      tables: seed({
        grocery_items: [
          { id: "grocery-x", workspace_id: OTHER_WORKSPACE, name: "Secret", category: "pantry",
            in_stock: true, needed: false, quantity: null, expires_on: null,
            expiry_is_estimate: false, times_added: 1 },
        ],
      }),
    });
    const { setNeeded } = await import("./actions");
    const result = await setNeeded({ itemId: "grocery-x", needed: true });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Forbidden") });
    expect(fake.tables.grocery_items?.[0].needed).toBe(false);
  });

  it("finishing clears quantity and expiry and keeps it on the list", async () => {
    const { finishItem } = await import("./actions");
    const result = await finishItem({ itemId: ITEM, keepOnList: true });

    expect(result.ok).toBe(true);
    expect(fake.tables.grocery_items?.[0]).toMatchObject({
      in_stock: false, needed: true, quantity: null, expires_on: null, expiry_is_estimate: false,
    });
  });

  it("finishing without keeping it archives the row rather than deleting it", async () => {
    const { finishItem } = await import("./actions");
    await finishItem({ itemId: ITEM, keepOnList: false });

    expect(fake.tables.grocery_items).toHaveLength(1);
    expect(fake.tables.grocery_items?.[0]).toMatchObject({ in_stock: false, needed: false });
  });

  it("stepping down to zero finishes the item instead of storing zero", async () => {
    const { adjustQuantity } = await import("./actions");
    await adjustQuantity({ itemId: ITEM, delta: -1 });
    await adjustQuantity({ itemId: ITEM, delta: -1 });
    expect(fake.tables.grocery_items?.[0].quantity).toBe(1);

    await adjustQuantity({ itemId: ITEM, delta: -1 });
    expect(fake.tables.grocery_items?.[0]).toMatchObject({
      in_stock: false, needed: true, quantity: null,
    });
  });

  it("marking bought returns it to the pantry with an estimated expiry", async () => {
    fake.tables.grocery_items![0] = {
      ...fake.tables.grocery_items![0], in_stock: false, needed: true,
      quantity: null, expires_on: null, expiry_is_estimate: false,
    };
    const { markBought } = await import("./actions");
    await markBought({ itemId: ITEM });

    expect(fake.tables.grocery_items?.[0]).toMatchObject({
      in_stock: true, needed: false, expiry_is_estimate: true,
    });
  });

  it("forgetting deletes the row", async () => {
    const { forgetItem } = await import("./actions");
    await forgetItem({ itemId: ITEM });
    expect(fake.tables.grocery_items).toHaveLength(0);
  });

  it("rejects invalid input before touching the database", async () => {
    const { addGroceryItem } = await import("./actions");
    const result = await addGroceryItem({
      workspaceId: WORKSPACE, name: "   ", category: "produce", target: "list",
    });

    expect(result.ok).toBe(false);
    expect(fake.tables.grocery_items).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/app/groceries/actions.test.ts`
Expected: FAIL — `Cannot find module './actions'`

- [ ] **Step 4: Write the implementation**

```typescript
// src/app/groceries/actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { assertWorkspaceMember, memberIdsForUser, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/tasks/action-result";
import { assertNoError, run } from "@/app/tasks/action-run";
import { parseInput, ValidationError } from "@/app/tasks/schemas";
import { estimatedExpiry } from "./categories";
import { knownGroceryRpcFailure } from "./rpc-errors";
import {
  addGroceryItemSchema,
  adjustQuantitySchema,
  editItemSchema,
  finishItemSchema,
  forgetItemSchema,
  markBoughtSchema,
  setNeededSchema,
  type AddGroceryItemInput,
  type AdjustQuantityInput,
  type EditItemInput,
  type FinishItemInput,
  type ForgetItemInput,
  type MarkBoughtInput,
  type SetNeededInput,
} from "./schemas";

/**
 * Grocery items are shared by workspace membership rather than assigned per user, so authorization
 * is "are you in this workspace" for every operation — read, write and delete alike. The item id
 * arrives from the network, so the workspace it belongs to is read here rather than trusted from
 * the caller. Same shape as assertColumnMember in src/app/board/actions.ts.
 */
async function assertItemMember(
  itemId: string,
  authUserId: string,
): Promise<{ workspaceId: string; category: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grocery_items")
    .select("workspace_id, category")
    .eq("id", itemId)
    .maybeSingle();

  assertNoError("load grocery item", { error });
  if (!data) throw new Error(`grocery item ${itemId} not found`);

  const workspaceId = data.workspace_id as string;
  await assertWorkspaceMember(workspaceId, authUserId);

  return { workspaceId, category: data.category as string };
}

/**
 * A unique-violation on grocery_items_workspace_name_key means this workspace already has a row
 * for that product — possibly an archived one the user cannot see, which is why the message says
 * where to look rather than just "already used".
 */
function assertNoNameCollision(
  step: string,
  { error }: { error: { message: string; code?: string } | null },
): void {
  if (!error) return;
  if (error.code === "23505") {
    throw new ValidationError(
      { name: ["You already have an item with that name — check the other list"] },
      "You already have an item with that name — check the other list",
    );
  }
  throw new Error(`${step}: ${error.message}`);
}

/** Turns an RPC failure into a user-facing message when we authored it, or rethrows. */
function assertNoRpcError(step: string, { error }: { error: { message: string } | null }): void {
  if (!error) return;
  const known = knownGroceryRpcFailure(error.message);
  if (known) throw new ValidationError({}, known);
  throw new Error(`${step}: ${error.message}`);
}

/** The member row this user holds in the given workspace, for `added_by_member_id`. */
async function memberInWorkspace(
  workspaceId: string,
  authUserId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const memberIds = await memberIdsForUser(authUserId);
  if (memberIds.length === 0) return null;

  const { data, error } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  assertNoError("load member row", { error });
  return (data?.id as string) ?? null;
}

export async function addGroceryItem(
  input: AddGroceryItemInput,
): Promise<ActionResult<{ itemId: string }>> {
  return run("addGroceryItem", async () => {
    const { user } = await requireUser();
    const { workspaceId, name, category, target, quantity, expiresOn } = parseInput(
      addGroceryItemSchema,
      input,
    );
    await assertWorkspaceMember(workspaceId, user.id);

    // An item entering the pantry with no printed date gets the category's shelf life, flagged as
    // an estimate. Undated rows sort last, which is wrong for produce — the whole reason the
    // estimate exists. `expiresOn: null` means the caller explicitly wants no date.
    const estimate = target === "stock" && expiresOn === undefined;
    const resolvedExpiry = estimate ? estimatedExpiry(category) : (expiresOn ?? null);

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("grocery_upsert", {
      p_workspace: workspaceId,
      p_name: name,
      p_category: category,
      p_target: target,
      p_quantity: target === "stock" ? (quantity ?? null) : null,
      p_expires_on: resolvedExpiry,
      p_estimate: estimate && resolvedExpiry !== null,
      p_member: await memberInWorkspace(workspaceId, user.id),
    });

    assertNoNameCollision("add grocery item", error);
    assertNoRpcError("add grocery item", { error });

    revalidatePath("/groceries");
    return { itemId: (data as { id: string }).id };
  });
}

export async function setNeeded(input: SetNeededInput): Promise<ActionResult<{ itemId: string }>> {
  return run("setNeeded", async () => {
    const { user } = await requireUser();
    const { itemId, needed } = parseInput(setNeededSchema, input);
    await assertItemMember(itemId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_set_needed", { p_id: itemId, p_needed: needed });
    assertNoRpcError("set needed", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function markBought(
  input: MarkBoughtInput,
): Promise<ActionResult<{ itemId: string }>> {
  return run("markBought", async () => {
    const { user } = await requireUser();
    const { itemId, expiresOn } = parseInput(markBoughtSchema, input);
    const { category } = await assertItemMember(itemId, user.id);

    // Bought is how nearly everything enters the pantry, so the shelf-life estimate has to apply
    // here too — prefilling only on a manual add would leave the mechanism unused.
    const estimate = expiresOn === undefined;
    const resolvedExpiry = estimate ? estimatedExpiry(category) : (expiresOn ?? null);

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_mark_bought", {
      p_id: itemId,
      p_expires_on: resolvedExpiry,
      p_estimate: estimate && resolvedExpiry !== null,
    });
    assertNoRpcError("mark bought", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function finishItem(
  input: FinishItemInput,
): Promise<ActionResult<{ itemId: string }>> {
  return run("finishItem", async () => {
    const { user } = await requireUser();
    const { itemId, keepOnList } = parseInput(finishItemSchema, input);
    await assertItemMember(itemId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_finish", {
      p_id: itemId,
      p_keep_on_list: keepOnList,
    });
    assertNoRpcError("finish item", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function adjustQuantity(
  input: AdjustQuantityInput,
): Promise<ActionResult<{ itemId: string }>> {
  return run("adjustQuantity", async () => {
    const { user } = await requireUser();
    const { itemId, delta } = parseInput(adjustQuantitySchema, input);
    await assertItemMember(itemId, user.id);

    // The RPC does the arithmetic relative to the committed row and owns the zero crossing, so two
    // phones stepping the same item both land. Reading the count here and writing it back would
    // lose one of them (tasks/lessons.md L10).
    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_adjust_quantity", { p_id: itemId, p_delta: delta });
    assertNoRpcError("adjust quantity", { error });

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function editItem(input: EditItemInput): Promise<ActionResult<{ itemId: string }>> {
  return run("editItem", async () => {
    const { user } = await requireUser();
    const { itemId, name, category, expiresOn, quantity } = parseInput(editItemSchema, input);
    await assertItemMember(itemId, user.id);

    // Editing the descriptive columns is a plain update: none of them are part of a transition, so
    // there is no multi-column invariant for an RPC to protect. The constraints still apply.
    const admin = createAdminClient();
    const { error } = await admin
      .from("grocery_items")
      .update({
        name,
        category,
        expires_on: expiresOn,
        expiry_is_estimate: false,
        quantity,
      })
      .eq("id", itemId);

    assertNoNameCollision("edit grocery item", error);

    revalidatePath("/groceries");
    return { itemId };
  });
}

export async function forgetItem(input: ForgetItemInput): Promise<ActionResult> {
  return run("forgetItem", async () => {
    const { user } = await requireUser();
    const { itemId } = parseInput(forgetItemSchema, input);
    await assertItemMember(itemId, user.id);

    const admin = createAdminClient();
    const { error } = await admin.rpc("grocery_forget", { p_id: itemId });
    assertNoRpcError("forget item", { error });

    revalidatePath("/groceries");
    return {};
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/app/groceries/actions.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 6: Commit**

```bash
git add src/app/groceries/actions.ts src/app/groceries/actions.test.ts src/test/supabase-fake.ts
git commit -m "feat(groceries): add server actions over the transition RPCs"
```

---

### Task 7: Page, item rows, and the two views

**Files:**
- Create: `src/app/groceries/page.tsx`, `src/app/groceries/groceries-client.tsx`, `src/app/groceries/item-row.tsx`, `src/app/groceries/loading.tsx`, `src/app/groceries/error.tsx`
- Test: `src/app/groceries/groceries-client.test.tsx`, `src/app/groceries/item-row.test.tsx`

**Interfaces:**
- Consumes: `sortPantry`, `sortShopping`, `isExpired` from `./sort`; `categoryLabel`, `localToday`, `estimatedExpiry` from `./categories`; actions from `./actions`; `TabPill` from `@/app/tasks/tab-pill`; `RowMenu` from `@/components/row-menu`; `toast` from `@/components/toaster`; `ICON_SECONDARY`, `ICON_STROKE` from `@/components/icon`.
- Produces: `type GroceryItem = { id, name, category, inStock, needed, quantity, expiresOn, expiryIsEstimate, timesAdded }`, exported from `./groceries-client`; default-exported `GroceriesPage`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/app/groceries/item-row.test.tsx
import { render, screen } from "@testing-library/react";

import { PantryRow, ShoppingRow } from "./item-row";

const base = {
  id: "g1",
  name: "Spinach",
  category: "produce",
  inStock: true,
  needed: false,
  quantity: null as number | null,
  expiresOn: "2026-09-13",
  expiryIsEstimate: true,
  timesAdded: 1,
};

describe("PantryRow", () => {
  it("marks an estimated expiry with a tilde", () => {
    render(<PantryRow item={base} today="2026-09-06" />);
    expect(screen.getByText(/~/)).toBeInTheDocument();
  });

  it("shows a plain date when the expiry is known", () => {
    render(<PantryRow item={{ ...base, expiryIsEstimate: false }} today="2026-09-06" />);
    expect(screen.queryByText(/~/)).not.toBeInTheDocument();
  });

  it("labels an expired item and offers Still good", () => {
    render(<PantryRow item={{ ...base, expiresOn: "2026-09-01" }} today="2026-09-06" />);
    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /still good/i })).toBeInTheDocument();
  });

  it("shows a stepper only when the item has a count", () => {
    const { rerender } = render(<PantryRow item={base} today="2026-09-06" />);
    expect(screen.queryByRole("button", { name: /one fewer/i })).not.toBeInTheDocument();

    rerender(<PantryRow item={{ ...base, quantity: 6 }} today="2026-09-06" />);
    expect(screen.getByRole("button", { name: /one fewer/i })).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("reflects the Need state in the toggle", () => {
    render(<PantryRow item={{ ...base, needed: true }} today="2026-09-06" />);
    expect(screen.getByRole("button", { name: /need/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("ShoppingRow", () => {
  it("shows how many we already have when it is also in the pantry", () => {
    render(<ShoppingRow item={{ ...base, needed: true, inStock: true, quantity: 6 }} />);
    expect(screen.getByText("have 6")).toBeInTheDocument();
  });

  it("shows no quantity line when we have none", () => {
    render(<ShoppingRow item={{ ...base, needed: true, inStock: false, quantity: null }} />);
    expect(screen.queryByText(/^have /)).not.toBeInTheDocument();
  });

  it("names the bought control after the item", () => {
    render(<ShoppingRow item={{ ...base, needed: true, inStock: false }} />);
    expect(screen.getByRole("button", { name: /bought spinach/i })).toBeInTheDocument();
  });
});
```

```tsx
// src/app/groceries/groceries-client.test.tsx
import { render, screen } from "@testing-library/react";

import { GroceriesClient } from "./groceries-client";

const items = [
  { id: "g1", name: "Rice", category: "pantry", inStock: true, needed: false,
    quantity: null, expiresOn: null, expiryIsEstimate: false, timesAdded: 4 },
  { id: "g2", name: "Milk", category: "dairy", inStock: false, needed: true,
    quantity: null, expiresOn: null, expiryIsEstimate: false, timesAdded: 9 },
  { id: "g3", name: "Spinach", category: "produce", inStock: true, needed: true,
    quantity: null, expiresOn: "2026-09-07", expiryIsEstimate: true, timesAdded: 2 },
  { id: "g4", name: "Old thing", category: "pantry", inStock: false, needed: false,
    quantity: null, expiresOn: null, expiryIsEstimate: false, timesAdded: 1 },
];

const props = { workspaceId: "11111111-1111-4111-8111-111111111111", items, today: "2026-09-06" };

describe("GroceriesClient", () => {
  it("shows in-stock items in the pantry view, archived excluded", () => {
    render(<GroceriesClient {...props} view="stock" />);
    expect(screen.getByText("Rice")).toBeInTheDocument();
    expect(screen.getByText("Spinach")).toBeInTheDocument();
    expect(screen.queryByText("Milk")).not.toBeInTheDocument();
    expect(screen.queryByText("Old thing")).not.toBeInTheDocument();
  });

  it("shows needed items in the shopping view, including one we still have", () => {
    render(<GroceriesClient {...props} view="buy" />);
    expect(screen.getByText("Milk")).toBeInTheDocument();
    expect(screen.getByText("Spinach")).toBeInTheDocument();
    expect(screen.queryByText("Rice")).not.toBeInTheDocument();
  });

  it("offers the sort control in the pantry only", () => {
    const { rerender } = render(<GroceriesClient {...props} view="stock" />);
    expect(screen.getByRole("group", { name: /sort/i })).toBeInTheDocument();

    rerender(<GroceriesClient {...props} view="buy" />);
    expect(screen.queryByRole("group", { name: /sort/i })).not.toBeInTheDocument();
  });

  it("hides the category filter until a view gets long", () => {
    render(<GroceriesClient {...props} view="stock" />);
    expect(screen.queryByRole("group", { name: /filter/i })).not.toBeInTheDocument();
  });

  it("shows an empty state when a view has nothing", () => {
    render(<GroceriesClient {...props} items={[]} view="buy" />);
    expect(screen.getByText(/list is empty/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/app/groceries/item-row.test.tsx src/app/groceries/groceries-client.test.tsx`
Expected: FAIL — modules missing

- [ ] **Step 3: Write `item-row.tsx`**

```tsx
// src/app/groceries/item-row.tsx
"use client";

import { useTransition } from "react";
import { Check, Minus, Plus } from "lucide-react";

import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { RowMenu } from "@/components/row-menu";
import { toast } from "@/components/toaster";
import { adjustQuantity, editItem, finishItem, forgetItem, markBought, setNeeded } from "./actions";
import { addDays, categoryLabel } from "./categories";
import { isExpired } from "./sort";
import type { GroceryItem } from "./groceries-client";

const CATEGORY_TAG =
  "text-2xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-sunken)] " +
  "text-[var(--color-text-secondary)]";

/**
 * Grocery expiry deliberately avoids the danger/warning/success trio task-card.tsx uses for
 * deadlines: if a bag of spinach turns a row red, red stops meaning "this task is late". Expiry is
 * muted text, and the single loud state — expired — gets the amber surface only.
 */
function ExpiryLine({ item, today }: { item: GroceryItem; today: string }) {
  if (item.expiresOn === null) return null;

  const expired = isExpired(item.expiresOn, today);
  const label = `${item.expiryIsEstimate ? "~" : ""}${item.expiresOn}`;

  return (
    <span className="text-2xs text-[var(--color-text-muted)]">
      {expired ? (
        <span className="font-medium px-2 py-0.5 rounded-full bg-[var(--color-warning-surface)] text-[var(--color-warning-text)]">
          expired
        </span>
      ) : (
        label
      )}
    </span>
  );
}

export function PantryRow({ item, today }: { item: GroceryItem; today: string }) {
  const [pending, startTransition] = useTransition();

  const call = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (!result.ok && result.error) toast(result.error, "error");
    });

  return (
    <li className="flex items-center gap-3 min-h-11 px-3 py-2 border-b border-[var(--color-border)]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium break-words text-[var(--color-text-primary)]">
            {item.name}
          </span>
          <span className={CATEGORY_TAG}>{categoryLabel(item.category)}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <ExpiryLine item={item} today={today} />
          {item.expiresOn !== null && isExpired(item.expiresOn, today) && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                call(() =>
                  editItem({
                    itemId: item.id,
                    name: item.name,
                    category: item.category,
                    expiresOn: addDays(today, 7),
                    quantity: item.quantity,
                  }),
                )
              }
              className="min-h-11 text-2xs font-medium text-[var(--color-accent-text)]"
            >
              Still good
            </button>
          )}
          {item.quantity !== null && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`One fewer ${item.name}`}
                disabled={pending}
                onClick={() => call(() => adjustQuantity({ itemId: item.id, delta: -1 }))}
                className="inline-flex items-center justify-center size-11 rounded-full text-[var(--color-text-secondary)]"
              >
                <Minus size={ICON_SECONDARY} strokeWidth={ICON_STROKE} />
              </button>
              <span className="text-sm tabular-nums w-5 text-center">{item.quantity}</span>
              <button
                type="button"
                aria-label={`One more ${item.name}`}
                disabled={pending}
                onClick={() => call(() => adjustQuantity({ itemId: item.id, delta: 1 }))}
                className="inline-flex items-center justify-center size-11 rounded-full text-[var(--color-text-secondary)]"
              >
                <Plus size={ICON_SECONDARY} strokeWidth={ICON_STROKE} />
              </button>
            </span>
          )}
        </div>
      </div>

      {/* The low-stock gesture: one tap, no dialog. A dialog here is the step people skip. */}
      <button
        type="button"
        aria-pressed={item.needed}
        disabled={pending}
        onClick={() => call(() => setNeeded({ itemId: item.id, needed: !item.needed }))}
        className={`shrink-0 inline-flex items-center min-h-11 px-3 rounded-full text-xs font-medium ${
          item.needed
            ? "bg-[var(--color-accent)] text-[var(--color-text-on-accent)]"
            : "border border-[var(--color-border)] text-[var(--color-text-secondary)]"
        }`}
      >
        Need
      </button>

      <RowMenu
        label={`Actions for ${item.name}`}
        items={[
          {
            label: "Finished — add to list",
            onSelect: () => call(() => finishItem({ itemId: item.id, keepOnList: true })),
          },
          {
            label: "Finished — just remove",
            onSelect: () => call(() => finishItem({ itemId: item.id, keepOnList: false })),
          },
          {
            label: "Forget this item",
            destructive: true,
            onSelect: () => call(() => forgetItem({ itemId: item.id })),
          },
        ]}
      />
    </li>
  );
}

export function ShoppingRow({ item }: { item: GroceryItem }) {
  const [pending, startTransition] = useTransition();

  const call = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (!result.ok && result.error) toast(result.error, "error");
    });

  return (
    <li className="border-b border-[var(--color-border)]">
      <div className="flex items-center gap-3">
        {/* The whole row is the target, not just the circle: this is tapped one-handed in a shop. */}
        <button
          type="button"
          aria-label={`Bought ${item.name}`}
          disabled={pending}
          onClick={() => call(() => markBought({ itemId: item.id }))}
          className="flex-1 flex items-center gap-3 min-h-11 px-3 py-2 text-left"
        >
          <span className="shrink-0 inline-flex items-center justify-center size-6 rounded-full border border-[var(--color-control-idle)]">
            {pending && <Check size={ICON_SECONDARY} strokeWidth={ICON_STROKE} />}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium break-words text-[var(--color-text-primary)]">
                {item.name}
              </span>
              <span className={CATEGORY_TAG}>{categoryLabel(item.category)}</span>
            </span>
            {/* What the shopper actually wants at the shelf: how much is already at home. */}
            {item.inStock && item.quantity !== null && (
              <span className="block text-2xs text-[var(--color-text-muted)]">
                have {item.quantity}
              </span>
            )}
          </span>
        </button>

        <RowMenu
          label={`Actions for ${item.name}`}
          items={[
            {
              label: "Remove from list",
              onSelect: () => call(() => setNeeded({ itemId: item.id, needed: false })),
            },
            {
              label: "Forget this item",
              destructive: true,
              onSelect: () => call(() => forgetItem({ itemId: item.id })),
            },
          ]}
        />
      </div>
    </li>
  );
}
```

If `RowMenu`'s existing prop names differ from `label` / `items` / `onSelect` / `destructive`, read `src/components/row-menu.tsx` and match it exactly rather than changing that component.

- [ ] **Step 4: Write `groceries-client.tsx`**

```tsx
// src/app/groceries/groceries-client.tsx
"use client";

import { useMemo, useState } from "react";

import { TabPill } from "@/app/tasks/tab-pill";
import { AddRow } from "./add-row";
import { categoryLabel } from "./categories";
import { PantryRow, ShoppingRow } from "./item-row";
import { sortPantry, sortShopping, type SortMode } from "./sort";
import { useForegroundRefresh } from "./use-foreground-refresh";

export type GroceryItem = {
  id: string;
  name: string;
  category: string;
  inStock: boolean;
  needed: boolean;
  quantity: number | null;
  expiresOn: string | null;
  expiryIsEstimate: boolean;
  timesAdded: number;
};

/** Below this many rows a filter row is chrome, not help. */
const FILTER_THRESHOLD = 15;

export function GroceriesClient({
  workspaceId,
  items,
  view,
  today,
}: {
  workspaceId: string;
  items: GroceryItem[];
  view: "stock" | "buy";
  today: string;
}) {
  const [sort, setSort] = useState<SortMode>("expiry");
  const [category, setCategory] = useState<string | null>(null);

  useForegroundRefresh();

  const visible = useMemo(() => {
    // Archived rows — neither in stock nor needed — belong to autocomplete only, so both views
    // filter them out. They are still loaded, which is what makes suggestions work with no
    // extra round trip.
    const inView = items.filter((item) => (view === "stock" ? item.inStock : item.needed));
    const filtered = category ? inView.filter((item) => item.category === category) : inView;
    const sortable = filtered.map((item) => ({ ...item, expiresOn: item.expiresOn }));

    return (view === "stock" ? sortPantry(sortable, sort) : sortShopping(sortable)) as GroceryItem[];
  }, [items, view, category, sort]);

  const categories = useMemo(
    () => [...new Set(items.filter((i) => (view === "stock" ? i.inStock : i.needed)).map((i) => i.category))],
    [items, view],
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex gap-2 px-3 py-2 overflow-x-auto">
        <TabPill href="/groceries?view=buy" label="Shopping list" matchKey="view" matchValue="buy" />
        <TabPill href="/groceries?view=stock" label="Pantry" matchKey="view" matchValue="stock" />
      </div>

      <AddRow workspaceId={workspaceId} items={items} target={view === "stock" ? "stock" : "list"} />

      {view === "stock" && (
        <div role="group" aria-label="Sort pantry" className="flex gap-2 px-3 pb-2">
          {(["expiry", "name"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={sort === mode}
              onClick={() => setSort(mode)}
              className={`inline-flex items-center min-h-11 px-3 rounded-full text-xs font-medium ${
                sort === mode
                  ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"
                  : "text-[var(--color-text-secondary)]"
              }`}
            >
              {mode === "expiry" ? "By expiry" : "By name"}
            </button>
          ))}
        </div>
      )}

      {visible.length + (category ? 1 : 0) > FILTER_THRESHOLD && (
        <div role="group" aria-label="Filter by category" className="flex gap-2 px-3 pb-2 overflow-x-auto">
          <button
            type="button"
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
            className="shrink-0 inline-flex items-center min-h-11 px-3 rounded-full text-xs"
          >
            All
          </button>
          {categories.map((slug) => (
            <button
              key={slug}
              type="button"
              aria-pressed={category === slug}
              onClick={() => setCategory(slug)}
              className="shrink-0 inline-flex items-center min-h-11 px-3 rounded-full text-xs"
            >
              {categoryLabel(slug)}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="px-3 py-8 text-sm text-[var(--color-text-secondary)]">
          {view === "stock"
            ? "Nothing tracked yet. Add what's in your kitchen."
            : "List is empty. Tap Need on anything in the pantry."}
        </p>
      ) : (
        <ul>
          {visible.map((item) =>
            view === "stock" ? (
              <PantryRow key={item.id} item={item} today={today} />
            ) : (
              <ShoppingRow key={item.id} item={item} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `page.tsx`, `loading.tsx`, `error.tsx`**

```tsx
// src/app/groceries/page.tsx
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { localToday } from "./categories";
import { GroceriesClient, type GroceryItem } from "./groceries-client";

type SearchParams = Promise<{ view?: string; workspace?: string }>;

export default async function GroceriesPage({ searchParams }: { searchParams: SearchParams }) {
  const { view, workspace } = await searchParams;

  // One canonical view per URL, so the active tab pill is never ambiguous. Shopping is the default:
  // it is the view with a deadline attached, because someone is standing in a shop.
  if (view !== "stock" && view !== "buy") redirect("/groceries?view=buy");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS decides what comes back; the filters below shape the result rather than protect it.
  const { data: members } = user
    ? await supabase
        .from("workspace_members")
        .select("workspace_id, workspaces!inner(id, name, kind)")
        .eq("auth_user_id", user.id)
    : { data: [] };

  const households = (members ?? [])
    .map((m) => m.workspaces as unknown as { id: string; kind: string })
    .filter((w) => w.kind === "household");

  const workspaceId = workspace ?? households[0]?.id ?? null;

  if (!workspaceId) {
    return (
      <main className="mx-auto w-full max-w-2xl px-3 py-8">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Groceries live in a household workspace. Create one first.
        </p>
      </main>
    );
  }

  // Archived rows are loaded on purpose: they are the autocomplete history, and at a few hundred
  // rows for two people this is one query rather than a suggestions endpoint.
  const { data: rows } = await supabase
    .from("grocery_items")
    .select("id, name, category, in_stock, needed, quantity, expires_on, expiry_is_estimate, times_added")
    .eq("workspace_id", workspaceId);

  const items: GroceryItem[] = (rows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as string,
    inStock: row.in_stock as boolean,
    needed: row.needed as boolean,
    quantity: (row.quantity as number | null) ?? null,
    expiresOn: (row.expires_on as string | null) ?? null,
    expiryIsEstimate: row.expiry_is_estimate as boolean,
    timesAdded: row.times_added as number,
  }));

  return (
    <main className="pb-[env(safe-area-inset-bottom)]">
      <GroceriesClient
        workspaceId={workspaceId}
        items={items}
        view={view}
        today={localToday()}
      />
    </main>
  );
}
```

```tsx
// src/app/groceries/loading.tsx
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-3 py-4">
      {/* Fixed heights so the list does not shift when the real rows arrive. */}
      <div className="h-11 rounded-full bg-[var(--color-surface-sunken)]" />
      <div className="mt-3 space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-[var(--color-surface-sunken)]" />
        ))}
      </div>
    </main>
  );
}
```

```tsx
// src/app/groceries/error.tsx
"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-3 py-8">
      <p className="text-sm text-[var(--color-text-primary)]">The grocery list could not load.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-3 inline-flex items-center min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm font-medium"
      >
        Try again
      </button>
    </main>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/app/groceries/`
Expected: PASS (the two new suites plus the four from earlier tasks)

- [ ] **Step 7: Commit**

```bash
git add src/app/groceries/page.tsx src/app/groceries/groceries-client.tsx \
        src/app/groceries/item-row.tsx src/app/groceries/loading.tsx src/app/groceries/error.tsx \
        src/app/groceries/groceries-client.test.tsx src/app/groceries/item-row.test.tsx
git commit -m "feat(groceries): add the pantry and shopping views"
```

---

### Task 8: Add row with autocomplete

**Files:**
- Create: `src/app/groceries/add-row.tsx`, `src/app/groceries/suggest.ts`
- Test: `src/app/groceries/suggest.test.ts`, `src/app/groceries/add-row.test.tsx`

**Interfaces:**
- Consumes: `addGroceryItem` from `./actions`; `GROCERY_CATEGORIES` from `./categories`; `GroceryItem` from `./groceries-client`.
- Produces: `suggestNames(items, query, limit?)`; `AddRow({ workspaceId, items, target })`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/groceries/suggest.test.ts
import { suggestNames } from "./suggest";

const item = (name: string, timesAdded: number) => ({
  id: name,
  name,
  category: "pantry",
  inStock: false,
  needed: false,
  quantity: null,
  expiresOn: null,
  expiryIsEstimate: false,
  timesAdded,
});

const items = [item("Oat milk", 12), item("Oats, rolled", 3), item("Olive oil", 7), item("Rice", 1)];

it("ranks prefix matches by how often they have been added", () => {
  expect(suggestNames(items, "o").map((i) => i.name)).toEqual([
    "Oat milk",
    "Olive oil",
    "Oats, rolled",
  ]);
});

it("is case-insensitive and ignores surrounding space", () => {
  expect(suggestNames(items, "  OAT ").map((i) => i.name)).toEqual(["Oat milk", "Oats, rolled"]);
});

it("matches inside a name too, after prefix matches", () => {
  expect(suggestNames(items, "milk").map((i) => i.name)).toEqual(["Oat milk"]);
});

it("returns nothing for an empty query", () => {
  expect(suggestNames(items, "   ")).toEqual([]);
});

it("caps the list", () => {
  expect(suggestNames(items, "o", 2)).toHaveLength(2);
});
```

```tsx
// src/app/groceries/add-row.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";

import { AddRow } from "./add-row";

jest.mock("./actions", () => ({ addGroceryItem: jest.fn(async () => ({ ok: true, itemId: "g9" })) }));

const items = [
  { id: "g1", name: "Oat milk", category: "dairy", inStock: false, needed: false,
    quantity: null, expiresOn: null, expiryIsEstimate: false, timesAdded: 12 },
];

const props = { workspaceId: "11111111-1111-4111-8111-111111111111", items, target: "list" as const };

it("suggests a past item as you type", () => {
  render(<AddRow {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: /add an item/i }), { target: { value: "oat" } });
  expect(screen.getByRole("button", { name: /oat milk/i })).toBeInTheDocument();
});

it("submits the typed name and keeps focus for the next item", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} />);
  const input = screen.getByRole("textbox", { name: /add an item/i });

  fireEvent.change(input, { target: { value: "Coriander" } });
  fireEvent.submit(input.closest("form")!);

  expect(addGroceryItem).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Coriander", target: "list" }),
  );
  expect(input).toHaveFocus();
});

it("does not submit an empty name", async () => {
  const { addGroceryItem } = await import("./actions");
  render(<AddRow {...props} />);
  fireEvent.submit(screen.getByRole("textbox", { name: /add an item/i }).closest("form")!);
  expect(addGroceryItem).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/app/groceries/suggest.test.ts src/app/groceries/add-row.test.tsx`
Expected: FAIL — modules missing

- [ ] **Step 3: Write `suggest.ts`**

```typescript
// src/app/groceries/suggest.ts
import type { GroceryItem } from "./groceries-client";

/**
 * Name suggestions, drawn from the rows the page already loaded.
 *
 * Archived rows are included deliberately: the point is that "oat milk" typed a year ago comes
 * back rather than becoming "Oatmilk", and a re-add resurrects the original row through the unique
 * index. Ranked by times_added, because the thing bought most often is the thing being typed.
 *
 * No endpoint and no round trip — at a few hundred rows for two people, filtering an array the
 * page already has is both simpler and faster than asking the database.
 */
export function suggestNames(
  items: readonly GroceryItem[],
  query: string,
  limit = 6,
): GroceryItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  const scored = items
    .map((item) => {
      const name = item.name.toLowerCase();
      if (name.startsWith(needle)) return { item, rank: 0 };
      if (name.includes(needle)) return { item, rank: 1 };
      return null;
    })
    .filter((entry): entry is { item: GroceryItem; rank: number } => entry !== null);

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.item.timesAdded - a.item.timesAdded ||
      a.item.name.localeCompare(b.item.name),
  );

  return scored.slice(0, limit).map((entry) => entry.item);
}
```

- [ ] **Step 4: Write `add-row.tsx`**

```tsx
// src/app/groceries/add-row.tsx
"use client";

import { useRef, useState, useTransition } from "react";

import { toast } from "@/components/toaster";
import { addGroceryItem } from "./actions";
import { GROCERY_CATEGORIES } from "./categories";
import type { GroceryItem } from "./groceries-client";
import { suggestNames } from "./suggest";

/**
 * One field, Enter commits, focus stays.
 *
 * Adding five things in a shop should cost five names and nothing else, so category is a separate
 * optional control defaulting to Pantry and everything else is editable from the row afterwards.
 * A modal per item is the friction that makes someone text their partner instead.
 */
export function AddRow({
  workspaceId,
  items,
  target,
}: {
  workspaceId: string;
  items: GroceryItem[];
  target: "stock" | "list";
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("pantry");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = suggestNames(items, name);

  function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed === "") return;

    startTransition(async () => {
      const result = await addGroceryItem({
        workspaceId,
        name: trimmed,
        category,
        target,
      });

      if (!result.ok) {
        toast(result.error, "error");
        return;
      }

      setName("");
      inputRef.current?.focus();
    });
  }

  return (
    <div className="sticky top-0 z-10 bg-[var(--color-bg)] px-3 py-2 border-b border-[var(--color-border)]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(name);
        }}
        className="flex items-center gap-2"
      >
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Add an item"
          placeholder={target === "list" ? "Add to the list" : "Add to the pantry"}
          autoComplete="off"
          enterKeyHint="done"
          className="flex-1 min-h-11 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-base"
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Category"
          // WebKit ignores min-height on a menulist select, so the height is explicit. See
          // tasks/lessons.md.
          className="h-11 px-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
        >
          {GROCERY_CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending || name.trim() === ""}
          className="shrink-0 inline-flex items-center min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm font-medium disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {suggestions.length > 0 && (
        <ul className="mt-1 flex gap-2 overflow-x-auto">
          {suggestions.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  setCategory(item.category);
                  submit(item.name);
                }}
                className="shrink-0 inline-flex items-center min-h-11 px-3 rounded-full bg-[var(--color-surface-sunken)] text-xs"
              >
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/app/groceries/suggest.test.ts src/app/groceries/add-row.test.tsx`
Expected: PASS, 8 tests

- [ ] **Step 6: Commit**

```bash
git add src/app/groceries/add-row.tsx src/app/groceries/suggest.ts \
        src/app/groceries/suggest.test.ts src/app/groceries/add-row.test.tsx
git commit -m "feat(groceries): add a one-field add row with history suggestions"
```

---

### Task 9: Foreground refresh

**Files:**
- Create: `src/app/groceries/use-foreground-refresh.ts`
- Test: `src/app/groceries/use-foreground-refresh.test.tsx`

**Interfaces:**
- Consumes: `useRouter` from `next/navigation`.
- Produces: `useForegroundRefresh(intervalMs?)`, already wired into `GroceriesClient` in Task 7.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/groceries/use-foreground-refresh.test.tsx
import { render } from "@testing-library/react";
import { act } from "react";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { useForegroundRefresh } from "./use-foreground-refresh";

function Probe() {
  useForegroundRefresh(1000);
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useForegroundRefresh", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    refresh.mockClear();
    setVisibility("visible");
  });

  afterEach(() => jest.useRealTimers());

  it("refreshes on the interval while visible", () => {
    render(<Probe />);
    act(() => void jest.advanceTimersByTime(2100));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops while the page is hidden", () => {
    render(<Probe />);
    act(() => setVisibility("hidden"));
    act(() => void jest.advanceTimersByTime(5000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("resumes when the page becomes visible again", () => {
    render(<Probe />);
    act(() => setVisibility("hidden"));
    act(() => void jest.advanceTimersByTime(5000));
    act(() => setVisibility("visible"));
    act(() => void jest.advanceTimersByTime(1100));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clears its timer on unmount", () => {
    const { unmount } = render(<Probe />);
    unmount();
    act(() => void jest.advanceTimersByTime(5000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/app/groceries/use-foreground-refresh.test.tsx`
Expected: FAIL — `Cannot find module './use-foreground-refresh'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/groceries/use-foreground-refresh.ts
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the server component tree every 20 seconds while the grocery page is foregrounded.
 *
 * Both phones are looking at the same list, and the only freshness the app otherwise has is
 * ResumeRefresh's five-minute poll plus refresh-on-resume — long enough for two people in a shop
 * to buy the same milk. Twenty seconds is inside the time it takes to walk to the next aisle.
 *
 * Deliberately not Supabase Realtime: this repo has no realtime code, and a subscription would add
 * a publication to enable in two projects, a lifecycle to get right across iOS suspend/resume, and
 * a socket-drop failure mode. Revisit if 20 seconds proves too stale in practice.
 *
 * The timer only runs while the document is visible, so a backgrounded standalone app is not
 * polling, and it is cleared on unmount so leaving the page stops the work.
 */
export function useForegroundRefresh(intervalMs = 20_000): void {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => router.refresh(), intervalMs);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [router, intervalMs]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/app/groceries/use-foreground-refresh.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/app/groceries/use-foreground-refresh.ts src/app/groceries/use-foreground-refresh.test.tsx
git commit -m "feat(groceries): poll for changes while the page is foregrounded"
```

---

### Task 10: Navigation slot

**Files:**
- Modify: `src/components/nav-links.tsx:7-11`
- Test: `src/components/__tests__/nav-links.test.tsx` (create if absent; check the directory first)

**Interfaces:**
- Consumes: nothing new.
- Produces: a top nav of Tasks / Board / Groceries.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/__tests__/nav-links.test.tsx
import { render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({ usePathname: () => "/groceries" }));

import { NavLinks } from "../nav-links";

it("links to groceries and no longer to workspaces", () => {
  render(<NavLinks />);
  expect(screen.getByRole("link", { name: "Groceries" })).toHaveAttribute("href", "/groceries");
  expect(screen.queryByRole("link", { name: "Workspaces" })).not.toBeInTheDocument();
});

it("marks the current section", () => {
  render(<NavLinks />);
  expect(screen.getByRole("link", { name: "Groceries" })).toHaveAttribute("aria-current", "page");
});

it("keeps the bar to three destinations", () => {
  render(<NavLinks />);
  expect(screen.getAllByRole("link")).toHaveLength(3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/components/__tests__/nav-links.test.tsx`
Expected: FAIL — no Groceries link; Workspaces still present

- [ ] **Step 3: Make the change**

In `src/components/nav-links.tsx`, replace the `links` array:

```typescript
/**
 * Three destinations, deliberately.
 *
 * The bar's intrinsic width is ~355px on a 393px iPhone (see src/app/layout.tsx), and every link is
 * flex-shrink-0, so a fourth entry pushes "Sign out" into a second line and makes the page scroll
 * sideways — the defect tasks/lessons.md records. Groceries takes the slot rather than joining:
 * it is a weekly-or-daily destination, while /workspaces is a rare setup screen still reachable
 * from the /tasks sidebar and by URL.
 */
const links = [
  { href: "/tasks", label: "Tasks" },
  { href: "/board", label: "Board" },
  { href: "/groceries", label: "Groceries" },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/components/__tests__/nav-links.test.tsx`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/nav-links.tsx src/components/__tests__/nav-links.test.tsx
git commit -m "feat(groceries): put groceries in the top nav in place of workspaces"
```

---

### Task 11: End-to-end coverage

**Files:**
- Modify: `e2e/layout.spec.ts:11`
- Create: `e2e/grocery.spec.ts`

**Interfaces:**
- Consumes: the fixtures and seeded workspace in `e2e/fixtures.ts`.
- Produces: e2e coverage for the whole loop, on both phone projects and desktop.

- [ ] **Step 1: Add `/groceries` to the layout sweep**

In `e2e/layout.spec.ts`, extend `PAGES`:

```typescript
const PAGES = [
  "/tasks",
  "/workspaces",
  "/board",
  "/groceries?view=buy",
  "/groceries?view=stock",
  "/settings?tab=profile",
  "/settings?tab=board",
];
```

- [ ] **Step 2: Run the layout sweep and confirm the nav still fits**

Run: `npx playwright test e2e/layout.spec.ts --project=iphone --project=iphone-16-pro`
Expected: PASS — in particular the "does not scroll horizontally" and 44px checks on both new URLs. A failure here means the nav swap in Task 10 did not land.

- [ ] **Step 3: Write the flow spec**

```typescript
// e2e/grocery.spec.ts
import { expect, test } from "./fixtures";

// Seeded names carry the E2E marker so the scoped teardown can find them: the dev project is
// shared with everyday local work (tasks/lessons.md L14).
const ITEM = "E2E Bananas";

test.describe("grocery list", () => {
  test("walks a full loop: add, need, bought, finish, re-add", async ({ page }) => {
    await page.goto("/groceries?view=stock");

    // Add to the pantry. One field, Enter commits.
    await page.getByRole("textbox", { name: /add an item/i }).fill(ITEM);
    await page.getByRole("textbox", { name: /add an item/i }).press("Enter");
    await expect(page.getByText(ITEM)).toBeVisible();

    // Low stock: one tap puts it on the list while it stays in the pantry.
    const row = page.locator("li", { hasText: ITEM });
    await row.getByRole("button", { name: /need/i }).click();
    await expect(row.getByRole("button", { name: /need/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.goto("/groceries?view=buy");
    await expect(page.getByText(ITEM)).toBeVisible();

    // Bought returns it to the pantry and takes it off the list.
    await page.getByRole("button", { name: new RegExp(`bought ${ITEM}`, "i") }).click();
    await expect(page.getByText(ITEM)).toBeHidden();

    // Finished, keeping it on the list.
    await page.goto("/groceries?view=stock");
    await page.locator("li", { hasText: ITEM }).getByRole("button", { name: /actions/i }).click();
    await page.getByRole("menuitem", { name: /finished — add to list/i }).click();
    await expect(page.getByText(ITEM)).toBeHidden();

    await page.goto("/groceries?view=buy");
    await expect(page.getByText(ITEM)).toBeVisible();
  });

  test("re-adding an archived item resurrects one row rather than duplicating it", async ({
    page,
  }) => {
    await page.goto("/groceries?view=stock");
    const input = page.getByRole("textbox", { name: /add an item/i });

    await input.fill(ITEM);
    await input.press("Enter");
    await page.locator("li", { hasText: ITEM }).getByRole("button", { name: /actions/i }).click();
    await page.getByRole("menuitem", { name: /finished — just remove/i }).click();
    await expect(page.getByText(ITEM)).toBeHidden();

    // Different case and trailing space: the unique index is on lower(btrim(name)).
    await input.fill(`${ITEM.toLowerCase()} `);
    await input.press("Enter");
    await expect(page.locator("li", { hasText: new RegExp(ITEM, "i") })).toHaveCount(1);
  });

  test("the sort control appears in the pantry only", async ({ page }) => {
    await page.goto("/groceries?view=stock");
    await expect(page.getByRole("group", { name: /sort/i })).toBeVisible();

    await page.goto("/groceries?view=buy");
    await expect(page.getByRole("group", { name: /sort/i })).toBeHidden();
  });

  test("/groceries redirects to a canonical view", async ({ page }) => {
    await page.goto("/groceries");
    await expect(page).toHaveURL(/\/groceries\?view=buy/);
  });
});
```

- [ ] **Step 4: Extend the teardown to cover grocery rows**

In `e2e/fixtures.ts`, find `cleanupUiWrites()` and add a scoped delete alongside the existing marker-based deletes:

```typescript
  // Same rule as the task cleanup: seeded workspace plus marker, never looser. Groceries are
  // workspace-scoped rows, so both halves of that filter are available.
  await admin
    .from("grocery_items")
    .delete()
    .eq("workspace_id", workspaceId)
    .like("name", "E2E %");
```

Match the surrounding style and the way `workspaceId` and `admin` are already obtained in that function.

- [ ] **Step 5: Run the flow spec on both phones and desktop**

Run: `npx playwright test e2e/grocery.spec.ts`
Expected: PASS on every configured project. Run it twice in a row — a second green run proves the teardown actually removed the seeded rows, since the unique index would otherwise fail the re-add.

- [ ] **Step 6: Commit**

```bash
git add e2e/layout.spec.ts e2e/grocery.spec.ts e2e/fixtures.ts
git commit -m "test(groceries): cover the list loop end to end"
```

---

### Task 12: Documentation and full verification

**Files:**
- Modify: `docs/db.md`, `docs/product.md`, `tasks/todo.md`, `tasks/lessons.md` (only if something surprised you)

- [ ] **Step 1: Document the schema**

Add a `### grocery_items` section to `docs/db.md` in the style of the existing tables, covering: the column list; the four-state table from the spec; that archived rows exist for autocomplete and that `grocery_forget` is the only real delete; that the category slug list is duplicated in `src/app/groceries/categories.ts` and the two must change together; the two triggers and why `state_changed_at` needs one; and that every transition goes through the migration-027 RPCs, with the constraints acting as a backstop rather than an API.

- [ ] **Step 2: Document the product rule**

Add a `## Groceries` section to `docs/product.md` stating plainly that grocery visibility is **workspace membership**, not assignment — the one place the app departs from "you only see what is assigned to you" — and that every member may read, add, edit and delete any item. Describe the two views, the low-stock state, the estimate convention (`~` prefix, muted, never red), and that the shopping list is the default view.

- [ ] **Step 3: Run the full suite**

```bash
npm run typecheck
npm test
npm run lint
npm run build
npx playwright test
```

Expected: typecheck clean; every Jest suite green; lint with no errors; build succeeds; Playwright green on all five projects. Record the actual counts — do not paraphrase a failure as a pass.

- [ ] **Step 4: Update the task file**

In `tasks/todo.md`, replace the grocery entry with what shipped and what is left, and add anything discovered during execution that a future session must not rediscover. If any assumption in the spec turned out wrong, write the correction into `tasks/lessons.md` as its own lesson with the date.

- [ ] **Step 5: Commit**

```bash
git add docs/db.md docs/product.md tasks/todo.md tasks/lessons.md
git commit -m "docs(groceries): document the schema and the membership visibility rule"
```

---

## Plan self-review

**Spec coverage.** Schema and constraints → Task 3. Triggers → Task 3. RPCs and the atomic zero crossing → Task 4. Actions and authorization → Task 6. Categories, shelf life and timezone safety → Task 1. Sorting → Task 2. Two views, rows, colour discipline, empty states → Task 7. Add row and autocomplete → Task 8. Foreground poll → Task 9. Nav slot → Task 10. Tests at all three levels → Tasks 1-11. Docs → Task 12. The accepted membership exposure needs no task: it is a recorded decision, not work.

**Deliberately not built** (spec "Out of scope"): units, per-item notes, aisle ordering, purchase statistics, auto-reorder, barcode scanning, offline writes, Realtime.

**Type consistency.** `GroceryItem` is defined once in `groceries-client.tsx` and imported by `item-row.tsx`, `add-row.tsx` and `suggest.ts`. `SortableItem` in `sort.ts` is structurally a subset of it, which is why `GroceriesClient` can pass items straight through. Action names match between `actions.ts`, the row components and the tests: `addGroceryItem`, `setNeeded`, `markBought`, `finishItem`, `adjustQuantity`, `editItem`, `forgetItem`. RPC parameter names match between migration 027, the fake handlers in Task 6 Step 1, and the action bodies.

**Two things an executor must verify rather than assume.** `RowMenu`'s prop names (Task 7 Step 3 says to read the component and match it) and whether `src/components/__tests__/` already holds a `nav-links` test to extend instead of create.
