import { createClient } from "@/lib/supabase/server";
import { TaskCard, EmptyState, type DeadlineVariant } from "@/components/task-card";

function SidebarItem({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-[7px] rounded-[8px] text-sm font-medium cursor-pointer ${
        active
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]/50"
      }`}
    >
      {icon}
      {label}
    </div>
  );
}

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const name = user?.user_metadata?.name || user?.email || "there";

  // Mock tasks — replace with real data when task queries are implemented
  const mockTasks = [
    { id: 1, title: "Buy groceries", deadline: "Overdue", deadlineVariant: "red" as DeadlineVariant, workspace: "Household", shared: true, section: "Overdue" },
    { id: 2, title: "Review Q2 budget report", deadline: "Due in 18 hrs", deadlineVariant: "yellow" as DeadlineVariant, workspace: "Work", section: "Today" },
    { id: 3, title: "Call the plumber", deadline: "Due in 3 days", deadlineVariant: "green" as DeadlineVariant, workspace: "Household", section: "Upcoming" },
    { id: 4, title: "Weekly team sync prep", deadline: "Due in 5 days", deadlineVariant: "green" as DeadlineVariant, workspace: "Work", section: "Upcoming" },
  ];

  const sections = ["Overdue", "Today", "Upcoming"] as const;
  const hasTasks = mockTasks.length > 0;

  return (
    <div className="flex min-h-[calc(100vh-52px)] -m-6">
      {/* Sidebar */}
      <aside className="hidden md:flex w-[200px] flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)] p-3 flex-shrink-0">
        <button className="mb-4 w-full flex items-center justify-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-[8px] py-[9px] transition-colors">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 1v10M1 6h10"/>
          </svg>
          New task
        </button>

        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-2 mb-1">Views</p>
        <SidebarItem active icon={
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M2 4h11M2 7.5h7M2 11h5"/>
          </svg>
        } label="My tasks" />
        <SidebarItem icon={
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="5.5" cy="5.5" r="3.5"/><circle cx="9.5" cy="9.5" r="3.5"/>
          </svg>
        } label="Shared" />

        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-2 mb-1 mt-4">Spaces</p>
        <SidebarItem icon={
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M1.5 6L7.5 1.5L13.5 6V13.5a.75.75 0 01-.75.75H2.25A.75.75 0 011.5 13.5V6z"/>
          </svg>
        } label="Household" />
        <SidebarItem icon={
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="1.5" y="4" width="12" height="9" rx="1.25"/>
            <path d="M4.5 4V3a.75.75 0 01.75-.75h4.5A.75.75 0 0110.5 3v1"/>
          </svg>
        } label="Work" />
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        <h2 className="text-xl font-semibold tracking-tight mb-1">Hello, {name}</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">Here are your tasks.</p>

        {!hasTasks ? (
          <EmptyState />
        ) : (
          sections.map((section) => {
            const tasks = mockTasks.filter((t) => t.section === section);
            if (!tasks.length) return null;
            return (
              <div key={section} className="mb-6">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
                  {section}
                </p>
                <div className="flex flex-col gap-1.5">
                  {tasks.map((task) => (
                    <TaskCard key={task.id} {...task} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
