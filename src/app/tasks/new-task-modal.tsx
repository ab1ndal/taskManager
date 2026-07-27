"use client";

import { useState, useTransition, useRef } from "react";
import { Circle, X } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { createTaskWithSubtasks } from "./actions";
import { createTaskWithSubtasksSchema } from "./schemas";
import { toast } from "../../components/toaster";
import { Dialog } from "@/components/dialog";
import { DictationTextarea } from "@/components/dictation-textarea";
import { useDictation } from "@/lib/use-dictation";
import type { RawTask } from "./bucket-tasks";

type WorkspaceMember = { id: string; display_name: string };
type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };
type SubtaskRow = { title: string; dueAt: string; description: string };

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
  const [formError, setFormError] = useState("");
  const lastSubtaskRef = useRef<HTMLInputElement>(null);
  // One recognizer for the whole form: the task details field and every subtask's details field
  // share it, and claiming it from one field releases whichever held it.
  const dictation = useDictation();

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
    setSubtaskRows((prev) => [...prev, { title: "", dueAt: "", description: "" }]);
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
    // The fields a session could be dictating into are about to be cleared, so end it here rather
    // than leaving the recognizer live against a form that no longer exists on screen.
    dictation.stop();
    setTitle("");
    setDescription("");
    setDueAt("");
    setWorkspaceId(firstWorkspace?.id ?? "");
    setSelectedMemberIds(getInitialMembers(firstWorkspace?.id ?? ""));
    setSubtaskRows([]);
    setFormError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Same schema the action parses, so the optimistic task below can never be one the server is
    // about to reject.
    const parsed = createTaskWithSubtasksSchema.safeParse({
      title,
      description: description.trim() || undefined,
      dueAt: dueAt || undefined,
      workspaceId,
      memberIds: selectedMemberIds,
      subtasks: subtaskRows
        .filter((r) => r.title.trim())
        .map((r) => ({
          title: r.title,
          dueAt: r.dueAt || undefined,
          description: r.description.trim() || undefined,
        })),
    });

    if (!parsed.success) {
      // Inline, not a toast: the toaster is a plain fixed div, not part of the dialog's own
      // top layer, so while this modal is open (native <dialog>.showModal()) a toast fired here
      // would be inert — unfocusable and unclickable — because the open dialog makes everything
      // else in the document inert, popovers included. See docs/audit findings, phase 04.
      setFormError(parsed.error.issues[0].message);
      return;
    }
    setFormError("");

    const input = parsed.data;
    const tempId = crypto.randomUUID();
    const ws = workspaces.find((w) => w.id === input.workspaceId)!;

    // Build optimistic RawTask
    const optimisticTask: RawTask = {
      id: tempId,
      title: input.title,
      due_at: input.dueAt ? `${input.dueAt}T00:00:00Z` : null,
      completed_at: null,
      workspace: { id: ws.id, name: ws.name, kind: ws.kind },
      member_sort_key: 0,
      assignee_count: input.memberIds.length,
      member_ids: input.memberIds,
      subtasks: [],
    };

    // Optimistic actions: fire callback, close modal, reset form, toast
    onTaskCreated?.(optimisticTask);
    resetForm();
    onClose();
    toast("Task created");

    startTransition(async () => {
      const result = await createTaskWithSubtasks(input);

      if (!result.ok) {
        // Roll the optimistic row back out of the list — it was never persisted.
        onTaskError?.(tempId);
        toast(result.error, "error");
        return;
      }

      if (result.subtaskErrors > 0) {
        toast(`Task created, but ${result.subtaskErrors} subtask(s) could not be saved`, "warning");
      }
    });
  }

  if (!open) return null;

  if (workspaces.length === 0) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-6 w-full max-w-sm text-center backdrop:bg-[var(--color-scrim)]"
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
      </Dialog>
    );
  }

  const disabled = pending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      initialFocusSelector="input[type=text]"
      ariaLabelledBy="new-task-modal-title"
    >
      <h3 id="new-task-modal-title" className="text-base font-semibold mb-4">New task</h3>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/*
            Every field carries a visible label tied to its control by id. Title and details used to
            rely on their placeholder alone, which disappears the moment typing starts and is not a
            label to a screen reader; Due date, Workspace and Assign to had visible text that was
            never associated with anything.
          */}
          <div>
            <label htmlFor="new-task-title" className="block text-xs text-[var(--color-text-muted)] mb-1">
              Title
            </label>
            <input
              id="new-task-title"
              type="text"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled}
              className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="new-task-description" className="block text-xs text-[var(--color-text-muted)] mb-1">
              Details (optional)
            </label>
            <DictationTextarea
              id="new-task-description"
              field="description"
              dictation={dictation}
              dictateLabel="Dictate task details"
              placeholder="Add details…"
              value={description}
              onChange={setDescription}
              disabled={disabled}
              rows={3}
              className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent resize-none disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="new-task-due" className="block text-xs text-[var(--color-text-muted)] mb-1">
              Due date (optional)
            </label>
            <input
              id="new-task-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={disabled}
              className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-[var(--color-surface)] disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="new-task-workspace" className="block text-xs text-[var(--color-text-muted)] mb-1">
              Workspace
            </label>
            <select
              id="new-task-workspace"
              value={workspaceId}
              onChange={(e) => handleWorkspaceChange(e.target.value)}
              disabled={disabled}
              className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-[var(--color-surface)] disabled:opacity-50"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* A group of checkboxes needs a group label, which is what fieldset/legend is for. */}
          <fieldset>
            <legend className="block text-xs text-[var(--color-text-muted)] mb-1">
              Assign to
            </legend>
            <div className="flex flex-col gap-1.5">
              {currentWorkspace?.members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.includes(m.id)}
                    onChange={() => toggleMember(m.id)}
                    disabled={disabled}
                    className="rounded accent-[var(--color-accent)]"
                  />
                  {m.display_name}
                </label>
              ))}
            </div>
          </fieldset>

          {/*
            Not a <label>: this heads a repeating group of rows whose own fields carry aria-labels,
            so there is no single control for it to point at.
          */}
          <div>
            <p className="block text-xs text-[var(--color-text-muted)] mb-2">
              Subtasks
            </p>
            <div className="flex flex-col gap-1">
              {/*
                A subtask is a two-line block at every width, not one row. Title, details, date and
                remove used to be promoted onto a single flex row at `sm` and up (via `sm:contents`),
                and three text fields plus a date picker do not fit the dialog's 448px: the date
                input holds its intrinsic ~140px, so the details textarea collapsed to roughly one
                character and could not be typed into. Details now owns a full-width line.
              */}
              {subtaskRows.map((row, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-sm border border-[var(--color-border)] p-2"
                >
                  <div className="flex items-center gap-2">
                    <Circle
                      size={ICON_SECONDARY}
                      strokeWidth={ICON_STROKE}
                      className="text-[var(--color-text-muted)] shrink-0"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      placeholder="Subtask title"
                      aria-label={`Subtask ${i + 1} title`}
                      value={row.title}
                      onChange={(e) => updateSubtask(i, "title", e.target.value)}
                      onKeyDown={(e) => handleSubtaskKeyDown(e, row.title)}
                      disabled={disabled}
                      ref={i === subtaskRows.length - 1 ? lastSubtaskRef : undefined}
                      className="flex-1 min-w-0 border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-transparent disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => removeSubtask(i)}
                      disabled={disabled}
                      aria-label={`Remove subtask ${i + 1}`}
                      className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                    >
                      <X size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                    <DictationTextarea
                      field={`subtask-${i}`}
                      dictation={dictation}
                      // Not "Dictate subtask N details": that string contains the field's own
                      // label, so any substring-matching label query resolves to both controls.
                      dictateLabel={`Dictate details for subtask ${i + 1}`}
                      placeholder="Details…"
                      aria-label={`Subtask ${i + 1} details`}
                      value={row.description}
                      onChange={(value) => updateSubtask(i, "description", value)}
                      disabled={disabled}
                      rows={2}
                      wrapperClassName="w-full sm:flex-1 min-w-0"
                      className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-xs bg-transparent resize-none disabled:opacity-50"
                    />
                    <input
                      type="date"
                      aria-label={`Subtask ${i + 1} due date`}
                      value={row.dueAt}
                      onChange={(e) => updateSubtask(i, "dueAt", e.target.value)}
                      disabled={disabled}
                      // Safari renders a date input without a picker glyph and sizes it to its own
                      // text: at `text-xs` it came out 96px, narrower than the value it holds. The
                      // explicit floor keeps it legible in every engine.
                      className="w-full sm:w-auto sm:shrink-0 min-w-[9rem] border border-[var(--color-border)] rounded-sm px-2 py-1 text-xs bg-[var(--color-surface)] disabled:opacity-50"
                    />
                  </div>
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

          {formError && (
            <p role="alert" className="rounded-sm bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={disabled}
              className="px-4 py-2 text-sm rounded-sm border border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || selectedMemberIds.length === 0 || pending}
              className="px-4 py-2 text-sm font-medium rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {pending ? "Adding…" : "Add task"}
            </button>
          </div>
        </form>
    </Dialog>
  );
}
