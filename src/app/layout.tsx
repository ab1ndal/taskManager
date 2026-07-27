import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });
import { createClient } from "@/lib/supabase/server";
import { NavLinks } from "@/components/nav-links";
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
        {user && (
          <nav className="h-[var(--nav-height)] border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-5 gap-4">
            {/* Wordmark */}
            <Link href="/tasks" className="font-semibold text-base tracking-tight flex-shrink-0 hover:opacity-80 transition-opacity duration-150">
              hearth<span className="text-[var(--color-accent)]">.</span>
            </Link>

            <NavLinks />

            <div className="ml-auto">
              <NavUser
                name={user.user_metadata?.name ?? ""}
                email={user.email ?? ""}
              />
            </div>
          </nav>
        )}

        {/*
          No <main> here. Each route renders its own, so the page owns its padding and there is
          exactly one main landmark per document — /tasks used to nest a second <main> inside this
          one and pay the padding twice.
        */}
        {children}
        <Toaster />
      </body>
    </html>
  );
}
