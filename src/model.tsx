import { createContext, useContext, useMemo, type ReactNode } from "react";
import { AI_MINOR, EE } from "./data";
import { buildPlan, type PlanModel } from "./engine/plan";
import {
  evaluateProgram,
  obsoleteCourseIds,
  railRows,
  type ProgramEval,
  type RailRow,
} from "./engine/requirements";
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
import type { Placement } from "./types";

export interface ModelBundle {
  model: PlanModel;
  eeEval: ProgramEval;
  minorEval: ProgramEval;
  eeRows: RailRow[];
  minorRows: RailRow[];
  marginal: { rows: MarginalRow[]; marginalCredits: number; sharedCredits: number };
  critical: CriticalPath;
  bottlenecks: Bottleneck[];
  fork: ExperientialFork;
  skills: { termId: string; label: string; cumulative: string[] }[];
  /** courses only reachable through already-satisfied option branches — "not needed" */
  obsolete: Set<string>;
}

export function computeBundle(placements: Placement[]): ModelBundle {
  const model = buildPlan(placements);
  const eeEval = evaluateProgram(EE, model);
  const minorEval = evaluateProgram(AI_MINOR, model);
  const obsolete = obsoleteCourseIds([eeEval, minorEval], model);
  return {
    obsolete,
    model,
    eeEval,
    minorEval,
    eeRows: railRows(eeEval),
    minorRows: railRows(minorEval),
    marginal: marginalMinorCost(model),
    critical: criticalPath(model),
    bottlenecks: bottlenecks(model),
    fork: experientialFork(),
    skills: skillsByTerm(model),
  };
}

const ModelCtx = createContext<ModelBundle | null>(null);

export function ModelProvider({ children }: { children: ReactNode }) {
  const placements = usePlan((s) => s.placements);
  const bundle = useMemo(() => computeBundle(placements), [placements]);
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
  const dragging = usePlan((s) => s.dragging);
  const overTerm = usePlan((s) => s.dragOverTerm);
  return useMemo(() => {
    if (!dragging || !overTerm) return null;
    const hypo: Placement = {
      instanceId: "hypothetical",
      courseId: dragging,
      termId: overTerm,
      block: null,
    };
    return computeBundle([...placements, hypo]);
  }, [placements, dragging, overTerm]);
}
