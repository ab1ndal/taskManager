"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { TabPill } from "@/app/tasks/tab-pill";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { PurchaseDialog } from "./purchase-dialog";
import { AddRow } from "./add-row";
import { categoryLabel } from "./categories";
import { PantryRow, ShoppingRow } from "./item-row";
import { searchPantry } from "./search";
import { groupByCategory, sortPantry, sortShopping, type SortMode } from "./sort";
import type { GroceryItem } from "./types";
import { useForegroundRefresh } from "./use-foreground-refresh";

/** Below this many rows a filter row is chrome, not help. */
const FILTER_THRESHOLD = 15;

/** Sort and filter pills share one look, so a selected filter reads as selected as clearly as a sort. */
function chipClass(selected: boolean) {
  return `shrink-0 inline-flex items-center min-h-11 px-3 rounded-full text-xs font-medium ${
    selected
      ? "bg-(--color-accent-subtle) text-(--color-accent-text)"
      : "text-(--color-text-secondary)"
  }`;
}

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
  const [purchase, setPurchase] = useState<GroceryItem | null>(null);
  const [sort, setSort] = useState<SortMode>("expiry");
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searching = view === "stock" && query.trim() !== "";

  useForegroundRefresh();

  // Archived rows — neither in stock nor needed — belong to autocomplete only, so both views
  // filter them out. They are still loaded, which is what makes suggestions work with no extra
  // round trip.
  const inView = useMemo(
    () => items.filter((item) => (view === "stock" ? item.inStock : item.needed)),
    [items, view],
  );

  const visible = useMemo(() => {
    const filtered = view === "stock" && category ? inView.filter((item) => item.category === category) : inView;

    return view === "stock" ? sortPantry(filtered, sort) : sortShopping(filtered);
  }, [inView, view, category, sort]);

  // Search runs over the already sorted list and keeps that order, so the chosen sort still holds.
  const results = useMemo(() => (searching ? searchPantry(visible, query) : null), [searching, visible, query]);

  const grouped = useMemo(
    () => (!category && !searching && view === "stock" && sort === "name" ? groupByCategory(visible) : null),
    [visible, category, searching, view, sort],
  );

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

      {view === "stock" && (inView.length > 0 || query !== "") && (
        <div role="search" className="px-3 pb-2">
          <div className="relative">
            <Search
              size={ICON_SECONDARY}
              strokeWidth={ICON_STROKE}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
            />
            {/* 16px text, or iOS zooms the page on focus. */}
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search pantry"
              placeholder="Search pantry"
              autoComplete="off"
              enterKeyHint="search"
              className="block w-full min-w-0 min-h-11 pl-9 pr-11 rounded-lg border border-(--color-border) bg-(--color-surface) text-base [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query !== "" && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-0 top-0 inline-flex items-center justify-center size-11 text-(--color-text-secondary)"
              >
                <X size={ICON_SECONDARY} strokeWidth={ICON_STROKE} />
              </button>
            )}
          </div>
        </div>
      )}

      {view === "stock" && (
        <div role="group" aria-label="Sort pantry" className="flex gap-2 px-3 pb-2">
          {(["expiry", "name"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={sort === mode}
              onClick={() => setSort(mode)}
              className={chipClass(sort === mode)}
            >
              {mode === "expiry" ? "By expiry" : "By name"}
            </button>
          ))}
        </div>
      )}

      {view === "stock" && showFilter && (
        <div role="group" aria-label="Filter by category" className="flex gap-2 px-3 pb-2 overflow-x-auto">
          <button
            type="button"
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
            className={chipClass(category === null)}
          >
            All
          </button>
          {categories.map((slug) => (
            <button
              key={slug}
              type="button"
              aria-pressed={category === slug}
              onClick={() => setCategory(slug)}
              className={chipClass(category === slug)}
            >
              {categoryLabel(slug)}
            </button>
          ))}
        </div>
      )}

      {purchase && <PurchaseDialog item={purchase} onClose={() => setPurchase(null)} />}

      {results && (
        <p aria-live="polite" className="sr-only">
          {results.exact.length + results.similar.length} matching items
        </p>
      )}

      {results ? (
        results.exact.length + results.similar.length === 0 ? (
          <p className="px-3 py-8 text-sm text-(--color-text-secondary)">
            No items match &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          <>
            <ul>
              {results.exact.map((item) => <PantryRow key={item.id} item={item} today={today} />)}
            </ul>
            {results.similar.length > 0 && (
              <>
                <h3 className="px-3 py-2 text-xs font-semibold text-(--color-text-secondary) uppercase tracking-wider">
                  Similar
                </h3>
                <ul>
                  {results.similar.map((item) => <PantryRow key={item.id} item={item} today={today} />)}
                </ul>
              </>
            )}
          </>
        )
      ) : visible.length === 0 ? (
        <p className="px-3 py-8 text-sm text-(--color-text-secondary)">
          {view === "stock"
            ? "Nothing tracked yet. Add what's in your kitchen."
            : "List is empty. Tap Need on anything in the pantry."}
        </p>
      ) : grouped ? (
        <ul>
          {grouped.map((group) => (
            <li key={group.category}>
              <h3 className="px-3 py-2 text-xs font-semibold text-(--color-text-secondary) uppercase tracking-wider">
                {categoryLabel(group.category)}
              </h3>
              <ul>
                {group.items.map((item) => (
                  <PantryRow key={item.id} item={item} today={today} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <ul>
          {visible.map((item) =>
            view === "stock" ? (
              <PantryRow key={item.id} item={item} today={today} />
            ) : (
              <ShoppingRow key={item.id} item={item} onPurchase={setPurchase} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
