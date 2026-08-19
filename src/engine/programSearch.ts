import type { Program } from "../types";

/**
 * Rank program matches; do not just filter them.
 *
 * A plain `includes` put "Biochemistry" above "Chemistry" for the query
 * "chemistry" — the exact degree the student typed sat second, under a
 * different one. Someone skimming a list picks the first row, so this is how a
 * student enrols in the wrong major.
 *
 * Exact first, then starts-with, then word-boundary, then anything else;
 * majors ahead of minors at equal rank, and shorter labels ahead of longer so
 * "Chemistry" beats "Chemistry Teaching Endorsement".
 *
 * Shared by the ⋯ menu and the first-run walkthrough — two places a student
 * picks a degree, which must not disagree about what the best match is.
 */
export function rankPrograms(
  available: readonly Program[],
  query: string,
  limit = 12,
): Program[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const rank = (label: string) => {
    const l = label.toLowerCase();
    if (l === q) return 0;
    if (l.startsWith(q)) return 1;
    // Word-boundary match without a dynamic regex — the query is user text and
    // would otherwise need escaping to be safe.
    if (l.includes(` ${q}`)) return 2;
    return 3;
  };
  return available
    .filter((p) => p.label.toLowerCase().includes(q))
    .slice()
    .sort(
      (a, b) =>
        rank(a.label) - rank(b.label) ||
        (a.type === b.type ? 0 : a.type === "major" ? -1 : 1) ||
        a.label.length - b.label.length ||
        a.label.localeCompare(b.label),
    )
    .slice(0, limit);
}
