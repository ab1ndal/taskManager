"use client";

import { useId, useRef, useState } from "react";
import { CheckCircle2, GripVertical, Trash2 } from "lucide-react";
import type { DraggableProvidedDragHandleProps, DraggableProvidedDraggableProps } from "@hello-pangea/dnd";

import { renameBoardColumn, setBoardColumnColor } from "@/app/board/actions";
import type { BoardColumn } from "@/app/board/group-columns";
import type { Tab20Slug } from "@/app/board/colors";
import { toast } from "@/components/toaster";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { ColorPicker } from "./color-picker";
import { DeleteColumnDialog } from "./delete-column-dialog";

/**
 * One editable column. Rename saves on blur and colour saves on pick, both optimistically — neither
 * moves a task, so neither needs confirmation. Deletion does, and is handled by its own dialog.
 *
 * `nonTerminalSiblingCount` is the count of this workspace's OTHER non-terminal columns (excluding
 * this row and excluding any terminal/is_done column) — the same thing migration 021's
 * `delete_board_column` counts before it refuses. A count of *total* siblings would block deleting
 * the done column whenever it is the only non-done one, which the server allows; only a non-terminal
 * column whose deletion would leave zero non-terminal columns is refused, so the guard here checks
 * both `!column.isDone` and the count, and a terminal column is never disabled by this rule.
 */
export function ColumnRow({
  column,
  siblings,
  nonTerminalSiblingCount,
  onDeleted,
  innerRef,
  draggableProps,
  dragHandleProps,
}: {
  column: BoardColumn;
  siblings: BoardColumn[];
  nonTerminalSiblingCount: number;
  onDeleted: () => void;
  // Supplied by the editor's <Draggable>. Optional so this row still renders — and stays testable —
  // outside a DragDropContext; without them it is simply a row that cannot be dragged.
  innerRef?: (element: HTMLElement | null) => void;
  draggableProps?: DraggableProvidedDraggableProps;
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
}) {
  const [name, setName] = useState(column.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [color, setColor] = useState<Tab20Slug>(column.color);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const captionId = useId();

  // The value the server currently holds, tracked separately from `column.name`/`column.color`
  // (frozen at this row's mount) so a rollback restores what actually saved last, not a stale
  // initial prop. Refs, not state: a fast, later save must win even if an earlier, slower save's
  // failure resolves after it — reading a ref at that moment always sees the latest success.
  const lastGoodNameRef = useRef(column.name);
  const lastGoodColorRef = useRef<Tab20Slug>(column.color);

  const deleteDisabled = !column.isDone && nonTerminalSiblingCount === 0;

  async function saveName() {
    const attempted = name.trim();
    if (attempted === lastGoodNameRef.current) return;

    const result = await renameBoardColumn({ columnId: column.id, name: attempted });
    if (result.ok) {
      lastGoodNameRef.current = attempted;
      setNameError(null);
      return;
    }

    const fieldError = result.fieldErrors?.name?.[0];
    if (fieldError) {
      // A field-level error (the name collision case): keep exactly what the user typed, editable
      // in place, with the reason attached to the input — not a toast that vanishes and a wiped
      // field the brief specifically asked not to lose.
      setNameError(fieldError);
      return;
    }

    setNameError(null);
    toast(result.error ?? "Could not rename the column", "error");
    // Only undo if nothing newer has been typed/saved since this attempt — a faster, later rename
    // may have already replaced it, and this stale failure must not clobber that.
    setName((current) => (current === attempted ? lastGoodNameRef.current : current));
  }

  async function saveColor(slug: Tab20Slug) {
    const attempted = slug;
    setColor(attempted);

    const result = await setBoardColumnColor({ columnId: column.id, color: attempted });
    if (result.ok) {
      lastGoodColorRef.current = attempted;
      return;
    }

    toast(result.error ?? "Could not change the colour", "error");
    setColor((current) => (current === attempted ? lastGoodColorRef.current : current));
  }

  return (
    <li
      ref={innerRef}
      {...draggableProps}
      className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
    >
      {dragHandleProps && (
        <button
          type="button"
          aria-label={`Reorder "${column.name}"`}
          className="flex min-h-11 min-w-11 shrink-0 cursor-grab items-center justify-center text-[var(--color-text-muted)] active:cursor-grabbing"
          {...dragHandleProps}
        >
          <GripVertical size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
      )}

      <ColorPicker value={color} onChange={saveColor} label={`Colour for ${column.name}`} />

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <input
          aria-label="Column name"
          aria-describedby={
            [column.isDone ? `${captionId}-done` : null, nameError ? `${captionId}-name-error` : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={nameError ? true : undefined}
          value={name}
          maxLength={40}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(null);
          }}
          onBlur={saveName}
          className="min-h-11 rounded-sm border border-transparent bg-transparent px-2 text-sm font-medium text-[var(--color-text-primary)] hover:border-[var(--color-border)]"
        />
        {nameError && (
          <span id={`${captionId}-name-error`} className="px-2 text-xs text-[var(--color-danger-text)]">
            {nameError}
          </span>
        )}
        {column.isDone && (
          <span
            id={`${captionId}-done`}
            className="flex items-center gap-1 px-2 text-xs text-[var(--color-text-secondary)]"
          >
            <CheckCircle2 size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
            Completed tasks land here
          </span>
        )}
      </div>

      <button
        type="button"
        aria-label={`Delete ${column.name}`}
        aria-disabled={deleteDisabled || undefined}
        aria-describedby={deleteDisabled ? `${captionId}-guard` : undefined}
        onClick={() => {
          // aria-disabled, not the disabled attribute: a disabled button drops out of the tab
          // order and stops the `title` tooltip from rendering, which is exactly what made the
          // guard's rationale unreachable to every user — mouse or keyboard. Staying focusable and
          // handling the click as a no-op keeps both channels live.
          if (deleteDisabled) return;
          setConfirmingDelete(true);
        }}
        title={deleteDisabled ? "A workspace needs at least one active column" : undefined}
        className={`flex min-h-11 min-w-11 items-center justify-center rounded-sm text-[var(--color-danger-text)] ${
          deleteDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-[var(--color-danger-surface)]"
        }`}
      >
        <Trash2 size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
        {deleteDisabled && (
          <span id={`${captionId}-guard`} className="sr-only">
            A workspace needs at least one active column, so this cannot be deleted.
          </span>
        )}
      </button>

      {confirmingDelete && (
        <DeleteColumnDialog
          column={column}
          siblings={siblings}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={() => {
            setConfirmingDelete(false);
            onDeleted();
          }}
        />
      )}
    </li>
  );
}
