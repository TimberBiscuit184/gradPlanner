import { COURSES, COURSE_BY_ID, EE, AI_MINOR } from "../data";
import type { Season } from "../types";
import type { PlanModel } from "./plan";
import { requiredCourseIds } from "./requirements";

const COUNTING = new Set(["completed", "in-progress", "registered", "planned"]);

// ---- §6.1 marginal cost of the minor ----

export interface MarginalRow {
  courseId: string;
  code: string;
  credits: number;
  sharedWithMajor: boolean;
  status: string;
  note: string | null;
}

/** EE pool ids (all buckets except the fillTo catch-all — that bucket accepts anything). */
function eePoolIds(): Set<string> {
  const out = new Set<string>();
  const walk = (b: (typeof EE.buckets)[number]) => {
    b.pool?.forEach((id) => out.add(id));
    b.groups?.forEach(walk);
  };
  EE.buckets.filter((b) => b.rule.type !== "fillTo").forEach(walk);
  return out;
}

/**
 * The minor courses the student will actually use (choosing options the student
 * has attempted or that overlap the major), split shared vs. net-new.
 * Expected: 8 marginal credits — DS 250 (2), DS 460 (3), CSE 455 (3).
 */
export function marginalMinorCost(model: PlanModel): {
  rows: MarginalRow[];
  marginalCredits: number;
  sharedCredits: number;
} {
  const ee = eePoolIds();
  // Chosen options: Core A → CSE110 (EE core; PH135 is not), Math A → MATH112X (attempted, EE).
  const needed = [
    "CSE110",
    "CSE111",
    "CSE210",
    "CSE212",
    "MATH112X",
    "MATH341",
    "DS250",
    "CSE450",
    "DS460",
    "CSE455",
  ];
  const conditional: Record<string, string> = {
    MATH341:
      "Counts for EE only if used as the Math & Science elective — otherwise it is net-new.",
    CSE450:
      "Counts for EE only if used as a Supplemental elective — otherwise it is net-new.",
  };
  const rows: MarginalRow[] = needed.map((id) => {
    const c = COURSE_BY_ID.get(id)!;
    return {
      courseId: id,
      code: c.code,
      credits: c.credits,
      sharedWithMajor: ee.has(id),
      status: model.derived.get(id)?.status ?? "locked",
      note: conditional[id] ?? null,
    };
  });
  const marginalCredits = rows
    .filter((r) => !r.sharedWithMajor)
    .reduce((s, r) => s + r.credits, 0);
  const sharedCredits = rows
    .filter((r) => r.sharedWithMajor)
    .reduce((s, r) => s + r.credits, 0);
  return { rows, marginalCredits, sharedCredits };
}

// ---- §6.2 critical path ----

export interface CriticalPath {
  chain: string[];
  earliestFinish: string | null;
}

/**
 * Longest not-yet-complete prerequisite chain among courses the degree still
 * needs. AND branches take the longest sub-chain (all are required); OR
 * branches take the shortest (the student picks one) — so a satisfied OR
 * alternative (e.g. DS 250 for CSE 450) never inflates the path.
 */
export function criticalPath(model: PlanModel): CriticalPath {
  const incomplete = (id: string) =>
    model.derived.get(id) !== undefined &&
    model.derived.get(id)!.status !== "completed";

  type PN = string | { and: PN[] } | { or: PN[] } | null;
  const memo = new Map<string, string[]>();

  const chainTo = (id: string, seen: Set<string>): string[] => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return [id]; // cycle guard
    const c = COURSE_BY_ID.get(id);
    if (!c) return [id];
    const nextSeen = new Set(seen).add(id);
    const out = [...chainOf(c.prereq as PN, nextSeen), id];
    if (!seen.size) memo.set(id, out);
    return out;
  };

  const chainOf = (node: PN, seen: Set<string>): string[] => {
    if (node == null) return [];
    if (typeof node === "string")
      return incomplete(node) ? chainTo(node, seen) : [];
    if ("and" in node) {
      let best: string[] = [];
      for (const k of node.and) {
        const ch = chainOf(k, seen);
        if (ch.length > best.length) best = ch;
      }
      return best;
    }
    // or: the student takes the cheapest branch
    let best: string[] | null = null;
    for (const k of node.or) {
      const ch = chainOf(k, seen);
      if (best === null || ch.length < best.length) best = ch;
    }
    return best ?? [];
  };

  // Chain endpoints are unconditionally-required courses (allOf pools of all
  // three programs) — optional electives may appear mid-chain but a chain that
  // ends on an elective the student can simply skip is not a critical path.
  const required = requiredCourseIds();

  let best: string[] = [];
  for (const c of COURSES) {
    if (!incomplete(c.id) || c.isPlaceholder || !required.has(c.id)) continue;
    const ch = chainTo(c.id, new Set());
    if (ch.length > best.length) best = ch;
  }

  // Earliest finish: schedule the chain sequentially through future terms
  // (Flex/Winter included), honoring confirmed offered-terms.
  const future = model.timeline.filter((t) => !t.real);
  let cursor = 0;
  let lastLabel: string | null = null;
  for (const id of best) {
    const d = model.derived.get(id)!;
    const active = d.occurrences.filter((o) => COUNTING.has(o.state));
    if (active.length) {
      // Already on the timeline — the chain continues after its latest occurrence.
      const idx = Math.max(...active.map((o) => o.termIndex));
      while (cursor < future.length && future[cursor].index <= idx) cursor++;
      lastLabel = model.timeline[idx]?.label ?? lastLabel;
      continue;
    }
    const c = COURSE_BY_ID.get(id)!;
    let placed = false;
    while (cursor < future.length) {
      const t = future[cursor];
      const offered = !c.termsConfirmed || c.terms.includes(t.season as Season);
      cursor++;
      if (offered) {
        lastLabel = t.label;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lastLabel = "beyond 2031 on this track";
      break;
    }
  }
  return { chain: best, earliestFinish: lastLabel };
}

// ---- §6.3 bottlenecks ----

export interface Bottleneck {
  courseId: string;
  code: string;
  reasons: string[];
}

export function bottlenecks(model: PlanModel): Bottleneck[] {
  const out: Bottleneck[] = [];
  for (const c of COURSES) {
    if (c.isPlaceholder) continue;
    const d = model.derived.get(c.id)!;
    const unplanned = d.status === "available" || d.status === "locked";
    if (!unplanned) continue;
    const reasons: string[] = [];
    if (c.terms.length === 1)
      reasons.push(`offered only in ${c.terms[0] === "F" ? "Fall" : c.terms[0] === "W" ? "Winter" : "Spring"}`);
    if (d.directUnlocks.length >= 4)
      reasons.push(`unlocks ${d.directUnlocks.length} courses directly`);
    if (reasons.length) out.push({ courseId: c.id, code: c.code, reasons });
  }
  return out.sort(
    (a, b) =>
      (model.derived.get(b.courseId)?.directUnlocks.length ?? 0) -
      (model.derived.get(a.courseId)?.directUnlocks.length ?? 0),
  );
}

// ---- §6.4 skills rollup (shell — only course → skill exists in the data) ----

export function skillsByTerm(model: PlanModel): {
  termId: string;
  label: string;
  cumulative: string[];
}[] {
  const acc = new Set<string>();
  const rows: { termId: string; label: string; cumulative: string[] }[] = [];
  for (const t of model.timeline) {
    for (const o of model.occurrencesByTerm.get(t.id) ?? []) {
      if (!COUNTING.has(o.state)) continue;
      const c = COURSE_BY_ID.get(o.courseId);
      c?.skills?.forEach((s) => acc.add(s));
    }
    rows.push({ termId: t.id, label: t.label, cumulative: [...acc] });
  }
  return rows;
}

// ---- §6.6 experiential fork ----

export interface ExperientialFork {
  internship: { label: string; courses: string[]; electives: number; credits: number };
  noInternship: { label: string; courses: string[]; electives: number; credits: number };
  reachableElectives: number;
  winterOnlyElectives: string[];
}

export function experientialFork(): ExperientialFork {
  const supplemental = EE.buckets.find((b) => b.id === "supplemental")!;
  const pool = supplemental.pool ?? [];
  const winterOnly = pool.filter((id) => {
    const c = COURSE_BY_ID.get(id)!;
    return c.terms.length === 1 && c.terms[0] === "W";
  });
  const reachable = pool.length - winterOnly.length;
  const electiveCr = 3; // supplemental electives are 3 credits each
  return {
    internship: {
      label: "Internship (ECEN 398R)",
      courses: ["ECEN398R"],
      electives: 4,
      credits: (COURSE_BY_ID.get("ECEN398R")?.credits ?? 1) + 4 * electiveCr,
    },
    noInternship: {
      label: "No internship (ECEN 397 + 2 extra electives)",
      courses: ["ECEN397"],
      electives: 6,
      credits: (COURSE_BY_ID.get("ECEN397")?.credits ?? 1) + 6 * electiveCr,
    },
    reachableElectives: reachable,
    winterOnlyElectives: winterOnly,
  };
}

export function minorLabel(): string {
  return AI_MINOR.label;
}
