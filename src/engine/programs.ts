import { PROGRAMS, PROGRAM_BY_ID, STUDENT } from "../data";
import type { Bucket, Program } from "../types";

/**
 * The enrollment layer: which programs this student is doing, and which of
 * those get evaluated as siblings.
 *
 * Phase 1 of opening the app up to every BYU-Idaho major and minor. Everything
 * downstream — the requirements rail, `obsoleteCourseIds`, the ★ set, grade
 * thresholds — used to be wired to two module-level constants named `EE` and
 * `AI_MINOR`. It now flows from a *registry* of known programs plus a list of
 * enrolled ids, so adding the rest of the catalogue is a data job rather than a
 * code job.
 *
 * Nothing here invents data: the student's declared programs are matched to
 * catalogue entries by the `code` they already carry in `student.json`.
 */

export type ProgramRole = Program["type"];

export interface Enrollment {
  programId: string;
  role: ProgramRole;
  /**
   * The catalogue year the *requirements* come from. Course prerequisites
   * follow the current catalogue; program requirements follow the year the
   * student declared under. Conflating those is DATA_GAPS U12.
   */
  catalogYear: string;
  /** Declared on the transcript, or chosen in the app. */
  source: "declared" | "chosen";
}

/** Every program the app knows about. Phase 2 grows this from the harvester. */
export const CATALOG: readonly Program[] = PROGRAMS;

/**
 * Programs that are nested inside another via a `programRef` bucket, derived
 * rather than listed.
 *
 * General Education is referenced from inside the EE major, so evaluating it
 * again as a sibling counts its ~27 credits twice — the single most expensive
 * mistake available in this file. Deriving the set means a new program that
 * nests something else gets the same protection for free.
 */
export const NESTED_PROGRAM_IDS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  const walk = (b: Bucket) => {
    if (b.rule.type === "programRef" && b.rule.programId)
      out.add(b.rule.programId);
    b.groups?.forEach(walk);
  };
  for (const p of CATALOG) p.buckets.forEach(walk);
  return out;
})();

/** Match a declared program to the catalogue by the code the transcript uses. */
function byCode(code: string): Program | undefined {
  return CATALOG.find((p) => p.code === code);
}

/**
 * What `student.json` says the student is enrolled in.
 *
 * Read from the existing `major` / `minor` / `generalEducation` blocks — no new
 * fields, no guesses. General Education is included for completeness even
 * though it is evaluated inside the major, because "what am I enrolled in" and
 * "what gets its own progress bar" are different questions.
 */
export function declaredEnrollment(): Enrollment[] {
  const decls: { d?: { code: string; catalogYear: string } | null }[] = [
    { d: STUDENT.major },
    { d: STUDENT.minor },
    { d: STUDENT.generalEducation },
  ];
  const out: Enrollment[] = [];
  for (const { d } of decls) {
    if (!d) continue;
    const p = byCode(d.code);
    if (!p) continue; // a declared program we have no file for yet — Phase 2
    out.push({
      programId: p.id,
      role: p.type,
      catalogYear: d.catalogYear,
      source: "declared",
    });
  }
  return out;
}

/** Enrollment ids in a stable display order: majors, then minors, then the rest. */
const ROLE_ORDER: ProgramRole[] = ["major", "minor", "general-education"];

export function sortEnrollment(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => {
    const pa = PROGRAM_BY_ID.get(a);
    const pb = PROGRAM_BY_ID.get(b);
    const ra = ROLE_ORDER.indexOf(pa?.type ?? "major");
    const rb = ROLE_ORDER.indexOf(pb?.type ?? "major");
    return ra - rb || (pa?.label ?? a).localeCompare(pb?.label ?? b);
  });
}

/**
 * The programs that get their own evaluation and their own section in the rail.
 *
 * Nested programs are filtered out — they are already counted inside their
 * host. Unknown ids are dropped rather than throwing: a saved profile is
 * untrusted input, and a stale program id should cost you a rail section, not
 * the whole app.
 */
export function evaluatedPrograms(enrolledIds: readonly string[]): Program[] {
  return sortEnrollment(enrolledIds)
    .filter((id) => !NESTED_PROGRAM_IDS.has(id))
    .map((id) => PROGRAM_BY_ID.get(id))
    .filter((p): p is Program => !!p);
}

/** Everything evaluated, plus everything nested inside it. Used for grade rules. */
export function activePrograms(enrolledIds: readonly string[]): Program[] {
  const out = evaluatedPrograms(enrolledIds);
  for (const id of NESTED_PROGRAM_IDS) {
    const p = PROGRAM_BY_ID.get(id);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * Programs a student could add that they are not already doing.
 *
 * Clusters and certificates are excluded by type, not by reference. Most are nested inside a
 * degree and `NESTED_PROGRAM_IDS` would catch those, but a cluster nothing
 * happens to reference is still not a thing you declare instead of a major —
 * and 110 of them in a search box that holds 205 real choices is not a picker.
 */
export function enrollablePrograms(enrolledIds: readonly string[]): Program[] {
  return CATALOG.filter(
    (p) =>
      p.type !== "cluster" &&
      p.type !== "certificate" &&
      !NESTED_PROGRAM_IDS.has(p.id) &&
      !enrolledIds.includes(p.id),
  );
}

export const DEFAULT_ENROLLED_IDS: readonly string[] = declaredEnrollment().map(
  (e) => e.programId,
);

/**
 * The catalogue's program *codes* for the declared enrollment — "445", "292".
 * Enrollment restrictions are written in codes, not ids, so this is the form
 * `engine/restrictions.ts` compares against.
 */
export function programCodesFor(enrolledIds: readonly string[]): string[] {
  return evaluatedPrograms(enrolledIds).map((p) => p.code);
}

export const DEFAULT_PROGRAM_CODES: readonly string[] =
  programCodesFor(DEFAULT_ENROLLED_IDS);
