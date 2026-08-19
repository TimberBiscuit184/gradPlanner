/* How well does the parser cope with the WHOLE catalogue? — `npm run coverage`
 *
 * `npm run bench` scores the parser against 131 hand-verified courses. That
 * says it is right when it speaks; it says nothing about how often it can speak
 * at all across ~2,000 courses it has never seen.
 *
 * This reads `data/catalog-raw.json` and reports three things Phase 3 needs:
 *   1. the confidence split — how much of the catalogue is trustworthy enough
 *      to enforce, and how much has to be shown with a caveat;
 *   2. what gets dropped, so the loss is visible rather than assumed;
 *   3. the unrecognised prose, ranked, so extending the header vocabulary is a
 *      data-driven decision instead of guesswork.
 */
import { readFileSync } from "node:fs";
import {
  parseRequisites,
  type ParseConfidence,
} from "../src/engine/prereqParse";
import { parseRestriction } from "../src/engine/restrictions";
import type { RawCourse } from "./harvestCatalog";

const raw = JSON.parse(
  readFileSync(new URL("../data/catalog-raw.json", import.meta.url), "utf8"),
) as { _fetchedOn: string; courses: Record<string, RawCourse> };

const courses = Object.values(raw.courses);
const BY_UPPER = new Map(courses.map((c) => [c.id.toUpperCase(), c.id]));
const resolve = (code: string) => BY_UPPER.get(code.toUpperCase()) ?? null;

const HEADER_RE =
  /^(completed or concurrently enrolled|take the following course|take \d+ of the following|complete \d+ of the following|complete all of the following)/i;
// The `-or-` prefix is optional: most course bullets are bare. Requiring it
// counted every plain course line as unmodelled prose.
const COURSE_RE = /^(?:-or-\s*)?[A-Z]{2,6}\s?\d{3}/;

const conf: Record<ParseConfidence, number> = { exact: 0, parsed: 0, unsure: 0 };
let withReq = 0;
let noneParsed = 0;
let offCatalog = 0;
const unrecognised = new Map<string, number>();
const noteKinds = new Map<string, number>();

for (const c of courses) {
  if (!Object.keys(c.requisites).length) continue;
  withReq++;

  const got = parseRequisites(c.requisites, resolve);
  conf[got.confidence]++;
  if (got.prereq === null && got.coreq === null) noneParsed++;

  for (const n of got.notes) {
    const kind = n.replace(/"[^"]*"/, "…").slice(0, 70);
    noteKinds.set(kind, (noteKinds.get(kind) ?? 0) + 1);
  }
  // A dropped token that looks like a course code is a real edge we lost.
  if (got.dropped.some((d) => /^[A-Z]{2,6}\d{3}/.test(d))) offCatalog++;

  for (const text of Object.values(c.requisites)) {
    for (const seg of text.split("•")) {
      const s = seg.trim();
      if (!s || HEADER_RE.test(s) || COURSE_RE.test(s)) continue;
      const key = s.replace(/\d+/g, "N").slice(0, 64);
      unrecognised.set(key, (unrecognised.get(key) ?? 0) + 1);
    }
  }
}

const pct = (n: number) => ((n / withReq) * 100).toFixed(1);

console.log(`\nCatalogue-wide parse coverage (harvested ${raw._fetchedOn})\n`);
console.log(`  courses in catalogue:      ${courses.length}`);
console.log(`  carrying requisite text:   ${withReq}\n`);
console.log("  parser confidence:");
console.log(`    exact   ${String(conf.exact).padStart(4)}  ${pct(conf.exact)}%   every token understood`);
console.log(`    parsed  ${String(conf.parsed).padStart(4)}  ${pct(conf.parsed)}%   understood, but something was dropped`);
console.log(`    unsure  ${String(conf.unsure).padStart(4)}  ${pct(conf.unsure)}%   shape not representable — needs a human`);
console.log(`\n  produced no expression at all: ${noneParsed} (${pct(noneParsed)}%)`);
console.log(`  dropped a real course code:    ${offCatalog} (${pct(offCatalog)}%)`);

if (noteKinds.size) {
  console.log("\n  why `unsure`:");
  for (const [k, n] of [...noteKinds].sort((a, b) => b[1] - a[1]).slice(0, 8))
    console.log(`    ${String(n).padStart(4)}  ${k}`);
}

// Phase 4: the prose that yields no prerequisite is mostly *restrictions*.
// Counting what they turn into says how much of that 24% is now modelled
// rather than merely displayed.
const kinds = new Map<string, number>();
let coursesWithRestriction = 0;
for (const c of courses) {
  let any = false;
  for (const text of Object.values(c.requisites)) {
    for (const seg of text.split("•")) {
      const t = seg.trim();
      if (!t || HEADER_RE.test(t) || COURSE_RE.test(t)) continue;
      const k = parseRestriction(t).kind;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      if (k !== "note") any = true;
    }
  }
  if (any) coursesWithRestriction++;
}
console.log(
  `
  enrollment restrictions recognised on ${coursesWithRestriction} courses:`,
);
for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1]))
  console.log(`    ${String(n).padStart(4)}  ${k}`);

console.log("\n  most common prose the parser does not model:");
for (const [k, n] of [...unrecognised].sort((a, b) => b[1] - a[1]).slice(0, 18))
  console.log(`    ${String(n).padStart(4)}  ${k}`);
console.log();
