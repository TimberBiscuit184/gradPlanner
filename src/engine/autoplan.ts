import { COURSE_BY_ID, EE } from "../data";
import type { Course, PrereqNode, Season } from "../types";
import { prereqDepth, prereqLeaves, type Occurrence, type PlanModel } from "./plan";
import { requiredCourseIds } from "./requirements";

const COUNTING = new Set(["completed", "in-progress", "registered", "planned"]);
const MAX_TERM_CREDITS = 16;

/**
 * Rough cost of satisfying one branch of an OR: how many of its courses are not
 * already on the timeline, then how deep the deepest of those sits. Used to
 * order branches so the scheduler tries the cheapest first and commits to it —
 * an OR means "pick one", so placing every branch over-plans the degree.
 */
function branchCost(
  node: PrereqNode,
  satisfiedAt: (id: string) => number | null,
): number {
  const unmet = prereqLeaves(node).filter(
    (id) => COURSE_BY_ID.has(id) && satisfiedAt(id) === null,
  );
  if (!unmet.length) return 0;
  return unmet.length * 100 + Math.max(...unmet.map((id) => prereqDepth(id)));
}

export interface AutoplanResult {
  additions: { courseId: string; termId: string }[];
  notes: string[];
}

/**
 * "Plan bottlenecks ASAP": place the schedule-constraining courses at their
 * earliest valid terms, prereq chains included.
 *
 * Scope (see DATA_GAPS I8): high-unlock gate courses (direct unlocks ≥ 4) and
 * enough single-term supplemental electives to fill the EE Supplemental
 * requirement — one slot is left for CSE 450, which the A.I. minor requires
 * anyway and double-counts here. It does not place every single-term elective;
 * that would over-plan courses the degree doesn't need.
 */
export function planBottlenecksAsap(
  model: PlanModel,
  /** "not needed" courses (unchosen option branches) — never worth scheduling. */
  obsolete: ReadonlySet<string> = new Set(),
): AutoplanResult {
  const additions: { courseId: string; termId: string }[] = [];
  const notes: string[] = [];

  // Working copies of the occurrence map and per-term credit load.
  const occ = new Map<string, Occurrence[]>();
  for (const [id, d] of model.derived) occ.set(id, [...d.occurrences]);
  const load = new Map<string, number>();
  for (const t of model.timeline) {
    load.set(
      t.id,
      (model.occurrencesByTerm.get(t.id) ?? []).reduce(
        (s, o) =>
          s + (COUNTING.has(o.state) && o.countsForCredit ? o.credits : 0),
        0,
      ),
    );
  }
  const future = model.timeline.filter((t) => !t.real);

  const satisfiedAt = (id: string): number | null => {
    const list = (occ.get(id) ?? []).filter((o) => COUNTING.has(o.state));
    if (!list.length) return null;
    return Math.max(...list.map((o) => o.termIndex));
  };

  /** Ensure a course is on the timeline; returns the term index it occupies, or null. */
  const ensure = (id: string, seen: Set<string>): number | null => {
    const existing = satisfiedAt(id);
    if (existing !== null) return existing;
    if (seen.has(id)) return null; // cycle guard
    const c = COURSE_BY_ID.get(id);
    if (!c || c.isPlaceholder) return null;
    const nextSeen = new Set(seen).add(id);

    // Deepest prereq finish first (AND: all; OR: cheapest branch).
    const depIndex = (node: PrereqNode): number | null => {
      if (node == null) return -1;
      if (typeof node === "string") return ensure(node, nextSeen);
      if ("and" in node) {
        let max = -1;
        for (const k of node.and) {
          const v = depIndex(k);
          if (v === null) return null;
          max = Math.max(max, v);
        }
        return max;
      }
      for (const k of node.or) {
        const already = orBranchSatisfied(k);
        if (already !== null) return already;
      }
      // Commit to one branch: cheapest first, first success wins.
      for (const k of [...node.or].sort(
        (a, b) => branchCost(a, satisfiedAt) - branchCost(b, satisfiedAt),
      )) {
        const v = depIndex(k);
        if (v !== null) return v;
      }
      return null;
    };
    const orBranchSatisfied = (node: PrereqNode): number | null => {
      if (node == null) return -1;
      if (typeof node === "string") return satisfiedAt(node);
      if ("and" in node) {
        let max = -1;
        for (const k of node.and) {
          const v = orBranchSatisfied(k);
          if (v === null) return null;
          max = Math.max(max, v);
        }
        return max;
      }
      for (const k of node.or) {
        const v = orBranchSatisfied(k);
        if (v !== null) return v;
      }
      return null;
    };

    const after = depIndex(c.prereq);
    if (after === null) {
      notes.push(`${c.code}: prerequisite chain could not be planned.`);
      return null;
    }

    // Earliest term index by which the corequisite expression can hold. Same
    // shape as prereqs, but "same term" counts, so the caller compares with <=.
    const coreqIndex = (node: PrereqNode): number | null => {
      if (node == null) return -1;
      if (typeof node === "string")
        return satisfiedAt(node) ?? ensure(node, nextSeen);
      if ("and" in node) {
        let max = -1;
        for (const k of node.and) {
          const v = coreqIndex(k);
          if (v === null) return null;
          max = Math.max(max, v);
        }
        return max;
      }
      let best: number | null = null;
      for (const k of node.or) {
        const v = coreqIndex(k);
        if (v !== null && (best === null || v < best)) best = v;
      }
      return best;
    };

    for (const t of future) {
      if (t.index <= after) continue;
      if (c.termsConfirmed && !c.terms.includes(t.season as Season)) continue;
      if ((load.get(t.id) ?? 0) + c.credits > MAX_TERM_CREDITS) continue;
      // coreqs must sit in the same term or earlier
      const ci = coreqIndex(c.coreq);
      if (ci === null || ci > t.index) continue;
      /**
       * Re-check the load AFTER resolving corequisites.
       *
       * `coreqIndex` can itself place courses — into this very term, since a
       * corequisite may sit alongside. The cap was read before that happened
       * and never read again, so the term could be full by the time this
       * course was pushed onto it. Nursing landed a 19-credit semester under a
       * 16-credit cap this way: a check-then-act gap with the planner's own
       * recursion running in between.
       */
      if ((load.get(t.id) ?? 0) + c.credits > MAX_TERM_CREDITS) continue;

      additions.push({ courseId: id, termId: t.id });
      load.set(t.id, (load.get(t.id) ?? 0) + c.credits);
      const list = occ.get(id) ?? [];
      list.push({
        courseId: id,
        termId: t.id,
        termIndex: t.index,
        source: "placement",
        state: "planned",
        credits: c.credits,
        earned: 0,
        countsForCredit: true,
        retake: false,
      });
      occ.set(id, list);
      return t.index;
    }
    notes.push(`${c.code}: no open term found before Fall 2031.`);
    return null;
  };

  // 1. Gate courses: unplanned with 4+ direct unlocks.
  const gates = [...model.derived.entries()]
    .filter(([id, d]) => {
      const c = COURSE_BY_ID.get(id)!;
      return (
        !c.isPlaceholder &&
        !obsolete.has(id) &&
        (d.status === "available" || d.status === "locked") &&
        d.directUnlocks.length >= 4
      );
    })
    .map(([id]) => id);
  for (const id of gates) ensure(id, new Set());

  // 2. Required courses offered in only one season — scarce, so grab them early.
  //    Must skip "not needed" options too: once the real 2026 schedule landed,
  //    the retired ECEN 101 became single-season and this loop started
  //    scheduling it, even though ECEN 100 already satisfies that requirement.
  const required = requiredCourseIds();
  for (const c of [...COURSE_BY_ID.values()]) {
    if (!required.has(c.id) || c.isPlaceholder || obsolete.has(c.id)) continue;
    const d = model.derived.get(c.id)!;
    if ((d.status === "available" || d.status === "locked") && c.terms.length === 1)
      ensure(c.id, new Set());
  }

  // 3. Fill EE Supplemental to 3 planned single-term electives
  //    (slot 4 is reserved for CSE 450 via the A.I. minor).
  const supplementalPool =
    EE.buckets.find((b) => b.id === "supplemental")?.pool ?? [];
  const counting = supplementalPool.filter((id) => satisfiedAt(id) !== null);
  let slots = Math.max(0, 3 - counting.length);
  const singleTerm = supplementalPool
    .map((id) => COURSE_BY_ID.get(id)!)
    .filter(
      (c): c is Course =>
        !!c && c.terms.length === 1 && satisfiedAt(c.id) === null,
    );
  // earliest-completable first: try in pool order but sort by how soon each could land
  const ranked = singleTerm
    .map((c) => ({ c, idx: previewEarliest(c, future, load) }))
    .filter((r) => r.idx !== null)
    .sort((a, b) => a.idx! - b.idx!);
  for (const r of ranked) {
    if (slots <= 0) break;
    if (ensure(r.c.id, new Set()) !== null) slots--;
  }
  if (slots === 0 && ranked.length) {
    notes.push(
      "Supplemental slot 4 left open for CSE 450 (required by the A.I. minor, double-counts here).",
    );
  }

  return { additions, notes };
}

/**
 * Auto-fill a chosen set of courses ("I want to take these") into the earliest
 * terms that satisfy prerequisites, offered terms, and a per-term credit cap.
 * Prerequisites that are not already done/planned get pulled in automatically
 * so the wishlist is actually reachable.
 */
export function planWishlist(
  model: PlanModel,
  wishlist: string[],
  opts: { maxCredits?: number; includePrereqs?: boolean } = {},
): AutoplanResult & { pulledIn: string[] } {
  const maxCredits = opts.maxCredits ?? MAX_TERM_CREDITS;
  const includePrereqs = opts.includePrereqs !== false;
  const additions: { courseId: string; termId: string }[] = [];
  const notes: string[] = [];
  const pulledIn: string[] = [];

  const occ = new Map<string, Occurrence[]>();
  for (const [id, d] of model.derived) occ.set(id, [...d.occurrences]);
  const load = new Map<string, number>();
  for (const t of model.timeline) {
    load.set(
      t.id,
      (model.occurrencesByTerm.get(t.id) ?? []).reduce(
        (s, o) =>
          s + (COUNTING.has(o.state) && o.countsForCredit ? o.credits : 0),
        0,
      ),
    );
  }
  const future = model.timeline.filter((t) => !t.real);

  const satisfiedAt = (id: string): number | null => {
    const list = (occ.get(id) ?? []).filter((o) => COUNTING.has(o.state));
    return list.length ? Math.max(...list.map((o) => o.termIndex)) : null;
  };

  const wanted = new Set(wishlist);

  const place = (id: string, seen: Set<string>): number | null => {
    const already = satisfiedAt(id);
    if (already !== null) return already;
    if (seen.has(id)) return null;
    const c = COURSE_BY_ID.get(id);
    if (!c) return null;
    const next = new Set(seen).add(id);

    const branchDone = (node: PrereqNode): number | null => {
      if (node == null) return -1;
      if (typeof node === "string") return satisfiedAt(node);
      if ("and" in node) {
        let max = -1;
        for (const k of node.and) {
          const v = branchDone(k);
          if (v === null) return null;
          max = Math.max(max, v);
        }
        return max;
      }
      for (const k of node.or) {
        const v = branchDone(k);
        if (v !== null) return v;
      }
      return null;
    };

    const resolve = (node: PrereqNode): number | null => {
      if (node == null) return -1;
      const done = branchDone(node);
      if (done !== null) return done;
      if (!includePrereqs) return null;
      if (typeof node === "string") {
        if (!wanted.has(node)) pulledIn.push(node);
        return place(node, next);
      }
      if ("and" in node) {
        let max = -1;
        for (const k of node.and) {
          const v = resolve(k);
          if (v === null) return null;
          max = Math.max(max, v);
        }
        return max;
      }
      // Pick ONE branch — cheapest first, first success wins. Scoring every
      // branch by calling resolve() would schedule the losers too.
      for (const k of [...node.or].sort(
        (a, b) => branchCost(a, satisfiedAt) - branchCost(b, satisfiedAt),
      )) {
        const v = resolve(k);
        if (v !== null) return v;
      }
      return null;
    };

    const after = resolve(c.prereq);
    if (after === null) {
      notes.push(`${c.code}: prerequisites could not be scheduled.`);
      return null;
    }

    const coreqIndex = (node: PrereqNode): number | null => {
      if (node == null) return -1;
      if (typeof node === "string") return satisfiedAt(node) ?? place(node, next);
      if ("and" in node) {
        let max = -1;
        for (const k of node.and) {
          const v = coreqIndex(k);
          if (v === null) return null;
          max = Math.max(max, v);
        }
        return max;
      }
      let best: number | null = null;
      for (const k of node.or) {
        const v = coreqIndex(k);
        if (v !== null && (best === null || v < best)) best = v;
      }
      return best;
    };

    for (const t of future) {
      if (t.index <= after) continue;
      if (c.termsConfirmed && !c.terms.includes(t.season as Season)) continue;
      if ((load.get(t.id) ?? 0) + c.credits > maxCredits) continue;
      const ci = coreqIndex(c.coreq);
      if (ci === null || ci > t.index) continue;
      // Same check-then-act gap as `planBottlenecksAsap` — see there.
      if ((load.get(t.id) ?? 0) + c.credits > maxCredits) continue;

      additions.push({ courseId: id, termId: t.id });
      load.set(t.id, (load.get(t.id) ?? 0) + c.credits);
      const list = occ.get(id) ?? [];
      list.push({
        courseId: id,
        termId: t.id,
        termIndex: t.index,
        source: "placement",
        state: "planned",
        credits: c.credits,
        earned: 0,
        countsForCredit: true,
        retake: false,
      });
      occ.set(id, list);
      return t.index;
    }
    notes.push(`${c.code}: no term with room before Fall 2031.`);
    return null;
  };

  // Shallowest first so prerequisites land before the courses that need them.
  const ordered = [...wishlist].sort(
    (a, b) => prereqDepth(a) - prereqDepth(b),
  );
  for (const id of ordered) place(id, new Set());

  return { additions, notes, pulledIn: [...new Set(pulledIn)] };
}

function previewEarliest(
  c: Course,
  future: { id: string; index: number; season: string }[],
  load: Map<string, number>,
): number | null {
  // rough ranking only — ensure() does the real placement work
  for (const t of future) {
    if (c.termsConfirmed && !c.terms.includes(t.season as Season)) continue;
    if ((load.get(t.id) ?? 0) + c.credits > MAX_TERM_CREDITS) continue;
    return t.index;
  }
  return null;
}
