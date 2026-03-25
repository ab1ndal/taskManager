"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export function TabPill({
  href,
  label,
  matchKey,
  matchValue,
}: {
  href: string;
  label: string;
  matchKey?: string;
  matchValue?: string;
}) {
  const searchParams = useSearchParams();
  const active = matchKey
    ? searchParams.get(matchKey) === (matchValue ?? null)
    : !searchParams.get("workspace") && !searchParams.get("view");

  return (
    <Link
      href={href}
      className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]/50"
      }`}
    >
      {label}
    </Link>
  );
}
