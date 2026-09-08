"use client";

import { useId, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { editItem } from "./actions";
import { GROCERY_CATEGORIES } from "./categories";
import { editItemSchema } from "./schemas";
import type { GroceryItem } from "./types";

export function EditItemDialog({ item, onClose, shopping = false }: { item: GroceryItem; onClose: () => void; shopping?: boolean }) {
  const titleId = useId();
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState<string>(item.category);
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
          itemId: item.id, name, ...(shopping ? {} : { category }),
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
          {!shopping && <label className="block text-sm">Category<select className={control} value={category} onChange={(e) => setCategory(e.target.value)}>
            {GROCERY_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
          </select></label>}

        </fieldset>
        {error && <p role="alert" className="rounded-sm bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-danger-text)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="min-h-11 px-4">Cancel</button>
          <button type="submit" disabled={pending} className="min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)]">{pending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
