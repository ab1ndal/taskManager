"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Plus, Users } from "lucide-react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";

import { createBoardColumn, reorderBoardColumn } from "@/app/board/actions";
import type { BoardColumn } from "@/app/board/group-columns";
import { toast } from "@/components/toaster";
import { ICON_SECONDARY, ICON_STROKE } from "@/components/icon";
import { ColumnRow } from "./column-row";

/** Columns render in `position` order, ties broken by name — the same order the board uses. */
function sortColumns(columns: BoardColumn[]): BoardColumn[] {
  return [...columns].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/**
 * Turns a drop into the `prevPosition`/`nextPosition` pair `reorderBoardColumn` expects, applies the
 * move optimistically, and rolls back that one column if the write fails.
 *
 * The optimistic position must be computed the same way the action computes the authoritative one,
 * or the row would visibly jump when the server's value arrives. Kept next to the action's own
 * arithmetic on purpose — the two are a pair.
 *
 * Exported for direct testing: a jsdom drag cannot produce a real DropResult.
 */
export function buildColumnDragEndHandler({
  columns,
  setColumns,
  onError,
}: {
  columns: BoardColumn[];
  setColumns: (updater: (prev: BoardColumn[]) => BoardColumn[]) => void;
  onError: (message: string) => void;
}) {
  return async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.index === destination.index) return;

    const dragged = columns.find((c) => c.id === draggableId);
    if (!dragged) return;

    const withoutDragged = columns.filter((c) => c.id !== draggableId);
    const reordered = [
      ...withoutDragged.slice(0, destination.index),
      dragged,
      ...withoutDragged.slice(destination.index),
    ];
    const prevPosition = destination.index > 0 ? reordered[destination.index - 1].position : null;
    const nextPosition =
      destination.index < reordered.length - 1 ? reordered[destination.index + 1].position : null;

    // Sole column: there is nothing to order against and the action returns without writing.
    if (prevPosition === null && nextPosition === null) return;

    const optimisticPosition =
      prevPosition === null
        ? nextPosition! - 1000
        : nextPosition === null
          ? prevPosition + 1000
          : (prevPosition + nextPosition) / 2;

    setColumns((prev) =>
      sortColumns(
        prev.map((c) => (c.id === draggableId ? { ...c, position: optimisticPosition } : c))
      )
    );

    const res = await reorderBoardColumn({ columnId: draggableId, prevPosition, nextPosition });

    if (!res.ok) {
      // Roll back this column only. Replacing the whole array with a pre-drag snapshot would erase a
      // rename or a colour change made while the write was in flight.
      setColumns((prev) =>
        sortColumns(
          prev.map((c) => (c.id === draggableId ? { ...c, position: dragged.position } : c))
        )
      );
      onError(res.error ?? "Could not reorder the column");
    }
  };
}

/**
 * One workspace's column list. Owns the add-column form and the drag-to-reorder context; each row
 * owns its own rename and colour.
 *
 * The terminal column is draggable like any other: the board renders whatever order `position`
 * gives, and nothing downstream assumes the completed column is last.
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
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = useId();

  // Server data is the source of truth: reorderBoardColumn revalidates "/settings", so a confirmed
  // drop arrives back as fresh `columns` props. Syncing during render rather than in an effect
  // avoids the extra pass that renders the stale order first — same shape as board-client.tsx.
  const [order, setOrder] = useState(() => sortColumns(columns));
  const [syncedFrom, setSyncedFrom] = useState(columns);
  if (syncedFrom !== columns) {
    setSyncedFrom(columns);
    setOrder(sortColumns(columns));
  }

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
      const fieldError = result.fieldErrors?.name?.[0];
      if (fieldError) {
        // Field-level error: keep the typed name in place, editable, with the reason attached to
        // the input — the same treatment a rename collision gets in ColumnRow.
        setNameError(fieldError);
        return;
      }
      toast(result.error ?? "Could not add the column", "error");
      return;
    }

    setNameError(null);
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

      <DragDropContext
        onDragEnd={buildColumnDragEndHandler({
          columns: order,
          setColumns: setOrder,
          onError: (message) => toast(message, "error"),
        })}
      >
        <Droppable droppableId={`columns-${workspaceId}`}>
          {(provided) => (
            <ul ref={provided.innerRef} {...provided.droppableProps} className="flex flex-col gap-2">
              {/* disableInteractiveElementBlocking: the handle is a <button>, and dnd's lock check
                  refuses a drag started from an interactive element without it — the same reason
                  tasks-page-client.tsx sets it. Without it the lift is silently ignored. */}
              {order.map((column, index) => (
                <Draggable
                  key={column.id}
                  draggableId={column.id}
                  index={index}
                  disableInteractiveElementBlocking
                >
                  {(dragProvided) => (
                    <ColumnRow
                      column={column}
                      siblings={order.filter((c) => c.id !== column.id)}
                      nonTerminalSiblingCount={
                        order.filter((c) => c.id !== column.id && !c.isDone).length
                      }
                      onDeleted={() => router.refresh()}
                      innerRef={dragProvided.innerRef}
                      draggableProps={dragProvided.draggableProps}
                      dragHandleProps={dragProvided.dragHandleProps}
                    />
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </ul>
          )}
        </Droppable>
      </DragDropContext>

      <form onSubmit={addColumn} className="mt-3 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            aria-label={`New column name for ${workspaceName}`}
            aria-describedby={nameError ? errorId : undefined}
            aria-invalid={nameError ? true : undefined}
            value={newName}
            maxLength={40}
            placeholder="Add a column"
            onChange={(event) => {
              setNewName(event.target.value);
              if (nameError) setNameError(null);
            }}
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
        </div>
        {nameError && (
          <span id={errorId} className="px-1 text-xs text-[var(--color-danger-text)]">
            {nameError}
          </span>
        )}
      </form>
    </section>
  );
}
