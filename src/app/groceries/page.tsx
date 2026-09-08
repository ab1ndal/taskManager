import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isCategorySlug, localToday, type CategorySlug } from "./categories";
import { GroceriesClient } from "./groceries-client";
import type { GroceryItem } from "./types";

type SearchParams = Promise<{ view?: string; workspace?: string }>;

/**
 * The check constraint on `grocery_items.category` (migration 026) restricts the column to the
 * nine known slugs, so this fallback is unreachable today — but the Supabase client here is
 * untyped, so the type system has no way to know that. Falling back to "pantry" rather than
 * dropping the row is deliberate: an unrecognised slug would otherwise silently hide a household's
 * item from the page entirely.
 */
function rowCategory(value: unknown): CategorySlug {
  return isCategorySlug(value as string) ? (value as CategorySlug) : "pantry";
}

export default async function GroceriesPage({ searchParams }: { searchParams: SearchParams }) {
  const { view, workspace } = await searchParams;

  // One canonical view per URL, so the active tab pill is never ambiguous. Shopping is the default:
  // it is the view with a deadline attached, because someone is standing in a shop.
  if (view !== "stock" && view !== "buy") {
    const params = new URLSearchParams({ view: "buy" });
    if (workspace) params.set("workspace", workspace);
    redirect(`/groceries?${params}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS decides what comes back; the filters below shape the result rather than protect it.
  const { data: members, error: membersError } = user
    ? await supabase
        .from("workspace_members")
        .select("workspace_id, workspaces!inner(id, name, kind)")
        .eq("auth_user_id", user.id)
    : { data: [], error: null };
  if (membersError) throw new Error("Could not load grocery workspaces", { cause: membersError });

  const households = (members ?? [])
    .map((m) => m.workspaces as unknown as { id: string; kind: string })
    .filter((w) => w.kind === "household");

  const workspaceId = workspace ?? households[0]?.id ?? null;

  if (!workspaceId) {
    return (
      <main className="mx-auto w-full max-w-2xl px-3 py-8">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Groceries live in a household workspace. Create one first.
        </p>
      </main>
    );
  }

  // Archived rows are loaded on purpose: they are the autocomplete history, and at a few hundred
  // rows for two people this is one query rather than a suggestions endpoint.
  const { data: rows, error: rowsError } = await supabase
    .from("grocery_items")
    .select("id, name, category, in_stock, needed, quantity, expires_on, expiry_is_estimate, times_added")
    .eq("workspace_id", workspaceId);
  if (rowsError) throw new Error("Could not load grocery items", { cause: rowsError });

  const items: GroceryItem[] = (rows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    category: rowCategory(row.category),
    inStock: row.in_stock as boolean,
    needed: row.needed as boolean,
    quantity: (row.quantity as number | null) ?? null,
    expiresOn: (row.expires_on as string | null) ?? null,
    expiryIsEstimate: row.expiry_is_estimate as boolean,
    timesAdded: row.times_added as number,
  }));

  return (
    <main className="pb-[env(safe-area-inset-bottom)]">
      <GroceriesClient
        workspaceId={workspaceId}
        items={items}
        view={view}
        today={localToday()}
      />
    </main>
  );
}
