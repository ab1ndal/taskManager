"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { TaskCard } from "@/components/task-card";
import type { DeadlineVariant } from "@/components/task-card";

type CompletedTask = {
  taskId: string;
  title: string;
  deadline: string | null;
  deadlineVariant: DeadlineVariant | null;
  workspace: string;
  shared: boolean;
  completed: true;
};

export function CompletedSection({ tasks }: { tasks: CompletedTask[] }) {
  const [open, setOpen] = useState(false);

  if (tasks.length === 0) return null;

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-2 hover:text-[var(--color-text-secondary)] transition-colors"
      >
        <ChevronRight
          size={ICON_SECONDARY}
          strokeWidth={ICON_STROKE}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
        {tasks.length} completed
      </button>

      {open && (
        <div className="flex flex-col gap-1.5">
          {tasks.map((t) => (
            <TaskCard key={t.taskId} {...t} />
          ))}
        </div>
      )}
    </div>
  );
}
