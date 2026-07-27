import type { Metadata, Viewport } from "next";
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
  applicationName: "Hearth",
  // Installed to an iPhone home screen the app runs standalone; without this it opens in a Safari
  // tab instead and the manifest's display mode is ignored, because iOS does not read it.
  appleWebApp: { capable: true, title: "Hearth", statusBarStyle: "default" },
};

/**
 * `viewport-fit=cover` is what lets `env(safe-area-inset-*)` resolve to the notch and home-indicator
 * insets. Without it they are all 0 and a standalone launch renders content under the status bar.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#16151c" },
  ],
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
          // safe-top/safe-x add the notch insets on top of the bar's own height, so a standalone
          // launch does not render the wordmark under the status bar or behind a rounded corner.
          <nav className="safe-top sticky top-0 z-30 h-[calc(var(--nav-height)+env(safe-area-inset-top))] border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-5 gap-4">
            {/* Wordmark */}
            <Link href="/tasks" className="inline-flex items-center min-h-11 font-semibold text-base tracking-tight flex-shrink-0 hover:opacity-80 transition-opacity duration-150">
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
