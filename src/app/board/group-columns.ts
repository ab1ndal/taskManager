import type { Tab20Slug } from "./colors";

/**
 * Everything the board needs to decide what appears where, as pure functions.
 *
 * The board's server component fetches, this module arranges, and the client component renders.
 * Keeping the arrangement pure is what makes the merge rules and the done window testable without a
 * database or a DOM.
 */

export type BoardColumn = {
  id: string;
  workspaceId: string;
  name: string;
  color: Tab20Slug;
  position: number;
  isDone: boolean;
};

export type BoardTask = {
  id: string;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
  workspaceId: string;
  workspaceName: string;
  workspaceKind: string;
  boardColumnId: string;
  memberSortKey: number;
  assigneeCount: number;
};

/**
 * A board column as rendered. In a single-workspace scope this is one row of board_columns; in the
 * all-workspaces scope it may stand for several, one per workspace, merged because they share a
 * name. `columnIdByWorkspaceId` is how a drop finds the real column to write.
 */
export type MergedColumn = {
  /** lower(name) — the identity a merge is keyed on, and the droppableId. */
  key: string;
  name: string;
  /** null when merged columns disagree about colour; the header then stays neutral. */
  color: Tab20Slug | null;
  position: number;
  isDone: boolean;
  columnIdByWorkspaceId: Record<string, string>;
};

/** docs/superpowers/specs/2026-08-26-kanban-board-design.md: the done column's default window. */
export const DONE_WINDOW_DAYS = 7;

export function mergeColumns(columns: BoardColumn[]): MergedColumn[] {
  const byKey = new Map<string, MergedColumn & { colorConflict: boolean }>();

  for (const column of columns) {
    const key = column.name.trim().toLowerCase();
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        key,
        name: column.name,
        color: column.color,
        position: column.position,
        isDone: column.isDone,
        columnIdByWorkspaceId: { [column.workspaceId]: column.id },
        colorConflict: false,
      });
      continue;
    }

    existing.columnIdByWorkspaceId[column.workspaceId] = column.id;
    // Lowest position wins, so a column early in either workspace stays early on the merged board.
    existing.position = Math.min(existing.position, column.position);
    // Terminal wins: a completed task must have somewhere to land.
    existing.isDone = existing.isDone || column.isDone;
    if (existing.color !== column.color) existing.colorConflict = true;
  }

  return [...byKey.values()]
    .map(({ colorConflict, ...merged }) => ({ ...merged, color: colorConflict ? null : merged.color }))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** The real column id to write when a card from `workspaceId` is dropped on `column`. */
export function resolveDropTarget(column: MergedColumn, workspaceId: string): string | null {
  return column.columnIdByWorkspaceId[workspaceId] ?? null;
}

/**
 * Buckets tasks under merged columns, keyed the same way `mergeColumns` keys them.
 *
 * Completion is derived, not stored twice: a completed task renders in the terminal column
 * regardless of its board_column_id, so completing a task from the list view moves its card here
 * with no write. With no terminal column on the board, completed tasks simply do not appear.
 */
export function groupTasks(
  merged: MergedColumn[],
  tasks: BoardTask[],
  now: Date = new Date()
): Record<string, BoardTask[]> {
  const grouped: Record<string, BoardTask[]> = {};
  merged.forEach((column) => (grouped[column.key] = []));

  const keyByColumnId = new Map<string, string>();
  merged.forEach((column) =>
    Object.values(column.columnIdByWorkspaceId).forEach((id) => keyByColumnId.set(id, column.key))
  );

  const terminal = merged.find((column) => column.isDone);
  const windowStart = now.getTime() - DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  for (const task of tasks) {
    if (task.completedAt) {
      if (!terminal) continue;
      if (new Date(task.completedAt).getTime() < windowStart) continue;
      grouped[terminal.key].push(task);
      continue;
    }

    const key = keyByColumnId.get(task.boardColumnId);
    // A column deleted between the fetch and this render: the card is left out rather than invented
    // into a column the user did not choose. The next load places it properly.
    if (!key) continue;

    // An open task whose column is the terminal one contradicts the board's own rule that the
    // terminal column holds completed work. Migration 019 and reopenTask both re-home such a task,
    // but a row written before those landed can still exist, so it renders in the first
    // non-terminal column rather than as an open card under Done.
    if (terminal && key === terminal.key) {
      const firstOpen = merged.find((column) => !column.isDone);
      if (!firstOpen) continue;
      grouped[firstOpen.key].push(task);
      continue;
    }

    grouped[key].push(task);
  }

  for (const column of merged) {
    grouped[column.key].sort((a, b) =>
      column.isDone
        ? // Done reads as a history: most recently finished first.
          new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()
        : a.memberSortKey - b.memberSortKey
    );
  }

  return grouped;
}
