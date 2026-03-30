"use client";

import { useState, useTransition, useRef } from "react";
import { createTaskWithSubtasks } from "./actions";
import { toast } from "@/components/toaster";
import type { RawTask } from "./bucket-tasks";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };
type SubtaskRow = { title: string; dueAt: string };

export function NewTaskModal({
  open,
  onClose,
  workspaces,
  currentMemberIds,
  onTaskCreated,
  onTaskError,
}: {
  open: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  currentMemberIds: string[];
  onTaskCreated?: (task: RawTask) => void;
  onTaskError?: (taskId: string) => void;
}) {
  const firstWorkspace = workspaces[0];
  const getInitialMembers = (wsId: string) =>
    workspaces.find((w) => w.id === wsId)?.members
      .filter((m) => currentMemberIds.includes(m.id))
      .map((m) => m.id) ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [workspaceId, setWorkspaceId] = useState(firstWorkspace?.id ?? "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(
    getInitialMembers(firstWorkspace?.id ?? "")
  );
  const [subtaskRows, setSubtaskRows] = useState<SubtaskRow[]>([]);
  const [pending, startTransition] = useTransition();
  const lastSubtaskRef = useRef<HTMLInputElement>(null);

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  function handleWorkspaceChange(id: string) {
    setWorkspaceId(id);
    setSelectedMemberIds(getInitialMembers(id));
  }

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function addSubtaskRow() {
    setSubtaskRows((prev) => [...prev, { title: "", dueAt: "" }]);
    setTimeout(() => lastSubtaskRef.current?.focus(), 0);
  }

  function updateSubtask(index: number, field: keyof SubtaskRow, value: string) {
    setSubtaskRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function removeSubtask(index: number) {
    setSubtaskRows((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubtaskKeyDown(e: React.KeyboardEvent, rowTitle: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (rowTitle.trim()) addSubtaskRow();
    }
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setDueAt("");
    setWorkspaceId(firstWorkspace?.id ?? "");
    setSelectedMemberIds(getInitialMembers(firstWorkspace?.id ?? ""));
    setSubtaskRows([]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !workspaceId || selectedMemberIds.length === 0) return;

    // Snapshot form values before resetting
    const tempId = crypto.randomUUID();
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim() || undefined;
    const snapshotDueAt = dueAt || undefined;
    const snapshotWorkspaceId = workspaceId;
    const snapshotMemberIds = [...selectedMemberIds];
    const snapshotSubtasks = subtaskRows
      .filter((r) => r.title.trim())
      .map((r) => ({ title: r.title.trim(), dueAt: r.dueAt || undefined }));
    const ws = workspaces.find((w) => w.id === workspaceId)!;

    // Build optimistic RawTask
    const optimisticTask: RawTask = {
      id: tempId,
      title: trimmedTitle,
      due_at: snapshotDueAt ? `${snapshotDueAt}T00:00:00Z` : null,
      completed_at: null,
      workspace: { id: ws.id, name: ws.name, kind: ws.kind },
      member_sort_key: 0,
      assignee_count: snapshotMemberIds.length,
      member_ids: snapshotMemberIds,
      subtasks: [],
    };

    // Optimistic actions: fire callback, close modal, reset form, toast
    onTaskCreated?.(optimisticTask);
    resetForm();
    onClose();
    toast("Task created");

    startTransition(async () => {
      try {
        const { subtaskErrors } = await createTaskWithSubtasks({
          title: trimmedTitle,
          description: trimmedDescription,
          dueAt: snapshotDueAt,
          workspaceId: snapshotWorkspaceId,
          memberIds: snapshotMemberIds,
          subtasks: snapshotSubtasks,
        });
        if (subtaskErrors > 0) {
          toast(`Task created, but ${subtaskErrors} subtask(s) could not be saved`, "warning");
        }
      } catch {
        onTaskError?.(tempId);
        toast("Failed to create task", "error");
      }
    });
  }

  if (!open) return null;

  if (workspaces.length === 0) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={onClose}
      >
        <div
          className="bg-[var(--color-surface)] rounded-[14px] border border-[var(--color-border)] p-6 w-full max-w-sm mx-4 shadow-xl text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            You must join a workspace before creating tasks.
          </p>
          <a
            href="/workspaces"
            className="text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            Go to Workspaces
          </a>
        </div>
      </div>
    );
  }

  const disabled = pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface)] rounded-[14px] border border-[var(--color-border)] p-6 w-full max-w-md mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-4">New task</h3>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled}
            className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
            autoFocus
          />

          <textarea
            placeholder="Add details…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            rows={3}
            className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-none disabled:opacity-50"
          />

          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
              Due date (optional)
            </label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={disabled}
              className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">
              Workspace
            </label>
            <select
              value={workspaceId}
              onChange={(e) => handleWorkspaceChange(e.target.value)}
              disabled={disabled}
              className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
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
                    disabled={disabled}
                    className="rounded"
                  />
                  {m.display_name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-2">
              Subtasks
            </label>
            <div className="flex flex-col gap-1">
              {subtaskRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-text-muted)] shrink-0" aria-hidden="true">
                    <circle cx="5" cy="5" r="4" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Subtask title"
                    value={row.title}
                    onChange={(e) => updateSubtask(i, "title", e.target.value)}
                    onKeyDown={(e) => handleSubtaskKeyDown(e, row.title)}
                    disabled={disabled}
                    ref={i === subtaskRows.length - 1 ? lastSubtaskRef : undefined}
                    className="flex-1 border border-[var(--color-border)] rounded-[8px] px-2 py-1 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
                  />
                  <input
                    type="date"
                    value={row.dueAt}
                    onChange={(e) => updateSubtask(i, "dueAt", e.target.value)}
                    disabled={disabled}
                    className="border border-[var(--color-border)] rounded-[8px] px-2 py-1 text-xs bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => removeSubtask(i)}
                    disabled={disabled}
                    aria-label="Remove subtask"
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-lg leading-none disabled:opacity-50"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addSubtaskRow}
              disabled={disabled}
              className="mt-1 text-sm text-[var(--color-accent)] hover:underline disabled:opacity-50"
            >
              + Add subtask
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={disabled}
              className="px-4 py-2 text-sm rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors disabled:opacity-50"
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
  );
}
