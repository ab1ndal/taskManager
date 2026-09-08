"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-3 py-8">
      <p className="text-sm text-[var(--color-text-primary)]">The grocery list could not load.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-3 inline-flex items-center min-h-11 px-4 rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm font-medium"
      >
        Try again
      </button>
    </main>
  );
}
