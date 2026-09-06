/**
 * Shown while the /board server component fetches. Mirrors the column track's shape — three
 * fixed-width skeleton columns — so the layout does not jump when the real columns arrive.
 */
export default function BoardLoading() {
  return (
    <div className="pt-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your board…</span>
      <div className="mx-4 mb-6 h-5 w-24 animate-pulse rounded bg-[var(--color-border)]" />
      <div className="flex gap-4 overflow-x-auto px-4 pb-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2"
          >
            <div className="mb-1 h-9 animate-pulse rounded-md bg-[var(--color-surface-sunken)]" />
            {[0, 1].map((j) => (
              <div
                key={j}
                className="h-16 animate-pulse rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
