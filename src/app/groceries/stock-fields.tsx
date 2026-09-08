"use client";

export type ExpiryMode = "none" | "date" | "estimate";
const control = "block w-full min-w-0 h-11 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-base";

export function StockFields({ quantity, setQuantity, date, setDate, mode, setMode }: {
  quantity: string; setQuantity: (value: string) => void;
  date: string; setDate: (value: string) => void;
  mode: ExpiryMode; setMode: (value: ExpiryMode) => void;
}) {
  return <div className="space-y-3 min-w-0">
    <label className="block text-sm">Quantity (optional)
      <input className={control} type="number" inputMode="numeric" min={1} max={999} step={1}
        value={quantity} onChange={(e) => setQuantity(e.target.value)} />
    </label>
    <label className="block text-sm">Expiry
      <select className={control} value={mode} onChange={(e) => setMode(e.target.value as ExpiryMode)}>
        <option value="none">No expiry date</option>
        <option value="date">Enter expiry date</option>
        <option value="estimate">Estimate from pantry category</option>
      </select>
    </label>
    {mode === "date" && <label className="block text-sm">Expiry date
      <input className={control} type="date" required min="2020-01-01" max="2100-01-01"
        value={date} onChange={(e) => setDate(e.target.value)} />
    </label>}
    <p className="text-xs text-[var(--color-text-secondary)]">Leave quantity blank when you haven’t counted it.</p>
  </div>;
}
