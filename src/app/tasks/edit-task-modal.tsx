"use client";

import { useEffect, useState, useTransition } from "react";
import { updateTask, getTaskUpdates, addTaskUpdate } from "./actions";
import { updateTaskSchema, createTaskUpdateSchema } from "./schemas";
import { toast } from "@/components/toaster";
import { Dialog } from "@/components/dialog";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";
import type { RawTask } from "./bucket-tasks";
import type { TaskUpdate } from "./actions";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

export function EditTaskModal({
  open,
  task,
  onClose,
  workspaces,
  currentMemberIds,
}: {
  open: boolean;
  task: RawTask;
  onClose: () => void;
  workspaces: Workspace[];
  currentMemberIds: string[];
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [dueAt, setDueAt] = useState(task.due_at ? task.due_at.slice(0, 10) : "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(task.member_ids);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState("");

  const [updates, setUpdates] = useState<TaskUpdate[]>([]);
  const [updateDraft, setUpdateDraft] = useState("");
  const [updateError, setUpdateError] = useState("");
  const [updatesPending, startUpdateTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getTaskUpdates(task.id).then((result) => {
      if (!cancelled && result.ok) setUpdates(result.updates);
    });
    return () => {
      cancelled = true;
    };
  }, [open, task.id]);

  const speech = useSpeechRecognition((transcript, isFinal) => {
    setUpdateDraft((prev) => (isFinal ? `${prev}${transcript} ` : prev.replace(/\s*$/, "") + " " + transcript));
  });

  function handleAddUpdate() {
    const parsed = createTaskUpdateSchema.safeParse({ taskId: task.id, updateText: updateDraft });
    if (!parsed.success) {
      setUpdateError(parsed.error.issues[0].message);
      return;
    }
    setUpdateError("");

    const tempId = crypto.randomUUID();
    const optimisticUpdate: TaskUpdate = {
      id: tempId,
      authorName: "You",
      createdAt: new Date().toISOString(),
      updateText: parsed.data.updateText,
    };
    setUpdates((prev) => [...prev, optimisticUpdate]);
    setUpdateDraft("");

    startUpdateTransition(async () => {
      const result = await addTaskUpdate(parsed.data);
      if (!result.ok) {
        setUpdates((prev) => prev.filter((u) => u.id !== tempId));
        setUpdateError(result.error);
        return;
      }
      setUpdates((prev) => prev.map((u) => (u.id === tempId ? result.update : u)));
    });
  }

  const currentWorkspace = workspaces.find((w) => w.id === task.workspace.id);

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Same schema the action parses, so the modal cannot close optimistically on input the server
    // is about to reject.
    const parsed = updateTaskSchema.safeParse({
      taskId: task.id,
      title,
      description: description.trim() || undefined,
      dueAt: dueAt || undefined,
      memberIds: selectedMemberIds,
    });

    if (!parsed.success) {
      // Inline, not a toast: the toaster is a plain fixed div, not part of this dialog's own
      // top layer, so while the modal is open (native <dialog>.showModal()) a toast fired here
      // would be inert — unfocusable and unclickable — because the open dialog makes everything
      // else in the document inert, popovers included. See docs/audit findings, phase 04.
      setFormError(parsed.error.issues[0].message);
      return;
    }
    setFormError("");

    onClose();

    // No optimistic update happens here — the list only changes once the server revalidates — so
    // the success toast waits for the result rather than announcing an edit that may not land.
    startTransition(async () => {
      const result = await updateTask(parsed.data);
      if (result.ok) toast("Task updated");
      else toast(result.error, "error");
    });
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      initialFocusSelector="input[type=text]"
      ariaLabelledBy="edit-task-modal-title"
    >
      <h3 id="edit-task-modal-title" className="text-base font-semibold mb-4">Edit task</h3>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
            className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
          />

          <textarea
            placeholder="Add details…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
            rows={3}
            className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-none disabled:opacity-50"
          />

          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Due date (optional)</label>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={pending}
              className="w-full border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Assign to</label>
            <div className="flex flex-col gap-1.5">
              {currentWorkspace?.members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.includes(m.id)}
                    onChange={() => toggleMember(m.id)}
                    disabled={pending}
                    className="rounded"
                  />
                  {m.display_name}
                </label>
              ))}
            </div>
          </div>

          {formError && (
            <p role="alert" className="rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-600">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="px-4 py-2 text-sm rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || selectedMemberIds.length === 0 || pending}
              className="px-4 py-2 text-sm font-medium rounded-[8px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </form>

      <div className="mt-6 border-t border-[var(--color-border)] pt-4">
        <h4 className="text-sm font-semibold mb-2">Updates</h4>
        <ul className="flex flex-col gap-2 mb-3 max-h-40 overflow-y-auto">
          {updates.map((u) => (
            <li key={u.id} className="text-sm">
              <span className="font-medium">{u.authorName}</span>{" "}
              <span className="text-[var(--color-text-muted)]">
                {new Date(u.createdAt).toLocaleString()}
              </span>
              <p>{u.updateText}</p>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <textarea
            placeholder="Add an update…"
            value={updateDraft}
            onChange={(e) => setUpdateDraft(e.target.value)}
            disabled={updatesPending}
            rows={2}
            className="flex-1 border border-[var(--color-border)] rounded-[8px] px-3 py-2 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-none disabled:opacity-50"
          />
          {speech.isSupported && (
            <button
              type="button"
              aria-label={speech.isListening ? "Stop dictating" : "Dictate update"}
              onClick={() => (speech.isListening ? speech.stop() : speech.start())}
              disabled={updatesPending}
              className={`px-3 rounded-[8px] border border-[var(--color-border)] text-sm disabled:opacity-50 ${speech.isListening ? "bg-red-50 text-red-600" : ""}`}
            >
              {speech.isListening ? "●" : "🎤"}
            </button>
          )}
          <button
            type="button"
            onClick={handleAddUpdate}
            disabled={!updateDraft.trim() || updatesPending}
            className="px-4 rounded-[8px] bg-[var(--color-accent)] text-white text-sm disabled:opacity-40"
          >
            Add update
          </button>
        </div>
        {updateError && (
          <p role="alert" className="mt-2 rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-600">
            {updateError}
          </p>
        )}
        {speech.error && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {speech.error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
