"use client";

import { useRef, useState, useTransition } from "react";

import { toast } from "@/components/toaster";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { StockFields, type ExpiryMode } from "./stock-fields";
import { addGroceryItem } from "./actions";
import { GROCERY_CATEGORIES, isCategorySlug, type CategorySlug } from "./categories";
import type { GroceryItem } from "./types";
import { suggestNames } from "./suggest";

/** Rapid name entry, with optional purchase details in the pantry only. */
export function AddRow({
  workspaceId,
  items,
  target,
}: {
  workspaceId: string;
  items: GroceryItem[];
  target: "stock" | "list";
}) {
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState("");
  const [mode, setMode] = useState<ExpiryMode>("none");
  const [name, setName] = useState("");
  // An untouched category preserves the stored product classification.
  const [category, setCategory] = useState<CategorySlug | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = suggestNames(items, name);

  // Pass suggestion category directly; a React state update is not synchronous.
  function submit(value: string, categoryOverride?: CategorySlug) {
    const trimmed = value.trim();
    if (pending || trimmed === "") return;
    const chosen = categoryOverride ?? category;

    startTransition(async () => {
      try {
        const result = await addGroceryItem({
          workspaceId,
          name: trimmed,
          // Spread rather than `category: chosen ?? undefined`: the key has to be absent, not
          // present-and-undefined, so the action sends null and the stored category survives.
          ...(target === "stock" && chosen !== null ? { category: chosen } : {}),
          ...(target === "stock" ? { quantity: quantity === "" ? null : Number(quantity),
            expiresOn: mode === "date" ? date : mode === "none" ? null : undefined } : {}),
          target,
        });

        if (!result.ok) {
          toast(result.error, "error");
          return;
        }

        setName("");
        setQuantity(""); setDate(""); setMode("none");
        inputRef.current?.focus();
      } catch (error) {
        // A rejected call (dropped connection, mid-flight navigation) used to vanish silently.
        console.error("grocery action call rejected", error);
        toast(GENERIC_ERROR, "error");
      }
    });
  }

  return (
    <div className="sticky top-0 z-10 bg-[var(--color-bg)] px-3 py-2 border-b border-[var(--color-border)]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(name);
        }}
        className="space-y-2"
      >
        <div className="flex items-center gap-2">
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
        {target === "stock" && <select
          value={category ?? "pantry"}
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
        </select>}
        <button
          type="submit"
          disabled={pending || name.trim() === ""}
          className="shrink-0 inline-flex items-center min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm font-medium disabled:opacity-50"
        >
          Add
        </button>
        </div>
        {target === "stock" && <details>
          <summary className="min-h-11 flex items-center text-xs cursor-pointer">Purchase quantity and expiry</summary>
          <StockFields quantity={quantity} setQuantity={setQuantity} date={date} setDate={setDate} mode={mode} setMode={setMode} />
        </details>}
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
