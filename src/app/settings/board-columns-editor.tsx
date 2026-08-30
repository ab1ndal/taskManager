"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Users } from "lucide-react";

import { createBoardColumn } from "@/app/board/actions";
import type { BoardColumn } from "@/app/board/group-columns";
import { toast } from "@/components/toaster";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { ColumnRow } from "./column-row";

/**
 * One workspace's column list. Owns the add-column form; each row owns its own rename and colour.
 *
 * Reordering is deliberately out of scope here: columns render in `position` order and a new one
 * lands at the end via `createBoardColumn`'s own placement. `reorderBoardColumn` exists and is
 * action-tested, but wiring a drag handle is separable work — see tasks/todo.md.
 */
export function BoardColumnsEditor({
  workspaceId,
  workspaceName,
  columns,
}: {
  workspaceId: string;
  workspaceName: string;
  columns: BoardColumn[];
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function addColumn(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setSaving(true);
    // New columns start grey; the colour picker is one click away and guessing a hue would be worse
    // than a neutral default.
    const result = await createBoardColumn({ workspaceId, name, color: "tab20-grey" });
    setSaving(false);

    if (!result.ok) {
      toast(result.error ?? "Could not add the column", "error");
      return;
    }

    setNewName("");
    router.refresh();
  }

  return (
    <section aria-label={`${workspaceName} columns`}>
      <h2 className="text-base font-semibold tracking-tight text-[var(--color-text-primary)]">
        {workspaceName}
      </h2>
      <p className="mb-3 mt-0.5 flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
        <Users size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
        These columns are shared. Changes apply to everyone in {workspaceName}.
      </p>

      <ul className="flex flex-col gap-2">
        {columns.map((column) => (
          <ColumnRow
            key={column.id}
            column={column}
            nonTerminalSiblingCount={
              columns.filter((c) => c.id !== column.id && !c.isDone).length
            }
            onDeleted={() => router.refresh()}
          />
        ))}
      </ul>

      <form onSubmit={addColumn} className="mt-3 flex items-center gap-2">
        <input
          aria-label={`New column name for ${workspaceName}`}
          value={newName}
          maxLength={40}
          placeholder="Add a column"
          onChange={(event) => setNewName(event.target.value)}
          className="min-h-11 flex-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm placeholder:text-[var(--color-text-secondary)]"
        />
        <button
          type="submit"
          disabled={saving || newName.trim().length === 0}
          className="flex min-h-11 items-center gap-1.5 rounded-sm bg-[var(--color-accent)] px-4 text-sm font-medium text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          <Plus size={ICON_SECONDARY} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Add
        </button>
      </form>
    </section>
  );
}
