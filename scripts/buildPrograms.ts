/* Generates program files from the harvest — `npm run merge:programs`.
 *
 * Phase 6. Three programs were written by hand; this produces the other ~350
 * from `data/programs-raw.json` so a student who is not an electrical engineer
 * can actually pick their degree.
 *
 * Same rule as the course merge: **a hand-written program is never
 * overwritten.** Those carry decisions a parser cannot make — placeholder slots
 * for "any foreign language course", REL electives expressed as prose, the
 * nested General Education reference — and they stay authoritative. Generated
 * programs are additive and arrive with a confidence grade.
 *
 * Only majors and minors are generated. Clusters and certificates are in the
 * catalogue but are not what "pick your major and minor" means, and shipping
 * 110 clusters into the picker would bury the 185 things people actually want.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { COURSES, PROGRAMS } from "../src/data";
import {
  parseProgramRules,
  type ProgramParseConfidence,
} from "../src/engine/programParse";
import { trustOfProgram } from "../src/engine/trust";
import type { Program } from "../src/types";
import type { RawProgram } from "./harvestPrograms";

const raw = JSON.parse(
  readFileSync(new URL("../data/programs-raw.json", import.meta.url), "utf8"),
) as { _fetchedOn: string; programs: Record<string, RawProgram> };

const byUpper = new Map(COURSES.map((c) => [c.id.toUpperCase(), c.id]));
const BY_DEPT = new Set(COURSES.map((c) => c.dept.toUpperCase()));
const resolveCourse = (code: string) =>
  byUpper.get(code.replace(/\s+/g, "").toUpperCase()) ?? null;

/**
 * Requirements the catalogue states in a sentence instead of a course list.
 *
 * Found by `npm run sweep`: 16 programs shipped a requirement a student could
 * never satisfy, and every one of them was this. The vocabulary is closed and
 * small, exactly like the prerequisite prose:
 *
 *   "from a foreign language course"                      → placeholder slot
 *   "from any foreign language course, including test-out"
 *   "from any 300- or 400-level CSE, ECEN or WDD course"  → dept + level
 *   "From any CSE, CYBER, DS, ECEN, ITM or WDD course"    → dept
 *   "any Internship (course ending in 298, 398, or 498)"  → number suffix
 *
 * Each returns real course ids, so the requirement becomes clickable. Where
 * the catalogue genuinely means "any course of this kind" rather than a fixed
 * list, that is a placeholder slot — the same mechanism the hand-written EE
 * program uses for its foreign language requirement.
 */
function resolveProsePool(
  text: string,
): { pool: string[]; usesPlaceholders?: boolean } | null {
  // 1. Foreign language. The catalogue means any language, taken any way —
  //    "on campus, a BYU study abroad, vertical credit, etc."
  if (/\bforeign language\b/i.test(text) || /\blanguage course\b/i.test(text))
    return { pool: ["FOREIGN_LANG"], usesPlaceholders: true };

  /**
   * 2. "at least 6 credit(s) from any other REL courses."
   *
   * Caught by reading a worksheet against the live catalogue, not by any
   * automated check. The clause names no courses, so the sibling-borrow rule
   * filled it with the four Cornerstone courses sitting beside it — the exact
   * courses the word "other" excludes. General Education is referenced by
   * nearly every program, so this was wrong almost everywhere at once.
   *
   * `REL_ELECTIVE` is the placeholder the hand-written GE program already used
   * for this requirement.
   */
  if (/\bREL\b.*\bcourses?\b/i.test(text) && /\bother\b/i.test(text))
    return { pool: ["REL_ELECTIVE"], usesPlaceholders: true };

  // 3. "from the following subject code(s): AGRON, AGTEC, APS, BIO, …"
  //    General Studies is built from six such areas, each a 30- and a
  //    15-credit rule, and every one of them was unsatisfiable.
  const subjects = text.match(/subject code\(?s?\)?:\s*([A-Z][A-Z0-9,\s]+)/i);
  if (subjects) {
    const codes = new Set(
      (subjects[1].match(/\b[A-Z]{2,7}\b/g) ?? []).filter((d) => d !== "OR"),
    );
    const pool = COURSES.filter((c) => codes.has(c.dept.toUpperCase())).map((c) => c.id);
    if (pool.length) return { pool };
  }

  /**
   * 4. "Mathematics courses numbered 112 or higher."
   *
   * The department is spelled out as a word rather than given as a code, so
   * the code is recovered by prefix — MATH is a prefix of MATHEMATICS. Only
   * ids that resolve to a real course are kept, so a wrong guess yields an
   * empty pool and falls through rather than inventing anything.
   */
  /**
   * Department names are spelled out, and not always resolvable by prefix:
   * "Electrical Engineering" would prefix-match ENG (English) on its second
   * word, which is exactly the kind of confident wrong answer worth spending a
   * lookup table to avoid. Named cases first; prefix only for a single word.
   */
  const DEPT_WORDS: Record<string, string> = {
    "ELECTRICAL ENGINEERING": "ECEN",
    "MECHANICAL ENGINEERING": "ME",
    "CIVIL ENGINEERING": "CE",
    "COMPUTER SCIENCE": "CSE",
  };
  const numbered = text.match(
    /(?:any\s+)?([A-Za-z]{4,20}(?:\s+[A-Za-z]{4,20})?)\s+(?:class(?:es)?|courses?)\s+numbered\s+(\d{3})[^.]{0,24}?or\s+higher/i,
  );
  if (numbered) {
    /**
     * Strip the words that lead into the phrase. The capture is two words
     * wide, so "…credit(s) from Mathematics courses numbered 112 or higher"
     * yielded "FROM MATHEMATICS" — a two-word phrase, therefore ineligible for
     * the single-word prefix match, therefore no pool at all. It had been
     * working until the capture widened to catch "Electrical Engineering".
     */
    const LEAD = new Set(["FROM", "TAKE", "ANY", "WITH", "LEAST", "THE"]);
    const words = numbered[1]
      .toUpperCase()
      .split(/\s+/)
      .filter((w) => w && !LEAD.has(w));
    const phrase = words.join(" ");
    const floor = Number(numbered[2]);
    const code =
      DEPT_WORDS[phrase] ??
      (phrase.includes(" ")
        ? undefined
        : [...BY_DEPT].find((d) => d.length >= 3 && phrase.startsWith(d)));
    if (code) {
      const pool = COURSES.filter((c) => {
        if (c.dept.toUpperCase() !== code) return false;
        return Number(c.code.match(/(\d{3})/)?.[1] ?? 0) >= floor;
      }).map((c) => c.id);
      if (pool.length) return { pool };
    }
  }

  // 5. "any [300- or 400-level] CSE, CYBER, DS, ECEN, ITM or WDD course"
  const deptPhrase = text.match(
    /from\s+any\s+((?:\d00-\s*(?:or|and)\s*)?(?:\d00-level\s+)?)([A-Z][A-Z]{1,6}(?:\s*,\s*[A-Z]{2,7})*(?:\s*,?\s*or\s+[A-Z]{2,7})?)\s+course/i,
  );
  if (deptPhrase) {
    const depts = new Set(
      (deptPhrase[2].match(/\b[A-Z]{2,7}\b/g) ?? []).filter((d) => d !== "OR"),
    );
    const levels = (text.match(/\b([1-4])00-/g) ?? []).map((m) => Number(m[0]));
    const pool = COURSES.filter((c) => {
      if (!depts.has(c.dept.toUpperCase())) return false;
      if (!levels.length) return true;
      const num = Number(c.code.match(/(\d{3})/)?.[1] ?? 0);
      return levels.some((l) => num >= l * 100 && num < (l + 1) * 100);
    }).map((c) => c.id);
    if (pool.length) return { pool };
  }

  /**
   * 6. Shorthand course lists: "MUSIC 312, 313, 314, 315, 316, 317".
   *
   * The catalogue states the department once and then bare numbers, with no
   * links — so Interdisciplinary Studies' Music emphasis asked for 6 credits
   * of Ensembles from an empty pool. Only ids that resolve to a real course
   * are kept, so the messy tails ("158 (A-V, X, Z), 165A/B") cost nothing.
   */
  const shorthand: string[] = [];
  let dept: string | null = null;
  for (const tok of text.match(/\b[A-Z]{2,7}\b|\b\d{3}[A-Z]?\b/g) ?? []) {
    if (/^[A-Z]+$/.test(tok)) {
      dept = BY_DEPT.has(tok) ? tok : null;
      continue;
    }
    if (!dept) continue;
    const id = byUpper.get(`${dept}${tok}`.toUpperCase());
    if (id && !shorthand.includes(id)) shorthand.push(id);
  }
  if (shorthand.length > 1) return { pool: shorthand };

  // 7. "any Internship (course ending in 298, 398, or 498)"
  const endings = [...text.matchAll(/ending in ([\d,\s or]+)/gi)].flatMap(
    (m) => m[1].match(/\d{3}/g) ?? [],
  );
  if (endings.length) {
    const want = new Set(endings);
    const pool = COURSES.filter((c) => {
      const num = c.code.match(/(\d{3})/)?.[1];
      return !!num && want.has(num);
    }).map((c) => c.id);
    if (pool.length) return { pool };
  }

  return null;
}

/**
 * Programs already written by hand keep their own ids and win outright.
 *
 * Filtered by trust, NOT by "everything in the registry" — once the generated
 * programs were wired into `PROGRAMS`, that read as "all 207 are hand-written"
 * and this script cheerfully generated nothing at all.
 */
const HAND_WRITTEN = PROGRAMS.filter((p) => trustOfProgram(p) === "human");
const HAND_CODES = new Set(HAND_WRITTEN.map((p) => p.code));

const slugId = (p: RawProgram) =>
  `${p.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)}-${p.code}`.replace(/-+/g, "-");

/** Kuali id → the id this app will use, for `programRef` links between programs. */
const KUALI_TO_ID: Record<string, string> = {};
for (const p of Object.values(raw.programs)) {
  const hand = HAND_WRITTEN.find((x) => x.code === p.code);
  KUALI_TO_ID[p.kualiId] = hand ? hand.id : slugId(p);
}
const resolveProgram = (kualiId: string) => KUALI_TO_ID[kualiId] ?? null;

const TYPE_MAP: Record<string, Program["type"]> = {
  "Major: Bachelor-Level": "major",
  "Major:  Associate-Level": "major",
  Minor: "minor",
  "General Education": "general-education",
  Cluster: "cluster",
  Certificate: "certificate",
};

interface GeneratedProgram extends Program {
  parseConfidence: ProgramParseConfidence;
  parseDropped?: string[];
  parseUnknownCourses?: string[];
}

const generated: GeneratedProgram[] = [];
const conf: Record<ProgramParseConfidence, number> = {
  exact: 0,
  parsed: 0,
  unsure: 0,
};

for (const p of Object.values(raw.programs)) {
  const type = TYPE_MAP[p.type];
  /**
   * General Education tracks are generated as well, even though nobody picks
   * one directly. 97 programs point at GE - BACH / GE - AAS / GE - TEACH /
   * GE - IDS / GE - TRF ASSOC through a `programRef`, and without those files
   * the reference resolves to nothing and the student is shown a General
   * Education requirement worth 39 credits containing no courses at all.
   * `NESTED_PROGRAM_IDS` keeps them out of the picker automatically.
   */
  if (!type) continue;
  if (HAND_CODES.has(p.code)) continue;

  const got = parseProgramRules(p.rules, { resolveCourse, resolveProgram, resolveProsePool });
  if (!got.buckets.length) continue; // nothing usable — better absent than empty
  conf[got.confidence]++;

  const total = got.buckets.reduce((s, b) => s + (b.credits?.min ?? 0), 0);

  /**
   * Downgrade to `unsure` when the parse produced something a student cannot
   * act on. Two shapes, both found by `npm run audit:programs`:
   *
   *  - an **unsatisfiable bucket** — credits demanded, no courses and no
   *    sub-groups. Music's "Emphasis 53-57 credits" renders as 0/53 forever
   *    with nothing to click, because the options live in a `specializations`
   *    field this harvest does not read.
   *  - an **unresolved programRef** — Agribusiness points at 16 programs and we
   *    carry one of them, so most of its requirements reference nothing.
   *
   * The parser was not wrong in either case; it was incomplete. Grading it
   * `exact` because every clause was consumed would be the parser marking its
   * own homework.
   */
  /**
   * Fill the emphasis bucket from the program's specializations.
   *
   * The catalogue models an emphasis as a program in its own right, nested
   * under its parent with the same rule structure — so "Emphasis: take between
   * 53 and 57 credits" is a *choice of one specialization*, and the options
   * were simply never fetched. Each becomes a group, so the bucket goes from
   * an unsatisfiable `0/53 cr` to a real pick-one.
   */
  if (p.specializations.length) {
    const specGroups = p.specializations
      .map((sp) => {
        const inner = parseProgramRules(sp.rules, { resolveCourse, resolveProgram, resolveProsePool });
        if (!inner.buckets.length) return null;
        return {
          id: sp.code || sp.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          label: sp.title.trim(),
          rule: { type: "allOfGroups" as const },
          groups: inner.buckets,
        };
      })
      .filter((g): g is NonNullable<typeof g> => !!g);

    if (specGroups.length) {
      const target = got.buckets.find(
        (b) =>
          (b.credits?.min ?? 0) > 0 &&
          !(b.pool ?? []).length &&
          !(b.groups ?? []).length &&
          b.rule.type !== "programRef" &&
          b.rule.type !== "fillTo",
      );
      if (target) {
        target.rule = { type: "nOfGroups", n: 1 };
        target.groups = specGroups;
      } else {
        got.buckets.push({
          id: "emphasis",
          label: "Emphasis",
          rule: { type: "nOfGroups", n: 1 },
          groups: specGroups,
        });
      }
    }
  }

  /**
   * Drop rules that ask for nothing.
   *
   * A clause whose course links did not resolve leaves an `allOf` with no
   * courses, no groups and no credit figure. It is not a requirement — it is
   * the residue of one — and it reached the screen as a row labelled `rule-2`
   * sitting at 0/0. Pruning is right rather than labelling: naming it would
   * only make the emptiness legible.
   */
  const prune = (bs: typeof got.buckets): typeof got.buckets =>
    bs
      .map((b) => (b.groups ? { ...b, groups: prune(b.groups) } : b))
      .filter(
        (b) =>
          b.rule.type === "fillTo" ||
          b.rule.type === "programRef" ||
          (b.pool ?? []).length > 0 ||
          (b.groups ?? []).length > 0 ||
          (b.credits?.min ?? 0) > 0,
      );
  got.buckets = prune(got.buckets);

  const poolAll = (b: (typeof got.buckets)[number]): string[] => [
    ...(b.pool ?? []),
    ...(b.groups ?? []).flatMap(poolAll),
  ];
  const hollow = got.buckets.filter(
    (b) =>
      (b.credits?.min ?? 0) > 0 &&
      !poolAll(b).length &&
      !(b.groups ?? []).length &&
      b.rule.type !== "programRef" &&
      b.rule.type !== "fillTo",
  );
  const srcRefs = (p.rules.match(/to complete the following program\(s\)/gi) ?? [])
    .length;
  /**
   * Count references anywhere in the tree, not just at the top.
   *
   * Agribusiness holds its sixteen `programRef`s as *groups* under one bucket,
   * so a top-level filter saw one and concluded fifteen were missing —
   * downgrading thirteen programs to `unsure` for a shortfall that did not
   * exist. The same top-level-only mistake as the original hollow check.
   */
  const countRefs = (bs: typeof got.buckets): number =>
    bs.reduce(
      (n, b) =>
        n + (b.rule.type === "programRef" ? 1 : 0) + countRefs(b.groups ?? []),
      0,
    );
  const gotRefs = countRefs(got.buckets);
  const incomplete: string[] = [];
  if (hollow.length)
    incomplete.push(
      `requirement with no courses to choose from: ${hollow.map((b) => b.label).join(", ")}`,
    );
  if (gotRefs < srcRefs)
    incomplete.push(
      `${srcRefs - gotRefs} referenced program(s) not carried by this app`,
    );
  const confidence = incomplete.length ? "unsure" : got.confidence;
  if (incomplete.length) {
    conf[got.confidence]--;
    conf.unsure++;
  }

  generated.push({
    id: slugId(p),
    code: p.code,
    // Kuali stores stray whitespace — "Exercise and Rehabilitation Sciences ",
    // "Investments  Minor". It shows in the picker and breaks exact-match
    // search, so normalise once here rather than at every display site.
    label: (p.title + (type === "minor" ? " Minor" : "")).replace(/\s+/g, " ").trim(),
    type,
    catalogYear: "2026-2027",
    totalCredits: { min: total, max: total },
    buckets: got.buckets,
    // The catalogue states minimum grades in prose, not structurally. C- is the
    // published bachelor-level rule, but it is not read from this program's own
    // text — so it is left null rather than asserted.
    minGrade: null,
    programNotes: p.programNotes ? [p.programNotes.slice(0, 400)] : undefined,
    parseConfidence: confidence,
    ...(got.dropped.length || incomplete.length
      ? { parseDropped: [...incomplete, ...got.dropped].slice(0, 12) }
      : {}),
    ...(got.unknownCourses.length
      ? { parseUnknownCourses: got.unknownCourses.slice(0, 20) }
      : {}),
  });
}

generated.sort((a, b) => a.label.localeCompare(b.label));

writeFileSync(
  new URL("../data/programs-generated.json", import.meta.url),
  JSON.stringify(
    {
      _note:
        `${generated.length} majors and minors parsed from the ${raw._fetchedOn} catalogue harvest. ` +
        "Hand-written programs in data/programs/ are NOT included and always win. " +
        "Each entry carries parseConfidence; regenerate with `npm run merge:programs`.",
      _generatedOn: new Date().toISOString().slice(0, 10),
      programs: generated,
    },
    null,
    1,
  ),
);

const majors = generated.filter((p) => p.type === "major").length;
const ge = generated.filter((p) => p.type === "general-education").length;
const clusters = generated.filter((p) => p.type === "cluster").length;
const certs = generated.filter((p) => p.type === "certificate").length;
console.log(`\ngenerated ${generated.length} programs → data/programs-generated.json`);
console.log(`  majors: ${majors}   minors: ${generated.length - majors - ge - clusters - certs}   general-education: ${ge}   clusters: ${clusters}   certificates: ${certs}`);
console.log(`  hand-written kept separate: ${HAND_WRITTEN.length}`);
console.log("  parse confidence:");
for (const [k, n] of Object.entries(conf)) if (n) console.log(`    ${k.padEnd(7)} ${n}`);
const withUnknown = generated.filter((p) => p.parseUnknownCourses?.length).length;
console.log(`  programs naming a course we do not carry: ${withUnknown}`);
