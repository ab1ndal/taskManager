"use client";

import { useId, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { GENERIC_ERROR } from "@/app/tasks/action-result";
import { editLot, markBought } from "./actions";
import { estimatedExpiry } from "./categories";
import { editLotSchema, markBoughtSchema } from "./schemas";
import { StockFields, type ExpiryMode } from "./stock-fields";
import type { GroceryItem, GroceryLot } from "./types";

export function LotDialog({ item, lot, onClose }: {
  item: GroceryItem; lot?: GroceryLot; onClose: () => void;
}) {
  const titleId = useId();
  const [quantity, setQuantity] = useState(lot?.quantity?.toString() ?? "");
  const [date, setDate] = useState(lot?.expiresOn ?? "");
  const [mode, setMode] = useState<ExpiryMode>(lot?.expiresOn ? "date" : "none");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(another: boolean) {
    if (pending) return;
    const expiresOn = mode === "date" ? date : mode === "none" ? null : undefined;
    const count = quantity === "" ? null : Number(quantity);
    const purchase = markBoughtSchema.safeParse({ itemId: item.id, quantity: count, expiresOn });
    const edit = editLotSchema.safeParse({
      lotId: lot?.id, quantity: count,
      expiresOn: mode === "estimate" ? estimatedExpiry(item.category) : expiresOn,
      expiryIsEstimate: mode === "estimate" || !!(lot?.expiryIsEstimate && mode === "date" && date === lot.expiresOn),
    });
    const parsed = lot ? edit : purchase;
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(null);
    startTransition(async () => {
      try {
        const result = lot && edit.success ? await editLot(edit.data)
          : purchase.success ? await markBought(purchase.data) : null;
        if (!result?.ok) { setError(result?.error ?? GENERIC_ERROR); return; }
        if (!another) onClose();
        else { setQuantity(""); setDate(""); setMode("none"); setSaved(true); }
      } catch { setError(GENERIC_ERROR); }
    });
  }

  return <Dialog open onClose={onClose} ariaLabelledBy={titleId} initialFocusSelector="input">
    <h2 id={titleId} className="text-lg font-semibold mb-4">{lot ? "Edit batch" : "Record purchase"} · {item.name}</h2>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save(false); }}>
      <fieldset disabled={pending} className="min-w-0">
        <StockFields quantity={quantity} setQuantity={setQuantity} date={date} setDate={setDate} mode={mode} setMode={setMode} />
      </fieldset>
      {saved && <p role="status" className="text-sm">Batch saved. Enter the next batch.</p>}
      {error && <p role="alert" className="text-sm text-[var(--color-danger-text)]">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={pending} onClick={onClose} className="min-h-11 px-3">{saved ? "Done" : "Cancel"}</button>
        {!lot && <button type="button" disabled={pending} onClick={() => save(true)} className="min-h-11 px-3">Save and add another batch</button>}
        <button type="submit" disabled={pending} className="min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)]">{pending ? "Saving…" : "Save"}</button>
      </div>
    </form>
  </Dialog>;
}
