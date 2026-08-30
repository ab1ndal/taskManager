import { redirect } from "next/navigation";
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

  // A tab value that is neither known tab redirects to normalise the URL rather than just the
  // rendered content: TabPill decides "active" by comparing the raw param to its own matchValue,
  // so silently defaulting content to Profile while leaving `tab=nonsense` in the URL would show
  // Profile's content with no pill highlighted. Redirecting makes the content and the active pill
  // the same fact. Bare /settings (no tab at all) is left alone — that already renders Profile
  // with no pill lit, which is correct: the Profile pill only lights up once its own explicit
  // ?tab=profile link is followed.
  if (tab !== undefined && tab !== "profile" && tab !== "board") {
    redirect("/settings?tab=profile");
  }

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
