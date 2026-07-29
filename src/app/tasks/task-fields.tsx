"use client";

import { DictationTextarea } from "@/components/dictation-textarea";
import { useDictation } from "@/lib/use-dictation";

export type WorkspaceMember = { id: string; display_name: string };
export type Workspace = { id: string; name: string; kind: string; members: WorkspaceMember[] };

export type TaskFieldsProps = {
  /** Namespaces every control id so both modals can be mounted in the same document. */
  idPrefix: "new-task" | "edit-task";
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  dueAt: string;
  onDueAtChange: (value: string) => void;
  workspaces: Workspace[];
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  /** Edit hides the select when there is nowhere to move to; new always shows it. */
  hideWorkspaceWhenOnlyOne?: boolean;
  /** Rendered under the workspace select — the edit modal's move warning lives here. */
  workspaceNote?: React.ReactNode;
  selectedMemberIds: string[];
  onToggleMember: (id: string) => void;
  disabled: boolean;
  dictation: ReturnType<typeof useDictation>;
};

/**
 * The fields both task modals share.
 *
 * New and Edit are the same form wrapped around different lifecycles — Edit persists each section
 * through its own action and carries updates and real subtask rows, New stages everything and
 * submits once. The form was duplicated between them, so the two drifted and every field change had
 * to be made twice. This component owns the shared half and holds no state: the modals keep theirs,
 * which is what lets the lifecycles stay separate.
 */
export function TaskFields({
  idPrefix,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  dueAt,
  onDueAtChange,
  workspaces,
  workspaceId,
  onWorkspaceChange,
  hideWorkspaceWhenOnlyOne = false,
  workspaceNote,
  selectedMemberIds,
  onToggleMember,
  disabled,
  dictation,
}: TaskFieldsProps) {
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);
  const showWorkspace = !hideWorkspaceWhenOnlyOne || workspaces.length > 1;

  return (
    <>
      {/*
        Every field carries a visible label tied to its control by id. Title and details used to
        rely on their placeholder alone, which disappears the moment typing starts and is not a
        label to a screen reader; Due date, Workspace and Assign to had visible text that was
        never associated with anything.
      */}
      <div>
        <label htmlFor={`${idPrefix}-title`} className="block text-xs text-[var(--color-text-muted)] mb-1">
          Title
        </label>
        <input
          id={`${idPrefix}-title`}
          type="text"
          placeholder="Task title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={disabled}
          className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-description`} className="block text-xs text-[var(--color-text-muted)] mb-1">
          Details (optional)
        </label>
        <DictationTextarea
          id={`${idPrefix}-description`}
          field="description"
          dictation={dictation}
          dictateLabel="Dictate task details"
          placeholder="Add details…"
          value={description}
          onChange={onDescriptionChange}
          disabled={disabled}
          rows={3}
          className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-transparent resize-none disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-due`} className="block text-xs text-[var(--color-text-muted)] mb-1">
          Due date (optional)
        </label>
        <input
          id={`${idPrefix}-due`}
          type="date"
          value={dueAt}
          onChange={(e) => onDueAtChange(e.target.value)}
          disabled={disabled}
          className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-[var(--color-surface)] disabled:opacity-50"
        />
      </div>

      {/*
        Sits directly above Assign to because it governs that list: member rows belong to one
        workspace, so changing this changes who the task can be assigned to.
      */}
      {showWorkspace && (
        <div>
          <label htmlFor={`${idPrefix}-workspace`} className="block text-xs text-[var(--color-text-muted)] mb-1">
            Workspace
          </label>
          <select
            id={`${idPrefix}-workspace`}
            value={workspaceId}
            onChange={(e) => onWorkspaceChange(e.target.value)}
            disabled={disabled}
            className="w-full border border-[var(--color-border)] rounded-sm px-3 py-2 text-sm bg-[var(--color-surface)] disabled:opacity-50"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {workspaceNote}
        </div>
      )}

      {/* A group of checkboxes needs a group label, which is what fieldset/legend is for. */}
      <fieldset>
        <legend className="block text-xs text-[var(--color-text-muted)] mb-1">Assign to</legend>
        <div className="flex flex-col gap-1.5">
          {currentWorkspace?.members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={selectedMemberIds.includes(m.id)}
                onChange={() => onToggleMember(m.id)}
                disabled={disabled}
                className="rounded accent-[var(--color-accent)]"
              />
              {m.display_name}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
