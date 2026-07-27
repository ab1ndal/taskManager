"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary for /tasks. Without it, a throw in the server component renders the
 * framework's default error page and the user is left with no way back (audit C4).
 */
export default function TasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({ level: "error", route: "/tasks", digest: error.digest, message: error.message })
    );
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <h2 className="text-base font-semibold">Your tasks could not be loaded</h2>
      <p className="max-w-sm text-sm text-[var(--color-text-secondary)]">
        Something went wrong while loading this page. Trying again usually helps.
      </p>
      <button
        onClick={reset}
        className="rounded-sm bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-text-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]"
      >
        Try again
      </button>
    </div>
  );
}
