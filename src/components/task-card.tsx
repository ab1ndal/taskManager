"use client";

import { useState, useTransition } from "react";
import { Circle, CircleCheck, GripVertical, Pencil, Trash2 } from "lucide-react";
import { completeTask, deleteTask } from "@/app/tasks/actions";
import { ICON_PRIMARY, ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { toast } from "@/components/toaster";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";

export type DeadlineVariant = "red" | "yellow" | "green";

const deadlineStyles: Record<DeadlineVariant, string> = {
  red: "bg-red-50 text-[var(--color-deadline-red)]",
  yellow: "bg-amber-50 text-[var(--color-deadline-yellow)]",
  green: "bg-emerald-50 text-[var(--color-deadline-green)]",
};

export function DeadlineBadge({ variant, label }: { variant: DeadlineVariant; label: string }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${deadlineStyles[variant]}`}>
      {label}
    </span>
  );
}

export function SharedBadge() {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]">
      Shared
    </span>
  );
}

export function TaskCard({
  taskId,
  title,
  deadline,
  deadlineVariant,
  workspace,
  shared,
  completed,
  subtasks,
  onEdit,
  dragHandleProps,
}: {
  taskId: string;
  title: string;
  deadline?: string | null;
  deadlineVariant?: DeadlineVariant | null;
  workspace: string;
  shared?: boolean;
  completed?: boolean;
  subtasks?: { id: string; title: string; completed_at: string | null }[];
  onEdit?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const [pending, startTransition] = useTransition();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  /** Mutations return a result rather than throwing, so a failure has to be read off `ok`. */
  function runAction(action: () => Promise<{ ok: boolean; error?: string }>, fallback: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast(result.error ?? fallback, "error");
    });
  }

  return (
    <div
      className={`bg-[var(--color-surface)] rounded-[11px] border border-[var(--color-border)] px-4 py-3 transition-opacity ${pending ? "opacity-40" : ""}`}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-3">
        {dragHandleProps && (
          <button
            type="button"
            aria-label={`Reorder "${title}"`}
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] cursor-grab active:cursor-grabbing"
            {...dragHandleProps}
          >
            <GripVertical size={ICON_PRIMARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </button>
        )}

        {/* Complete button */}
        <button
          onClick={() => {
            // Completing a parent completes its open subtasks server-side, so an open subtask is no
            // longer a reason to block the button.
            if (!completed) runAction(() => completeTask(taskId), "Failed to complete task");
          }}
          aria-label={completed ? "Completed" : `Mark "${title}" complete`}
          disabled={completed}
          className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-border)] hover:text-[var(--color-accent)] disabled:cursor-default transition-colors"
        >
          {completed ? (
            <CircleCheck
              size={ICON_PRIMARY}
              strokeWidth={ICON_STROKE}
              className="text-[var(--color-text-muted)]"
              aria-hidden="true"
            />
          ) : (
            <Circle size={ICON_PRIMARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${completed ? "line-through text-[var(--color-text-muted)]" : "text-[var(--color-text-primary)]"}`}>
            {title}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {deadline && deadlineVariant && <DeadlineBadge variant={deadlineVariant} label={deadline} />}
            {shared && <SharedBadge />}
            <span className="text-[11px] text-[var(--color-text-muted)]">{workspace}</span>
          </div>
        </div>

        {!completed && onEdit && (
          <button
            onClick={onEdit}
            aria-label={`Edit "${title}"`}
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            <Pencil size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </button>
        )}

        {!completed && (
          <button
            onClick={() => setDeleteConfirmOpen(true)}
            aria-label={`Delete "${title}"`}
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
          >
            <Trash2 size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </button>
        )}
      </div>

      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        taskTitle={title}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          runAction(() => deleteTask(taskId), "Failed to delete task");
        }}
      />

      {/* Subtasks */}
      {(subtasks ?? []).length > 0 && (
        <div className="mt-2 ml-7 flex flex-col gap-1">
          {(subtasks ?? []).map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!sub.completed_at) runAction(() => completeTask(sub.id), "Failed to complete subtask");
                }}
                disabled={!!sub.completed_at}
                aria-label={sub.completed_at ? "Subtask completed" : `Mark "${sub.title}" complete`}
                className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-border)] hover:text-[var(--color-accent)] disabled:cursor-default transition-colors"
              >
                {sub.completed_at ? (
                  <CircleCheck
                    size={ICON_SECONDARY}
                    strokeWidth={ICON_STROKE}
                    className="text-[var(--color-text-muted)]"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
                )}
              </button>
              <span className={`text-xs ${sub.completed_at ? "line-through text-[var(--color-text-muted)]" : "text-[var(--color-text-secondary)]"}`}>
                {sub.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="var(--color-accent-subtle)" />
        <path
          d="M20 38 Q26 26 32 30 Q38 34 44 22"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="20" cy="38" r="2.5" fill="var(--color-accent)" opacity="0.4" />
        <circle cx="32" cy="30" r="2.5" fill="var(--color-accent)" opacity="0.65" />
        <circle cx="44" cy="22" r="2.5" fill="var(--color-accent)" />
        <path d="M24 46h16" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round" />
        <path d="M27 51h10" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-[var(--color-text-muted)]">
        No tasks yet.
        <br />
        Add one to get started.
      </p>
    </div>
  );
}
