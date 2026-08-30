"use client";

import { deadlineFor } from "@/app/tasks/bucket-tasks";
import type { BoardTask } from "./group-columns";

/**
 * Deliberately thin: title, deadline, workspace, and a shared badge. Descriptions, subtasks and
 * updates are the list view's job — the board is for seeing where work stands at a glance, and a
 * card that carries everything defeats that.
 *
 * The column supplies its own tab20 colour as a rail and header tint; the card body stays on
 * --color-surface so the deadline stays the loudest signal on it.
 */
const VARIANT_CLASS = {
  red: "bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]",
  yellow: "bg-[var(--color-warning-surface)] text-[var(--color-warning-text)]",
  green: "bg-[var(--color-success-surface)] text-[var(--color-success-text)]",
} as const;

const KIND_CLASS: Record<string, string> = {
  household:
    "bg-[var(--color-kind-household-surface)] text-[var(--color-kind-household-text)]",
  work: "bg-[var(--color-kind-work-surface)] text-[var(--color-kind-work-text)]",
};

export function BoardCard({
  task,
  showWorkspace,
  now = new Date(),
}: {
  task: BoardTask;
  showWorkspace: boolean;
  now?: Date;
}) {
  const { label, variant } = deadlineFor(task.dueAt, now);

  // docs/product.md: a task with no deadline appears green, and a completed one neutral.
  const pillLabel = task.completedAt ? "Completed" : (label ?? "No due date");
  const pillVariant = task.completedAt ? null : (variant ?? "green");

  return (
    <article className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <h3
        className={`truncate text-sm font-medium ${
          task.completedAt
            ? "text-[var(--color-text-muted)] line-through"
            : "text-[var(--color-text-primary)]"
        }`}
        title={task.title}
      >
        {task.title}
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          data-variant={pillVariant ?? undefined}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            pillVariant
              ? VARIANT_CLASS[pillVariant]
              : "bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]"
          }`}
        >
          {pillLabel}
        </span>

        {showWorkspace && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              KIND_CLASS[task.workspaceKind] ??
              "bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
            }`}
          >
            {task.workspaceName}
          </span>
        )}

        {task.assigneeCount > 1 && (
          <span
            aria-label={`Shared with ${task.assigneeCount - 1} other ${
              task.assigneeCount - 1 === 1 ? "person" : "people"
            }`}
            className="inline-flex items-center rounded-full bg-[var(--color-accent-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--color-accent-text)]"
          >
            +{task.assigneeCount - 1}
          </span>
        )}
      </div>
    </article>
  );
}
