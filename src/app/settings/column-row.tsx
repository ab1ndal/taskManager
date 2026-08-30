"use client";

import { useId, useState } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";

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
}: {
  column: BoardColumn;
  siblings: BoardColumn[];
  nonTerminalSiblingCount: number;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState<Tab20Slug>(column.color);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const captionId = useId();

  const deleteDisabled = !column.isDone && nonTerminalSiblingCount === 0;

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed === column.name) return;

    const result = await renameBoardColumn({ columnId: column.id, name: trimmed });
    if (!result.ok) {
      setName(column.name);
      toast(result.error ?? "Could not rename the column", "error");
    }
  }

  async function saveColor(slug: Tab20Slug) {
    const previous = color;
    setColor(slug);

    const result = await setBoardColumnColor({ columnId: column.id, color: slug });
    if (!result.ok) {
      setColor(previous);
      toast(result.error ?? "Could not change the colour", "error");
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <ColorPicker value={color} onChange={saveColor} label={`Colour for ${column.name}`} />

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <input
          aria-label="Column name"
          aria-describedby={column.isDone ? `${captionId}-done` : undefined}
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          className="min-h-11 rounded-sm border border-transparent bg-transparent px-2 text-sm font-medium text-[var(--color-text-primary)] hover:border-[var(--color-border)]"
        />
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
        aria-describedby={deleteDisabled ? `${captionId}-guard` : undefined}
        disabled={deleteDisabled}
        onClick={() => setConfirmingDelete(true)}
        title={deleteDisabled ? "A workspace needs at least one active column" : undefined}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-sm text-[var(--color-danger-text)] hover:bg-[var(--color-danger-surface)] disabled:pointer-events-none disabled:opacity-40"
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
