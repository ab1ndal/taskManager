"use client";

import { useMemo, useState } from "react";

import { TabPill } from "@/app/tasks/tab-pill";
import { AddRow } from "./add-row";
import { categoryLabel } from "./categories";
import { PantryRow, ShoppingRow } from "./item-row";
import { sortPantry, sortShopping, type SortMode } from "./sort";
import type { GroceryItem } from "./types";
import { useForegroundRefresh } from "./use-foreground-refresh";

// Re-exported so the plan's stated interface still holds: GroceryItem moved to ./types (Task 8)
// because add-row.tsx and suggest.ts, both leaf modules this component depends on, needed it
// before this task existed.
export type { GroceryItem } from "./types";

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

  // Archived rows — neither in stock nor needed — belong to autocomplete only, so both views
  // filter them out. They are still loaded, which is what makes suggestions work with no extra
  // round trip.
  const inView = useMemo(
    () => items.filter((item) => (view === "stock" ? item.inStock : item.needed)),
    [items, view],
  );

  const visible = useMemo(() => {
    const filtered = category ? inView.filter((item) => item.category === category) : inView;

    return (view === "stock" ? sortPantry(filtered, sort) : sortShopping(filtered)) as GroceryItem[];
  }, [inView, view, category, sort]);

  const categories = useMemo(
    () => [...new Set(inView.map((item) => item.category))],
    [inView],
  );

  /**
   * The threshold reads the *unfiltered* count, and the bar stays up while a filter is active.
   *
   * Judging it by the filtered list traps the user: with twenty items, picking a category holding
   * three drops the count below the threshold, the whole bar — including "All" — disappears, and
   * the filter is still on with no way to clear it. A foreground refresh preserves that state, so
   * the list stays stuck until a manual reload.
   */
  const showFilter = category !== null || inView.length > FILTER_THRESHOLD;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex gap-2 px-3 py-2 overflow-x-auto">
        <TabPill href={`/groceries?${new URLSearchParams({ view: "buy", workspace: workspaceId })}`} label="Shopping list" matchKey="view" matchValue="buy" />
        <TabPill href={`/groceries?${new URLSearchParams({ view: "stock", workspace: workspaceId })}`} label="Pantry" matchKey="view" matchValue="stock" />
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

      {showFilter && (
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
