import { TabPill } from "@/app/tasks/tab-pill";
import { BoardTab } from "./board-tab";
import { ProfileTab } from "./profile-tab";

type SearchParams = Promise<{ tab?: string }>;

/**
 * Per-user settings, tabbed so this stays the one place settings live rather than growing a route
 * each time something is configurable. /profile redirects here.
 */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { tab } = await searchParams;
  // Anything unrecognised falls back rather than rendering nothing: the tab comes from the URL.
  const active = tab === "board" ? "board" : "profile";

  return (
    <main className="p-6">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Settings</h1>

      <nav aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--color-border)] pb-3">
        <TabPill href="/settings?tab=profile" label="Profile" matchKey="tab" matchValue="profile" />
        <TabPill href="/settings?tab=board" label="Board" matchKey="tab" matchValue="board" />
      </nav>

      {active === "board" ? <BoardTab /> : <ProfileTab />}
    </main>
  );
}
