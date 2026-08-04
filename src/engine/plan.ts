import { COURSES, COURSE_BY_ID, EE, AI_MINOR, GE_ABET, STUDENT } from "../data";
import type {
  Bucket,
  Course,
  CourseFlag,
  CourseStatus,
  Placement,
  PrereqNode,
  Program,
  TimelineTerm,
  TranscriptEntry,
} from "../types";
import { meetsThreshold } from "./grades";
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

const EE_POOL = programPool(EE);
const AI_POOL = programPool(AI_MINOR);
const GE_POOL = programPool(GE_ABET);

/** Strictest minGrade among the programs whose pools contain the course. */
export function thresholdFor(courseId: string): string | null {
  if (EE_POOL.has(courseId) || AI_POOL.has(courseId)) return EE.minGrade; // "C-"
  if (GE_POOL.has(courseId)) return GE_ABET.minGrade; // null → any credit-earning grade
  return null;
}

export function programsContaining(courseId: string): Program[] {
  const out: Program[] = [];
  if (EE_POOL.has(courseId)) out.push(EE);
  if (GE_POOL.has(courseId)) out.push(GE_ABET);
  if (AI_POOL.has(courseId)) out.push(AI_MINOR);
  return out;
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

/** Direct unlocks: courses whose prereq expression names `id`. Direct only — never transitive. */
export function directUnlocksOf(id: string): string[] {
  return COURSES.filter((c) => prereqLeaves(c.prereq).includes(id)).map(
    (c) => c.id,
  );
}

const DIRECT_UNLOCKS = new Map<string, string[]>(
  COURSES.map((c) => [c.id, directUnlocksOf(c.id)]),
);

/** Dependency edges for the downstream walk: prereq AND coreq (a coreq is still a dependency). */
const DEP_EDGES = new Map<string, string[]>(
  COURSES.map((c) => [
    c.id,
    COURSES.filter(
      (t) => prereqLeaves(t.prereq).includes(c.id) || t.coreq.includes(c.id),
    ).map((t) => t.id),
  ]),
);

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
 * Longest prerequisite chain behind a course, counted globally (not per
 * cluster). 0 = no prerequisites at all; the tree uses this for the horizontal
 * stagger so "further right" always means "more prerequisites deep".
 */
const DEPTH_CACHE = new Map<string, number>();
export function prereqDepth(id: string, seen: Set<string> = new Set()): number {
  const cached = DEPTH_CACHE.get(id);
  if (cached !== undefined) return cached;
  if (seen.has(id)) return 0; // cycle guard
  const c = COURSE_BY_ID.get(id);
  if (!c) return 0;
  const deps = [...new Set([...prereqLeaves(c.prereq), ...c.coreq])].filter(
    (p) => COURSE_BY_ID.has(p),
  );
  const next = new Set(seen).add(id);
  const d = deps.length
    ? 1 + Math.max(...deps.map((p) => prereqDepth(p, next)))
    : 0;
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
    for (const prev of [...prereqLeaves(c.prereq), ...c.coreq]) {
      if (!COURSE_BY_ID.has(prev) || out.has(prev)) continue;
      out.add(prev);
      stack.push(prev);
    }
  }
  return out;
}

// ---- the model ----

const COUNTING_STATES = new Set([
  "completed",
  "in-progress",
  "registered",
  "planned",
]);

export function buildPlan(placements: Placement[]): PlanModel {
  const timeline = buildTimeline(STUDENT);
  const termById = new Map(timeline.map((t) => [t.id, t]));

  // 1. Collect occurrences.
  const occByCourse = new Map<string, Occurrence[]>();
  const occurrencesByTerm = new Map<string, Occurrence[]>();
  timeline.forEach((t) => occurrencesByTerm.set(t.id, []));

  const push = (o: Occurrence) => {
    if (!occByCourse.has(o.courseId)) occByCourse.set(o.courseId, []);
    occByCourse.get(o.courseId)!.push(o);
    occurrencesByTerm.get(o.termId)?.push(o);
  };

  for (const term of STUDENT.terms) {
    const tl = termById.get(term.id)!;
    for (const e of term.courses) {
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
    return isSatisfiable(c.prereq) ? "available" : "locked";
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
      directUnlocks: DIRECT_UNLOCKS.get(c.id) ?? [],
    });
  }

  // 3. Flags (at-risk logic).
  const springFall = STUDENT.track.pattern === "spring-fall";
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

  return {
    timeline,
    termById,
    occurrencesByTerm,
    derived,
    totalPlanCredits,
    completedCourseIds,
    totalEarnedCredits,
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

  const evalNode = (node: PrereqNode): boolean => {
    if (node == null) return true;
    if (typeof node === "string") {
      const ok = leafOk(node, false);
      if (!ok) missing.push(COURSE_BY_ID.get(node)?.code ?? node);
      return ok;
    }
    if ("and" in node) {
      // Evaluate all so `missing` is complete.
      return node.and.map(evalNode).every(Boolean);
    }
    const before = missing.length;
    const ok = node.or.some(evalNode);
    if (ok) missing.length = before; // an OR that passed leaves no missing entries
    return ok;
  };

  const prereqOk = evalNode(course.prereq);
  let coreqOk = true;
  for (const id of course.coreq) {
    if (!leafOk(id, true)) {
      coreqOk = false;
      missing.push(`${COURSE_BY_ID.get(id)?.code ?? id} (coreq)`);
    }
  }
  return {
    ok: prereqOk && coreqOk,
    missing: [...new Set(missing)],
    unconfirmed: !course.verified,
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
  if (term.real) {
    return {
      allowed: false,
      level: "blocked",
      reason: `${term.label} is ${term.status === "complete" ? "history" : "already registered"} — real terms are read-only.`,
      unconfirmed: false,
    };
  }
  if (c.isPlaceholder) {
    return { allowed: true, level: "ok", reason: null, unconfirmed: false };
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
    const hard = c.verified; // confirmed edge → hard block; inferred edge → warn but allow
    const reason =
      `Prerequisite not satisfied by ${term.label}: ${pr.missing.join(", ")}` +
      (pr.unconfirmed ? " (unconfirmed prerequisite)" : "");
    return hard
      ? { allowed: false, level: "blocked", reason, unconfirmed: false }
      : { allowed: true, level: "warning", reason, unconfirmed: true };
  }
  if (c.termsConfirmed && !c.terms.includes(term.season)) {
    return {
      allowed: false,
      level: "blocked",
      reason: `${c.code} is not offered in ${term.label.split(" ")[0]} (offered: ${c.terms.join(", ")}).`,
      unconfirmed: !c.verified,
    };
  }
  if (!c.termsConfirmed) {
    return {
      allowed: true,
      level: "info",
      reason: "Offered terms unconfirmed — check the class schedule before registering.",
      unconfirmed: !c.verified,
    };
  }
  // A clean drop still renders dashed when the course's prereq edge is inferred
  // (verified:false) — the validity verdict itself rests on unconfirmed data.
  return { allowed: true, level: "ok", reason: null, unconfirmed: !c.verified };
}

/** at-risk is a modifier on top of the base status. */
export function isAtRisk(courseId: string, model: PlanModel): boolean {
  const d = model.derived.get(courseId);
  if (!d) return false;
  return d.flags.some((f) => f.level === "error" || f.level === "warning");
}
