"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, CircleCheck, Pencil, RotateCcw, Trash2 } from "lucide-react";

import { deadlineFor } from "@/app/tasks/bucket-tasks";
import { completeTask, deleteTask, reopenTask } from "@/app/tasks/actions";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { RowMenu } from "@/components/row-menu";
import { toast } from "@/components/toaster";
import type { BoardTask } from "./group-columns";

/**
 * Deliberately thin: title, deadline, workspace, and a shared badge. Descriptions, subtasks and
 * updates are the list view's job — the board is for seeing where work stands at a glance, and a
 * card that carries everything defeats that.
 *
 * Thin is about what it *shows*, not what it can *do*. The card was previously drag-only: no way to
 * read a task, edit it, or delete it without leaving for /tasks. Pressing it opens the task, and the
 * two secondary actions live in a menu, the same pair the list row offers.
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
  onOpen,
  onMove,
  isDragging = false,
  dragHandleProps,
  now = new Date(),
}: {
  task: BoardTask;
  showWorkspace: boolean;
  onMove?: () => void;
  /** Absent on a completed card, which has nothing to edit until it is reopened. */
  onOpen?: () => void;
  /** Drives the lift. Comes from the Draggable's snapshot, not from local state. */
  isDragging?: boolean;
  /**
   * Applied to the card's body, not to the article. @hello-pangea/dnd puts `role="button"` on
   * whatever carries these, and the actions menu is a button too — wrapping the whole card would
   * nest one interactive element inside another, which axe fails on `nested-interactive` and which
   * leaves a screen reader announcing a button that contains a button.
   */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  now?: Date;
}) {
  const [pending, startTransition] = useTransition();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { label, variant } = deadlineFor(task.dueAt, now);

  // docs/product.md: a task with no deadline appears green, and a completed one neutral.
  const pillLabel = task.completedAt ? "Completed" : (label ?? "No due date");
  const pillVariant = task.completedAt ? null : (variant ?? "green");

  function runAction(action: () => Promise<{ ok: boolean; error?: string }>, fallback: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast(result.error ?? fallback, "error");
    });
  }

  return (
    <article
      /*
        The lift lives on this element rather than on the Draggable wrapper above it, which carries
        @hello-pangea/dnd's own inline `transform`. A Tailwind `scale-*` class there would be
        overridden by that inline style on every frame of the drag.
      */
      className={`relative rounded-md border bg-[var(--color-surface)] p-3 transition-[transform,box-shadow,opacity] duration-150 ease-out ${
        isDragging
          ? "scale-[1.02] border-[var(--color-accent)]"
          : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
      } ${pending ? "opacity-40" : ""}`}
      style={{ boxShadow: isDragging ? "var(--shadow-lifted)" : "var(--shadow-card)" }}
    >
      <div
        {...dragHandleProps}
        /*
          Enter opens the task. The library's keyboard sensor uses Space to lift and the arrows to
          move, so the two gestures do not collide. A plain click is safe for the same reason a
          click on any drag handle is: a press that never crosses the movement threshold is not a
          drag.
        */
        onClick={(event) => {
          if (event.defaultPrevented) return;
          onOpen?.();
        }}
        onKeyDown={(event) => {
          dragHandleProps?.onKeyDown?.(event);
          if (event.key !== "Enter" || event.defaultPrevented) return;
          event.preventDefault();
          onOpen?.();
        }}
        className={`rounded-sm ${onOpen ? "cursor-pointer" : "cursor-grab"} active:cursor-grabbing`}
      >
        {/*
          Two lines, not one. `truncate` clipped "Renew the household contents ins…" while the list
          view is covered by a test that asserts the opposite (e2e/layout.spec.ts). A `title`
          tooltip was the only way to read the rest, and tooltips do not exist on touch.
        */}
        <h3
          className={`pr-7 text-sm font-medium [overflow-wrap:anywhere] ${
            task.completedAt
              ? "text-[var(--color-text-muted)] line-through"
              : "text-[var(--color-text-primary)]"
          }`}
        >
          {task.title}
        </h3>
      </div>

      {/* Outside the drag handle: see `dragHandleProps` above. */}
      <div className="absolute right-1.5 top-1.5">
          <RowMenu
            label={`More actions for "${task.title}"`}
            items={[
              ...(onMove ? [{
                label: "Move to column…",
                onSelect: onMove,
                icon: <ArrowRightLeft size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
              }] : []),
              ...(onOpen
                ? [
                    {
                      label: "Edit",
                      onSelect: onOpen,
                      icon: <Pencil size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
                    },
                  ]
                : []),
              task.completedAt
                ? {
                    label: "Reopen",
                    onSelect: () => runAction(() => reopenTask(task.id), "Failed to reopen task"),
                    icon: <RotateCcw size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
                  }
                : {
                    label: "Complete",
                    onSelect: () => runAction(() => completeTask(task.id), "Failed to complete task"),
                    icon: <CircleCheck size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
                  },
              {
                label: "Delete",
                onSelect: () => setDeleteConfirmOpen(true),
                icon: <Trash2 size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />,
                danger: true,
              },
            ]}
          />
      </div>

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

      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        taskTitle={task.title}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          runAction(() => deleteTask(task.id), "Failed to delete task");
        }}
      />
    </article>
  );
}
