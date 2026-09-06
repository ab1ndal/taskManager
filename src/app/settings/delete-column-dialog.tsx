"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { deleteBoardColumn, listTasksInColumn, type ColumnTask } from "@/app/board/actions";
import type { BoardColumn } from "@/app/board/group-columns";
import { Dialog } from "@/components/dialog";
import { toast } from "@/components/toaster";

/**
 * Deleting a column asks where each of its tasks should go.
 *
 * Not built on ConfirmDialog: that component renders its body inside a <p>, and this body is a list
 * of selects — invalid HTML nested that way. The buttons match its styling so the two read as the
 * same kind of decision.
 *
 * "Move all to" only sets the individual selects — the payload sent to the server is always
 * per-task, so there is no second code path where a bulk choice bypasses a row the user changed.
 */
export function DeleteColumnDialog({
  column,
  siblings,
  onClose,
  onDeleted,
}: {
  column: BoardColumn;
  siblings: BoardColumn[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [tasks, setTasks] = useState<ColumnTask[] | null>(null);
  const [targetByTaskId, setTargetByTaskId] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // The nearest column on the left, or the nearest on the right when deleting the leftmost. A
  // neighbour is the least surprising destination; there is no attempt to guess anything cleverer.
  const defaultTarget =
    [...siblings]
      .filter((sibling) => sibling.position < column.position)
      .sort((a, b) => b.position - a.position)[0]?.id ??
    [...siblings].sort((a, b) => a.position - b.position)[0]?.id ??
    "";

  // Every load claims a generation. A response whose generation is no longer current belongs to a
  // superseded load or to an unmounted dialog, and is discarded rather than written to state.
  const generationRef = useRef(0);

  const load = useCallback(() => {
    const generation = ++generationRef.current;

    return listTasksInColumn({ columnId: column.id }).then((result) => {
      if (generation !== generationRef.current) return false;

      if (!result.ok) {
        toast(result.error ?? "Could not load this column's tasks", "error");
        onClose();
        return false;
      }

      setTasks(result.tasks);
      setTargetByTaskId(Object.fromEntries(result.tasks.map((task) => [task.id, defaultTarget])));
      return true;
    });
  }, [column.id, defaultTarget, onClose]);

  useEffect(() => {
    void load();
    // Bumping the generation on unmount (and before a re-run) retires whatever load is in flight.
    return () => {
      generationRef.current += 1;
    };
  }, [load]);

  async function confirm() {
    if (!tasks || busy) return;

    setBusy(true);
    const result = await deleteBoardColumn({
      columnId: column.id,
      moves: tasks.map((task) => ({ taskId: task.id, targetColumnId: targetByTaskId[task.id] })),
    });

    if (result.ok) {
      onDeleted();
      return;
    }

    // The RPC's coverage check failed: someone changed the column while this dialog was open. Show
    // what is actually there now rather than deleting a column whose contents were never seen.
    // `busy` stays true across the reload, so a second click cannot confirm against the old list.
    if (result.error?.includes("changed since it was listed")) {
      toast("This column changed — check the list and try again.", "error");
      const applied = await load();
      if (applied) setBusy(false);
      return;
    }

    setBusy(false);
    toast(result.error ?? "Could not delete the column", "error");
  }

  const headingId = `delete-column-${column.id}`;

  return (
    <Dialog
      open
      onClose={onClose}
      initialFocusSelector="[data-cancel-button]"
      ariaLabelledBy={headingId}
      className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl backdrop:bg-[var(--color-scrim)] max-h-[90dvh] overflow-y-auto"
    >
      <h3 id={headingId} className="text-base font-semibold">
        Delete “{column.name}”?
      </h3>

      {column.isDone && (
        <p className="mt-3 rounded-sm bg-[var(--color-warning-surface)] p-2 text-sm text-[var(--color-warning-text)]">
          This is where completed tasks appear. Without it, completed tasks will no longer appear on
          the board.
        </p>
      )}

      <div className="mt-3">
        {tasks === null ? (
          <p className="text-sm text-[var(--color-text-secondary)]" aria-busy="true">
            Loading this column’s tasks…
          </p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">This column is empty.</p>
        ) : (
          <>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {tasks.length} {tasks.length === 1 ? "task is" : "tasks are"} in this column. Choose
              where each one goes.
            </p>

            <label className="mt-3 flex items-center gap-2 rounded-sm bg-[var(--color-accent-subtle)] p-2 text-sm">
              <span className="text-[var(--color-text-secondary)]">Move all tasks to</span>
              <select
                aria-label="Move all tasks to"
                defaultValue=""
                onChange={(event) => {
                  const target = event.target.value;
                  if (!target) return;
                  setTargetByTaskId(Object.fromEntries(tasks.map((task) => [task.id, target])));
                }}
                className="h-11 flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
              >
                <option value="">Choose a column…</option>
                {siblings.map((sibling) => (
                  <option key={sibling.id} value={sibling.id}>
                    {sibling.name}
                  </option>
                ))}
              </select>
            </label>

            <ul className="mt-2 flex max-h-64 flex-col overflow-y-auto">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-2 border-t border-[var(--color-border)] py-2 first:border-t-0"
                >
                  <span className="min-w-0 flex-1 truncate text-sm" title={task.title}>
                    {task.title}
                  </span>
                  <select
                    aria-label={`Move ${task.title} to`}
                    value={targetByTaskId[task.id] ?? ""}
                    onChange={(event) =>
                      setTargetByTaskId((prev) => ({ ...prev, [task.id]: event.target.value }))
                    }
                    className="h-11 w-40 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
                  >
                    {siblings.map((sibling) => (
                      <option key={sibling.id} value={sibling.id}>
                        {sibling.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-text-secondary)]">
        This applies to everyone in the workspace.
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          data-cancel-button
          onClick={onClose}
          className="min-h-11 rounded-sm border border-[var(--color-border)] px-4 py-2 text-sm transition-colors hover:bg-[var(--color-accent-subtle)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy || tasks === null}
          className="min-h-11 rounded-sm bg-[var(--color-danger-solid)] px-4 py-2 text-sm font-medium text-[var(--color-text-on-solid)] transition-colors hover:bg-[var(--color-danger-solid-hover)] disabled:opacity-50"
        >
          Delete column
        </button>
      </div>
    </Dialog>
  );
}
