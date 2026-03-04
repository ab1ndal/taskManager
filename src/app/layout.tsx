import type { Metadata } from "next";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { NavUser } from "@/components/nav-user";
import { Toaster } from "@/components/toaster";

export const metadata: Metadata = {
  title: "Task Manager",
  description: "Manage household and work tasks",
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
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <nav className="h-14 border-b border-gray-200 bg-white flex items-center px-6 gap-6">
          <span className="font-semibold text-base tracking-tight">
            Task Manager
          </span>

          {/* Workspace tabs — placeholder */}
          <div className="flex items-center gap-1 text-sm">
            <button className="px-3 py-1.5 rounded-md bg-gray-100 font-medium">
              All
            </button>
            <button className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100">
              Household
            </button>
            <button className="px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-100">
              Work
            </button>
          </div>

          <div className="ml-auto">
            {user && <NavUser email={user.email ?? ""} />}
          </div>
        </nav>

        <main className="p-6">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
