import { COURSES, COURSE_BY_ID, PROGRAM_BY_ID, STUDENT } from "../data";
import { transitiveAncestorsOf } from "./plan";
import { DEFAULT_ENROLLED_IDS, evaluatedPrograms } from "./programs";
import type { Bucket, Program } from "../types";

/**
 * Which courses could plausibly matter to this student.
 *
 * Phase 5 wired the whole 2,031-course catalogue into the app, and that broke
 * the planner in a way the tests caught immediately: "what should I take next
 * term" started recommending ENG 301, POLSC 200 and CHEM 105 — ranked by how
 * many courses they unlock *across the entire university* — and "furthest out"
 * surfaced MUSIC 462D. Both were working exactly as written. The input was
 * wrong.
 *
 * So the catalogue and the plan are different sets:
 *   - **Search and the course picker see everything.** Looking a course up is
 *     never wrong, and browsing what exists is the point of having harvested it.
 *   - **The planner sees only this scope.** Suggestions, the auto-planner, the
 *     "furthest out" ranking and the tree operate on courses that could count
 *     toward an enrolled program, plus everything those depend on.
 *
 * Anything already on the transcript or the board is in scope by definition —
 * a course you have taken is relevant whether or not it still counts for
 * anything.
 */

function poolIdsOf(b: Bucket, out: Set<string>, seen: Set<string>): void {
  b.pool?.forEach((id) => out.add(id));
  if (b.rule.type === "programRef" && b.rule.programId) {
    const ref = PROGRAM_BY_ID.get(b.rule.programId);
    if (ref && !seen.has(ref.id)) {
      seen.add(ref.id);
      ref.buckets.forEach((sub) => poolIdsOf(sub, out, seen));
    }
  }
  b.groups?.forEach((g) => poolIdsOf(g, out, seen));
}

function programPoolIds(programs: Program[]): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>(programs.map((p) => p.id));
  for (const p of programs) p.buckets.forEach((b) => poolIdsOf(b, out, seen));
  return out;
}

const CACHE = new Map<string, Set<string>>();

/**
 * The enrollment everything scopes to when no explicit list is passed.
 *
 * `buildPlan`, `suggest`, `deepestFirst` and the tree all ask for "the scope"
 * without knowing who is enrolled. That used to resolve to the transcript's
 * declared programs, which was right only because the shipped record had some.
 * Now that the app ships a **blank** student, the default has to follow what
 * the user picks — otherwise choosing a major leaves the tree empty.
 *
 * `computeBundle` sets this before building; nothing else should.
 */
let ACTIVE: readonly string[] = DEFAULT_ENROLLED_IDS;

export function setActiveEnrollment(ids: readonly string[]): void {
  ACTIVE = ids;
}

/** The programs the student is actually doing. */
export function activeEnrollment(): readonly string[] {
  return ACTIVE;
}

export function relevantCourseIds(
  enrolledIds: readonly string[] = ACTIVE,
): Set<string> {
  const key = [...enrolledIds].sort().join("|");
  const hit = CACHE.get(key);
  if (hit) return hit;

  const scope = programPoolIds(evaluatedPrograms(enrolledIds));

  // Everything a scoped course needs, transitively — a prerequisite of a
  // required course is relevant even when no program lists it directly.
  for (const id of [...scope]) {
    for (const dep of transitiveAncestorsOf(id)) scope.add(dep);
  }

  /**
   * Everything already on the transcript, whether or not a program wants it.
   * GS 102R matches no requirement bucket in any of the three programs
   * (DATA_GAPS I3) but the student has taken it — a course you have sat in is
   * relevant by definition, and scoping it out made it vanish from the tree.
   */
  for (const t of STUDENT.terms)
    for (const e of t.courses) if (COURSE_BY_ID.has(e.id)) scope.add(e.id);

  // Placeholders are program machinery and always belong.
  for (const c of COURSES) if (c.isPlaceholder) scope.add(c.id);

  CACHE.set(key, scope);
  return scope;
}

/** Is this course part of the planning problem, as opposed to the catalogue? */
export function isRelevant(
  courseId: string,
  enrolledIds?: readonly string[],
): boolean {
  return relevantCourseIds(enrolledIds).has(courseId);
}

/**
 * The scope, plus anything the student has actually touched. Kept separate
 * because the pure program scope is stable and cacheable, while this one
 * depends on the plan.
 */
export function plannableCourseIds(
  takenOrPlaced: Iterable<string>,
  enrolledIds?: readonly string[],
): Set<string> {
  const out = new Set(relevantCourseIds(enrolledIds));
  for (const id of takenOrPlaced) if (COURSE_BY_ID.has(id)) out.add(id);
  return out;
}
