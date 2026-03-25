"use client";

import { useState, useTransition } from "react";
import { createTask } from "./actions";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

export function NewTaskModal({
  workspaces,
  currentMemberIds,
}: {
  workspaces: Workspace[];
  currentMemberIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(currentMemberIds);
  const [pending, startTransition] = useTransition();

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  function handleWorkspaceChange(id: string) {
    setWorkspaceId(id);
    const ws = workspaces.find((w) => w.id === id);
    const myMembersInWs =
      ws?.members.filter((m) => currentMemberIds.includes(m.id)).map((m) => m.id) ?? [];
    setSelectedMemberIds(myMembersInWs);
  }

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || selectedMemberIds.length === 0) return;
    startTransition(async () => {
      await createTask({
        title: title.trim(),
        dueAt: dueAt || undefined,
        workspaceId,
        memberIds: selectedMemberIds,
      });
      setOpen(false);
      setTitle("");
      setDueAt("");
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mb-4 w-full flex items-center justify-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-[8px] py-[9px] transition-colors"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 1v10M1 6h10" />
        </svg>
        New task
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[var(--color-surface)] rounded-[14px] border border-[var(--color-border)] p-6 w-full max-w-md mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-4">New task</h3>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <input
                type="text"
                placeholder="Task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                autoFocus
              />

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                  Due date (optional)
                </label>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                  Workspace
                </label>
                <select
                  value={workspaceId}
                  onChange={(e) => handleWorkspaceChange(e.target.value)}
                  className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                  Assign to
                </label>
                <div className="flex flex-col gap-1.5">
                  {currentWorkspace?.members.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.includes(m.id)}
                        onChange={() => toggleMember(m.id)}
                        className="rounded"
                      />
                      {m.display_name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 text-sm rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || selectedMemberIds.length === 0 || pending}
                  className="px-4 py-2 text-sm font-medium rounded-[8px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {pending ? "Adding…" : "Add task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
