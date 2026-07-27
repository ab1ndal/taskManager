"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Mic, Square } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { updateTask, getTaskUpdates, addTaskUpdate, addSubtask } from "./actions";
import { updateTaskSchema, createTaskUpdateSchema, addSubtaskSchema } from "./schemas";
import { toast } from "@/components/toaster";
import { Dialog } from "@/components/dialog";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";
import type { RawTask } from "./bucket-tasks";
import type { TaskUpdate } from "./actions";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

/**
 * Update timestamps are read at a glance to answer "is this recent?", which a full
 * `toLocaleString()` ("7/26/2026, 11:04:33 PM") answers slowly. Recent entries get a relative
 * label; anything past a day falls back to an absolute date, where relative stops being useful.
 * The exact value stays available to assistive tech through the `<time dateTime>` attribute.
 */
export function formatUpdateTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (Number.isNaN(seconds)) return "";
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
  const [updatesLoadError, setUpdatesLoadError] = useState("");
  const [updateDraft, setUpdateDraft] = useState("");
  const [updateError, setUpdateError] = useState("");
  const [updatesPending, startUpdateTransition] = useTransition();
  // Text committed before the current dictation utterance started. Each SpeechRecognition
  // interim/final event carries the FULL transcript for the utterance so far, not a delta, so the
  // draft is rendered as `base + live utterance text` rather than accumulated across events.
  const dictationBaseRef = useRef("");
  const updatesListRef = useRef<HTMLUListElement>(null);

  const [subtasks, setSubtasks] = useState(task.subtasks);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskError, setSubtaskError] = useState("");
  const [subtaskPending, startSubtaskTransition] = useTransition();

  // Reset during render (not in an effect) when the modal is pointed at a different task, so the
  // previous task's updates never render against the new one while the refetch is in flight.
  const [loadedTaskId, setLoadedTaskId] = useState(task.id);
  if (loadedTaskId !== task.id) {
    setLoadedTaskId(task.id);
    setUpdates([]);
    setUpdatesLoadError("");
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getTaskUpdates(task.id).then((result) => {
      if (cancelled) return;
      if (result.ok) setUpdates(result.updates);
      else setUpdatesLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, task.id]);

  // Newest update is appended at the bottom of a max-h-40 scroller, so without this the one the
  // user just posted lands out of view.
  useEffect(() => {
    const list = updatesListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [updates.length]);

  const speech = useSpeechRecognition((transcript, isFinal) => {
    // `transcript` is the FULL text of the current utterance so far, not a delta — so it replaces
    // (rather than appends to) whatever the previous event in this utterance rendered. Only a
    // final result gets folded into the committed base.
    const base = dictationBaseRef.current;
    const combined = base ? `${base} ${transcript}` : transcript;
    if (isFinal) dictationBaseRef.current = combined;
    setUpdateDraft(combined);
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
    // Submitting consumes the draft, so an in-flight dictation has nothing left to append to —
    // and the mic button is disabled while the submit transition runs, which would leave the
    // recognizer live with no way to stop it. End the session here instead.
    if (speech.isListening) speech.stop();

    setUpdates((prev) => [...prev, optimisticUpdate]);
    dictationBaseRef.current = "";
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

  function handleAddSubtask() {
    const parsed = addSubtaskSchema.safeParse({ parentTaskId: task.id, title: subtaskTitle });
    if (!parsed.success) {
      setSubtaskError(parsed.error.issues[0].message);
      return;
    }
    setSubtaskError("");

    const tempId = crypto.randomUUID();
    setSubtasks((prev) => [...prev, { id: tempId, title: parsed.data.title, completed_at: null }]);
    setSubtaskTitle("");

    startSubtaskTransition(async () => {
      const result = await addSubtask(parsed.data);
      if (!result.ok) {
        setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
        setSubtaskError(result.error);
        return;
      }
      setSubtasks((prev) => prev.map((s) => (s.id === tempId ? result.subtask : s)));
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
            className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent disabled:opacity-50"
          />

          <textarea
            placeholder="Add details…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
            rows={3}
            className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent resize-none disabled:opacity-50"
          />

          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Due date (optional)</label>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={pending}
              className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-[var(--color-surface)] disabled:opacity-50"
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
            <p role="alert" className="rounded-sm bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="px-4 py-2 text-sm rounded-sm border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || selectedMemberIds.length === 0 || pending}
              className="px-4 py-2 text-sm font-medium rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </form>

      {/*
        Updates and Subtasks write the moment their button is pressed, while everything above is
        staged behind Save. Nothing used to mark that difference, so Cancel looked like it would
        undo a posted update. They now sit on the sunken surface with an explicit note.
      */}
      <section className="mt-6 rounded-md bg-[var(--color-surface-sunken)] p-3">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h4 className="text-sm font-semibold">Updates</h4>
          <p className="text-2xs text-[var(--color-text-muted)]">Posts immediately</p>
        </div>
        {updatesLoadError && (
          <p role="alert" className="mb-2 rounded-sm bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
            {updatesLoadError}
          </p>
        )}
        {updates.length === 0 && !updatesLoadError ? (
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">
            No updates yet. Add the first one below.
          </p>
        ) : (
          <ul ref={updatesListRef} className="flex flex-col gap-2 mb-3 max-h-40 overflow-y-auto">
            {updates.map((u) => (
              <li key={u.id} className="text-sm">
                <span className="font-medium">{u.authorName}</span>{" "}
                <time dateTime={u.createdAt} className="text-2xs text-[var(--color-text-muted)]">
                  {formatUpdateTime(u.createdAt)}
                </time>
                <p>{u.updateText}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <textarea
            placeholder="Add an update…"
            value={updateDraft}
            onChange={(e) => {
              dictationBaseRef.current = e.target.value;
              setUpdateDraft(e.target.value);
            }}
            disabled={updatesPending}
            rows={2}
            className="flex-1 border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent resize-none disabled:opacity-50"
          />
          {speech.isSupported && (
            <button
              type="button"
              aria-label={speech.isListening ? "Stop dictating" : "Dictate update"}
              onClick={() => (speech.isListening ? speech.stop() : speech.start())}
              disabled={updatesPending}
              className={`flex items-center justify-center px-3 rounded-sm border text-sm disabled:opacity-50 transition-colors ${
                speech.isListening
                  ? "border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]"
                  : "border-[var(--color-border)]"
              }`}
            >
              {speech.isListening ? (
                <Square
                  size={ICON_SECONDARY}
                  strokeWidth={ICON_STROKE}
                  fill="currentColor"
                  aria-hidden="true"
                />
              ) : (
                <Mic size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleAddUpdate}
            disabled={!updateDraft.trim() || updatesPending}
            className="px-4 rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm disabled:opacity-40"
          >
            Add update
          </button>
        </div>
        {updateError && (
          <p role="alert" className="mt-2 rounded-sm bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
            {updateError}
          </p>
        )}
        {speech.error && (
          <p role="alert" className="mt-2 text-sm text-[var(--color-danger-text)]">
            {speech.error}
          </p>
        )}
      </section>

      <section className="mt-4 rounded-md bg-[var(--color-surface-sunken)] p-3">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h4 className="text-sm font-semibold">Subtasks</h4>
          <p className="text-2xs text-[var(--color-text-muted)]">Saves immediately</p>
        </div>
        {subtasks.length === 0 ? (
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">No subtasks yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 mb-3">
            {subtasks.map((s) => (
              <li key={s.id} className="text-sm flex items-center gap-2">
                <span className={s.completed_at ? "line-through text-[var(--color-text-muted)]" : ""}>
                  {s.title}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="New subtask title"
            value={subtaskTitle}
            onChange={(e) => setSubtaskTitle(e.target.value)}
            disabled={subtaskPending}
            className="flex-1 border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleAddSubtask}
            disabled={!subtaskTitle.trim() || subtaskPending}
            className="px-4 rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm disabled:opacity-40"
          >
            Add subtask
          </button>
        </div>
        {subtaskError && (
          <p role="alert" className="mt-2 rounded-sm bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
            {subtaskError}
          </p>
        )}
      </section>
    </Dialog>
  );
}
