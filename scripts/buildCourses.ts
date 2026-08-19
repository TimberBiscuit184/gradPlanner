/* Merges the harvested catalogue into a full course set — `npm run merge`.
 *
 * Phase 5. `data/courses.json` holds 136 courses a human audited; the harvest
 * holds all 2,026. This produces `data/courses-full.json` = the fixture,
 * verbatim, plus every other course with its requisites parsed and *graded*.
 *
 * The rule that matters: **a hand-audited entry is never overwritten.** Those
 * carry scraped offered-terms, half-semester blocks, online availability,
 * section counts and skill tags that the catalogue API does not have, and they
 * are the only entries anyone has actually read. Generated entries are additive
 * and arrive labelled with what the parser could and could not do.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseRequisites } from "../src/engine/prereqParse";
import { parseRestriction } from "../src/engine/restrictions";
import type { Course, PrereqTrust, Restriction } from "../src/types";
import type { RawCourse } from "./harvestCatalog";

const url = (p: string) => new URL(`../data/${p}`, import.meta.url);
const fixture = JSON.parse(readFileSync(url("courses.json"), "utf8")) as {
  _note: string;
  courses: Course[];
};
const raw = JSON.parse(readFileSync(url("catalog-raw.json"), "utf8")) as {
  _fetchedOn: string;
  courses: Record<string, RawCourse>;
};

/**
 * Offered terms, blocks and online availability from the class-schedule scrape
 * (`npm run schedule`). Optional: the merge still works without it, courses
 * just stay `termsConfirmed: false`.
 */
interface ScheduleEntry {
  terms: string[];
  blocks: string[];
  online: boolean;
  sections: Record<string, number>;
}
let schedule: Record<string, ScheduleEntry> = {};
let scheduleDate = "";
try {
  const sf = JSON.parse(readFileSync(url("schedule-full.json"), "utf8")) as {
    _fetchedOn: string;
    courses: Record<string, ScheduleEntry>;
  };
  schedule = sf.courses;
  scheduleDate = sf._fetchedOn;
} catch {
  console.log("no schedule-full.json — run `npm run schedule` to confirm offered terms");
}
const SEASON_ORDER = ["F", "W", "S"];

/**
 * One id space. Fixture casing wins — `CSE121c` is the id the plan, the
 * programs and the transcript all reference, and the catalogue's `CSE121C`
 * must resolve to it rather than creating a second course.
 */
const idByUpper = new Map<string, string>();
for (const c of Object.values(raw.courses)) idByUpper.set(c.id.toUpperCase(), c.id);
for (const c of fixture.courses) idByUpper.set(c.id.toUpperCase(), c.id);
const resolve = (code: string) => idByUpper.get(code.toUpperCase()) ?? null;

const HEADER_RE =
  /^(completed or concurrently enrolled|take the following course|take \d+ of the following|complete \d+ of the following|complete all of the following)/i;
const COURSE_RE = /^(?:-or-\s*)?[A-Z]{2,6}\s?\d{3}/;

/** The non-course, non-header bullets — the enrollment gates. */
function restrictionsFrom(rawCourse: RawCourse): Restriction[] {
  const out: Restriction[] = [];
  for (const text of Object.values(rawCourse.requisites)) {
    for (const seg of text.split("•")) {
      const t = seg.trim();
      if (!t || HEADER_RE.test(t) || COURSE_RE.test(t)) continue;
      const r = parseRestriction(t);
      if (r.kind !== "note") out.push(r);
    }
  }
  return out;
}

/**
 * Dedupe case-INSENSITIVELY. The catalogue calls it `CSE121C`, the fixture
 * calls it `CSE121c`, and a case-sensitive check let both through — producing
 * two courses with the same identity, one of which nothing references.
 */
/** Schedule-derived fields for one course, or the unconfirmed fallback. */
function termFieldsFor(id: string) {
  const scraped = Object.keys(schedule).length > 0;
  const hit = schedule[id.toUpperCase()];
  if (hit) {
    return {
      terms: SEASON_ORDER.filter((s) => hit.terms.includes(s)) as Course["terms"],
      termsConfirmed: true,
      blocks: hit.blocks.length ? hit.blocks : null,
      blocksConfirmed: hit.blocks.length > 0,
      online: hit.online,
      onlineConfirmedBySchedule: hit.online,
      sectionCounts: hit.sections as Course["sectionCounts"],
      scheduleSource: `BYU-Idaho class schedule, scraped ${scheduleDate}`,
      scheduleCheckedOn: scheduleDate,
    };
  }
  if (scraped) {
    /**
     * A full cycle was read and this course never appeared — but that is NOT
     * `terms: []`, which this codebase reads as "retired, will never run" and
     * which blocks planning outright. The schedule is one cycle of evidence:
     * a course on a two-year rotation looks identical to a dead one
     * (DATA_GAPS U14). Marking it unconfirmed never blocks, and the note says
     * exactly what was and was not observed.
     */
    return {
      terms: ["F", "W", "S"] as Course["terms"],
      termsConfirmed: false,
      blocks: null,
      blocksConfirmed: false,
      online: false,
      notes: `No section ran in Fall, Winter or Spring 2026. It may be on a longer rotation — check the class schedule before relying on it.`,
      scheduleSource: `BYU-Idaho class schedule, scraped ${scheduleDate} — not seen in the 2026 cycle`,
      scheduleCheckedOn: scheduleDate,
    };
  }
  return {
    terms: ["F", "W", "S"] as Course["terms"],
    termsConfirmed: false,
    blocks: null,
    blocksConfirmed: false,
    online: false,
  };
}

const fixtureIds = new Set(fixture.courses.map((c) => c.id.toUpperCase()));
const generated: Course[] = [];
const trustCount: Record<PrereqTrust, number> = {
  human: 0,
  exact: 0,
  parsed: 0,
  unsure: 0,
  none: 0,
};

for (const rc of Object.values(raw.courses)) {
  if (fixtureIds.has(rc.id.toUpperCase())) continue;

  const hasRequisites = Object.keys(rc.requisites).length > 0;
  /**
   * A course is never its own prerequisite. CHILD 300 and CHILD 310 each name
   * themselves in their catalogue text — harmless prose, but as an edge it puts
   * a course to the left of itself in the tree and makes `prereqDepth`
   * inconsistent. Dropping it is recorded, so the entry grades `parsed` rather
   * than `exact`.
   */
  const resolveHere = (code: string) => {
    const id = resolve(code);
    return id && id.toUpperCase() === rc.id.toUpperCase() ? null : id;
  };
  const p = hasRequisites ? parseRequisites(rc.requisites, resolveHere) : null;
  const trust: PrereqTrust = !p
    ? "none"
    : p.prereq === null && p.coreq === null && p.dropped.length === 0
      ? "none"
      : p.confidence;
  trustCount[trust]++;

  const restrictionRules = restrictionsFrom(rc);
  const [, subject = "", number = ""] =
    rc.id.match(/^([A-Z]+)(\d.*)$/) ?? [];

  generated.push({
    id: rc.id,
    dept: subject || rc.subject || rc.id.replace(/\d.*$/, ""),
    code: subject && number ? `${subject} ${number}` : rc.id,
    // Catalogue titles carry stray whitespace; normalise once at the source.
    title: rc.title.replace(/\s+/g, " ").trim(),
    credits: rc.credits?.min ?? 0,
    prereq: p?.prereq ?? null,
    coreq: p?.coreq ?? null,
    /**
     * Offered terms come from the class schedule, never the catalogue API.
     * Seen in the scrape → confirmed. Absent from a scrape that *did* run →
     * `terms: []`, which this codebase reads as "never runs" and which blocks
     * planning it: the course exists in the catalogue but had no section in a
     * full Fall/Winter/Spring cycle. Never scraped at all → the honest
     * `termsConfirmed: false`, which never blocks.
     */
    ...termFieldsFor(rc.id),
    tags: [],
    // `verified` means a human compared it to the catalogue. Nobody did.
    verified: false,
    prereqTrust: trust,
    ...(p?.dropped.length ? { prereqDropped: p.dropped } : {}),
    ...(restrictionRules.length ? { restrictionRules } : {}),
    prereqSource: `BYU-Idaho 2026-2027 catalog (byui.kuali.co API), parsed ${raw._fetchedOn}`,
    prereqCheckedOn: raw._fetchedOn,
  });
}

const merged = {
  _note:
    `${fixture.courses.length} hand-audited courses from courses.json, unchanged, ` +
    `plus ${generated.length} parsed from the ${raw._fetchedOn} catalogue harvest. ` +
    "Generated entries carry prereqTrust and are never enforced unless `exact`. " +
    "Regenerate with `npm run merge`; do not edit by hand.",
  _generatedOn: new Date().toISOString().slice(0, 10),
  courses: [...fixture.courses, ...generated],
};

writeFileSync(url("courses-full.json"), JSON.stringify(merged));

const bytes = readFileSync(url("courses-full.json")).length;
console.log(`\nmerged course set → data/courses-full.json`);
console.log(`  hand-audited kept: ${fixture.courses.length}`);
console.log(`  generated:         ${generated.length}`);
console.log(`  total:             ${merged.courses.length}`);
console.log(`  size:              ${(bytes / 1024 / 1024).toFixed(2)} MB\n`);
console.log("  generated prereq trust:");
for (const [k, n] of Object.entries(trustCount))
  if (n) console.log(`    ${k.padEnd(7)} ${String(n).padStart(4)}`);
const withRestrictions = generated.filter((c) => c.restrictionRules?.length).length;
console.log(`\n  generated with enrollment gates: ${withRestrictions}`);
