import { COURSES, COURSE_BY_ID, PROGRAMS, STUDENT } from "../data";
import type {
  Bucket,
  Course,
  CourseFlag,
  CourseStatus,
  Placement,
  PrereqNode,
  Program,
  Student,
  TimelineTerm,
  TranscriptEntry,
} from "../types";
import { meetsThreshold } from "./grades";
import { enforcesPrereq, trustOf } from "./trust";
import {
  blockingRestriction,
  checkRestrictions,
  type RestrictionContext,
} from "./restrictions";
import { DEFAULT_PROGRAM_CODES } from "./programs";
import { sameTermPartners } from "./requirements";
import { relevantCourseIds } from "./scope";
import { buildTimeline } from "./terms";

/** One appearance of a course on the timeline — transcript entry or user placement. */
export interface Occurrence {
  courseId: string;
  termId: string;
  termIndex: number;
  source: "transcript" | "placement";
  state: "completed" | "failed" | "in-progress" | "registered" | "planned";
  grade?: string;
  credits: number;
  earned: number;
  countsForCredit: boolean;
  retake: boolean;
  entry?: TranscriptEntry;
  placementId?: string;
}

export interface CourseDerived {
  status: CourseStatus;
  /** Credits this course contributes to the plan total (counted once). */
  countingCredits: number;
  earnedCredits: number;
  occurrences: Occurrence[];
  flags: CourseFlag[];
  directUnlocks: string[];
}

export interface PlanModel {
  timeline: TimelineTerm[];
  termById: Map<string, TimelineTerm>;
  occurrencesByTerm: Map<string, Occurrence[]>;
  derived: Map<string, CourseDerived>;
  /** Sum of countingCredits over all courses + placeholder instances. */
  totalPlanCredits: number;
  completedCourseIds: string[];
  totalEarnedCredits: number;
  /**
   * Program codes the student is declared in, carried on the model so
   * restriction checks reach `validateDrop` without changing its signature at
   * every call site.
   */
  programCodes: readonly string[];
}

// ---- program membership → minGrade threshold ----

function poolIdsOf(b: Bucket, out: Set<string>): void {
  b.pool?.forEach((id) => out.add(id));
  b.groups?.forEach((g) => poolIdsOf(g, out));
}

function programPool(p: Program): Set<string> {
  const s = new Set<string>();
  p.buckets.forEach((b) => poolIdsOf(b, s));
  return s;
}

/**
 * Course pools, one per program in the registry, built once.
 *
 * This used to be three constants named EE_POOL / AI_POOL / GE_POOL with the
 * grade rule written out by hand. Driving it off the registry is what lets a
 * fourth program exist without editing this file — and it keeps each program's
 * own `minGrade` attached to its own pool instead of assuming everyone shares
 * the major's.
 */
const POOLS: { program: Program; pool: Set<string> }[] = PROGRAMS.map((p) => ({
  program: p,
  pool: programPool(p),
}));

/**
 * Which programs is this course allowed to count toward?
 *
 * Registry-wide rather than enrollment-filtered on purpose: the answer is a
 * property of the catalogue, and the rail already shows what the student is
 * actually enrolled in. Filtering here would make "Counts toward" silently
 * incomplete when comparing programs.
 */
export function programsContaining(courseId: string): Program[] {
  return POOLS.filter(({ pool }) => pool.has(courseId)).map((e) => e.program);
}

/** Rank for `minGrade` strings — higher index is a stricter requirement. */
const GRADE_ORDER = ["D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A"];

/**
 * Strictest minGrade among the programs whose pools contain the course.
 *
 * `null` means "any credit-earning grade" and is therefore the weakest possible
 * requirement, not the strongest — a course in both GE (null) and the major
 * (C-) has to clear C-.
 */
export function thresholdFor(courseId: string): string | null {
  let best: string | null = null;
  for (const { program, pool } of POOLS) {
    if (!pool.has(courseId) || program.minGrade == null) continue;
    if (best === null || GRADE_ORDER.indexOf(program.minGrade) > GRADE_ORDER.indexOf(best))
      best = program.minGrade;
  }
  return best;
}

// ---- prereq expression helpers ----

export function prereqLeaves(node: PrereqNode, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  const kids = "and" in node ? node.and : node.or;
  kids.forEach((k) => prereqLeaves(k, out));
  return out;
}

/**
 * Reverse edge indexes, built in **one pass over the courses**, not one pass
 * per course.
 *
 * These were `COURSES.map(c => COURSES.filter(…))`, which is O(N²) and
 * re-derives every course's prerequisite leaves N times. At 136 courses that
 * cost 21 ms and nobody noticed. At the full 2,032-course catalogue it cost
 * **1.1 seconds of blocking work before React could render** — measured, not
 * guessed. Inverting the loop makes it O(N·edges): the same 2,032 courses now
 * index in single-digit milliseconds.
 *
 * Insertion order still follows `COURSES`, so unlock lists stay deterministic
 * and the counts asserted in `npm run verify` do not move.
 */
function reverseIndex(edgesOf: (c: Course) => string[]): Map<string, string[]> {
  const m = new Map<string, string[]>(COURSES.map((c) => [c.id, []]));
  for (const c of COURSES) {
    for (const dep of new Set(edgesOf(c))) m.get(dep)?.push(c.id);
  }
  return m;
}

const DIRECT_UNLOCKS = reverseIndex((c) => prereqLeaves(c.prereq));

/** Direct unlocks: courses whose prereq expression names `id`. Direct only — never transitive. */
export function directUnlocksOf(id: string): string[] {
  return DIRECT_UNLOCKS.get(id) ?? [];
}

/** Every course this one depends on, prereq or coreq — a coreq is still a dependency. */
export function dependencyIds(c: Course): string[] {
  return [...new Set([...prereqLeaves(c.prereq), ...prereqLeaves(c.coreq)])];
}

/** Dependency edges for the downstream walk: prereq AND coreq. Same one-pass build. */
const DEP_EDGES = reverseIndex(dependencyIds);

/** Transitive descendant set, for the downstream-highlight interaction only — never a node label. */
export function transitiveDescendantsOf(id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of DEP_EDGES.get(cur) ?? []) {
      if (!out.has(next)) {
        out.add(next);
        stack.push(next);
      }
    }
  }
  return out;
}

/**
 * How many semesters deep a course sits, counted globally (not per cluster).
 * 0 = takeable immediately; the tree uses this for the horizontal stagger so
 * "further right" always means "more prerequisites deep".
 *
 * Three rules, all of which matter for the column to be honest:
 *  - A **prerequisite** costs a column: it must finish in an earlier term.
 *  - A **corequisite** costs nothing: it may be taken in the same term, so
 *    ECEN 299 draws beside ECEN 250 rather than one column right.
 *  - **AND takes the deepest** branch (all are required); **OR takes the
 *    shallowest** (the student picks one), matching how criticalPath and the
 *    autoplanner resolve the same expressions. Flattening an OR to its leaves
 *    and taking the max would rank a course by a path nobody would choose —
 *    MATH 341's "MATH 112X or MATH 119" pushed it to column 7 instead of 1.
 */
const DEPTH_CACHE = new Map<string, number>();
export function prereqDepth(id: string, seen: Set<string> = new Set()): number {
  const cached = DEPTH_CACHE.get(id);
  if (cached !== undefined) return cached;
  if (seen.has(id)) return 0; // cycle guard
  const c = COURSE_BY_ID.get(id);
  if (!c) return 0;
  const next = new Set(seen).add(id);

  /** Depth of an expression, or null when it names nothing in the fixture. */
  const exprDepth = (node: PrereqNode): number | null => {
    if (node == null) return null;
    if (typeof node === "string")
      return COURSE_BY_ID.has(node) ? prereqDepth(node, next) : null;
    const kids = "and" in node ? node.and : node.or;
    const vals = kids
      .map(exprDepth)
      .filter((v): v is number => v !== null);
    if (!vals.length) return null;
    return "and" in node ? Math.max(...vals) : Math.min(...vals);
  };

  const pre = exprDepth(c.prereq);
  const co = exprDepth(c.coreq);
  const d = Math.max(pre === null ? 0 : pre + 1, co === null ? 0 : co);
  if (seen.size === 0) DEPTH_CACHE.set(id, d);
  return d;
}

/** Everything this course depends on, transitively — "what I need first". */
export function transitiveAncestorsOf(id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const c = COURSE_BY_ID.get(cur);
    if (!c) continue;
    for (const prev of dependencyIds(c)) {
      if (!COURSE_BY_ID.has(prev) || out.has(prev)) continue;
      out.add(prev);
      stack.push(prev);
    }
  }
  return out;
}

/**
 * A course the university no longer runs. `terms: []` with confirmed terms is
 * the encoding — see CLAUDE.md. Distinct from "we don't know when it runs".
 */
export function isRetired(c: Course): boolean {
  return c.termsConfirmed && c.terms.length === 0;
}

/** What to take instead, where the catalog makes the successor obvious. */
export const RETIRED_REPLACEMENT: Record<string, string> = {
  CIT160:
    "CSE 110 is the current equivalent — the catalog still accepts your CIT 160 credit as the prerequisite for CSE 111.",
  ECEN101:
    "ECEN 100 replaced it, and satisfies the same Introduction requirement.",
};

// ---- the model ----

const COUNTING_STATES = new Set([
  "completed",
  "in-progress",
  "registered",
  "planned",
]);

/**
 * A term you can still change. History is immutable, but a term you are merely
 * registered for is not — you can still add and drop during registration, so
 * the board lets you rearrange it.
 */
export function isEditableTerm(t: TimelineTerm): boolean {
  return !t.real || t.status !== "complete";
}

/** Key for a dropped registration: one course out of one real term. */
export function registrationKey(termId: string, courseId: string): string {
  return `${termId}:${courseId}`;
}

export function buildPlan(
  placements: Placement[],
  /** Registrations the user has dropped — `termId:courseId` (see store). */
  droppedRegistrations: readonly string[] = [],
  /** Declared program codes, for enrollment restrictions. */
  programCodes: readonly string[] = DEFAULT_PROGRAM_CODES,
  /**
   * Whose record this is. Defaults to the shipped one, which is **blank** — the
   * app opens with no transcript so a new user starts clean. Tests pass a real
   * record in, which is how the suite keeps asserting concrete numbers without
   * that record being bundled into the app.
   */
  student: Student = STUDENT,
): PlanModel {
  const scope = relevantCourseIds();
  const timeline = buildTimeline(student);
  const termById = new Map(timeline.map((t) => [t.id, t]));
  const dropped = new Set(droppedRegistrations);

  // 1. Collect occurrences.
  const occByCourse = new Map<string, Occurrence[]>();
  const occurrencesByTerm = new Map<string, Occurrence[]>();
  timeline.forEach((t) => occurrencesByTerm.set(t.id, []));

  const push = (o: Occurrence) => {
    if (!occByCourse.has(o.courseId)) occByCourse.set(o.courseId, []);
    occByCourse.get(o.courseId)!.push(o);
    occurrencesByTerm.get(o.termId)?.push(o);
  };

  for (const term of student.terms) {
    const tl = termById.get(term.id)!;
    for (const e of term.courses) {
      // Dropped from a term that is still editable — treat it as never taken.
      // Completed history can never be dropped, so it is never filtered here.
      if (isEditableTerm(tl) && dropped.has(registrationKey(term.id, e.id)))
        continue;
      const passed =
        e.state === "completed" &&
        meetsThreshold(e.grade, thresholdFor(e.id));
      const state: Occurrence["state"] =
        e.state === "withdrawn" || (e.state === "completed" && !passed)
          ? "failed"
          : e.state === "completed"
            ? "completed"
            : (e.state as Occurrence["state"]);
      push({
        courseId: e.id,
        termId: term.id,
        termIndex: tl.index,
        source: "transcript",
        state,
        grade: e.grade,
        credits: e.credits,
        earned: passed ? (e.earned ?? e.credits) : 0,
        countsForCredit: e.countsForCredit !== false,
        retake: e.retake === true,
        entry: e,
      });
    }
  }

  for (const p of placements) {
    const tl = termById.get(p.termId);
    if (!tl) continue;
    const c = COURSE_BY_ID.get(p.courseId);
    if (!c) continue;
    push({
      courseId: p.courseId,
      termId: p.termId,
      termIndex: tl.index,
      source: "placement",
      state: "planned",
      credits: c.credits,
      earned: 0,
      countsForCredit: true,
      retake: false,
      placementId: p.instanceId,
    });
  }

  occurrencesByTerm.forEach((list) => list.sort((a, b) => a.termIndex - b.termIndex));

  // 2. Derive per-course status + credits.
  const derived = new Map<string, CourseDerived>();

  const statusOf = (c: Course): CourseStatus => {
    const occs = (occByCourse.get(c.id) ?? []).slice().sort((a, b) => a.termIndex - b.termIndex);
    const passing = occs.filter((o) => o.state === "completed");
    if (passing.length) return "completed";
    if (occs.length) {
      // Retake rule: the latest attempt determines state.
      const last = occs[occs.length - 1];
      return last.state === "planned" ? "planned" : last.state;
    }
    // Not on the timeline at all: available vs locked by optimistic satisfiability.
    return isSatisfiable(c.prereq) && isSatisfiable(c.coreq)
      ? "available"
      : "locked";
  };

  /** A prereq leaf is "reachable" if the course has any counting occurrence, or passes recursively. */
  const isSatisfiable = (node: PrereqNode): boolean => {
    if (node == null) return true;
    if (typeof node === "string") {
      const occs = occByCourse.get(node) ?? [];
      return occs.some((o) => COUNTING_STATES.has(o.state));
    }
    if ("and" in node) return node.and.every(isSatisfiable);
    return node.or.some(isSatisfiable);
  };

  for (const c of COURSES) {
    const occs = occByCourse.get(c.id) ?? [];
    const passing = occs.filter((o) => o.state === "completed" && o.countsForCredit);
    // Credits count once, from the attempt with the highest passing grade (earned field).
    const earnedCredits = passing.length
      ? Math.max(...passing.map((o) => o.earned))
      : 0;
    const status = statusOf(c);
    let countingCredits = 0;
    if (c.isPlaceholder) {
      // Each planned placeholder instance is its own slot.
      countingCredits = occs.filter((o) => o.state === "planned").length * c.credits;
    } else if (status === "completed") {
      countingCredits = earnedCredits;
    } else if (COUNTING_STATES.has(status)) {
      const active = occs.filter((o) => COUNTING_STATES.has(o.state));
      countingCredits = active.some((o) => o.countsForCredit) ? c.credits : 0;
    }
    derived.set(c.id, {
      status,
      countingCredits,
      earnedCredits,
      occurrences: occs,
      flags: [],
      /**
       * Scoped to the planning set. "unlocks 9" has to mean nine courses *you*
       * might take — with the whole catalogue loaded, ENG 301 unlocks 442
       * courses university-wide, which made it the top suggestion for an
       * electrical-engineering student. The graph edges stay unscoped; only
       * this count, which drives the badge and the gate bonus, is filtered.
       */
      directUnlocks: (DIRECT_UNLOCKS.get(c.id) ?? []).filter((id) =>
        scope.has(id),
      ),
    });
  }

  // 3. Flags (at-risk logic).
  const springFall = student.track.pattern === "spring-fall";
  for (const c of COURSES) {
    const d = derived.get(c.id)!;
    if (c.isPlaceholder) continue; // placeholders never trigger warnings

    if (!c.termsConfirmed) {
      d.flags.push({
        level: "info",
        unconfirmed: false,
        text: "Offered terms unconfirmed — check the class schedule before registering.",
      });
    }
    if (
      springFall &&
      c.termsConfirmed &&
      c.terms.length === 1 &&
      c.terms[0] === "W" &&
      d.status !== "completed"
    ) {
      d.flags.push({
        level: "info",
        unconfirmed: false,
        text: "Winter-only per catalog — schedule it in a Flex Track (Winter) semester.",
      });
    }
    // Completed but below the strictest threshold, with no retake planned.
    const occs = d.occurrences;
    const attempted = occs.filter((o) => o.source === "transcript" && o.grade);
    const bestGrade = attempted.find(
      (o) => o.state === "completed" || o.state === "failed",
    );
    if (
      bestGrade &&
      d.status === "failed" &&
      !occs.some((o) => o.termIndex > bestGrade.termIndex)
    ) {
      d.flags.push({
        level: "warning",
        unconfirmed: false,
        text: `Attempted with grade ${bestGrade.grade}, below the required minimum — no retake planned.`,
      });
    }

    // Per-occurrence checks: placement into a term the course isn't offered,
    // prereqs unsatisfied or in a later term.
    for (const o of occs) {
      if (!COUNTING_STATES.has(o.state)) continue;
      // History that already passed is moot — don't second-guess a completed term.
      if (o.state === "completed") continue;
      const term = termById.get(o.termId)!;
      if (c.termsConfirmed && !c.terms.includes(term.season)) {
        d.flags.push({
          level: "error",
          unconfirmed: false,
          text: `${c.code} is not offered in ${term.label.split(" ")[0]} (offered: ${c.terms.join(", ")}).`,
        });
      }
      /**
       * Courses the catalogue requires in ONE term. Business Management's IBC
       * block is three courses that must be registered together; the app used
       * to require all three and say nothing when a student spread them across
       * three semesters — a plan that looks finished and cannot be registered.
       *
       * A warning, not a block. The student builds the plan one course at a
       * time, so the split is a normal intermediate state; the app's job is to
       * say so, not to refuse the drop.
       */
      const partners = sameTermPartners(c.id);
      if (partners.length) {
        const elsewhere = partners.filter((id) =>
          (occByCourse.get(id) ?? []).some(
            (po) => COUNTING_STATES.has(po.state) && po.termId !== o.termId,
          ),
        );
        if (elsewhere.length)
          d.flags.push({
            level: "warning",
            unconfirmed: false,
            text:
              `${c.code} must be taken in the same semester as ` +
              `${elsewhere.map((id) => COURSE_BY_ID.get(id)?.code ?? id).join(", ")}` +
              ` — currently in a different term.`,
          });
      }

      const pr = checkPrereqAt(c, o.termIndex, occByCourse);
      if (!pr.ok) {
        d.flags.push({
          level: "warning",
          unconfirmed: pr.unconfirmed,
          text:
            `Prerequisite not satisfied by ${term.label}: ${pr.missing.join(", ")}` +
            (pr.unconfirmed ? " (unconfirmed prerequisite)" : ""),
        });
      }
    }
  }

  const totalPlanCredits = [...derived.values()].reduce(
    (s, d) => s + d.countingCredits,
    0,
  );
  const completedCourseIds = COURSES.filter(
    (c) => derived.get(c.id)!.status === "completed",
  ).map((c) => c.id);
  const totalEarnedCredits = completedCourseIds.reduce(
    (s, id) => s + derived.get(id)!.earnedCredits,
    0,
  );

  /**
   * Enrollment gates, checked in a second pass.
   *
   * They live here rather than in the per-course loop above because a credit
   * minimum needs the *total* earned credits, which is only known once every
   * course has been derived. Each gate is now checked against the student:
   * "restricted to programs 203, 687…" becomes a warning when you are not in
   * one of them and says nothing at all when you are — where before every
   * restriction rendered as the same undifferentiated info text.
   */
  const restrictionCtx: RestrictionContext = { programCodes, earnedCredits: totalEarnedCredits };
  for (const c of COURSES) {
    const d = derived.get(c.id);
    if (!d) continue;
    for (const rc of checkRestrictions(c, restrictionCtx)) {
      if (rc.status === "met") continue; // nothing to say about a gate you clear
      d.flags.push({
        level: rc.status === "unmet" ? "warning" : "info",
        unconfirmed: rc.status === "unknown",
        text: rc.status === "unmet" ? `Not open to you: ${rc.detail}` : rc.detail,
      });
    }
  }

  return {
    timeline,
    termById,
    occurrencesByTerm,
    derived,
    totalPlanCredits,
    completedCourseIds,
    totalEarnedCredits,
    programCodes,
  };
}

// ---- prereq satisfaction at a specific term ----

export interface PrereqCheck {
  ok: boolean;
  missing: string[];
  /** true when the verdict rests on at least one verified:false edge */
  unconfirmed: boolean;
}

function occsFor(
  id: string,
  occByCourse: Map<string, Occurrence[]>,
): Occurrence[] {
  return occByCourse.get(id) ?? [];
}

/**
 * BUILD_PROMPT §2: a prereq is satisfied when the prereq course sits in a term
 * strictly before T in a counting state. Corequisites allow before-or-equal.
 */
export function checkPrereqAt(
  course: Course,
  termIndex: number,
  occByCourse: Map<string, Occurrence[]>,
): PrereqCheck {
  const missing: string[] = [];

  const leafOk = (id: string, allowEqual: boolean): boolean =>
    occsFor(id, occByCourse).some(
      (o) =>
        COUNTING_STATES.has(o.state) &&
        (allowEqual ? o.termIndex <= termIndex : o.termIndex < termIndex),
    );

  /**
   * `allowEqual` distinguishes the two rules: a prerequisite must sit strictly
   * before T, a corequisite may sit in T itself. Both use the same expression
   * shape, so this walks either one.
   */
  const evalNode = (node: PrereqNode, allowEqual: boolean): boolean => {
    if (node == null) return true;
    if (typeof node === "string") {
      const ok = leafOk(node, allowEqual);
      if (!ok) {
        const code = COURSE_BY_ID.get(node)?.code ?? node;
        missing.push(allowEqual ? `${code} (coreq)` : code);
      }
      return ok;
    }
    if ("and" in node) {
      // Evaluate all so `missing` is complete.
      return node.and.map((k) => evalNode(k, allowEqual)).every(Boolean);
    }
    const before = missing.length;
    const ok = node.or.some((k) => evalNode(k, allowEqual));
    if (ok) missing.length = before; // an OR that passed leaves no missing entries
    return ok;
  };

  const prereqOk = evalNode(course.prereq, false);
  const coreqOk = evalNode(course.coreq, true);
  return {
    ok: prereqOk && coreqOk,
    missing: [...new Set(missing)],
    unconfirmed: !enforcesPrereq(trustOf(course)),
  };
}

/**
 * Pre-drop validation: would placing `courseId` into `termId` be valid?
 * Evaluated before the drop, not after.
 */
export interface DropVerdict {
  allowed: boolean;
  level: "ok" | "info" | "warning" | "blocked";
  reason: string | null;
  unconfirmed: boolean;
}

export function validateDrop(
  courseId: string,
  termId: string,
  model: PlanModel,
): DropVerdict {
  const c = COURSE_BY_ID.get(courseId)!;
  const term = model.termById.get(termId);
  if (!term) return { allowed: false, level: "blocked", reason: "Unknown term.", unconfirmed: false };
  // History is immutable. A registered term is not — you can still add and drop
  // during registration, so it stays editable.
  if (term.real && term.status === "complete") {
    return {
      allowed: false,
      level: "blocked",
      reason: `${term.label} is history — completed terms are read-only.`,
      unconfirmed: false,
    };
  }
  if (c.isPlaceholder) {
    return { allowed: true, level: "ok", reason: null, unconfirmed: false };
  }

  // Same-semester block: warn at the moment of the drop, so the student sees it
  // while placing rather than after.
  const partners = sameTermPartners(courseId);
  if (partners.length) {
    const elsewhere = partners.filter((id) =>
      (model.derived.get(id)?.occurrences ?? []).some(
        (o) => COUNTING_STATES.has(o.state) && o.termId !== termId,
      ),
    );
    if (elsewhere.length)
      return {
        allowed: true,
        level: "warning",
        reason:
          `Must be taken with ${elsewhere
            .map((id) => COURSE_BY_ID.get(id)?.code ?? id)
            .join(", ")} in the same semester.`,
        unconfirmed: false,
      };
  }
  // Duplicate placement of a non-placeholder that is already passed/active in that term
  const dup = model.derived
    .get(courseId)!
    .occurrences.some((o) => o.termId === termId && COUNTING_STATES.has(o.state));
  if (dup) {
    return {
      allowed: false,
      level: "blocked",
      reason: `${c.code} is already in ${term.label}.`,
      unconfirmed: false,
    };
  }

  // Occurrence map including a hypothetical placement is not needed for prereq
  // (prereqs look strictly backwards), so check against current occurrences.
  const occByCourse = new Map<string, Occurrence[]>();
  for (const [id, d] of model.derived) occByCourse.set(id, d.occurrences);
  const pr = checkPrereqAt(c, term.index, occByCourse);
  if (!pr.ok) {
    /**
     * Only a *complete* reading of the catalogue earns a hard block.
     *
     * `human` and `exact` mean every token of the rule was understood, so
     * refusing is safe. `parsed` means we dropped something — possibly an OR
     * branch that would have let this drop through — and `unsure` means we
     * could not represent the shape at all. In both of those cases blocking
     * risks refusing a registration the university allows, which is the one
     * failure that makes a planner worth less than no planner. See
     * `engine/trust.ts` for the asymmetry argument.
     */
    const trust = trustOf(c);
    const hard = enforcesPrereq(trust);
    const caveat =
      trust === "parsed"
        ? " (read from the catalog; some options could not be modelled, so this is a warning rather than a block)"
        : trust === "unsure"
          ? " (unconfirmed prerequisite)"
          : pr.unconfirmed
            ? " (rests on an unconfirmed prerequisite)"
            : "";
    const reason = `Prerequisite not satisfied by ${term.label}: ${pr.missing.join(", ")}${caveat}`;
    return hard
      ? { allowed: false, level: "blocked", reason, unconfirmed: false }
      : { allowed: true, level: "warning", reason, unconfirmed: true };
  }
  if (isRetired(c)) {
    return {
      allowed: false,
      level: "blocked",
      reason: `${c.code} is retired — it is not offered in any term, so it cannot be taken or retaken.${
        RETIRED_REPLACEMENT[c.id] ? ` ${RETIRED_REPLACEMENT[c.id]}` : ""
      }`,
      unconfirmed: false,
    };
  }
  if (c.termsConfirmed && !c.terms.includes(term.season)) {
    return {
      allowed: false,
      level: "blocked",
      reason: `${c.code} is not offered in ${term.label.split(" ")[0]} (offered: ${c.terms.join(", ")}).`,
      unconfirmed: !enforcesPrereq(trustOf(c)),
    };
  }
  /**
   * An enrollment gate you do not clear — the catalogue restricting a course to
   * declared majors, or demanding credits you have not earned.
   *
   * A warning, never a block, for the same reason machine-read prerequisites
   * warn (see `engine/trust.ts`): our picture of what you are declared in comes
   * from a transcript we did not write, declarations change, and refusing a
   * registration the university would allow is the expensive mistake. Before
   * this, planning MUSIC 102 — flatly closed to Electrical Engineering — said
   * nothing at all.
   */
  const restricted = blockingRestriction(c, {
    programCodes: model.programCodes,
    earnedCredits: model.totalEarnedCredits,
  });
  if (restricted) {
    return {
      allowed: true,
      level: "warning",
      reason: `${c.code} may not be open to you — ${restricted.detail}`,
      unconfirmed: false,
    };
  }
  if (!c.termsConfirmed) {
    return {
      allowed: true,
      level: "info",
      reason: "Offered terms unconfirmed — check the class schedule before registering.",
      unconfirmed: !enforcesPrereq(trustOf(c)),
    };
  }
  // A clean drop still renders dashed when the course's prereq edge is inferred
  // (verified:false) — the validity verdict itself rests on unconfirmed data.
  return {
    allowed: true,
    level: "ok",
    reason: null,
    unconfirmed: !enforcesPrereq(trustOf(c)),
  };
}

export interface EarliestTerm {
  /** First future term where this course would be a legal drop, if any. */
  term: TimelineTerm | null;
  /** When no term works: what has to be planned first. */
  blockedBy: string[];
  /** True when nothing can fix it — the course is retired. */
  retired: boolean;
}

/**
 * The soonest term a course could actually be taken, given the plan as it
 * stands. Answers the question an at-risk badge raises but never resolves:
 * "fine, so when *can* I take it?"
 *
 * Prerequisites are assumed to stay where they are — this reports the
 * consequence of the current plan rather than re-optimising it. If a
 * prerequisite is not planned anywhere, there is no earliest term and the
 * missing courses are named instead.
 */
export function earliestLegalTerm(
  courseId: string,
  model: PlanModel,
): EarliestTerm {
  const c = COURSE_BY_ID.get(courseId);
  if (!c) return { term: null, blockedBy: [], retired: false };
  if (isRetired(c)) return { term: null, blockedBy: [], retired: true };

  for (const t of model.timeline) {
    if (t.real || !isEditableTerm(t)) continue;
    if (validateDrop(courseId, t.id, model).allowed) {
      return { term: t, blockedBy: [], retired: false };
    }
  }

  // Nothing worked: report what the last term was still missing, which is the
  // set that has to be planned before this course becomes reachable at all.
  const occByCourse = new Map<string, Occurrence[]>();
  for (const [id, d] of model.derived) occByCourse.set(id, d.occurrences);
  const last = model.timeline[model.timeline.length - 1];
  const pr = checkPrereqAt(c, last.index + 1, occByCourse);
  return { term: null, blockedBy: pr.missing, retired: false };
}

/** at-risk is a modifier on top of the base status. */
export function isAtRisk(courseId: string, model: PlanModel): boolean {
  const d = model.derived.get(courseId);
  if (!d) return false;
  return d.flags.some((f) => f.level === "error" || f.level === "warning");
}
