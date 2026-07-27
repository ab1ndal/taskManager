"use client";

import { useEffect, useState, useTransition } from "react";
import { Circle, CircleCheck, Pencil, Trash2 } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import {
  updateTask,
  getTaskUpdates,
  addTaskUpdate,
  addSubtask,
  updateSubtask,
  completeTask,
  reopenTask,
  deleteTask,
} from "./actions";
import {
  updateTaskSchema,
  createTaskUpdateSchema,
  addSubtaskSchema,
  updateSubtaskSchema,
} from "./schemas";
import { toast } from "@/components/toaster";
import { Dialog } from "@/components/dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { useDictation } from "@/lib/use-dictation";
import { DictationTextarea } from "@/components/dictation-textarea";
import type { RawTask } from "./bucket-tasks";
import type { TaskUpdate } from "./actions";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };
type Subtask = RawTask["subtasks"][number];

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

/**
 * The exact moment an update was posted, for the `title` behind the relative label. "3h ago" cannot
 * be pinned to a time, and past a day the relative label degrades to a bare date with no clock at
 * all — which is not enough to order two updates from the same afternoon.
 */
export function formatUpdateTimestamp(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return then.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

  const [subtasks, setSubtasks] = useState(task.subtasks);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtaskDueAt, setSubtaskDueAt] = useState("");
  // Which existing subtask is open for editing, and the draft it holds. Null means the list is in
  // its read-only state.
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState({ title: "", description: "", dueAt: "" });
  const [subtaskError, setSubtaskError] = useState("");
  const [subtaskPending, startSubtaskTransition] = useTransition();
  // A subtask carries its own details and due date, so deleting one is the same destructive weight
  // as deleting a task — it goes through the same confirmation rather than firing on first click.
  const [subtaskToDelete, setSubtaskToDelete] = useState<Subtask | null>(null);

  // Reset during render (not in an effect) when the modal is pointed at a different task, so the
  // previous task's updates never render against the new one while the refetch is in flight.
  const [loadedTaskId, setLoadedTaskId] = useState(task.id);
  if (loadedTaskId !== task.id) {
    setLoadedTaskId(task.id);
    setUpdates([]);
    setUpdatesLoadError("");
  }

  // One controller for the whole modal: the update composer, the task description and both subtask
  // description fields share a single recognizer, and claiming it from one field releases the rest.
  const dictation = useDictation();
  const { stop: stopDictation } = dictation;

  // A closed modal keeps its component mounted (it renders null), so without this a session left
  // running when the dialog closes holds the microphone open with no visible control to stop it.
  useEffect(() => {
    if (!open) stopDictation();
  }, [open, stopDictation]);

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
    dictation.stop();

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

  /**
   * Optimistic, then reconciled: the row flips immediately and rolls back to its previous state if
   * the server refuses. Same shape as the update list above.
   */
  function toggleSubtask(subtask: Subtask) {
    const nextCompletedAt = subtask.completed_at ? null : new Date().toISOString();
    setSubtaskError("");
    setSubtasks((prev) =>
      prev.map((s) => (s.id === subtask.id ? { ...s, completed_at: nextCompletedAt } : s))
    );

    startSubtaskTransition(async () => {
      const result = subtask.completed_at
        ? await reopenTask(subtask.id)
        : await completeTask(subtask.id);
      if (!result.ok) {
        setSubtasks((prev) =>
          prev.map((s) => (s.id === subtask.id ? { ...s, completed_at: subtask.completed_at } : s))
        );
        setSubtaskError(result.error ?? "Failed to update subtask");
      }
    });
  }

  function removeSubtask(subtask: Subtask) {
    setSubtaskError("");
    setSubtasks((prev) => prev.filter((s) => s.id !== subtask.id));

    startSubtaskTransition(async () => {
      const result = await deleteTask(subtask.id);
      if (!result.ok) {
        // Put it back where it was rather than at the end — the list is ordered by creation.
        setSubtasks((prev) => {
          const index = task.subtasks.findIndex((s) => s.id === subtask.id);
          const next = [...prev];
          next.splice(index < 0 ? next.length : index, 0, subtask);
          return next;
        });
        setSubtaskError(result.error ?? "Failed to delete subtask");
      }
    });
  }

  function startEditingSubtask(subtask: Subtask) {
    setSubtaskError("");
    setEditingSubtaskId(subtask.id);
    setSubtaskDraft({
      title: subtask.title,
      description: subtask.description ?? "",
      dueAt: subtask.due_at ? subtask.due_at.slice(0, 10) : "",
    });
  }

  /**
   * Optimistic like the rest of this section: the row shows the edited values immediately and rolls
   * back to what it held before if the server refuses.
   */
  function saveSubtaskEdit(subtask: Subtask) {
    const parsed = updateSubtaskSchema.safeParse({
      subtaskId: subtask.id,
      title: subtaskDraft.title,
      description: subtaskDraft.description.trim() || undefined,
      dueAt: subtaskDraft.dueAt || undefined,
    });
    if (!parsed.success) {
      setSubtaskError(parsed.error.issues[0].message);
      return;
    }
    setSubtaskError("");

    const next = {
      ...subtask,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      due_at: parsed.data.dueAt ? `${parsed.data.dueAt}T00:00:00Z` : null,
    };
    setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? next : s)));
    setEditingSubtaskId(null);

    startSubtaskTransition(async () => {
      const result = await updateSubtask(parsed.data);
      if (!result.ok) {
        setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? subtask : s)));
        setSubtaskError(result.error);
      }
    });
  }

  function handleAddSubtask() {
    const parsed = addSubtaskSchema.safeParse({
      parentTaskId: task.id,
      title: subtaskTitle,
      description: subtaskDescription.trim() || undefined,
      dueAt: subtaskDueAt || undefined,
    });
    if (!parsed.success) {
      setSubtaskError(parsed.error.issues[0].message);
      return;
    }
    setSubtaskError("");

    const tempId = crypto.randomUUID();
    setSubtasks((prev) => [
      ...prev,
      {
        id: tempId,
        title: parsed.data.title,
        completed_at: null,
        description: parsed.data.description ?? null,
        due_at: parsed.data.dueAt ? `${parsed.data.dueAt}T00:00:00Z` : null,
      },
    ]);
    setSubtaskTitle("");
    setSubtaskDescription("");
    setSubtaskDueAt("");

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

          <DictationTextarea
            field="description"
            dictation={dictation}
            dictateLabel="Dictate task details"
            placeholder="Add details…"
            value={description}
            onChange={setDescription}
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
                    className="rounded accent-[var(--color-accent)]"
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
              className="min-h-11 px-4 text-sm rounded-sm border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || selectedMemberIds.length === 0 || pending}
              className="min-h-11 px-4 text-sm font-medium rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </form>

      {/*
        Updates and Subtasks write the moment their button is pressed, while everything above is
        staged behind Save. Nothing used to mark that difference, so Cancel looked like it would
        undo a posted update. The per-section "Saves immediately" / "Posts immediately" note carries
        that on its own — these sat on the sunken surface as well until 2026-07-27, which read as a
        heavy lavender box against the rest of the form.

        The separation is now structural rather than a fill: a hairline rule and a heading open each
        section, which reads as hierarchy instead of as two competing panels.
      */}
      <section className="mt-6 border-t border-[var(--color-border)] pt-5">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h4 className="text-sm font-semibold">Subtasks</h4>
          <p className="text-2xs text-[var(--color-text-muted)]">Saves immediately</p>
        </div>
        {/*
          Subtasks used to render as bare text: no way to tick one off, no way to remove one added
          by mistake, and the only signal that a subtask was done was a strikethrough you could not
          undo. Each row now carries the same two controls the task list has.
        */}
        {subtasks.length === 0 ? (
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">No subtasks yet.</p>
        ) : (
          <ul className="flex flex-col mb-2">
            {subtasks.map((s) => (
              <li key={s.id} className="flex flex-col">
                {editingSubtaskId === s.id ? (
                  <div className="flex flex-col gap-2 rounded-sm border border-[var(--color-border)] p-2 my-1">
                    <input
                      type="text"
                      aria-label={`Subtask title for "${s.title}"`}
                      value={subtaskDraft.title}
                      onChange={(e) =>
                        setSubtaskDraft((d) => ({ ...d, title: e.target.value }))
                      }
                      disabled={subtaskPending}
                      className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-transparent disabled:opacity-50"
                    />
                    <DictationTextarea
                      field={`subtask-${s.id}`}
                      dictation={dictation}
                      dictateLabel={`Dictate details for "${s.title}"`}
                      placeholder="Details…"
                      aria-label={`Subtask details for "${s.title}"`}
                      value={subtaskDraft.description}
                      onChange={(value) => setSubtaskDraft((d) => ({ ...d, description: value }))}
                      disabled={subtaskPending}
                      rows={2}
                      className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-xs bg-transparent resize-none disabled:opacity-50"
                    />
                    <input
                      type="date"
                      aria-label={`Subtask due date for "${s.title}"`}
                      value={subtaskDraft.dueAt}
                      onChange={(e) => setSubtaskDraft((d) => ({ ...d, dueAt: e.target.value }))}
                      disabled={subtaskPending}
                      // Safari sizes a date input to its own text and drops the picker glyph; the
                      // floor keeps the value legible in every engine. Same as the new-task modal.
                      className="w-full sm:w-auto sm:self-start min-w-[9rem] border border-[var(--color-border)] rounded-sm px-2 py-1 text-xs bg-[var(--color-surface)] disabled:opacity-50"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingSubtaskId(null)}
                        disabled={subtaskPending}
                        className="min-h-11 px-3 text-sm rounded-sm border border-[var(--color-border)] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveSubtaskEdit(s)}
                        disabled={!subtaskDraft.title.trim() || subtaskPending}
                        className="min-h-11 px-3 rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm disabled:opacity-40"
                      >
                        Save subtask
                      </button>
                    </div>
                  </div>
                ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleSubtask(s)}
                  disabled={subtaskPending}
                  aria-label={
                    s.completed_at ? `Reopen "${s.title}"` : `Mark "${s.title}" complete`
                  }
                  className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-control-idle)] hover:text-[var(--color-accent)] disabled:opacity-50 transition-colors"
                >
                  {s.completed_at ? (
                    <CircleCheck
                      size={ICON_SECONDARY}
                      strokeWidth={ICON_STROKE}
                      className="text-[var(--color-accent)]"
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <span
                    className={`block text-sm ${
                      s.completed_at ? "line-through text-[var(--color-text-muted)]" : ""
                    }`}
                  >
                    {s.title}
                  </span>
                  {/*
                    A subtask's details and due date were previously invisible once it existed —
                    they could be typed at creation and never seen again. They render under the
                    title, muted, and are what the pencil opens for editing.
                  */}
                  {s.description && (
                    <span className="block text-2xs text-[var(--color-text-muted)] truncate">
                      {s.description}
                    </span>
                  )}
                  {s.due_at && (
                    <time
                      dateTime={s.due_at}
                      className="block text-2xs text-[var(--color-text-muted)]"
                    >
                      Due {s.due_at.slice(0, 10)}
                    </time>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => startEditingSubtask(s)}
                  disabled={subtaskPending}
                  aria-label={`Edit "${s.title}"`}
                  className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] disabled:opacity-50 transition-colors"
                >
                  <Pencil size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setSubtaskToDelete(s)}
                  disabled={subtaskPending}
                  aria-label={`Delete "${s.title}"`}
                  className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-danger-text)] disabled:opacity-50 transition-colors"
                >
                  <Trash2 size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
                </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {/*
          The new-task modal gives a subtask a title, details and a due date. This row took a title
          only, so a subtask added after creation could never carry the other two — and `addSubtask`
          accepted them all along. Same three fields, same order, same widths.
        */}
        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="New subtask title"
            value={subtaskTitle}
            onChange={(e) => setSubtaskTitle(e.target.value)}
            disabled={subtaskPending}
            className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent disabled:opacity-50"
          />
          <div className="flex flex-col sm:flex-row sm:items-start gap-2">
            <DictationTextarea
              field="subtask-new"
              dictation={dictation}
              dictateLabel="Dictate subtask details"
              placeholder="Details…"
              aria-label="New subtask details"
              value={subtaskDescription}
              onChange={setSubtaskDescription}
              disabled={subtaskPending}
              rows={2}
              wrapperClassName="w-full sm:flex-1 min-w-0"
              className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-xs bg-transparent resize-none disabled:opacity-50"
            />
            <input
              type="date"
              aria-label="New subtask due date"
              value={subtaskDueAt}
              onChange={(e) => setSubtaskDueAt(e.target.value)}
              disabled={subtaskPending}
              className="w-full sm:w-auto sm:shrink-0 min-w-[9rem] border border-[var(--color-border)] rounded-sm px-2 py-1 text-xs bg-[var(--color-surface)] disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={handleAddSubtask}
            disabled={!subtaskTitle.trim() || subtaskPending}
            className="self-end min-h-11 px-4 rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm disabled:opacity-40"
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

      {/*
        Updates sit last and below Subtasks: subtasks are the structure of the task and belong
        directly under its fields, while updates are a log that only grows. The list used to be a
        160px inner scroller nested inside a scrollable dialog — two scroll regions competing for
        the same gesture — so it now runs at full height and scrolls with the modal body.
      */}
      <section className="mt-6 border-t border-[var(--color-border)] pt-5">
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
          <ul className="flex flex-col gap-2 mb-3">
            {updates.map((u) => (
              <li key={u.id} className="text-sm">
                <span className="font-medium">{u.authorName}</span>{" "}
                {/*
                  The relative label answers "is this recent?" at a glance; the title carries the
                  exact date and time, which is the only way to place an update older than a day.
                */}
                <time
                  dateTime={u.createdAt}
                  title={formatUpdateTimestamp(u.createdAt)}
                  className="text-2xs text-[var(--color-text-muted)]"
                >
                  {formatUpdateTime(u.createdAt)}
                </time>
                <p>{u.updateText}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <DictationTextarea
            field="update"
            dictation={dictation}
            dictateLabel="Dictate update"
            placeholder="Add an update…"
            value={updateDraft}
            onChange={setUpdateDraft}
            disabled={updatesPending}
            rows={2}
            wrapperClassName="flex-1 min-w-0"
            className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent resize-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleAddUpdate}
            disabled={!updateDraft.trim() || updatesPending}
            className="self-start min-h-11 px-4 rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-sm disabled:opacity-40"
          >
            Add update
          </button>
        </div>
        {updateError && (
          <p role="alert" className="mt-2 rounded-sm bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
            {updateError}
          </p>
        )}
      </section>

      {/*
        Nested inside the open edit modal on purpose: a second `showModal()` stacks above the first
        in the top layer, so the confirmation is the topmost dialog and Escape dismisses only it.
      */}
      <DeleteConfirmDialog
        open={subtaskToDelete !== null}
        taskTitle={subtaskToDelete?.title ?? ""}
        onConfirm={() => {
          if (subtaskToDelete) removeSubtask(subtaskToDelete);
          setSubtaskToDelete(null);
        }}
        onCancel={() => setSubtaskToDelete(null)}
      />
    </Dialog>
  );
}
