"use client";

import { useState } from "react";
import Link from "next/link";
import { NewTaskModal } from "./new-task-modal";
import { TabPill } from "./tab-pill";
import { TaskCard, EmptyState } from "@/components/task-card";
import { CompletedSection } from "./completed-section";
import { bucketTasks, type RawTask } from "./bucket-tasks";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

function SidebarLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-2 py-[7px] rounded-[8px] text-sm font-medium ${
        active
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]/50"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

export function TasksPageClient({
  workspaces,
  currentMemberIds,
  workspaceFilter,
  viewFilter,
  initialTasks,
  userName,
}: {
  workspaces: Workspace[];
  currentMemberIds: string[];
  workspaceFilter?: string;
  viewFilter?: string;
  initialTasks: RawTask[];
  userName?: string;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [localTasks, setLocalTasks] = useState<RawTask[]>(initialTasks);
  const [optimisticTaskIds, setOptimisticTaskIds] = useState<Set<string>>(new Set());

  const hasWorkspace = workspaces.length > 0;

  function handleTaskCreated(task: RawTask) {
    setLocalTasks((prev) => [...prev, task]);
    setOptimisticTaskIds((prev) => new Set([...prev, task.id]));
  }

  function handleTaskError(taskId: string) {
    setLocalTasks((prev) => prev.filter((t) => t.id !== taskId));
    setOptimisticTaskIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }

  const filtered = localTasks.filter((t) => {
    if (workspaceFilter && t.workspace.kind !== workspaceFilter) return false;
    if (viewFilter === "shared" && t.assignee_count <= 1) return false;
    return true;
  });

  const { overdue, today, upcoming, completed } = bucketTasks(filtered);
  const hasAnyTasks = overdue.length + today.length + upcoming.length + completed.length > 0;

  return (
    <>
      {/* Tab strip — small screens only */}
      <div className="flex md:hidden items-center gap-2 overflow-x-auto px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={() => setModalOpen(true)}
          disabled={!hasWorkspace}
          className="shrink-0 whitespace-nowrap flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 1v10M1 6h10" />
          </svg>
          New task
        </button>
        <TabPill href="/tasks" label="My tasks" />
        <TabPill href="/tasks?view=shared" label="Shared" matchKey="view" matchValue="shared" />
        {workspaces.map((ws) => (
          <TabPill
            key={ws.id}
            href={`/tasks?workspace=${ws.kind}`}
            label={ws.name}
            matchKey="workspace"
            matchValue={ws.kind}
          />
        ))}
      </div>

      {/* Shared modal */}
      <NewTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        workspaces={workspaces}
        currentMemberIds={currentMemberIds}
        onTaskCreated={handleTaskCreated}
        onTaskError={handleTaskError}
      />

      {/* Main layout */}
      <div className="flex min-h-[calc(100vh-52px)] -m-6">
        {/* Sidebar — medium screens and up */}
        <aside className="hidden md:flex w-[200px] flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)] p-3 flex-shrink-0">
          <button
            onClick={() => setModalOpen(true)}
            disabled={!hasWorkspace}
            className="mb-4 w-full flex items-center justify-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-[8px] py-[9px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 1v10M1 6h10" />
            </svg>
            New task
          </button>

          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-2 mb-1">
            Views
          </p>
          <SidebarLink
            href="/tasks"
            active={!workspaceFilter && !viewFilter}
            icon={
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M2 4h11M2 7.5h7M2 11h5" />
              </svg>
            }
            label="My tasks"
          />
          <SidebarLink
            href="/tasks?view=shared"
            active={viewFilter === "shared"}
            icon={
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="5.5" cy="5.5" r="3.5" />
                <circle cx="9.5" cy="9.5" r="3.5" />
              </svg>
            }
            label="Shared"
          />

          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-2 mb-1 mt-4">
            Spaces
          </p>
          {workspaces.map((ws) => (
            <SidebarLink
              key={ws.id}
              href={`/tasks?workspace=${ws.kind}`}
              active={workspaceFilter === ws.kind}
              icon={
                ws.kind === "household" ? (
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M1.5 6L7.5 1.5L13.5 6V13.5a.75.75 0 01-.75.75H2.25A.75.75 0 011.5 13.5V6z" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <rect x="1.5" y="4" width="12" height="9" rx="1.25" />
                    <path d="M4.5 4V3a.75.75 0 01.75-.75h4.5A.75.75 0 0110.5 3v1" />
                  </svg>
                )
              }
              label={ws.name}
            />
          ))}
          <SidebarLink
            href="/workspaces"
            icon={
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="1.5" y="1.5" width="5" height="5" rx="0.75" />
                <rect x="8.5" y="1.5" width="5" height="5" rx="0.75" />
                <rect x="1.5" y="8.5" width="5" height="5" rx="0.75" />
                <rect x="8.5" y="8.5" width="5" height="5" rx="0.75" />
              </svg>
            }
            label="Workspaces"
          />
        </aside>

        <main className="flex-1 p-6 overflow-auto">
          {workspaces.length === 0 && (
            <div className="mb-6 rounded-[8px] border border-[var(--color-accent-text)] bg-[var(--color-accent-subtle)] px-4 py-3">
              <p className="text-sm text-[var(--color-accent-text)]">
                You&apos;re not in any workspace yet.{" "}
                <a
                  href="/workspaces"
                  className="font-semibold underline hover:opacity-80 transition-opacity duration-150"
                >
                  Browse workspaces
                </a>
              </p>
            </div>
          )}

          {userName && (
            <>
              <h2 className="text-xl font-semibold tracking-tight mb-1">Hello, {userName}</h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6">Here are your tasks.</p>
            </>
          )}

          {!hasAnyTasks ? (
            <EmptyState />
          ) : (
            <>
              {(
                [
                  { key: "Overdue", tasks: overdue },
                  { key: "Today", tasks: today },
                  { key: "Upcoming", tasks: upcoming },
                ] as const
              ).map(({ key, tasks: sectionTasks }) => {
                if (!sectionTasks.length) return null;
                return (
                  <div key={key} className="mb-6">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
                      {key}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {sectionTasks.map((task) => (
                        <div
                          key={task.id}
                          className={optimisticTaskIds.has(task.id) ? "opacity-40" : undefined}
                        >
                          <TaskCard
                            taskId={task.id}
                            title={task.title}
                            deadline={task.deadlineLabel}
                            deadlineVariant={task.deadlineVariant}
                            workspace={task.workspace.name}
                            shared={task.shared}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <CompletedSection
                tasks={completed.map((t) => ({
                  taskId: t.id,
                  title: t.title,
                  deadline: t.deadlineLabel,
                  deadlineVariant: t.deadlineVariant,
                  workspace: t.workspace.name,
                  shared: t.shared,
                  completed: true as const,
                }))}
              />
            </>
          )}
        </main>
      </div>
    </>
  );
}
