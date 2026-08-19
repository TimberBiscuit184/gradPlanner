import { COURSES, COURSE_BY_ID } from "../data";
import type { CourseStatus, PrereqNode, Season, TimelineTerm } from "../types";
import { isEditableTerm, isRetired, type PlanModel } from "./plan";
import { relevantCourseIds } from "./scope";

const COUNTING = new Set(["completed", "in-progress", "registered", "planned"]);
const UNREACHABLE = Number.POSITIVE_INFINITY;

export interface ReachStep {
  courseId: string;
  code: string;
  /** When this link would have to be taken. Null if it can never be. */
  term: TimelineTerm | null;
  status: CourseStatus;
  /** Already done or on the board — nothing to plan. */
  settled: boolean;
}

export interface Reach {
  /** Soonest term this could be taken if its whole chain were planned optimally. */
  term: TimelineTerm | null;
  /** Terms between the first plannable term and this one. 0 = you could take it next. */
  termsAway: number;
  /** Already completed, registered or on the board. */
  settled: boolean;
  /** Retired, or no season on the timeline ever works. */
  impossible: boolean;
  /**
   * The chain that sets the date, earliest first, ending with the course
   * itself. This is the answer to "what has to happen, and when".
   */
  path: ReachStep[];
}

/**
 * How soon each course could *possibly* be taken, assuming you plan its
 * prerequisites as early as the catalog allows.
 *
 * This is the question `status` cannot answer. "Available" only means every
 * prerequisite sits somewhere on your timeline — it says nothing about when,
 * so a course whose prerequisite is registered for next Fall reads the same as
 * one you could take tomorrow. "Locked" only means some prerequisite is not
 * planned at all. Neither tells you that ECEN 351 is four semesters deep.
 *
 * Unlike `earliestLegalTerm`, which reports the consequence of the plan as it
 * stands, this one *re-plans* the chain optimistically. Use it to find what to
 * start first: the courses with the highest `termsAway` are the ones that will
 * still be blocking you a year from now.
 */
export function computeReach(model: PlanModel): Map<string, Reach> {
  const plannable = model.timeline.filter((t) => !t.real && isEditableTerm(t));
  const firstPlannable = plannable[0]?.index ?? 0;

  const idxCache = new Map<string, number>();
  const driverCache = new Map<string, string | null>();

  /** Index of the earliest term this course could occupy. */
  const idxOf = (id: string, seen: Set<string>): number => {
    const hit = idxCache.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return UNREACHABLE; // cycle guard
    const c = COURSE_BY_ID.get(id);
    if (!c) return UNREACHABLE;

    // Already done or scheduled: it sits where it sits.
    const placed = (model.derived.get(id)?.occurrences ?? []).filter((o) =>
      COUNTING.has(o.state),
    );
    if (placed.length) {
      const i = Math.min(...placed.map((o) => o.termIndex));
      if (!seen.size) idxCache.set(id, i);
      return i;
    }
    if (isRetired(c)) {
      if (!seen.size) idxCache.set(id, UNREACHABLE);
      return UNREACHABLE;
    }

    const next = new Set(seen).add(id);
    const expr = (
      node: PrereqNode,
    ): { idx: number; driver: string | null } => {
      if (node == null) return { idx: -1, driver: null };
      if (typeof node === "string") {
        if (!COURSE_BY_ID.has(node)) return { idx: UNREACHABLE, driver: node };
        return { idx: idxOf(node, next), driver: node };
      }
      const kids = "and" in node ? node.and : node.or;
      const vals = kids.map(expr);
      if (!vals.length) return { idx: -1, driver: null };
      // AND waits for the slowest; OR takes the quickest route.
      return "and" in node
        ? vals.reduce((a, b) => (b.idx > a.idx ? b : a))
        : vals.reduce((a, b) => (b.idx < a.idx ? b : a));
    };

    const pre = expr(c.prereq);
    const co = expr(c.coreq);
    // Prerequisites must finish strictly earlier; corequisites may share a term.
    const needFrom = Math.max(
      pre.idx === -1 ? -1 : pre.idx + 1,
      co.idx === -1 ? -1 : co.idx,
      firstPlannable,
    );
    const driver =
      pre.idx === UNREACHABLE || co.idx === UNREACHABLE
        ? (pre.idx === UNREACHABLE ? pre.driver : co.driver)
        : (pre.idx >= co.idx ? pre.driver : co.driver);

    let result = UNREACHABLE;
    if (needFrom !== UNREACHABLE) {
      for (const t of plannable) {
        if (t.index < needFrom) continue;
        if (c.termsConfirmed && !c.terms.includes(t.season as Season)) continue;
        result = t.index;
        break;
      }
    }
    if (!seen.size) {
      idxCache.set(id, result);
      driverCache.set(id, driver);
    }
    return result;
  };

  // Two passes on purpose. The caches are only written for root calls (a
  // non-root result can be poisoned by the cycle guard), so a course first
  // reached as someone else's dependency has no cached term yet. Resolving
  // every course as a root before walking any path is what stops a settled
  // prerequisite from rendering as "?".
  for (const c of COURSES) if (!c.isPlaceholder) idxOf(c.id, new Set());

  const out = new Map<string, Reach>();
  for (const c of COURSES) {
    if (c.isPlaceholder) continue;
    const idx = idxOf(c.id, new Set());
    const d = model.derived.get(c.id);
    const settled = COUNTING.has(d?.status ?? "");
    const term =
      idx === UNREACHABLE ? null : (model.timeline[idx] ?? null);

    // Walk the drivers back to build the chain, then reverse to read forwards.
    const path: ReachStep[] = [];
    const walk = (id: string, guard: Set<string>) => {
      if (guard.has(id)) return;
      guard.add(id);
      const drv = driverCache.get(id);
      if (drv) walk(drv, guard);
      const cc = COURSE_BY_ID.get(id);
      const i = idxCache.get(id);
      const dd = model.derived.get(id);
      if (cc)
        path.push({
          courseId: id,
          code: cc.code,
          term:
            i === undefined || i === UNREACHABLE
              ? null
              : (model.timeline[i] ?? null),
          status: dd?.status ?? "locked",
          settled: COUNTING.has(dd?.status ?? ""),
        });
    };
    walk(c.id, new Set());

    out.set(c.id, {
      term,
      termsAway:
        idx === UNREACHABLE ? Infinity : Math.max(0, idx - firstPlannable),
      settled,
      impossible: idx === UNREACHABLE,
      path,
    });
  }
  return out;
}

/**
 * Courses that will still be blocking you longest — the ones whose chains you
 * should start now. Settled courses are excluded; they are already handled.
 */
export function deepestFirst(
  reach: Map<string, Reach>,
  obsolete: ReadonlySet<string>,
  limit = 12,
): { courseId: string; reach: Reach }[] {
  // Scoped: "start these chains first" is advice about your degree, not about
  // the deepest chain in the university (which is a music-performance course).
  const scope = relevantCourseIds();
  return [...reach.entries()]
    .filter(
      ([id, r]) =>
        !r.settled && !r.impossible && !obsolete.has(id) && scope.has(id),
    )
    .sort(
      (a, b) =>
        b[1].termsAway - a[1].termsAway ||
        b[1].path.length - a[1].path.length ||
        a[0].localeCompare(b[0]),
    )
    .slice(0, limit)
    .map(([courseId, r]) => ({ courseId, reach: r }));
}
