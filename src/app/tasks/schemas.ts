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

export const createTaskWithSubtasksSchema = z.object({
  title,
  description,
  dueAt,
  workspaceId: uuid,
  memberIds,
  subtasks: z
    .array(z.object({ title, dueAt, description }))
    .max(50, "A task cannot have more than 50 subtasks"),
});

export const updateTaskSchema = z.object({
  taskId: uuid,
  title,
  description,
  dueAt,
  memberIds,
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
