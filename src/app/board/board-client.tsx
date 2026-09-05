"use client";

import { useMemo, useState } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";

import { computeNeighborKeys } from "@/app/tasks/reorder-helpers";
import { EditTaskModal } from "@/app/tasks/edit-task-modal";
import { NewTaskModal } from "@/app/tasks/new-task-modal";
import type { RawTask } from "@/app/tasks/bucket-tasks";
import type { Workspace } from "@/app/tasks/task-fields";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { toast } from "@/components/toaster";
import { BoardCard } from "./board-card";
import { MoveTaskDialog } from "./move-task-dialog";
import {
  DONE_WINDOW_DAYS,
  groupTasks,
  mergeColumns,
  resolveDropTarget,
  type BoardColumn,
  type BoardTask,
  type MergedColumn,
} from "./group-columns";
import { loadOlderDone, loadTaskForEdit, moveTaskToColumn } from "./move-actions";

/**
 * Applies a drop.
 *
 * Exported and built as a factory so tests can call it with a fabricated DropResult:
 * @hello-pangea/dnd's sensors are not designed to be driven by synthetic DOM events, which is the
 * same reason tasks-page-client.tsx exports buildDragEndHandler.
 */
export function buildBoardDragEndHandler({
  merged,
  groupedByKey,
  memberIdByWorkspaceId,
  setLocalTasks,
  onError,
}: {
  merged: MergedColumn[];
  /** The *rendered* arrays: destination.index is an index into what the user can see. */
  groupedByKey: Record<string, BoardTask[]>;
  memberIdByWorkspaceId: Record<string, string>;
  setLocalTasks: (updater: (prev: BoardTask[]) => BoardTask[]) => void;
  onError: (message: string) => void;
}) {
  return async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const dragged = groupedByKey[source.droppableId]?.find((t) => t.id === draggableId);
    if (!dragged) return;

    const targetColumn = merged.find((c) => c.key === destination.droppableId);
    if (!targetColumn) return;

    // On the all-workspaces board a column may be merged from several workspaces' columns. The card
    // must land in its own workspace's column, and if that workspace has no column by this name the
    // drop is refused rather than inventing one.
    const columnId = resolveDropTarget(targetColumn, dragged.workspaceId);
    if (!columnId) {
      onError(`${dragged.workspaceName} has no "${targetColumn.name}" column`);
      return;
    }

    const memberId = memberIdByWorkspaceId[dragged.workspaceId];
    if (!memberId) {
      onError("Could not determine your membership for this task's workspace");
      return;
    }

    const withoutDragged = (groupedByKey[destination.droppableId] ?? []).filter(
      (t) => t.id !== draggableId
    );
    const reordered = [
      ...withoutDragged.slice(0, destination.index),
      dragged,
      ...withoutDragged.slice(destination.index),
    ];
    const { prevKey, nextKey } = computeNeighborKeys(
      reordered.map((t) => ({ member_sort_key: t.memberSortKey })),
      destination.index
    );

    // Must stay in sync with move_task_to_column's arithmetic in migration 016 and with reorderTask:
    // all three compute the same key, one optimistically and two authoritatively.
    const optimisticKey =
      prevKey !== null && nextKey !== null
        ? (prevKey + nextKey) / 2
        : prevKey !== null
          ? prevKey + 1000
          : nextKey !== null
            ? nextKey - 1000
            : dragged.memberSortKey;

    // groupTasks() renders by completedAt, not boardColumnId: any task with completedAt set lands
    // in the terminal column regardless of its column, and an open task pointed at the terminal
    // column is re-homed to the first non-terminal one. So moving boardColumnId alone is not enough
    // — a drop into Completed needs completedAt set too, or the card renders back in the leftmost
    // column; a drag out of Completed needs it cleared, or the card snaps back into Completed.
    // Moving between two non-terminal columns touches neither: completedAt is already null there.
    //
    // Both branches are guarded by whether completedAt is actually transitioning, not just by which
    // column is terminal: a reorder *within* Done (source and destination both terminal, different
    // index only) reaches this code too, since the early return above only bails on an identical
    // index. Stamping unconditionally on `targetColumn.isDone` would give that reorder a fresh
    // timestamp the server never applies — move_task_to_column only calls completeTask/reopenTask
    // when terminal-ness changes — so the card would jump to the top of Done's newest-first sort
    // and then snap back once the props resync lands. Guarding on `dragged.completedAt === null`
    // (only transitioning open->done stamps a new time) mirrors the exit guard exactly.
    const completedAt = targetColumn.isDone
      ? dragged.completedAt === null
        ? new Date().toISOString()
        : dragged.completedAt
      : dragged.completedAt !== null
        ? null
        : dragged.completedAt;

    setLocalTasks((prev) =>
      prev.map((t) =>
        t.id === draggableId
          ? { ...t, boardColumnId: columnId, memberSortKey: optimisticKey, completedAt }
          : t
      )
    );

    const res = await moveTaskToColumn({ taskId: draggableId, columnId, memberId, prevKey, nextKey });

    if (!res.ok) {
      // Roll back this card only, and all three fields the optimistic update touched. Replacing
      // the whole array would erase anything else that moved during the await; restoring only some
      // of the three fields is exactly how this class of bug (Task 10 review, Important 2)
      // reappears — a card left in the wrong terminal-vs-open state after a failed drop.
      setLocalTasks((prev) =>
        prev.map((t) =>
          t.id === draggableId
            ? {
                ...t,
                boardColumnId: dragged.boardColumnId,
                memberSortKey: dragged.memberSortKey,
                completedAt: dragged.completedAt,
              }
            : t
        )
      );
      onError(res.error ?? "Failed to move task");
    }
  };
}

export function BoardClient({
  columns,
  tasks,
  memberIdByWorkspaceId,
  workspaceIds,
  showWorkspace,
  workspaces,
  currentMemberIds,
}: {
  columns: BoardColumn[];
  tasks: BoardTask[];
  memberIdByWorkspaceId: Record<string, string>;
  workspaceIds: string[];
  showWorkspace: boolean;
  /** Every workspace the user belongs to, with its members. Feeds both task modals. */
  workspaces: Workspace[];
  currentMemberIds: string[];
}) {
  const [localTasks, setLocalTasks] = useState(tasks);
  const [movingTask, setMovingTask] = useState<BoardTask | null>(null);

  // Server data is the source of truth: moveTaskToColumn revalidates "/board", so a completed drop
  // arrives here as fresh `tasks` props, not just a resolved promise. Without this, the optimistic
  // overlay above is permanent — the board would never pick up a server-side correction or a change
  // made from another tab. Adjusting during render rather than in an effect avoids the extra pass
  // that renders stale rows first (react-hooks/set-state-in-effect) — mirrors tasks-page-client.tsx.
  // Only localTasks is reset here, not olderDone/doneExpanded/moreOlder: the initial fetch is
  // bounded to the done window and loadOlderDone only ever returns rows strictly older than its
  // cursor, so the two populations are disjoint by construction — there is no stale "older" state
  // for a fresh `tasks` prop to invalidate.
  const [syncedFrom, setSyncedFrom] = useState(tasks);
  if (syncedFrom !== tasks) {
    setSyncedFrom(tasks);
    setLocalTasks(tasks);
  }

  /**
   * The task behind an opened card. `null` while nothing is open; the id alone while its full row
   * is still loading, so a slow fetch cannot leave the press with no feedback at all.
   */
  const [editingTask, setEditingTask] = useState<RawTask | null>(null);
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(null);

  /** The column "Add task" was pressed in, so the new task lands there rather than leftmost. */
  const [addingIn, setAddingIn] = useState<{ columnId: string; workspaceId: string } | null>(null);

  /** Older completed tasks the user asked for. Client state: a fresh visit starts collapsed. */
  const [olderDone, setOlderDone] = useState<BoardTask[]>([]);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [moreOlder, setMoreOlder] = useState(true);

  const merged = useMemo(() => mergeColumns(columns), [columns]);
  const groupedByKey = useMemo(() => {
    const grouped = groupTasks(merged, localTasks);
    const terminal = merged.find((c) => c.isDone);
    if (terminal && doneExpanded) {
      grouped[terminal.key] = [...grouped[terminal.key], ...olderDone];
    }
    return grouped;
  }, [merged, localTasks, doneExpanded, olderDone]);

  const onDragEnd = buildBoardDragEndHandler({
    merged,
    groupedByKey,
    memberIdByWorkspaceId,
    setLocalTasks,
    onError: (message) => toast(message, "error"),
  });

  /**
   * Opens a card. The board's own query carries four fields per task; the edit modal needs
   * description, members, subtasks and recurrence, so the rest is fetched here rather than joined
   * into every render of the board.
   */
  async function openTask(taskId: string) {
    setOpeningTaskId(taskId);
    const res = await loadTaskForEdit(taskId);
    setOpeningTaskId(null);

    if (!res.ok) {
      toast(res.error ?? "Could not open that task", "error");
      return;
    }
    setEditingTask(res.task);
  }

  async function showOlder() {
    const terminal = merged.find((c) => c.isDone);
    if (!terminal) return;

    // The cursor is the PAIR (completedAt, id) of the oldest card on screen. Passing `beforeId` is
    // mandatory, not optional: loadOlderDone falls back to a completed_at-only comparison without it,
    // and two tasks sharing a completed_at across a page boundary would silently lose one. See the
    // Task 6 review findings.
    const shown = groupedByKey[terminal.key];
    const oldest = shown.reduce<{ completedAt: string; id: string } | null>((acc, t) => {
      if (!t.completedAt) return acc;
      if (acc === null) return { completedAt: t.completedAt, id: t.id };
      if (t.completedAt < acc.completedAt) return { completedAt: t.completedAt, id: t.id };
      if (t.completedAt === acc.completedAt && t.id < acc.id) return { completedAt: t.completedAt, id: t.id };
      return acc;
    }, null);

    setLoadingOlder(true);
    const res = await loadOlderDone({
      workspaceIds,
      before:
        oldest?.completedAt ??
        new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString(),
      beforeId: oldest?.id,
    });
    setLoadingOlder(false);

    if (!res.ok) {
      toast(res.error ?? "Could not load older tasks", "error");
      return;
    }

    // The older page carries no workspace names — they come from the columns already on screen.
    const nameByWorkspaceId = new Map(localTasks.map((t) => [t.workspaceId, t]));
    setOlderDone((prev) => [
      ...prev,
      ...res.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt,
        completedAt: t.completedAt,
        workspaceId: t.workspaceId,
        workspaceName: nameByWorkspaceId.get(t.workspaceId)?.workspaceName ?? "",
        workspaceKind: nameByWorkspaceId.get(t.workspaceId)?.workspaceKind ?? "",
        boardColumnId: t.boardColumnId,
        memberSortKey: t.memberSortKey,
        assigneeCount: 1,
      })),
    ]);
    setMoreOlder(res.hasMore);
    setDoneExpanded(true);
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      {/*
        `relative` is load-bearing, not decoration. The strip scrolls sideways and clips its own
        columns correctly, but the `sr-only` live region in the Done footer is absolutely
        positioned: with no positioned ancestor its containing block is the page, so it sat at the
        strip's scroll width rather than inside it and the whole document — nav included — scrolled
        sideways. e2e/layout.spec.ts asserts the page does not scroll horizontally, which caught it.

        `contain: paint` was the previous answer here and was wrong. It also makes this div a
        containing block for *fixed* descendants, and @hello-pangea/dnd lifts a card as
        `position: fixed` at its viewport coordinates — which were then re-anchored to this div,
        floating the dragged card ~98px below the cursor so it could not be aimed. `relative`
        contains the absolute descendant and leaves fixed ones on the viewport, which is the
        distinction the drag depends on.
      */}
      <div className="relative isolate flex gap-4 overflow-x-auto px-4 pb-6 pt-1">
        {merged.map((column) => {
          const items = groupedByKey[column.key] ?? [];
          // A merged column whose workspaces disagree on colour (color === null) stays neutral —
          // group-columns.ts's own rule, not restated here beyond reading the field.
          const accent = column.color ? `var(--color-${column.color})` : "var(--color-text-muted)";

          return (
            <section
              key={column.key}
              aria-label={`${column.name}, ${items.length} task${items.length === 1 ? "" : "s"}`}
              className="flex w-72 shrink-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
            >
              <header
                className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-lg border-b-2 bg-[var(--color-surface)] px-3 py-2.5"
                style={{ borderBottomColor: accent }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                  <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                    {column.name}
                  </h2>
                </div>
                {/* An empty column says so in its body; a `0` here as well is the same fact twice. */}
                {items.length > 0 && (
                  <span className="shrink-0 rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--color-text-secondary)]">
                    {items.length}
                  </span>
                )}
              </header>

              <Droppable droppableId={column.key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    /*
                      The hovered column tints while a card is over it. Before this, a drag had no
                      feedback of any kind: nothing lifted, nothing highlighted, and the only way to
                      tell where a card would land was to let go and see.
                    */
                    className={`flex flex-1 flex-col gap-2 p-2 transition-colors duration-150 ease-out ${
                      snapshot.isDraggingOver ? "bg-[var(--color-accent-subtle)]" : ""
                    } ${column.isDone && doneExpanded ? "max-h-[60dvh] overflow-y-auto" : ""}`}
                  >
                    {items.map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={`rounded-md ${openingTaskId === task.id ? "opacity-60" : ""}`}
                          >
                            <BoardCard
                              task={task}
                              onMove={() => setMovingTask(task)}
                              showWorkspace={showWorkspace}
                              isDragging={dragSnapshot.isDragging}
                              dragHandleProps={dragProvided.dragHandleProps ?? undefined}
                              onOpen={task.completedAt ? undefined : () => void openTask(task.id)}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}

                    {/*
                      An empty column used to render as a tall blank rectangle with a `0` beside its
                      name. Three of five columns looked broken on a normal board. The terminal
                      column keeps its own footer instead, which already explains itself.
                    */}
                    {items.length === 0 && !snapshot.isDraggingOver && (
                      <p className="grid flex-1 place-content-center px-2 py-6 text-center text-xs text-[var(--color-text-muted)]">
                        {column.isDone ? "Nothing finished yet." : "Drop a task here, or add one below."}
                      </p>
                    )}
                  </div>
                )}
              </Droppable>

              {/*
                Adding straight into a column, rather than into whichever column happens to be
                leftmost. Hidden on the terminal column: a task created as already-completed is not
                a thing this product has.
              */}
              {!column.isDone && (() => {
                const workspaceId = workspaceIds.length === 1 ? workspaceIds[0] : null;
                const columnId = workspaceId ? column.columnIdByWorkspaceId[workspaceId] : null;
                if (!workspaceId || !columnId) return null;
                return (
                  <button
                    type="button"
                    onClick={() => setAddingIn({ columnId, workspaceId })}
                    aria-label={`Add a task to ${column.name}`}
                    className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-b-lg border-t border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent-text)]"
                  >
                    <Plus size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
                    Add task
                  </button>
                );
              })()}

              {column.isDone && (() => {
                const footerDisabled = loadingOlder || (doneExpanded && !moreOlder);
                const label = loadingOlder
                  ? "Loading…"
                  : doneExpanded && !moreOlder
                    ? "No older tasks"
                    : doneExpanded
                      ? "Show more"
                      : "Show older";
                return (
                  <button
                    type="button"
                    onClick={() => {
                      // aria-disabled, not the disabled attribute: a disabled button drops out of
                      // the tab order and keyboard focus lands on <body>, losing the user's place —
                      // aria-disabled keeps it focusable and this guard keeps it inert.
                      if (footerDisabled) return;
                      void showOlder();
                    }}
                    aria-disabled={footerDisabled}
                    aria-busy={loadingOlder}
                    className="min-h-11 w-full rounded-b-lg border-t border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-subtle)] aria-disabled:cursor-default aria-disabled:opacity-60 aria-disabled:hover:bg-transparent"
                  >
                    {label}
                    {/* The label change ("Loading…" / "No older tasks") is otherwise silent to a
                        screen reader: nothing else on the page moves focus or announces it. */}
                    <span role="status" aria-live="polite" className="sr-only">
                      {loadingOlder ? "Loading older tasks" : doneExpanded && !moreOlder ? "No older tasks" : ""}
                    </span>
                  </button>
                );
              })()}
            </section>
          );
        })}
      </div>

      {/*
        Both modals are the list view's, unchanged. The board contributes the column context and
        nothing else — a second editor for the same task would be two places to fix every bug.
      */}
      {addingIn && (
        <NewTaskModal
          open
          onClose={() => setAddingIn(null)}
          workspaces={workspaces}
          currentMemberIds={currentMemberIds}
          initialWorkspaceId={addingIn.workspaceId}
          boardColumnId={addingIn.columnId}
        />
      )}

      {movingTask && (
        <MoveTaskDialog
          task={movingTask}
          columns={columns.filter((column) => column.workspaceId === movingTask.workspaceId)}
          memberId={memberIdByWorkspaceId[movingTask.workspaceId]}
          onClose={() => setMovingTask(null)}
        />
      )}

      {editingTask && (
        <EditTaskModal
          open
          task={editingTask}
          workspaces={workspaces}
          memberIdByWorkspaceId={memberIdByWorkspaceId}
          onClose={() => setEditingTask(null)}
        />
      )}
    </DragDropContext>
  );
}
