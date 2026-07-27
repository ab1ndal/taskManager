"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/tasks", label: "Tasks" },
  { href: "/workspaces", label: "Workspaces" },
];

/**
 * Client-side because the active state needs the current path. The sidebar on /tasks has always
 * highlighted where you are; the top nav rendered every link identically, so at a glance there was
 * nothing telling you which section you were in.
 */
export function NavLinks() {
  // `usePathname()` is typed as string but returns null outside a mounted app router — no link is
  // active in that case, which is the right answer rather than a crash.
  const pathname = usePathname() as string | null;

  return (
    <>
      {links.map(({ href, label }) => {
        const active = pathname === href || pathname?.startsWith(`${href}/`) === true;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            // A 20px-tall text link is a 20px touch target. The nav is 52px tall, so the full 44px
            // minimum fits without changing how the bar looks.
            className={`flex-shrink-0 inline-flex items-center min-h-11 text-sm font-medium transition-colors duration-150 ${
              active
                ? "text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
