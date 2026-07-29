"use client";

import { Repeat } from "lucide-react";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { DictationTextarea } from "@/components/dictation-textarea";
import { useDictation } from "@/lib/use-dictation";
import { defaultFirstRun, type RecurrenceValue } from "./recurrence-time";

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
  /**
   * The stored/draft schedule values. Kept populated even while `recurrenceEnabled` is false so a
   * paused rule's cadence survives being switched back on — see the note above the checkbox below.
   */
  recurrence: RecurrenceValue | null;
  /** Whether Repeats is switched on. Independent of `recurrence` so "off" can still remember a value. */
  recurrenceEnabled: boolean;
  /** Edits to the schedule fields while `recurrenceEnabled` is true. Never called with null. */
  onRecurrenceChange: (next: RecurrenceValue) => void;
  onRecurrenceEnabledChange: (enabled: boolean) => void;
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
  recurrence,
  recurrenceEnabled,
  onRecurrenceChange,
  onRecurrenceEnabledChange,
}: TaskFieldsProps) {
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);
  const showWorkspace = !hideWorkspaceWhenOnlyOne || workspaces.length > 1;

  /**
   * Flipping the toggle only ever changes `recurrenceEnabled`. It seeds `recurrence` with defaults
   * the first time it is switched on and there is nothing stored yet, but turning it off never
   * touches `recurrence` — that is what lets a paused rule's cadence come back unchanged when the
   * user re-enables it, instead of the checkbox itself overloading "off" as "forgotten".
   */
  function handleToggleRecurrence() {
    const next = !recurrenceEnabled;
    onRecurrenceEnabledChange(next);
    if (next && recurrence === null) {
      onRecurrenceChange({
        frequency: "daily",
        intervalCount: 1,
        firstRunAt: defaultFirstRun(),
        dueOffsetHours: null,
      });
    }
  }

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

      {/*
        Recurrence is a property of the task, not a separate entity — one permanent task row that
        reactivates at each occurrence. Switching Repeats off in the modal turns into is_active =
        false so the schedule survives being switched back on, and deleting the task is what
        removes a recurrence for good. The checkbox reflects `recurrenceEnabled`, not merely
        whether `recurrence` is non-null — a paused rule has stored values but must render OFF.
      */}
      <div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={recurrenceEnabled}
            onChange={handleToggleRecurrence}
            disabled={disabled}
            className="rounded accent-[var(--color-accent)]"
          />
          <Repeat size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Repeats
        </label>

        {recurrenceEnabled && recurrence && (
          <div className="mt-2 flex flex-col gap-2 rounded-sm border border-[var(--color-border)] p-2">
            <div className="flex items-end gap-2">
              <div className="w-20">
                <label
                  htmlFor={`${idPrefix}-repeat-interval`}
                  className="block text-xs text-[var(--color-text-muted)] mb-1"
                >
                  Repeat every
                </label>
                <input
                  id={`${idPrefix}-repeat-interval`}
                  type="number"
                  min={1}
                  max={365}
                  value={recurrence.intervalCount}
                  onChange={(e) =>
                    onRecurrenceChange({
                      ...recurrence,
                      intervalCount: Number(e.target.value),
                    })
                  }
                  disabled={disabled}
                  className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-transparent disabled:opacity-50"
                />
              </div>
              <div className="flex-1">
                <label
                  htmlFor={`${idPrefix}-repeat-unit`}
                  className="block text-xs text-[var(--color-text-muted)] mb-1"
                >
                  Repeat unit
                </label>
                <select
                  id={`${idPrefix}-repeat-unit`}
                  value={recurrence.frequency}
                  onChange={(e) =>
                    onRecurrenceChange({
                      ...recurrence,
                      frequency: e.target.value as RecurrenceValue["frequency"],
                    })
                  }
                  disabled={disabled}
                  className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-[var(--color-surface)] disabled:opacity-50"
                >
                  {/* No biweekly: it is weekly with an interval of 2, and migration 012 drops it. */}
                  <option value="daily">days</option>
                  <option value="weekly">weeks</option>
                  <option value="monthly">months</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor={`${idPrefix}-repeat-start`}
                className="block text-xs text-[var(--color-text-muted)] mb-1"
              >
                Starting
              </label>
              {/*
                datetime-local, not date: the existing due-date fields are date-only, but 9am versus
                midnight is the point of a chore schedule. The value is Pacific wall-clock and is
                resolved server-side — see recurrence-time.ts.
              */}
              <input
                id={`${idPrefix}-repeat-start`}
                type="datetime-local"
                value={recurrence.firstRunAt}
                onChange={(e) => onRecurrenceChange({ ...recurrence, firstRunAt: e.target.value })}
                disabled={disabled}
                className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-[var(--color-surface)] disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor={`${idPrefix}-repeat-offset`}
                className="block text-xs text-[var(--color-text-muted)] mb-1"
              >
                Due hours after it appears (optional)
              </label>
              <input
                id={`${idPrefix}-repeat-offset`}
                type="number"
                min={0}
                max={8760}
                value={recurrence.dueOffsetHours ?? ""}
                onChange={(e) =>
                  onRecurrenceChange({
                    ...recurrence,
                    dueOffsetHours: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                disabled={disabled}
                className="w-full border border-[var(--color-border)] rounded-sm px-2 py-1 text-sm bg-transparent disabled:opacity-50"
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
