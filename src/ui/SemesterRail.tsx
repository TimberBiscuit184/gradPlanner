import { useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import { validateDrop } from "../engine/plan";
import { useModel } from "../model";
import { usePlan } from "../store";
import type { TimelineTerm } from "../types";

/**
 * Persistent bottom rail. Collapsed: term chips with live credit counts.
 * On drag start it expands into drop zones colored by whether THIS course is
 * valid in THAT term — validity evaluated before the drop.
 */
function RailZone({ term }: { term: TimelineTerm }) {
  const { model } = useModel();
  const dragging = usePlan((s) => s.dragging);
  const { setNodeRef, isOver } = useDroppable({ id: `term:${term.id}` });

  const occs = model.occurrencesByTerm.get(term.id) ?? [];
  const credits = occs.reduce(
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
  const short = `${term.season === "F" ? "Fall" : term.flex ? "Flex" : term.season === "W" ? "Win" : "Spr"} ${String(term.year).slice(2)}`;

  const verdict = useMemo(
    () => (dragging ? validateDrop(dragging, term.id, model) : null),
    [dragging, term.id, model],
  );

  if (!dragging) {
    return (
      <div
        className="flex shrink-0 items-center gap-1.5 rounded border border-line bg-surface px-2 py-1 text-xs"
        title={term.flex ? `${term.label} — Flex Track (Winter)` : term.label}
      >
        <span className={`font-medium ${term.flex ? "text-registered" : ""}`}>
          {short}
        </span>
        <span className="font-mono text-ink-dim">{credits} cr</span>
        {term.real && <span className="text-[9px] uppercase text-ink-faint">real</span>}
      </div>
    );
  }

  const color = !verdict
    ? ""
    : !verdict.allowed
      ? "border-danger/70 bg-danger/10 text-danger"
      : verdict.level === "warning"
        ? `border-warn bg-warn/10 text-warn ${verdict.unconfirmed ? "border-dashed" : ""}`
        : verdict.level === "info"
          ? "border-planned/70 bg-planned/10 text-ink"
          : "border-ok/70 bg-ok/10 text-ink";

  return (
    <div
      ref={setNodeRef}
      className={`flex h-14 w-24 shrink-0 flex-col items-center justify-center rounded border text-xs transition-transform ${color} ${
        isOver ? "scale-105 ring-2 ring-planned" : ""
      } ${verdict?.unconfirmed && verdict.allowed ? "border-dashed" : ""}`}
      title={verdict?.reason ?? term.label}
    >
      <span className="font-medium">{short}</span>
      <span className="font-mono text-[11px] opacity-80">{credits} cr</span>
      <span className="text-[9px] opacity-70">
        {!verdict ? "" : verdict.allowed ? (verdict.level === "ok" ? "valid" : verdict.level) : "blocked"}
      </span>
    </div>
  );
}

export function SemesterRail() {
  const { model } = useModel();
  const dragging = usePlan((s) => s.dragging);
  return (
    <div
      className={`z-20 flex items-center gap-1.5 overflow-x-auto border-t border-line bg-bg/95 px-3 ${
        dragging ? "py-2" : "py-1.5"
      }`}
      aria-label="Semester rail"
    >
      {model.timeline.map((t) => (
        <RailZone key={t.id} term={t} />
      ))}
    </div>
  );
}
