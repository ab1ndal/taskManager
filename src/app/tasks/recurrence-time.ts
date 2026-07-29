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

/**
 * Tomorrow at 09:00 Pacific — the value Repeats starts on rather than an empty field.
 *
 * Adding a fixed 24h in UTC is wrong here: Pacific's clock does not move by exactly 24h across a
 * DST transition, so it either skips a calendar day (spring-forward) or repeats one (fall-back).
 * The fix works on the Pacific calendar date itself — read today's Y/M/D from `toLocalInputValue`,
 * advance the date component by one, and let `Date.UTC` normalize the month/year rollover — so no
 * instant arithmetic, and therefore no DST, is involved at all.
 */
export function defaultFirstRun(now: Date = new Date()): string {
  const [year, month, day] = toLocalInputValue(now.toISOString()).slice(0, 10).split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return `${tomorrow}T09:00`;
}
