import { useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import { termLoad, termLoadNote } from "../engine/gpa";
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
  // `rail:` so it cannot collide with the board column for the same term —
  // see the note in Board.tsx.
  const { setNodeRef, isOver } = useDroppable({
    id: `rail:${term.id}`,
    data: { termId: term.id },
  });

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
  const over = termLoad(credits) === "over";

  const verdict = useMemo(
    () => (dragging ? validateDrop(dragging, term.id, model) : null),
    [dragging, term.id, model],
  );

  if (!dragging) {
    return (
      <div
        className="flex shrink-0 items-center gap-1.5 rounded border border-line bg-surface px-2 py-1 text-xs"
        title={
          termLoadNote(credits) ??
          (term.flex ? `${term.label} — Flex Track (Winter)` : term.label)
        }
      >
        <span className={`font-medium ${term.flex ? "text-flex" : ""}`}>
          {short}
        </span>
        <span
          className={`font-mono ${over ? "font-semibold text-warn" : "text-ink-dim"}`}
        >
          {over && "⚠ "}
          {credits} cr
        </span>
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
  const selected = usePlan((s) => s.selectedCourse);
  const mode = usePlan((s) => s.mode);
  /**
   * In tree mode the rail is the *only* place a dragged course can land, and it
   * only turns into drop zones once a drag is already under way — so before you
   * start, nothing says where to aim. Arming a card lights the rail up instead:
   * no resize, no layout shift, just an unmistakable "down here".
   */
  const armed = !dragging && !!selected && mode === "tree";
  return (
    <div
      className={`z-20 flex items-center gap-1.5 overflow-x-auto border-t bg-bg/95 px-3 transition-colors ${
        dragging ? "py-2" : "py-1.5"
      } ${armed ? "border-planned/70 bg-planned/5" : "border-line"}`}
      aria-label="Semester rail"
    >
      {armed && (
        <span className="shrink-0 pr-1 text-[10px] font-medium text-planned">
          drop here ↓
        </span>
      )}
      {model.timeline.map((t) => (
        <RailZone key={t.id} term={t} />
      ))}
    </div>
  );
}
