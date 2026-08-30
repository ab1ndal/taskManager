import { z } from "zod";

import { TAB20_SLUGS } from "./colors";

/**
 * Input contracts for the board server actions.
 *
 * Same posture as src/app/tasks/schemas.ts: actions are public endpoints, so these schemas are the
 * boundary and the client imports the same ones. Limits mirror migration 015 exactly — a name the
 * schema accepts and the database rejects would surface as a generic error instead of a field one.
 */

const uuid = z.uuid("Expected a UUID");

const columnName = z
  .string()
  .trim()
  .min(1, "Column name is required")
  .max(40, "Column name must be 40 characters or fewer");

const color = z.enum(TAB20_SLUGS, { message: "Choose one of the 20 palette colours" });

/** A neighbour's member_sort_key, or null when the card lands at an end of the column. */
const neighbourKey = z.number().nullable();

export const createBoardColumnSchema = z.object({
  workspaceId: uuid,
  name: columnName,
  color,
});

export const renameBoardColumnSchema = z.object({
  columnId: uuid,
  name: columnName,
});

export const setBoardColumnColorSchema = z.object({
  columnId: uuid,
  color,
});

export const reorderBoardColumnSchema = z.object({
  columnId: uuid,
  prevPosition: neighbourKey,
  nextPosition: neighbourKey,
});

export const moveTaskToColumnSchema = z.object({
  taskId: uuid,
  columnId: uuid,
  memberId: uuid,
  prevKey: neighbourKey,
  nextKey: neighbourKey,
});

export const listTasksInColumnSchema = z.object({ columnId: uuid });

export const loadOlderDoneSchema = z.object({
  workspaceIds: z.array(uuid).min(1, "Name at least one workspace").max(20),
  /** The oldest completed_at already on screen; the next page is strictly older than this. */
  before: z.iso.datetime("Expected an ISO timestamp"),
});

/**
 * One destination per task, because the user chooses individually. `moves` must be empty exactly
 * when the column is empty — the action checks that against the database, since only the database
 * knows what is in the column right now.
 */
export const deleteBoardColumnSchema = z
  .object({
    columnId: uuid,
    moves: z
      .array(z.object({ taskId: uuid, targetColumnId: uuid }))
      .max(500, "Too many tasks to move in one deletion"),
  })
  .refine((value) => value.moves.every((m) => m.targetColumnId !== value.columnId), {
    message: "Each task must move to a different column",
    path: ["moves"],
  })
  .refine((value) => new Set(value.moves.map((m) => m.taskId)).size === value.moves.length, {
    message: "Each task may appear only once",
    path: ["moves"],
  });

export type CreateBoardColumnInput = z.input<typeof createBoardColumnSchema>;
export type RenameBoardColumnInput = z.input<typeof renameBoardColumnSchema>;
export type SetBoardColumnColorInput = z.input<typeof setBoardColumnColorSchema>;
export type ReorderBoardColumnInput = z.input<typeof reorderBoardColumnSchema>;
export type MoveTaskToColumnInput = z.input<typeof moveTaskToColumnSchema>;
export type ListTasksInColumnInput = z.input<typeof listTasksInColumnSchema>;
export type LoadOlderDoneInput = z.input<typeof loadOlderDoneSchema>;
export type DeleteBoardColumnInput = z.input<typeof deleteBoardColumnSchema>;
