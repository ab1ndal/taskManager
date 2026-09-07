export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-3 py-4">
      {/* Fixed heights so the list does not shift when the real rows arrive. */}
      <div className="h-11 rounded-full bg-[var(--color-surface-sunken)]" />
      <div className="mt-3 space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-[var(--color-surface-sunken)]" />
        ))}
      </div>
    </main>
  );
}
