import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });
import { createClient } from "@/lib/supabase/server";
import { NavUser } from "@/components/nav-user";
import { Toaster } from "@/components/toaster";

export const metadata: Metadata = {
  title: "Hearth",
  description: "Your household and work tasks, in one warm place.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)]`}>
        <nav className="h-[52px] border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-5 gap-4">
          {/* Wordmark */}
          <Link href="/tasks" className="font-semibold text-base tracking-tight flex-shrink-0 hover:opacity-80 transition-opacity duration-150">
            hearth<span className="text-[var(--color-accent)]">.</span>
          </Link>

          {/* Nav links */}
          <Link href="/workspaces" className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-150 flex-shrink-0">
            Workspaces
          </Link>

          {/* Workspace tab pills */}
          <div className="flex items-center gap-[3px] bg-[var(--color-accent-subtle)] p-[3px] rounded-[9px] text-sm">
            <button className="px-3 py-[5px] rounded-[7px] bg-white text-[var(--color-accent)] font-medium shadow-sm text-xs">
              All
            </button>
            <button className="px-3 py-[5px] rounded-[7px] text-[var(--color-text-secondary)] hover:bg-white/60 font-medium text-xs">
              Household
            </button>
            <button className="px-3 py-[5px] rounded-[7px] text-[var(--color-text-secondary)] hover:bg-white/60 font-medium text-xs">
              Work
            </button>
          </div>

          <div className="ml-auto">
            {user && (
              <NavUser
                name={user.user_metadata?.name ?? ""}
                email={user.email ?? ""}
              />
            )}
          </div>
        </nav>

        <main className="p-6">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
