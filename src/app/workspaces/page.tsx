import { createClient } from "@/lib/supabase/server";
import { WorkspaceForms } from "./workspace-forms";

type Workspace = {
  id: string;
  name: string;
  kind: string;
};

export default async function WorkspacesPage() {
  const supabase = await createClient();
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name, kind")
    .order("name");

  const list: Workspace[] = workspaces ?? [];

  return (
    <div className="max-w-lg">
      <h2 className="mb-6 text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
        Workspaces
      </h2>

      {/* Your workspaces */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-widest mb-3">
          Your workspaces
        </h3>

        {list.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No workspaces yet. Create one below.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((ws) => (
              <div
                key={ws.id}
                className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {ws.name}
                    </span>
                    <span
                      className={`mt-0.5 text-xs font-medium px-2 py-0.5 rounded-full w-fit ${
                        ws.kind === "household"
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-sky-100 text-sky-700"
                      }`}
                    >
                      {ws.kind === "household" ? "Household" : "Work"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create + Join forms */}
      <WorkspaceForms />
    </div>
  );
}
