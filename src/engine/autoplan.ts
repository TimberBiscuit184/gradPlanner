import { COURSE_BY_ID, EE } from "../data";
import type { Course, PrereqNode, Season } from "../types";
import { prereqDepth, type Occurrence, type PlanModel } from "./plan";
import { requiredCourseIds } from "./requirements";

const COUNTING = new Set(["completed", "in-progress", "registered", "planned"]);
const MAX_TERM_CREDITS = 16;

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
export function planBottlenecksAsap(model: PlanModel): AutoplanResult {
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
      let best: number | null = null;
      for (const k of node.or) {
        const already = orBranchSatisfied(k);
        if (already !== null) return already;
      }
      for (const k of node.or) {
        const v = depIndex(k);
        if (v !== null && (best === null || v < best)) best = v;
      }
      return best;
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

    for (const t of future) {
      if (t.index <= after) continue;
      if (c.termsConfirmed && !c.terms.includes(t.season as Season)) continue;
      if ((load.get(t.id) ?? 0) + c.credits > MAX_TERM_CREDITS) continue;
      // coreqs must sit in the same term or earlier
      let coreqOk = true;
      for (const q of c.coreq) {
        const qi = satisfiedAt(q) ?? ensure(q, nextSeen);
        if (qi === null || qi > t.index) {
          coreqOk = false;
          break;
        }
      }
      if (!coreqOk) continue;

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
        (d.status === "available" || d.status === "locked") &&
        d.directUnlocks.length >= 4
      );
    })
    .map(([id]) => id);
  for (const id of gates) ensure(id, new Set());

  // 2. Required courses that are single-term (none today, but future-proof).
  const required = requiredCourseIds();
  for (const c of [...COURSE_BY_ID.values()]) {
    if (!required.has(c.id) || c.isPlaceholder) continue;
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
      // pick the OR branch that is cheapest to satisfy
      let best: number | null = null;
      for (const k of node.or) {
        const v = resolve(k);
        if (v !== null && (best === null || v < best)) best = v;
      }
      return best;
    };

    const after = resolve(c.prereq);
    if (after === null) {
      notes.push(`${c.code}: prerequisites could not be scheduled.`);
      return null;
    }

    for (const t of future) {
      if (t.index <= after) continue;
      if (c.termsConfirmed && !c.terms.includes(t.season as Season)) continue;
      if ((load.get(t.id) ?? 0) + c.credits > maxCredits) continue;
      let coreqOk = true;
      for (const q of c.coreq) {
        const qi = satisfiedAt(q) ?? place(q, next);
        if (qi === null || qi > t.index) {
          coreqOk = false;
          break;
        }
      }
      if (!coreqOk) continue;

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
