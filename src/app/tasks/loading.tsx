/**
 * Shown while the /tasks server component fetches. Mirrors the card list's shape so the layout does
 * not jump when the real rows arrive.
 */
export default function TasksLoading() {
  return (
    <div className="p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your tasks…</span>
      <div className="mb-6 h-5 w-40 animate-pulse rounded bg-[var(--color-border)]" />
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[62px] animate-pulse rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
          />
        ))}
      </div>
    </div>
  );
}
