"use client";

import { useId, useRef, useState, useTransition } from "react";

import { toast } from "@/components/toaster";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { type ExpiryMode } from "./stock-fields";
import { addGroceryItem } from "./actions";
import { GROCERY_CATEGORIES, isCategorySlug, type CategorySlug } from "./categories";
import { DictateSheet } from "./dictate-sheet";
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
  const formId = useId();

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

  const control = "h-11 min-w-0 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-base";

  // A fragment, not a wrapper: `sticky` only sticks within its parent, so the bar has to be a direct
  // child of the tall list container. Only the name field, Add and the suggestions stay pinned —
  // everything optional scrolls away, because on a phone the pinned block used to cover over half
  // the screen and leave the list a strip at the bottom. It pins below the nav, which is itself
  // sticky at top-0 and stacked above: pinned at top-0 too, the bar slid underneath it.
  return (
    <>
      <div className="sticky top-[calc(var(--nav-height)+env(safe-area-inset-top))] z-10 bg-[var(--color-bg)] px-3 py-2 border-b border-[var(--color-border)]">
        <form
          id={formId}
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
            className="block w-full min-w-0 flex-1 min-h-11 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-base"
          />
          <button
            type="submit"
            disabled={pending || name.trim() === ""}
            className="shrink-0 inline-flex items-center min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm font-medium disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {suggestions.length > 0 && (
          <ul className="mt-2 flex gap-2 overflow-x-auto">
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

      {/* Outside the <form> element for layout only; `form={formId}` keeps the date field's
          `required` check part of the submit. */}
      <div className="space-y-2 px-3 py-2">
        {target === "stock" && (
          <div className="flex items-center gap-2">
            <select
              value={category ?? ""}
              onChange={(event) => {
                if (isCategorySlug(event.target.value)) setCategory(event.target.value);
              }}
              aria-label="Category"
              form={formId}
              className={`${control} flex-1`}
            >
              {/* Untouched means "keep the stored category", so the control says nothing rather
                  than showing Pantry & dry goods for an item that is actually Dairy. */}
              <option value="" disabled>
                Category
              </option>
              {GROCERY_CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Quantity (optional)"
              placeholder="Qty"
              form={formId}
              className={`${control} w-20`}
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {target === "stock" && (
            <select
              aria-label="Expiry"
              form={formId}
              className={`${control} flex-1`}
              value={mode}
              onChange={(e) => setMode(e.target.value as ExpiryMode)}
            >
              <option value="none">No expiry date</option>
              <option value="date">Enter expiry date</option>
              <option value="estimate">Estimate from category</option>
            </select>
          )}
          <DictateSheet workspaceId={workspaceId} target={target} />
          {target === "stock" && mode === "date" && (
            <input
              aria-label="Expiry date"
              form={formId}
              className={`${control} basis-full`}
              type="date"
              required
              min="2020-01-01"
              max="2100-01-01"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </div>
      </div>
    </>
  );
}
