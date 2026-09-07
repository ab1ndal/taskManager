"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Three destinations, deliberately.
 *
 * The bar's intrinsic width is ~355px on a 393px iPhone (see src/app/layout.tsx), and every link is
 * flex-shrink-0, so a fourth entry pushes "Sign out" into a second line and makes the page scroll
 * sideways — the defect tasks/lessons.md records. Groceries takes the slot rather than joining:
 * it is a weekly-or-daily destination, while /workspaces is a rare setup screen still reachable
 * from the /tasks sidebar and by URL.
 */
const links = [
  { href: "/tasks", label: "Tasks" },
  { href: "/board", label: "Board" },
  { href: "/groceries", label: "Groceries" },
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
