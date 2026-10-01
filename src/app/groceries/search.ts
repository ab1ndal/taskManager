/**
 * Pantry search: exact substring hits first, then near-misses for typos.
 *
 * Runs over the rows the page already loaded, like suggest.ts — a few hundred names for two people
 * is far too small to justify a search index or a dependency.
 */

/** Spaces and hyphens are ignored, so "oatmilk" finds "Oat milk" and "oat-milk" alike. */
function compact(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "");
}

/**
 * Below four letters every typo allowance matches half the pantry ("ri" is one edit from most
 * two-letter fragments), so short queries get substring matching only.
 */
function allowedEdits(length: number): number {
  if (length < 4) return 0;
  return length < 8 ? 1 : 2;
}

/**
 * Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps each
 * cost one. Swaps matter on a phone keyboard: "panere" for "paneer" is one slip, not two.
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }

  return d[a.length][b.length];
}

/**
 * A name is "similar" when the query is within the allowance of any one word, of that word's
 * same-length prefix (so a typo while still typing — "pann" — already finds "Paneer"), or of the
 * whole name with spaces removed (so multi-word typos like "oat mlk" work).
 */
function isSimilar(name: string, needle: string): boolean {
  const limit = allowedEdits(needle.length);
  if (limit === 0) return false;

  const candidates = name.toLowerCase().split(/[\s-]+/).filter(Boolean);
  candidates.push(compact(name));

  return candidates.some(
    (word) =>
      editDistance(needle, word) <= limit ||
      (word.length > needle.length && editDistance(needle, word.slice(0, needle.length)) <= limit),
  );
}

export type PantrySearchResult<T> = { exact: T[]; similar: T[] };

/** Keeps the caller's order within each group, so the chosen pantry sort still applies. */
export function searchPantry<T extends { name: string }>(
  items: readonly T[],
  query: string,
): PantrySearchResult<T> {
  const needle = compact(query);
  if (needle === "") return { exact: [...items], similar: [] };

  const exact: T[] = [];
  const similar: T[] = [];
  for (const item of items) {
    if (compact(item.name).includes(needle)) exact.push(item);
    else if (isSimilar(item.name, needle)) similar.push(item);
  }

  return { exact, similar };
}
