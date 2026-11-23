"use client";

// unstable_retry, not reset: reset only clears the boundary and re-renders without refetching, so
// a failed server render fails the same way again. unstable_retry refreshes the route first.
export default function Error({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-3 py-8">
      <p className="text-sm text-(--color-text-primary)">The grocery list could not load.</p>
      <button
        type="button"
        onClick={unstable_retry}
        className="mt-3 inline-flex items-center min-h-11 px-4 rounded-full bg-(--color-accent) text-(--color-text-on-accent) text-sm font-medium"
      >
        Try again
      </button>
    </main>
  );
}
