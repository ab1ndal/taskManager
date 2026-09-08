"use client";

import { useId, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { editItem } from "./actions";
import { GROCERY_CATEGORIES } from "./categories";
import { editItemSchema } from "./schemas";
import type { GroceryItem } from "./types";

export function EditItemDialog({ item, onClose }: { item: GroceryItem; onClose: () => void }) {
  const titleId = useId();
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState<string>(item.category);
  const [quantity, setQuantity] = useState(item.quantity?.toString() ?? "");
  const [expiresOn, setExpiresOn] = useState(item.expiresOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const control = "block w-full min-w-0 h-11 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-base";

  return (
    <Dialog open onClose={onClose} ariaLabelledBy={titleId} initialFocusSelector="input">
      <h2 id={titleId} className="text-lg font-semibold mb-4">Edit grocery item</h2>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const parsed = editItemSchema.safeParse({
          itemId: item.id, name, category,
          quantity: item.inStock && quantity !== "" ? Number(quantity) : null,
          expiresOn: item.inStock ? expiresOn || null : null,
          expiryIsEstimate: item.expiryIsEstimate && expiresOn === item.expiresOn,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0].message);
          return;
        }
        setError(null);
        startTransition(async () => {
          try {
            const result = await editItem(parsed.data);
            if (result.ok) onClose();
            else setError(result.error);
          } catch (error) {
            console.error("grocery edit rejected", error);
            setError(GENERIC_ERROR);
          }
        });
      }}>
        <fieldset disabled={pending} className="space-y-4 min-w-0">
          <label className="block text-sm">Name<input className={control} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} /></label>
          <label className="block text-sm">Category<select className={control} value={category} onChange={(e) => setCategory(e.target.value)}>
            {GROCERY_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
          </select></label>
          {item.inStock && <>
            <label className="block text-sm">Quantity<input className={control} type="number" inputMode="numeric" min={1} max={999} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
            <label className="block text-sm">Expiry date<input className={control} type="date" min="2020-01-01" max="2100-01-01" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></label>
            <p className="text-xs text-[var(--color-text-secondary)]">Leave quantity or expiry blank to stop tracking it.</p>
          </>}
        </fieldset>
        {error && <p role="alert" className="text-sm text-[var(--color-danger-text)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="min-h-11 px-4">Cancel</button>
          <button type="submit" disabled={pending} className="min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)]">{pending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
