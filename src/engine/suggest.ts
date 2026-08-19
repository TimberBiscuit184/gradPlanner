import { COURSES, COURSE_BY_ID } from "../data";
import { relevantCourseIds } from "./scope";
import type { TimelineTerm } from "../types";
import { FULL_TIME_CREDITS, RECOMMENDED_MAX_CREDITS } from "./gpa";
import { bottlenecks, criticalPath } from "./insights";
import { isEditableTerm, validateDrop, type PlanModel } from "./plan";
import { requiredCourseIds } from "./requirements";

/** A course worth taking next, with the case for it in plain words. */
export interface Suggestion {
  courseId: string;
  code: string;
  credits: number;
  score: number;
  reasons: string[];
}

export interface TermSuggestion {
  term: TimelineTerm;
  picks: Suggestion[];
  totalCredits: number;
  targetCredits: number;
  /** Legal options that lost out — shown as "also possible". */
  runnersUp: Suggestion[];
  notes: string[];
}

export interface SuggestOptions {
  /** Credits to aim for. Clamped to BYU-Idaho's 21-credit recommended maximum. */
  targetCredits?: number;
  /** Force a specific term instead of letting the engine pick the next one. */
  termId?: string;
}

const DEFAULT_TARGET = 15;

function termCredits(model: PlanModel, termId: string): number {
  return (model.occurrencesByTerm.get(termId) ?? []).reduce(
    (s, o) =>
      s +
      (o.countsForCredit &&
      ["completed", "in-progress", "registered", "planned"].includes(o.state)
        ? o.credits
        : 0),
    0,
  );
}

/**
 * The term the student should be planning now: the earliest one that is
 * editable, not already a real registration, and still under a full-time load.
 *
 * Winter is skipped unless they already plan into a Flex Track term — on a
 * spring-fall pattern, suggesting an off-track winter unprompted would quietly
 * change the shape of the degree.
 */
export function nextTermToPlan(model: PlanModel): TimelineTerm | null {
  const usesFlex = model.timeline.some(
    (t) =>
      t.flex &&
      (model.occurrencesByTerm.get(t.id) ?? []).some(
        (o) => o.state === "planned",
      ),
  );
  for (const t of model.timeline) {
    if (t.real || !isEditableTerm(t)) continue;
    if (t.flex && !usesFlex) continue;
    if (termCredits(model, t.id) < FULL_TIME_CREDITS) return t;
  }
  return null;
}

/**
 * What to take next, and why.
 *
 * Ranking, highest first:
 *  - **on the critical path** — the longest unfinished prerequisite chain. Every
 *    term one of these slips, graduation slips with it.
 *  - **gates other courses** — direct unlocks, weighted. Taking ECEN 250 opens
 *    nine doors; taking a terminal elective opens none.
 *  - **scarce** — offered in only one or two seasons a year, so missing it
 *    costs a full cycle rather than a term.
 *  - **required** — unavoidable, per the derived rule (DATA_GAPS I16).
 *
 * Only courses that would be a *legal* drop are considered, so prerequisites
 * and offered terms are already respected. A second pass catches corequisite
 * pairs like ECEN 250 + ECEN 299, which only become legal together.
 */
export function suggestTerm(
  model: PlanModel,
  obsolete: ReadonlySet<string>,
  opts: SuggestOptions = {},
): TermSuggestion | null {
  const term = opts.termId
    ? (model.termById.get(opts.termId) ?? null)
    : nextTermToPlan(model);
  if (!term) return null;

  const target = Math.min(
    opts.targetCredits ?? DEFAULT_TARGET,
    RECOMMENDED_MAX_CREDITS,
  );
  const already = termCredits(model, term.id);
  const room = Math.max(0, target - already);

  const critical = new Set(criticalPath(model).chain);
  const required = requiredCourseIds();
  const bott = new Map(
    bottlenecks(model, obsolete).map((b) => [b.courseId, b.reasons]),
  );

  const score = (id: string): Suggestion | null => {
    const c = COURSE_BY_ID.get(id);
    if (!c || c.isPlaceholder || obsolete.has(id)) return null;
    const d = model.derived.get(id);
    if (!d || (d.status !== "available" && d.status !== "locked")) return null;
    if (!validateDrop(id, term.id, model).allowed) return null;

    let s = 0;
    const reasons: string[] = [];
    if (critical.has(id)) {
      s += 100;
      reasons.push("on the critical path to graduation");
    }
    if (d.directUnlocks.length) {
      s += d.directUnlocks.length * 8;
      // A gate — same 4-unlock threshold the bottleneck list uses. Without this
      // tier a short critical chain outranked ECEN 250, which the whole EE
      // program flows through.
      if (d.directUnlocks.length >= 4) s += 50;
      if (d.directUnlocks.length >= 3)
        reasons.push(`unlocks ${d.directUnlocks.length} courses`);
    }
    if (c.termsConfirmed && c.terms.length === 1) {
      s += 30;
      reasons.push(`offered only in ${SEASON[c.terms[0]]}`);
    } else if (c.termsConfirmed && c.terms.length === 2) {
      s += 10;
    }
    if (required.has(id)) {
      s += 40;
      reasons.push("required — no alternative");
    }
    if (bott.has(id) && !reasons.length) reasons.push(...bott.get(id)!);
    if (!reasons.length) reasons.push("counts toward a requirement you still owe");
    return { courseId: id, code: c.code, credits: c.credits, score: s, reasons };
  };

  /**
   * Only courses inside the planning scope. With the full catalogue loaded,
   * ranking every course by direct unlocks recommended ENG 301 and POLSC 200 —
   * genuinely high-unlock courses that count toward nothing this student is
   * doing. See `engine/scope.ts`.
   */
  const scope = relevantCourseIds();
  const ranked = COURSES.filter((c) => scope.has(c.id))
    .map((c) => score(c.id))
    .filter((x): x is Suggestion => x !== null)
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));

  // Greedy fill. Skipping a course that does not fit and trying the next keeps
  // a 4-credit leader from wasting the last 3 credits of room.
  const picks: Suggestion[] = [];
  let used = 0;
  for (const s of ranked) {
    if (used + s.credits > room) continue;
    picks.push(s);
    used += s.credits;
  }

  // Second pass: with the picks hypothetically in place, some corequisites
  // become legal (ECEN 299 needs ECEN 250 in the same term or earlier).
  const notes: string[] = [];
  if (picks.length) {
    const hypothetical = [
      ...picks.map((p, i) => ({
        instanceId: `sugg-${i}`,
        courseId: p.courseId,
        termId: term.id,
        block: null,
      })),
    ];
    const withPicks = buildHypothetical(model, hypothetical);
    for (const c of COURSES) {
      if (!scope.has(c.id)) continue;
      if (picks.some((p) => p.courseId === c.id)) continue;
      if (used + c.credits > room) continue;
      const before = validateDrop(c.id, term.id, model).allowed;
      const after = validateDrop(c.id, term.id, withPicks).allowed;
      if (!before && after) {
        const s = score(c.id) ?? {
          courseId: c.id,
          code: c.code,
          credits: c.credits,
          score: 0,
          reasons: [],
        };
        s.reasons.unshift("corequisite — take it alongside the above");
        picks.push(s);
        used += c.credits;
      }
    }
  }

  if (already > 0)
    notes.push(
      `${term.label} already holds ${already} credit${already === 1 ? "" : "s"}; this tops it up toward ${target}.`,
    );
  if (!picks.length)
    notes.push(
      ranked.length
        ? `Nothing fits in the remaining ${room} credits.`
        : `No course is currently legal in ${term.label} — its prerequisites are not met yet.`,
    );

  return {
    term,
    picks,
    totalCredits: used,
    targetCredits: target,
    runnersUp: ranked
      .filter((r) => !picks.some((p) => p.courseId === r.courseId))
      .slice(0, 5),
    notes,
  };
}

const SEASON: Record<string, string> = { F: "Fall", W: "Winter", S: "Spring" };

/** Rebuild the model with extra placements — used for the corequisite pass. */
function buildHypothetical(
  model: PlanModel,
  extra: { instanceId: string; courseId: string; termId: string; block: null }[],
): PlanModel {
  // Cheap shim: clone the occurrence map and splice the extras in, rather than
  // re-running the whole engine. validateDrop only reads occurrences + terms.
  const derived = new Map(model.derived);
  for (const p of extra) {
    const d = derived.get(p.courseId);
    const t = model.termById.get(p.termId);
    if (!d || !t) continue;
    derived.set(p.courseId, {
      ...d,
      occurrences: [
        ...d.occurrences,
        {
          courseId: p.courseId,
          termId: p.termId,
          termIndex: t.index,
          source: "placement" as const,
          state: "planned" as const,
          credits: COURSE_BY_ID.get(p.courseId)?.credits ?? 0,
          earned: 0,
          countsForCredit: true,
          retake: false,
        },
      ],
    });
  }
  return { ...model, derived };
}
