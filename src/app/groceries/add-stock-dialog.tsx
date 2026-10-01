"use client";

import { useId, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { addGroceryItem } from "./actions";
import { GROCERY_CATEGORIES, isCategorySlug, type CategorySlug } from "./categories";
import { addGroceryItemSchema } from "./schemas";
import { StockFields, type ExpiryMode } from "./stock-fields";

/**
 * Pantry adds ask for the amount instead of saving on Add: an item that silently landed with no
 * count was the common case, because the optional fields sat below the pinned bar and scrolled
 * away. An existing product (matched by name, archived ones included) merges into its stock row.
 */
export function AddStockDialog({ workspaceId, name, category: knownCategory, onClose, onAdded }: {
  workspaceId: string;
  name: string;
  /** The stored category when the name matches an existing product. */
  category: CategorySlug | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const titleId = useId();
  const [quantity, setQuantity] = useState("1");
  const [date, setDate] = useState("");
  const [mode, setMode] = useState<ExpiryMode>("none");
  // New products default to the same category the database would give them, shown rather than implied.
  const [category, setCategory] = useState<CategorySlug>(knownCategory ?? "pantry");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const control = "block w-full min-w-0 h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-base";

  function save() {
    if (pending) return;
    const parsed = addGroceryItemSchema.safeParse({
      workspaceId,
      name,
      category,
      target: "stock",
      quantity: quantity === "" ? null : Number(quantity),
      expiresOn: mode === "date" ? date : mode === "none" ? null : undefined,
    });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(null);
    startTransition(async () => {
      try {
        const result = await addGroceryItem(parsed.data);
        if (result.ok) onAdded();
        else setError(result.error);
      } catch (error) {
        console.error("grocery add rejected", error);
        setError(GENERIC_ERROR);
      }
    });
  }

  return <Dialog open onClose={onClose} ariaLabelledBy={titleId} initialFocusSelector="input">
    <h2 id={titleId} className="text-lg font-semibold mb-4">Add to pantry · {name}</h2>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <fieldset disabled={pending} className="space-y-3 min-w-0">
        <StockFields quantity={quantity} setQuantity={setQuantity} date={date} setDate={setDate} mode={mode} setMode={setMode} />
        <label className="block text-sm">Category
          <select className={control} value={category}
            onChange={(event) => { if (isCategorySlug(event.target.value)) setCategory(event.target.value); }}>
            {GROCERY_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
          </select>
        </label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-(--color-danger-text)">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={pending} onClick={onClose} className="min-h-11 px-3">Cancel</button>
        <button type="submit" disabled={pending} className="min-h-11 px-4 rounded-full bg-(--color-accent) text-(--color-text-on-accent)">{pending ? "Adding…" : "Add"}</button>
      </div>
    </form>
  </Dialog>;
}
