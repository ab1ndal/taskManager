/**
 * The tab20 palette, as slugs rather than hex.
 *
 * Columns store a slug and the CSS resolves it, so a column's colour follows the light/dark tokens
 * in globals.css instead of being frozen at the value it had when someone picked it. The same list
 * is the check constraint in migration 015 — changing one without the other lets a row exist that
 * the UI cannot paint.
 */
export const TAB20_SLUGS = [
  "tab20-blue",
  "tab20-blue-light",
  "tab20-orange",
  "tab20-orange-light",
  "tab20-green",
  "tab20-green-light",
  "tab20-red",
  "tab20-red-light",
  "tab20-purple",
  "tab20-purple-light",
  "tab20-brown",
  "tab20-brown-light",
  "tab20-pink",
  "tab20-pink-light",
  "tab20-grey",
  "tab20-grey-light",
  "tab20-olive",
  "tab20-olive-light",
  "tab20-cyan",
  "tab20-cyan-light",
] as const;

export type Tab20Slug = (typeof TAB20_SLUGS)[number];

export function isTab20Slug(value: string): value is Tab20Slug {
  return (TAB20_SLUGS as readonly string[]).includes(value);
}

/**
 * Seeded for every workspace by the trigger in migration 015. The terminal column must be last:
 * new tasks land in the leftmost non-terminal column, and the delete dialog defaults to a
 * neighbour, so ordering carries behaviour.
 */
export const DEFAULT_BOARD_COLUMNS: { name: string; color: Tab20Slug; isDone: boolean }[] = [
  { name: "Not Started", color: "tab20-grey", isDone: false },
  { name: "In Progress", color: "tab20-blue", isDone: false },
  { name: "Blocked", color: "tab20-red", isDone: false },
  { name: "Follow-up", color: "tab20-orange", isDone: false },
  { name: "Completed", color: "tab20-green", isDone: true },
];
