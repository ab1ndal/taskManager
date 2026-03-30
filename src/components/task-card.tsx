"use client";

import { useTransition } from "react";
import { completeTask, deleteTask } from "@/app/tasks/actions";

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
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div
      className={`bg-[var(--color-surface)] rounded-[11px] border border-[var(--color-border)] px-4 py-3 transition-opacity ${pending ? "opacity-40" : ""}`}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-3">
        {/* Complete button */}
        <button
          onClick={() => {
            const hasIncomplete = (subtasks ?? []).some((s) => !s.completed_at);
            if (!completed && !hasIncomplete) startTransition(() => completeTask(taskId));
          }}
          aria-label={completed ? "Completed" : "Mark complete"}
          disabled={completed || (subtasks ?? []).some((s) => !s.completed_at)}
          className="flex-shrink-0 text-[var(--color-border)] hover:text-[var(--color-accent)] disabled:cursor-default transition-colors"
        >
          {completed ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.8" className="text-[var(--color-text-muted)]" />
              <path d="M5.5 9.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)]" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.8" />
            </svg>
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
            aria-label="Edit task"
            className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" />
            </svg>
          </button>
        )}

        {!completed && (
          <button
            onClick={() => {
              if (!window.confirm(`Delete "${title}"?`)) return;
              startTransition(() => deleteTask(taskId));
            }}
            aria-label="Delete task"
            className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M5.5 6v4M8.5 6v4M3 3.5l.5 8a.5.5 0 00.5.5h6a.5.5 0 00.5-.5l.5-8" />
            </svg>
          </button>
        )}
      </div>

      {/* Subtasks */}
      {(subtasks ?? []).length > 0 && (
        <div className="mt-2 ml-7 flex flex-col gap-1">
          {(subtasks ?? []).map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <button
                onClick={() => { if (!sub.completed_at) startTransition(() => completeTask(sub.id)); }}
                disabled={!!sub.completed_at}
                aria-label={sub.completed_at ? "Subtask completed" : "Complete subtask"}
                className="flex-shrink-0 text-[var(--color-border)] hover:text-[var(--color-accent)] disabled:cursor-default transition-colors"
              >
                {sub.completed_at ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-text-muted)]" />
                    <path d="M4 7.5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)]" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
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
