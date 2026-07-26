"use client";

import { useState } from "react";
import Link from "next/link";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { NewTaskModal } from "./new-task-modal";
import { TabPill } from "./tab-pill";
import { TaskCard, EmptyState } from "@/components/task-card";
import { CompletedSection } from "./completed-section";
import { bucketTasks, type RawTask } from "./bucket-tasks";
import { EditTaskModal } from "./edit-task-modal";
import { reorderTask } from "./actions";
import { computeNeighborKeys } from "./reorder-helpers";
import { toast } from "@/components/toaster";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

/**
 * Extracted from the component so it's testable by calling it directly with a fabricated
 * DropResult, rather than simulating real @hello-pangea/dnd pointer/keyboard sensor events —
 * the library's own tests take the same approach; its sensors aren't designed to be triggered
 * by synthetic DOM events.
 */
export function buildDragEndHandler({
  bucketsByKey,
  memberIdByWorkspaceId,
  setLocalTasks,
  onReorderError,
}: {
  // Keyed by droppableId ("Overdue" | "Today" | "Upcoming"). These must be the *rendered* arrays —
  // already filtered and already sorted by member_sort_key — because destination.index is an index
  // into the rendered list, not into the unsorted/unfiltered localTasks array.
  bucketsByKey: Record<string, RawTask[]>;
  memberIdByWorkspaceId: Record<string, string>;
  setLocalTasks: (updater: (prev: RawTask[]) => RawTask[]) => void;
  onReorderError: (message: string) => void;
}) {
  return async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId !== destination.droppableId) return;
    if (source.index === destination.index) return;

    const bucket = bucketsByKey[source.droppableId];
    if (!bucket) return;
    const dragged = bucket.find((t) => t.id === draggableId);
    if (!dragged) return;

    const withoutDragged = bucket.filter((t) => t.id !== draggableId);
    const reordered = [
      ...withoutDragged.slice(0, destination.index),
      dragged,
      ...withoutDragged.slice(destination.index),
    ];
    const { prevKey, nextKey } = computeNeighborKeys(reordered, destination.index);

    const memberId = memberIdByWorkspaceId[dragged.workspace.id];
    if (!memberId) {
      onReorderError("Could not determine member for this task's workspace");
      return;
    }

    // Optimistic move: give the dragged task a synthetic sort key placed between its new
    // neighbors so bucketTasks()'s existing member_sort_key sort reflects the drop immediately,
    // before the server confirms. This is the single state update for the optimistic phase —
    // bucketTasks() re-sorts by member_sort_key on every render, so reassigning just this one
    // task's key is sufficient to move it; no manual array-splice-into-place is needed.
    //
    // Must stay in sync with reorderTask's key-assignment logic in actions.ts — the two compute
    // the same value, one optimistically on the client and one authoritatively on the server.
    const optimisticKey =
      prevKey !== null && nextKey !== null
        ? (prevKey + nextKey) / 2
        : prevKey !== null
          ? prevKey + 1000
          : nextKey !== null
            ? nextKey - 1000
            : dragged.member_sort_key;
    setLocalTasks((prev) =>
      prev.map((t) => (t.id === draggableId ? { ...t, member_sort_key: optimisticKey } : t))
    );

    const res = await reorderTask({ taskId: draggableId, memberId, prevKey, nextKey });

    if (!res.ok) {
      // Roll back only the dragged task's key. Replacing the whole array with a pre-drag snapshot
      // would erase any task optimistically created during the await.
      setLocalTasks((prev) =>
        prev.map((t) =>
          t.id === draggableId ? { ...t, member_sort_key: dragged.member_sort_key } : t
        )
      );
      onReorderError(res.error ?? "Failed to reorder task");
    }
  };
}

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
  memberIdByWorkspaceId,
  workspaceFilter,
  viewFilter,
  initialTasks,
  userName,
}: {
  workspaces: Workspace[];
  currentMemberIds: string[];
  memberIdByWorkspaceId: Record<string, string>; // used by drag-to-reorder (Task 15)
  workspaceFilter?: string;
  viewFilter?: string;
  initialTasks: RawTask[];
  userName?: string;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [localTasks, setLocalTasks] = useState<RawTask[]>(initialTasks);
  const [optimisticTaskIds, setOptimisticTaskIds] = useState<Set<string>>(new Set());
  const [editingTask, setEditingTask] = useState<RawTask | null>(null);

  // Server data is the source of truth: once a revalidation delivers a new list, the optimistic
  // overlay is dropped. Adjusting during render rather than in an effect avoids the extra pass that
  // renders stale rows first (react-hooks/set-state-in-effect).
  const [syncedFrom, setSyncedFrom] = useState(initialTasks);
  if (syncedFrom !== initialTasks) {
    setSyncedFrom(initialTasks);
    setLocalTasks(initialTasks);
    setOptimisticTaskIds(new Set());
  }

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

  function handleReorderError(message: string) {
    toast(message, "error");
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

      {editingTask && (
        <EditTaskModal
          open={!!editingTask}
          task={editingTask}
          workspaces={workspaces}
          currentMemberIds={currentMemberIds}
          onClose={() => setEditingTask(null)}
        />
      )}

      {/* Main layout */}
      <div className="flex min-h-dvh">
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
              <DragDropContext
                onDragEnd={buildDragEndHandler({
                  bucketsByKey: { Overdue: overdue, Today: today, Upcoming: upcoming },
                  memberIdByWorkspaceId,
                  setLocalTasks,
                  onReorderError: handleReorderError,
                })}
              >
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
                      {/* type={key} makes dnd treat each bucket as its own drag universe, so a
                          foreign bucket never renders as a valid drop target mid-drag. */}
                      <Droppable droppableId={key} type={key}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className="flex flex-col gap-1.5"
                          >
                            {sectionTasks.map((task, index) => (
                              <Draggable
                                key={task.id}
                                draggableId={task.id}
                                index={index}
                                isDragDisabled={optimisticTaskIds.has(task.id)}
                                // The drag handle is a real <button> (needed for its own
                                // aria-label/44px hit target), and the library refuses to start a
                                // drag from any native interactive element (button/input/etc)
                                // unless this is set — otherwise Space silently no-ops instead of
                                // lifting, since tryGetLock's isEventInInteractiveElement check
                                // rejects the lock before it ever reaches our onDragEnd.
                                disableInteractiveElementBlocking
                              >
                                {(dragProvided) => (
                                  <div
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    className={optimisticTaskIds.has(task.id) ? "opacity-40" : undefined}
                                  >
                                    <TaskCard
                                      taskId={task.id}
                                      title={task.title}
                                      deadline={task.deadlineLabel}
                                      deadlineVariant={task.deadlineVariant}
                                      workspace={task.workspace.name}
                                      shared={task.shared}
                                      subtasks={task.subtasks}
                                      onEdit={() => setEditingTask(task)}
                                      dragHandleProps={dragProvided.dragHandleProps ?? undefined}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </DragDropContext>
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
