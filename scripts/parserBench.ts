/* Measures the prerequisite parser against hand-verified ground truth.
 *
 *   npm run bench
 *
 * WHY THIS EXISTS: Phase 2 replaces a human reading 136 catalogue entries with
 * a parser reading a few thousand. The only honest way to trust that swap is to
 * point the parser at the entries a human *did* read and count how often it
 * agrees. `data/catalog-snapshot.json` is the raw prose the 2026-08-06 audit
 * saw; `data/courses.json` is what a human concluded from it. That pairing is a
 * labelled test set, and this script is the score.
 *
 * A disagreement is not automatically a parser bug — several fixture entries
 * deliberately differ from the catalogue (retired branches kept as options,
 * placement paths left unmodelled; see ACKNOWLEDGED in auditCatalog.ts). The
 * point is that every difference is *visible* rather than absorbed.
 */
import { readFileSync } from "node:fs";
import { COURSES } from "../src/data";
import {
  parseRequisites,
  sameNode,
  type ParseConfidence,
} from "../src/engine/prereqParse";
import type { PrereqNode } from "../src/types";

interface Snapshot {
  _fetchedOn: string;
  courses: Record<string, Record<string, unknown>>;
}

const snap = JSON.parse(
  readFileSync(new URL("../data/catalog-snapshot.json", import.meta.url), "utf8"),
) as Snapshot;

const show = (n: PrereqNode): string => {
  if (n === null) return "—";
  if (typeof n === "string") return n;
  const kids = "and" in n ? n.and : n.or;
  const op = "and" in n ? " AND " : " OR ";
  return `(${kids.map(show).join(op)})`;
};

/** Catalogue codes are upper-case; fixture ids are not always (CSE121c). */
const BY_UPPER = new Map(COURSES.map((c) => [c.id.toUpperCase(), c.id]));
const resolve = (code: string) => BY_UPPER.get(code.toUpperCase()) ?? null;

let compared = 0;
const byConfidence: Record<ParseConfidence, number> = {
  exact: 0,
  parsed: 0,
  unsure: 0,
};
const agree: Record<ParseConfidence, number> = { exact: 0, parsed: 0, unsure: 0 };
const disagreements: string[] = [];

for (const c of COURSES) {
  if (c.isPlaceholder) continue;
  const entry = snap.courses[c.id];
  if (!entry) continue;
  compared++;

  const got = parseRequisites(entry, resolve);
  byConfidence[got.confidence]++;

  const prereqOk = sameNode(got.prereq, c.prereq);
  const coreqOk = sameNode(got.coreq, c.coreq ?? null);
  if (prereqOk && coreqOk) {
    agree[got.confidence]++;
    continue;
  }

  disagreements.push(
    [
      `${c.code}  [${got.confidence}]`,
      !prereqOk && `   prereq  human: ${show(c.prereq)}`,
      !prereqOk && `           parser: ${show(got.prereq)}`,
      !coreqOk && `   coreq   human: ${show(c.coreq ?? null)}`,
      !coreqOk && `           parser: ${show(got.coreq)}`,
      got.dropped.length && `   dropped: ${got.dropped.join(" | ").slice(0, 140)}`,
      got.notes.length && `   notes: ${got.notes.join("; ").slice(0, 160)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

const totalAgree = agree.exact + agree.parsed + agree.unsure;
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : "—");

console.log(`\nParser vs. hand-verified ground truth (${snap._fetchedOn})\n`);
console.log(`  compared:        ${compared} courses`);
console.log(`  agree exactly:   ${totalAgree}  (${pct(totalAgree, compared)}%)\n`);
console.log("  by self-reported confidence:");
for (const k of ["exact", "parsed", "unsure"] as ParseConfidence[]) {
  console.log(
    `    ${k.padEnd(7)} ${String(byConfidence[k]).padStart(3)} parsed` +
      `   ${String(agree[k]).padStart(3)} agree` +
      `   ${pct(agree[k], byConfidence[k])}%`,
  );
}

if (disagreements.length) {
  console.log(`\n  ${disagreements.length} disagreements:\n`);
  console.log(disagreements.join("\n\n"));
}
console.log();
