"use client";

import { useState } from "react";

export function PinDisplay({ pin }: { pin: string }) {
  const [copied, setCopied] = useState(false);

  const formatted = pin.slice(0, 3) + " " + pin.slice(3);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available (e.g. non-https dev environment)
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="font-mono text-sm font-semibold tracking-wider text-[var(--color-text-primary)]">
        {formatted}
      </span>
      <button
        onClick={handleCopy}
        title="Copy pin"
        className="rounded-[6px] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent-text)] transition-colors"
      >
        {copied ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M2 8l4 4 7-7" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="4" y="4" width="9" height="9" rx="1.25" />
            <path d="M2 11V2h9" />
          </svg>
        )}
      </button>
    </div>
  );
}
