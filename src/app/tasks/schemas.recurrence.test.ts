import { recurrenceSchema, setTaskRecurrenceSchema, createTaskWithSubtasksSchema } from "./schemas";

const validRecurrence = {
  frequency: "daily" as const,
  intervalCount: 3,
  firstRunAt: "2026-07-30T09:00",
  dueOffsetHours: 0,
  isActive: true,
};

describe("recurrenceSchema", () => {
  it("accepts an every-3-days rule", () => {
    expect(recurrenceSchema.safeParse(validRecurrence).success).toBe(true);
  });

  it("defaults isActive to true when omitted", () => {
    const { isActive, ...withoutActive } = validRecurrence;
    const parsed = recurrenceSchema.parse(withoutActive);
    expect(parsed.isActive).toBe(true);
  });

  it("rejects biweekly, which is weekly with interval 2", () => {
    const result = recurrenceSchema.safeParse({ ...validRecurrence, frequency: "biweekly" });
    expect(result.success).toBe(false);
  });

  it("rejects an interval of zero", () => {
    const result = recurrenceSchema.safeParse({ ...validRecurrence, intervalCount: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at least 1/i);
    }
  });

  it("rejects a fractional interval", () => {
    expect(recurrenceSchema.safeParse({ ...validRecurrence, intervalCount: 1.5 }).success).toBe(false);
  });

  it("rejects a date-only first run, because the time of day is the point", () => {
    expect(recurrenceSchema.safeParse({ ...validRecurrence, firstRunAt: "2026-07-30" }).success).toBe(false);
  });

  it("rejects a UTC offset suffix (Z), because resolution must be in Pacific", () => {
    const result = recurrenceSchema.safeParse({ ...validRecurrence, firstRunAt: "2026-07-30T09:00Z" });
    expect(result.success).toBe(false);
  });

  it("rejects a positive offset (e.g., +05:00), because resolution must be in Pacific", () => {
    const result = recurrenceSchema.safeParse({ ...validRecurrence, firstRunAt: "2026-07-30T09:00+05:00" });
    expect(result.success).toBe(false);
  });

  it("rejects seconds in the timestamp, matching datetime-local input which omits them", () => {
    const result = recurrenceSchema.safeParse({ ...validRecurrence, firstRunAt: "2026-07-30T09:00:00" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative due offset", () => {
    expect(recurrenceSchema.safeParse({ ...validRecurrence, dueOffsetHours: -1 }).success).toBe(false);
  });
});

describe("setTaskRecurrenceSchema", () => {
  it("requires a task id", () => {
    expect(setTaskRecurrenceSchema.safeParse(validRecurrence).success).toBe(false);
  });

  it("accepts a task id with the recurrence fields", () => {
    const result = setTaskRecurrenceSchema.safeParse({
      taskId: "0f1e2d3c-4b5a-4968-8776-655443332211",
      ...validRecurrence,
    });
    expect(result.success).toBe(true);
  });
});

describe("createTaskWithSubtasksSchema recurrence", () => {
  const base = {
    title: "Take trash",
    workspaceId: "0f1e2d3c-4b5a-4968-8776-655443332211",
    memberIds: ["1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"],
    subtasks: [],
  };

  it("is optional", () => {
    expect(createTaskWithSubtasksSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a recurrence alongside the task", () => {
    const result = createTaskWithSubtasksSchema.safeParse({ ...base, recurrence: validRecurrence });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid recurrence rather than dropping it", () => {
    const result = createTaskWithSubtasksSchema.safeParse({
      ...base,
      recurrence: { ...validRecurrence, intervalCount: 0 },
    });
    expect(result.success).toBe(false);
  });
});
