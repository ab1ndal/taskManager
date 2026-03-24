import { createClient } from "@/lib/supabase/server";

export default async function TasksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const name = user?.user_metadata?.name || user?.email || "there";

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">Hello, {name}</h2>
      <p className="mb-6 text-sm text-gray-500">Here are your tasks.</p>

      {/* Task list — placeholder */}
      <p className="text-sm text-gray-400">Tasks will appear here.</p>
    </div>
  );
}
