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
      className={`shrink-0 inline-flex items-center min-h-11 whitespace-nowrap px-3 rounded-full text-sm font-medium transition-colors ${
        active
          ? "bg-(--color-accent-subtle) text-(--color-accent-text)"
          : "text-(--color-text-secondary) hover:bg-(--color-accent-subtle)/50"
      }`}
    >
      {label}
    </Link>
  );
}
