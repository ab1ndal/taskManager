"use client";

import { useId, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import type { BoardColumn, BoardTask } from "./group-columns";
import { moveTaskToColumn } from "./move-actions";

/** A keyboard and touch alternative to dragging across a horizontally scrolling board. */
export function MoveTaskDialog({ task, columns, memberId, onClose }: {
  task: BoardTask;
  columns: BoardColumn[];
  memberId: string | undefined;
  onClose: () => void;
}) {
  const id = useId();
  const current = task.completedAt
    ? columns.find((column) => column.isDone)?.id
    : task.boardColumnId;
  const [columnId, setColumnId] = useState(current ?? columns[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const target = columns.find((column) => column.id === columnId);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !target || columnId === current) return;
    if (!memberId) {
      setError("Could not determine your membership for this workspace");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        // No reorder requested: preserve this user's existing priority key.
        const result = await moveTaskToColumn({
          taskId: task.id, columnId, memberId, prevKey: null, nextKey: null,
        });
        if (!result.ok) {
          setError(result.error ?? "Could not move the task");
          return;
        }
        onClose();
      } catch {
        setError("Could not move the task. Please try again.");
      }
    });
  }

  return (
    <Dialog open onClose={onClose} ariaLabelledBy={`${id}-title`} initialFocusSelector="select">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 id={`${id}-title`} className="text-base font-semibold">Move task</h2>
        <p className="break-words text-sm text-[var(--color-text-secondary)]">{task.title}</p>
        <label htmlFor={`${id}-column`} className="text-sm font-medium">Move to column</label>
        <select
          id={`${id}-column`}
          value={columnId}
          onChange={(event) => setColumnId(event.target.value)}
          disabled={pending}
          className="min-h-11 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-base"
        >
          {columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
        </select>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {target?.isDone && !task.completedAt
            ? "This completes the task and its subtasks. "
            : target && !target.isDone && task.completedAt ? "This reopens the task. " : ""}
          This move applies to everyone assigned to this task in {task.workspaceName}.
        </p>
        {error && <p role="alert" className="text-sm text-[var(--color-danger-text)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-sm border border-[var(--color-border)] px-4">Cancel</button>
          <button type="submit" disabled={pending || !target || columnId === current}
            className="min-h-11 rounded-sm bg-[var(--color-accent)] px-4 font-medium text-[var(--color-text-on-accent)] disabled:opacity-50">
            {pending ? "Moving…" : "Move task"}
          </button>
        </div>
        <span role="status" className="sr-only">{pending ? "Saving task move" : ""}</span>
      </form>
    </Dialog>
  );
}
