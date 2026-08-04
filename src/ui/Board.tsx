import { useDroppable } from "@dnd-kit/core";
import { useEffect, useMemo } from "react";
import { validateDrop, type Occurrence } from "../engine/plan";
import { useModel } from "../model";
import { usePlan } from "../store";
import type { TimelineTerm } from "../types";
import { CourseCard } from "./CourseCard";

function termCredits(occs: Occurrence[]): number {
  return occs.reduce(
    (s, o) =>
      s +
      (o.countsForCredit &&
      ["completed", "in-progress", "registered", "planned"].includes(o.state)
        ? o.state === "completed"
          ? o.earned
          : o.credits
        : 0),
    0,
  );
}

const ZONE_STYLE: Record<string, string> = {
  ok: "outline outline-2 outline-ok/60 bg-ok/5",
  info: "outline outline-2 outline-planned/50 bg-planned/5",
  warning: "outline outline-2 outline-dashed outline-warn/70 bg-warn/5",
  blocked: "outline outline-2 outline-danger/50 bg-danger/5 opacity-60",
};

function TermColumn({ term }: { term: TimelineTerm }) {
  const { model } = useModel();
  const dragging = usePlan((s) => s.dragging);
  const occs = model.occurrencesByTerm.get(term.id) ?? [];
  const { setNodeRef, isOver } = useDroppable({ id: `term:${term.id}` });

  const verdict = useMemo(
    () => (dragging ? validateDrop(dragging, term.id, model) : null),
    [dragging, term.id, model],
  );

  const credits = termCredits(occs);

  const zone =
    dragging && verdict
      ? ZONE_STYLE[verdict.allowed ? verdict.level : "blocked"]
      : "";

  // Main area = everything that isn't in a half-semester block (full-semester,
  // online, and any legacy value). Only "1st"/"2nd" live in the block rows.
  const byBlock = (b: "1st" | "2nd" | null) =>
    occs.filter((o) => {
      const pl = o.placementId
        ? usePlan.getState().placements.find((p) => p.instanceId === o.placementId)
        : null;
      const block = pl?.block ?? null;
      if (b === null) return block !== "1st" && block !== "2nd";
      return block === b;
    });

  return (
    <div
      ref={setNodeRef}
      data-term={term.id}
      className={`flex h-full w-52 shrink-0 flex-col rounded-lg border bg-surface/60 ${
        isOver && dragging ? "ring-2 ring-planned" : ""
      } ${zone} border-line`}
    >
      <div className="flex items-baseline gap-2 border-b border-line px-2.5 py-2">
        <span className="text-sm font-semibold">{term.label}</span>
        {term.real && (
          <span
            className="rounded bg-surface-2 px-1 text-[10px] uppercase tracking-wide text-ink-faint"
            title="Real term from your transcript/registration — read-only."
          >
            {term.status === "complete"
              ? "history"
              : term.status === "in-progress"
                ? "in progress"
                : "registered"}
          </span>
        )}
        {term.flex && (
          <span
            className="rounded bg-registered/20 px-1 text-[10px] uppercase tracking-wide text-registered"
            title="Flex Track — a Winter semester outside your spring-fall pattern. Fully plannable."
          >
            flex track
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-ink-dim">
          {credits} cr
        </span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-1.5">
        {byBlock(null).map((o) => (
          <CourseCard key={o.placementId ?? `${o.courseId}-${o.termId}`} occ={o} />
        ))}
        {/* half-height block rows — driven by manual assignment only (no source data, M1) */}
        {(["1st", "2nd"] as const).map((b) => {
          const blockOccs = byBlock(b);
          if (term.real && blockOccs.length === 0) return null;
          return (
            <div
              key={b}
              className="rounded border border-dashed border-line/70 px-1.5 py-1"
            >
              <div className="text-[10px] uppercase tracking-wide text-ink-faint">
                {b} block
              </div>
              <div className="mt-1 space-y-1.5">
                {blockOccs.map((o) => (
                  <CourseCard
                    key={o.placementId ?? `${o.courseId}-${o.termId}`}
                    occ={o}
                  />
                ))}
                {blockOccs.length === 0 && (
                  <div className="pb-0.5 text-[10px] text-ink-faint/60">
                    block availability unknown
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {verdict && dragging && (
          <div
            className={`rounded border px-2 py-1 text-[11px] ${
              verdict.allowed
                ? verdict.level === "warning"
                  ? "border-dashed border-warn text-warn"
                  : "border-line text-ink-dim"
                : "border-danger text-danger"
            }`}
          >
            {verdict.allowed
              ? (verdict.reason ?? "Drop to plan here")
              : verdict.reason}
          </div>
        )}
      </div>
    </div>
  );
}

export function Board() {
  const { model } = useModel();
  const focusCourse = usePlan((s) => s.focusCourse);
  const setFocusCourse = usePlan((s) => s.setFocusCourse);

  // Search in board mode: scroll to the term holding the course, if any.
  useEffect(() => {
    if (!focusCourse) return;
    const d = model.derived.get(focusCourse);
    const occ = d?.occurrences.find((o) =>
      ["completed", "in-progress", "registered", "planned"].includes(o.state),
    );
    if (occ) {
      document
        .querySelector(`[data-term="${occ.termId}"]`)
        ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
    setFocusCourse(null);
  }, [focusCourse, model, setFocusCourse]);

  return (
    <div className="flex h-full gap-2 overflow-x-auto p-3">
      {model.timeline.map((t) => (
        <TermColumn key={t.id} term={t} />
      ))}
    </div>
  );
}
