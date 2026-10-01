"use client";

import { useId, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { markBought } from "./actions";
import { markBoughtSchema } from "./schemas";
import { StockFields, type ExpiryMode } from "./stock-fields";
import type { GroceryItem } from "./types";

/** Bought and Record purchase. The amount merges into the item's one stock row (migration 031). */
export function PurchaseDialog({ item, onClose }: { item: GroceryItem; onClose: () => void }) {
  const titleId = useId();
  const [quantity, setQuantity] = useState("1");
  const [date, setDate] = useState("");
  const [mode, setMode] = useState<ExpiryMode>("none");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (pending) return;
    const parsed = markBoughtSchema.safeParse({
      itemId: item.id,
      quantity: quantity === "" ? null : Number(quantity),
      expiresOn: mode === "date" ? date : mode === "none" ? null : undefined,
    });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(null);
    startTransition(async () => {
      try {
        const result = await markBought(parsed.data);
        if (result.ok) onClose();
        else setError(result.error);
      } catch { setError(GENERIC_ERROR); }
    });
  }

  return <Dialog open onClose={onClose} ariaLabelledBy={titleId} initialFocusSelector="input">
    <h2 id={titleId} className="text-lg font-semibold mb-4">Record purchase · {item.name}</h2>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <fieldset disabled={pending} className="min-w-0">
        <StockFields quantity={quantity} setQuantity={setQuantity} date={date} setDate={setDate} mode={mode} setMode={setMode} />
      </fieldset>
      {error && <p role="alert" className="text-sm text-(--color-danger-text)">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={pending} onClick={onClose} className="min-h-11 px-3">Cancel</button>
        <button type="submit" disabled={pending} className="min-h-11 px-4 rounded-full bg-(--color-accent) text-(--color-text-on-accent)">{pending ? "Saving…" : "Save"}</button>
      </div>
    </form>
  </Dialog>;
}
