import { redirect } from "next/navigation";

/**
 * The profile form moved into /settings when board columns needed a settings home. Kept as a
 * redirect rather than deleted: this path is in bookmarks, and the user menu linked here for months.
 */
export default function ProfilePage() {
  redirect("/settings?tab=profile");
}
