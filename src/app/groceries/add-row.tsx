"use client";

import { useRef, useState, useTransition } from "react";

import { toast } from "@/components/toaster";
import { addGroceryItem } from "./actions";
import { GROCERY_CATEGORIES, isCategorySlug, type CategorySlug } from "./categories";
import type { GroceryItem } from "./types";
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
  const [category, setCategory] = useState<CategorySlug>("pantry");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = suggestNames(items, name);

  /**
   * `categoryOverride` is not a convenience: picking a suggestion has to submit *that item's*
   * category, and `setCategory()` does not change the `category` binding this render already
   * closed over. Reading state here would submit the previous category, and because
   * grocery_upsert overwrites the column, a Dairy item re-added from a suggestion would silently
   * become Pantry — losing its shelf-life estimate for every future purchase.
   */
  function submit(value: string, categoryOverride?: CategorySlug) {
    const trimmed = value.trim();
    if (trimmed === "") return;

    startTransition(async () => {
      const result = await addGroceryItem({
        workspaceId,
        name: trimmed,
        category: categoryOverride ?? category,
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
          className="flex-1 min-w-0 min-h-11 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-base"
        />
        <select
          value={category}
          onChange={(event) => {
            if (isCategorySlug(event.target.value)) setCategory(event.target.value);
          }}
          aria-label="Category"
          // WebKit ignores min-height on a menulist select, so the height is explicit. See
          // tasks/lessons.md.
          // A native select renders at the width of its widest option ("Pantry & dry goods"),
          // which alone overflows a 393px viewport once the input and Add button sit beside it.
          // min-w-0 + shrink let it give up that intrinsic width; max-w-28 caps it at a size the
          // 393px layout (the narrower of the two shipping phones) actually has room for, with the
          // remainder going to the input. The selected label clips at that width — an accepted
          // native-control limitation, not a bug.
          className="h-11 min-w-0 shrink max-w-28 px-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
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
                  submit(item.name, item.category);
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
