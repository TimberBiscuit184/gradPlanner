import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  DEFAULT_ENROLLED_IDS,
  evaluatedPrograms,
  programCodesFor,
} from "./engine/programs";
import { setActiveEnrollment } from "./engine/scope";
import { buildPlan, type PlanModel } from "./engine/plan";
import {
  evaluateProgram,
  obsoleteCourseIds,
  railRows,
  type ProgramEval,
  type RailRow,
} from "./engine/requirements";
import { computeReach, type Reach } from "./engine/reach";
import { suggestTerm, type TermSuggestion } from "./engine/suggest";
import {
  bottlenecks,
  criticalPath,
  experientialFork,
  marginalMinorCost,
  skillsByTerm,
  type Bottleneck,
  type CriticalPath,
  type ExperientialFork,
  type MarginalRow,
} from "./engine/insights";
import { usePlan } from "./store";
import { useProfile } from "./profileStore";
import type { Placement, Program } from "./types";

/** One enrolled program, evaluated and ready to render. */
export interface ProgramView {
  program: Program;
  eval: ProgramEval;
  rows: RailRow[];
}

export interface ModelBundle {
  model: PlanModel;
  /**
   * Every enrolled program, majors first — not two fields called `eeEval` and
   * `minorEval`. The rail maps over this, so a student with two minors or no
   * minor at all renders correctly without touching the UI.
   */
  programs: ProgramView[];
  marginal: { rows: MarginalRow[]; marginalCredits: number; sharedCredits: number };
  critical: CriticalPath;
  bottlenecks: Bottleneck[];
  fork: ExperientialFork;
  skills: { termId: string; label: string; cumulative: string[] }[];
  /** courses only reachable through already-satisfied option branches — "not needed" */
  obsolete: Set<string>;
  /** What to take next term, and why. Null once every future term is full. */
  suggestion: TermSuggestion | null;
  /** Soonest each course could be taken if its chain were planned optimally. */
  reach: Map<string, Reach>;
}

export function computeBundle(
  placements: Placement[],
  droppedRegistrations: readonly string[] = [],
  enrolledIds: readonly string[] = DEFAULT_ENROLLED_IDS,
): ModelBundle {
  // Program codes flow from the *current* enrollment, so removing a major
  // re-evaluates every "restricted to programs …" gate with it.
  // Scope and restriction checks must follow the *chosen* enrollment, not the
  // transcript's declarations — the shipped record has none.
  setActiveEnrollment(enrolledIds);
  const model = buildPlan(
    placements,
    droppedRegistrations,
    programCodesFor(enrolledIds),
  );
  // `evaluatedPrograms` drops anything nested inside another program, so
  // General Education is counted once — inside the major — and never as a
  // sibling. Evaluating it twice reads ~27 credits high.
  const programs: ProgramView[] = evaluatedPrograms(enrolledIds).map((p) => {
    const ev = evaluateProgram(p, model);
    return { program: p, eval: ev, rows: railRows(ev) };
  });
  const obsolete = obsoleteCourseIds(
    programs.map((p) => p.eval),
    model,
  );
  return {
    obsolete,
    model,
    programs,
    marginal: marginalMinorCost(model),
    critical: criticalPath(model),
    bottlenecks: bottlenecks(model, obsolete),
    fork: experientialFork(),
    skills: skillsByTerm(model),
    suggestion: suggestTerm(model, obsolete),
    reach: computeReach(model),
  };
}

const ModelCtx = createContext<ModelBundle | null>(null);

export function ModelProvider({ children }: { children: ReactNode }) {
  const placements = usePlan((s) => s.placements);
  const dropped = usePlan((s) => s.droppedRegistrations);
  const enrolledIds = useProfile((s) => s.enrolledIds);
  const bundle = useMemo(
    () => computeBundle(placements, dropped, enrolledIds),
    [placements, dropped, enrolledIds],
  );
  return <ModelCtx.Provider value={bundle}>{children}</ModelCtx.Provider>;
}

export function useModel(): ModelBundle {
  const v = useContext(ModelCtx);
  if (!v) throw new Error("useModel outside ModelProvider");
  return v;
}

/**
 * Hypothetical evaluation used for the live mid-drag counters: what the rail
 * would show if the dragged course landed on the hovered term.
 */
export function useHypotheticalBundle(): ModelBundle | null {
  const placements = usePlan((s) => s.placements);
  const dropped = usePlan((s) => s.droppedRegistrations);
  const dragging = usePlan((s) => s.dragging);
  const overTerm = usePlan((s) => s.dragOverTerm);
  const enrolledIds = useProfile((s) => s.enrolledIds);
  return useMemo(() => {
    if (!dragging || !overTerm) return null;
    const hypo: Placement = {
      instanceId: "hypothetical",
      courseId: dragging,
      termId: overTerm,
      block: null,
    };
    return computeBundle([...placements, hypo], dropped, enrolledIds);
  }, [placements, dropped, dragging, overTerm, enrolledIds]);
}
