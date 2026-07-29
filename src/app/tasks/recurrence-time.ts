/**
 * Converting between an instant and the wall-clock string `<input type="datetime-local">` uses.
 *
 * The app is Pacific and the database functions in migration 013 say so explicitly. The browser's
 * own timezone is deliberately not used: a user in another zone editing a household chore must see
 * the time the chore actually fires, not that instant rendered where they happen to be sitting.
 *
 * The reverse direction has no function here on purpose. A `datetime-local` value is submitted
 * verbatim and resolved by `public.upsert_task_recurrence`, which is the only place that should
 * decide what a bare wall-clock string means.
 */
export const APP_TIME_ZONE = "America/Los_Angeles";

/**
 * A task's schedule as the form holds it. Declared here rather than in `task-fields.tsx` because
 * `bucket-tasks.ts` needs the same shape and must not import a client component.
 */
export type RecurrenceValue = {
  frequency: "daily" | "weekly" | "monthly";
  intervalCount: number;
  /** Pacific wall-clock, exactly as `<input type="datetime-local">` produces it. */
  firstRunAt: string;
  dueOffsetHours: number | null;
};

/**
 * `sv-SE` formats as `YYYY-MM-DD HH:mm:ss`, which is the `datetime-local` value with a space where
 * the T goes — the shortest correct route from an instant to that format without a date library.
 */
export function toLocalInputValue(iso: string): string {
  const formatted = new Date(iso).toLocaleString("sv-SE", { timeZone: APP_TIME_ZONE });
  return formatted.slice(0, 16).replace(" ", "T");
}

/** Tomorrow at 09:00 Pacific — the value Repeats starts on rather than an empty field. */
export function defaultFirstRun(now: Date = new Date()): string {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return `${toLocalInputValue(tomorrow.toISOString()).slice(0, 10)}T09:00`;
}
