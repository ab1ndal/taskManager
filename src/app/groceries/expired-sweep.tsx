"use client";

import { LotRow } from "./lot-row";
import { isExpired } from "./sort";
import type { GroceryItem } from "./types";

export function ExpiredSweep({ items, today }: { items: GroceryItem[]; today: string }) {
  const expired = items.flatMap((item) => item.lots.filter((lot) => isExpired(lot.expiresOn, today))
    .map((lot) => ({ item, lot })))
    .sort((a, b) => a.lot.expiresOn!.localeCompare(b.lot.expiresOn!));
  if (!expired.length) return null;
  return <section aria-label="Expired batches" className="px-3 py-3">
    <h2 className="text-sm font-semibold">Check expired stock</h2>
    {expired.map(({ item, lot }) => <div key={lot.id} className="mt-3">
      <p className="text-sm font-medium">{item.name}</p>
      <ul><LotRow item={item} lot={lot} today={today} /></ul>
    </div>)}
  </section>;
}
