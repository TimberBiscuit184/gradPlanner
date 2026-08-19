import { useMemo } from "react";
import { COURSE_BY_ID } from "../data";
import { EMPHASES } from "../data/emphases";
import { dependencyIds } from "../engine/plan";
import { requiredCourseIds } from "../engine/requirements";
import { useModel } from "../model";
import { usePlan } from "../store";

/**
 * Focus modes that are not emphasis areas. Prefixed so they can never collide
 * with an id from `src/data/emphases.ts`.
 */
export const FOCUS_OPTIONS = [
  {
    id: "focus:suggested",
    label: "→ Suggested next term",
    hint: "The courses the Insights tab recommends for the next term you need to plan, plus their prerequisite chains.",
  },
  {
    id: "focus:required",
    label: "★ Required only",
    hint: "Only courses you cannot avoid — including exact-fit credit pools and options closed by a retirement — plus their prerequisite chains.",
  },
  {
    id: "focus:bottleneck",
    label: "⧗ Bottlenecks only",
    hint: "Courses offered in a single season or gating four or more others, plus what they need first.",
  },
  {
    id: "focus:unfinished",
    label: "◦ Still to plan",
    hint: "Everything the degree still needs that is not already completed, registered or on the board.",
  },
] as const;

/**
 * The highlight set for the current focus/emphasis selection, or null when
 * nothing is selected. Shared by the tree and the board so the two can never
 * disagree about what is dimmed.
 *
 * Every mode pulls in prerequisite ancestors: highlighting ECEN 470 without
 * ECEN 250 would show a chain floating with its own foundation greyed out.
 */
export function useFocusSet(): Set<string> | null {
  const emphasis = usePlan((s) => s.emphasis);
  const { bottlenecks, obsolete, model, suggestion } = useModel();

  return useMemo(() => {
    if (!emphasis) return null;

    const DONE = new Set(["completed", "in-progress", "registered", "planned"]);
    const settled = (id: string) =>
      DONE.has(model.derived.get(id)?.status ?? "");

    /**
     * Walks prerequisite ancestors so a highlighted chain keeps its foundation.
     * `stopAt` prunes the walk: a "not needed" option is never worth showing,
     * and for "still to plan" neither is a prerequisite you already hold.
     */
    const out = new Set<string>();
    const build = (roots: string[], stopAt: (id: string) => boolean) => {
      const add = (id: string) => {
        if (out.has(id) || stopAt(id)) return;
        out.add(id);
        const c = COURSE_BY_ID.get(id);
        if (!c) return;
        dependencyIds(c).forEach(add);
      };
      roots.forEach(add);
      return out;
    };

    if (emphasis === "focus:suggested")
      return build(
        (suggestion?.picks ?? []).map((p) => p.courseId),
        (id) => obsolete.has(id),
      );

    if (emphasis === "focus:required")
      return build([...requiredCourseIds()], (id) => obsolete.has(id));

    if (emphasis === "focus:bottleneck")
      return build(
        bottlenecks.map((b) => b.courseId),
        (id) => obsolete.has(id),
      );

    if (emphasis === "focus:unfinished")
      return build(
        [...requiredCourseIds()].filter(
          (id) => !obsolete.has(id) && !settled(id),
        ),
        // Stop at anything already handled — the point is what's LEFT.
        (id) => obsolete.has(id) || settled(id),
      );

    const e = EMPHASES.find((x) => x.id === emphasis);
    if (!e) return null;
    return build([...e.supplemental, ...e.core], (id) => obsolete.has(id));
  }, [emphasis, bottlenecks, obsolete, model, suggestion]);
}
