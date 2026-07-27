"use client";

import { useState, useTransition } from "react";
import { Circle, CircleCheck, GripVertical, Pencil, Trash2 } from "lucide-react";
import { completeTask, deleteTask } from "@/app/tasks/actions";
import { ICON_PRIMARY, ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { toast } from "@/components/toaster";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";

export type DeadlineVariant = "red" | "yellow" | "green";

/**
 * Deadline urgency reads through the status tokens rather than raw palette classes, so it survives
 * the theme swap. The old pairings (#D4A017 on amber-50, #4A9B6F on emerald-50) sat at roughly
 * 2.3:1 and 3.1:1 — below AA for text this small.
 */
const deadlineStyles: Record<DeadlineVariant, string> = {
  red: "bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]",
  yellow: "bg-[var(--color-warning-surface)] text-[var(--color-warning-text)]",
  green: "bg-[var(--color-success-surface)] text-[var(--color-success-text)]",
};

export function DeadlineBadge({ variant, label }: { variant: DeadlineVariant; label: string }) {
  return (
    <span className={`text-2xs font-medium px-2 py-0.5 rounded-full ${deadlineStyles[variant]}`}>
      {label}
    </span>
  );
}

export function SharedBadge() {
  return (
    <span className="text-2xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]">
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
      className={`group bg-[var(--color-surface)] rounded-md border border-[var(--color-border)] px-2 py-3 sm:px-4 transition-opacity ${pending ? "opacity-40" : ""}`}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/*
        Tighter gutters and gaps below `sm`. Four 44px controls plus 32px of padding and three 12px
        gaps consumed 244px of a 375px row, leaving the title around 90px. This buys back ~50px.
        It does not fully solve it — see the note in 06.5-AUDIT.md; the real answer for phones is an
        overflow menu, which is a bigger change than this pass.
      */}
      <div className="flex items-center gap-1 sm:gap-3">
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
          className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-control-idle)] hover:text-[var(--color-accent)] disabled:cursor-default transition-colors"
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
          {/*
            `truncate` clipped the title to a single line, which on a 375px row — after a drag
            handle, a complete toggle, edit and delete all hold their 44px — left about 90px and
            rendered "Renew t…". Two lines then ellipsis keeps the row compact while making most
            titles fully readable.
          */}
          <p className={`text-sm font-medium line-clamp-2 ${completed ? "line-through text-[var(--color-text-muted)]" : "text-[var(--color-text-primary)]"}`}>
            {title}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {deadline && deadlineVariant && <DeadlineBadge variant={deadlineVariant} label={deadline} />}
            {shared && <SharedBadge />}
            <span className="text-xs text-[var(--color-text-muted)]">{workspace}</span>
          </div>
        </div>

        {/*
          Edit and delete stay rendered at every viewport rather than appearing on hover: hover is
          not available on touch, and hiding a destructive action behind it makes the row's
          capabilities undiscoverable. They are de-emphasised instead — dimmed until the row is
          hovered or something inside it takes focus — so four grey glyphs stop competing with the
          task title while remaining tappable and visible to a keyboard user the moment they arrive.
        */}
        {!completed && onEdit && (
          <button
            onClick={onEdit}
            aria-label={`Edit "${title}"`}
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-[var(--color-accent)] transition-[opacity,color]"
          >
            <Pencil size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </button>
        )}

        {!completed && (
          <button
            onClick={() => setDeleteConfirmOpen(true)}
            aria-label={`Delete "${title}"`}
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-[var(--color-danger-text)] transition-[opacity,color]"
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

      {/*
        The old `ml-7` put each subtask's mark at an arbitrary offset, reading as a floating dot
        rather than a nested item. `ml-14` is one control width plus the row's gap, which is what
        actually lands the subtask toggles under the parent's complete button — `ml-11` looked
        right on paper and was still 12px out once rendered.

        The button stays a full 44x44 despite holding a 16px glyph. Phase 04 established that
        minimum and it is the one thing here not to trade for tighter rhythm.
      */}
      {(subtasks ?? []).length > 0 && (
        <div className="mt-1 ml-14 flex flex-col">
          {(subtasks ?? []).map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!sub.completed_at) runAction(() => completeTask(sub.id), "Failed to complete subtask");
                }}
                disabled={!!sub.completed_at}
                aria-label={sub.completed_at ? "Subtask completed" : `Mark "${sub.title}" complete`}
                className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-control-idle)] hover:text-[var(--color-accent)] disabled:cursor-default transition-colors"
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

/**
 * Two different nothings. `variant="no-tasks"` means the user genuinely has none and the useful
 * thing to say is "add one". `variant="no-matches"` means a filter emptied the list — telling that
 * user to add a task is wrong, so they get a way back to the full list instead.
 */
export function EmptyState({
  variant = "no-tasks",
  onClearFilter,
}: {
  variant?: "no-tasks" | "no-matches";
  onClearFilter?: () => void;
} = {}) {
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
      {variant === "no-tasks" ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          No tasks yet.
          <br />
          Add one to get started.
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">
            Nothing matches this view.
            <br />
            Your other tasks are still here.
          </p>
          {onClearFilter && (
            <button
              type="button"
              onClick={onClearFilter}
              className="text-sm font-medium text-[var(--color-accent)] hover:underline"
            >
              Show all tasks
            </button>
          )}
        </>
      )}
    </div>
  );
}
