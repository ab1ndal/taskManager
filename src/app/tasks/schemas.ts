import { z } from "zod";

/**
 * Input contracts for the task server actions.
 *
 * Server actions are public endpoints — arguments arrive from the network, not from the form, so
 * the modal's own checks are convenience, not validation. These schemas are the boundary: the
 * actions parse against them before touching the database, and the modals import the same schemas
 * so client and server can never disagree about what is acceptable.
 */

const uuid = z.uuid("Expected a UUID");

const title = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(200, "Title must be 200 characters or fewer");

const description = z
  .string()
  .trim()
  .max(2000, "Description must be 2000 characters or fewer")
  .optional();

/** The UI submits bare calendar dates; the actions widen them to UTC midnight. */
const dueAt = z.iso.date("Due date must be in YYYY-MM-DD format").optional();

/**
 * A task with no assignees is invisible to everyone — visibility is defined by task_assignments —
 * so an empty list is rejected rather than silently orphaning the task.
 */
const memberIds = z
  .array(uuid)
  .min(1, "Assign the task to at least one person")
  .max(50, "A task cannot be assigned to more than 50 people");

/**
 * A recurrence is the schedule half of a recurring task; the task row owns everything else.
 *
 * `biweekly` is deliberately absent — with a free interval count it is `weekly` with
 * `intervalCount: 2`, and two encodings of one schedule means nothing decides which the form emits.
 * Migration 012 drops it from the database check constraint for the same reason.
 */
const frequency = z.enum(["daily", "weekly", "monthly"], {
  message: "Choose days, weeks or months",
});

const intervalCount = z
  .number()
  .int("Repeat interval must be a whole number")
  .min(1, "Repeat interval must be at least 1")
  .max(365, "Repeat interval must be 365 or fewer"); // UI guardrail; database has no upper bound

/**
 * A wall-clock time with no offset, exactly as `<input type="datetime-local">` produces it. It is
 * resolved to an instant by `public.upsert_task_recurrence`, which is the only place in the stack
 * that knows the app is Pacific. Date-only is rejected: 9am versus midnight is the point of a
 * chore schedule.
 *
 * Use regex instead of `z.iso.datetime({ local: true })` because the latter permits an optional
 * offset (e.g., "2026-07-30T09:00Z"), and this field must reject any offset. Server actions are
 * public endpoints; a caller sending UTC would silently become Pacific time with no error.
 */
const firstRunAt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Start must include a date and a time");

const dueOffsetHours = z
  .number()
  .int("Due offset must be a whole number of hours")
  .min(0, "Due offset cannot be negative")
  .max(8760, "Due offset must be 8760 hours or fewer")
  .optional();

export const recurrenceSchema = z.object({
  frequency,
  intervalCount,
  firstRunAt,
  dueOffsetHours,
  /** Toggling Repeats off pauses rather than deletes, so the schedule survives being turned back on. */
  isActive: z.boolean().default(true),
});

export const setTaskRecurrenceSchema = recurrenceSchema.extend({ taskId: uuid });

export const createTaskWithSubtasksSchema = z.object({
  title,
  description,
  dueAt,
  workspaceId: uuid,
  memberIds,
  subtasks: z
    .array(z.object({ title, dueAt, description }))
    .max(50, "A task cannot have more than 50 subtasks"),
  /** Present when the Repeats section is on. The task and its rule are written by one action. */
  recurrence: recurrenceSchema.optional(),
});

export const updateTaskSchema = z.object({
  taskId: uuid,
  title,
  description,
  dueAt,
  memberIds,
  /**
   * Absent means "leave the workspace alone". Present and different from the task's current
   * workspace is a move: the task and its subtasks change workspace and are reassigned to
   * `memberIds`, which must be members of this workspace.
   */
  workspaceId: uuid.optional(),
});

const updateText = z
  .string()
  .trim()
  .min(1, "Update text is required")
  .max(2000, "Update must be 2000 characters or fewer");

export const createTaskUpdateSchema = z.object({
  taskId: uuid,
  updateText,
});

export const addSubtaskSchema = z.object({
  parentTaskId: uuid,
  title,
  description,
  dueAt,
});

/**
 * A subtask is a task row, so it could go through `updateTaskSchema` — except that schema also
 * reassigns members, and a subtask's assignees are inherited from its parent rather than chosen.
 * This one edits the three fields the subtask UI actually owns and leaves assignment alone.
 */
export const updateSubtaskSchema = z.object({
  subtaskId: uuid,
  title,
  description,
  dueAt,
});

export const taskIdSchema = uuid;

export const reorderTaskSchema = z
  .object({
    taskId: uuid,
    memberId: uuid,
    prevKey: z.number().finite().nullable(),
    nextKey: z.number().finite().nullable(),
  })
  .refine((v) => v.prevKey === null || v.nextKey === null || v.prevKey < v.nextKey, {
    message: "prevKey must be less than nextKey",
    path: ["prevKey"],
  });

export type CreateTaskWithSubtasksInput = z.input<typeof createTaskWithSubtasksSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;
export type ReorderTaskInput = z.input<typeof reorderTaskSchema>;
export type CreateTaskUpdateInput = z.input<typeof createTaskUpdateSchema>;
export type AddSubtaskInput = z.input<typeof addSubtaskSchema>;
export type UpdateSubtaskInput = z.input<typeof updateSubtaskSchema>;
export type Recurrence = z.output<typeof recurrenceSchema>;
export type SetTaskRecurrenceInput = z.input<typeof setTaskRecurrenceSchema>;

/** Thrown when input fails a schema. Carries per-field messages so the UI can point at the field. */
export class ValidationError extends Error {
  constructor(readonly fieldErrors: Record<string, string[]>, message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const flattened = z.flattenError(result.error);
  const fieldErrors = flattened.fieldErrors as Record<string, string[]>;
  const messages = [...flattened.formErrors, ...Object.values(fieldErrors).flat()];

  throw new ValidationError(fieldErrors, `Invalid input: ${messages.join("; ")}`);
}
