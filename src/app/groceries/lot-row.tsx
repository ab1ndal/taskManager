"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { GENERIC_ERROR, type ActionResult } from "@/app/tasks/action-result";
import { discardLot, extendLot } from "./actions";
import { addDays, shelfLifeDays } from "./categories";
import { LotDialog } from "./lot-dialog";
import { isExpired } from "./sort";
import type { GroceryItem, GroceryLot } from "./types";

export function LotRow({ item, lot, today }: { item: GroceryItem; lot: GroceryLot; today: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const expired = isExpired(lot.expiresOn, today);
  function call(work: () => Promise<ActionResult>) {
    startTransition(async () => {
      try { const result = await work(); if (!result.ok) toast(result.error, "error"); }
      catch { toast(GENERIC_ERROR, "error"); }
    });
  }
  return <li className="py-2 border-t border-[var(--color-border)]" data-lot-id={lot.id}>
    <div className="flex flex-wrap items-center gap-x-3 text-xs">
      <span>{lot.expiresOn ? `${lot.expiryIsEstimate ? "~" : ""}${lot.expiresOn}` : "No expiry date"}</span>
      {expired && <span className="rounded-full px-2 py-1 bg-[var(--color-warning-surface)] text-[var(--color-warning-text)]">expired</span>}
      <span>{lot.quantity === null ? "Quantity unknown" : `Quantity ${lot.quantity}`}</span>
      <span className="text-[var(--color-text-muted)]">Added {new Date(lot.createdAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}</span>
    </div>
    <div className="flex flex-wrap gap-2">
      {expired && <button type="button" disabled={pending} className="min-h-11 px-3 text-xs text-[var(--color-accent-text)]"
        onClick={() => call(() => extendLot({ lotId: lot.id, expiresOn: addDays(today, shelfLifeDays(item.category) ?? 7) }))}>Still good</button>}
      <button type="button" disabled={pending} className="min-h-11 px-3 text-xs"
        onClick={() => call(() => discardLot({ lotId: lot.id, keepOnList: true }))}>Gone</button>
      <button type="button" disabled={pending} className="min-h-11 px-3 text-xs" onClick={() => setEditing(true)}>Edit batch</button>
    </div>
    {editing && <LotDialog item={item} lot={lot} onClose={() => setEditing(false)} />}
  </li>;
}
