import { useDraggable } from "@dnd-kit/core";
import { useMemo } from "react";
import { COURSE_BY_ID } from "../data";
import { EMPHASES } from "../data/emphases";
import type { Occurrence } from "../engine/plan";
import { isAtRisk, prereqLeaves } from "../engine/plan";
import { useModel } from "../model";
import { usePlan } from "../store";
import { BLOCK_LABELS, STATUS_STYLE } from "./status";
import type { BlockChoice } from "../types";

/** Emphasis highlight set incl. prereq ancestors (mirrors the tree behavior). */
export function useEmphasisSet(): Set<string> | null {
  const emphasis = usePlan((s) => s.emphasis);
  return useMemo(() => {
    if (!emphasis) return null;
    const e = EMPHASES.find((x) => x.id === emphasis);
    if (!e) return null;
    const out = new Set<string>();
    const add = (id: string) => {
      if (out.has(id)) return;
      out.add(id);
      const c = COURSE_BY_ID.get(id);
      if (!c) return;
      prereqLeaves(c.prereq).forEach(add);
      c.coreq.forEach(add);
    };
    [...e.supplemental, ...e.core].forEach(add);
    return out;
  }, [emphasis]);
}

/** A course card on the semester board. Real-term cards are read-only history. */
export function CourseCard({ occ }: { occ: Occurrence }) {
  const { model } = useModel();
  const course = COURSE_BY_ID.get(occ.courseId)!;
  const derived = model.derived.get(occ.courseId)!;
  const select = usePlan((s) => s.select);
  const removePlacement = usePlan((s) => s.removePlacement);
  const setBlock = usePlan((s) => s.setBlock);
  const lensPool = usePlan((s) => s.lensPool);
  const placement = usePlan((s) =>
    s.placements.find((p) => p.instanceId === occ.placementId),
  );

  const draggable = occ.source === "placement";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `placement-${occ.placementId ?? `${occ.courseId}-${occ.termId}`}`,
    data: draggable
      ? { kind: "placement", instanceId: occ.placementId!, courseId: occ.courseId }
      : undefined,
    disabled: !draggable,
  });

  const cardStatus =
    occ.source === "placement"
      ? "planned"
      : occ.state === "failed"
        ? "failed"
        : occ.state;
  const sty = STATUS_STYLE[cardStatus];
  const atRisk = !course.isPlaceholder && isAtRisk(occ.courseId, model);
  const unconfirmedEdge = !course.verified;
  const emphSet = useEmphasisSet();
  const outsideLens =
    (lensPool !== null && !lensPool.includes(occ.courseId)) ||
    (emphSet !== null && !emphSet.has(occ.courseId));
  const riskFlags = derived.flags.filter((f) => f.level !== "info");

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      role="button"
      tabIndex={0}
      onClick={() => select(occ.courseId)}
      onKeyDown={(e) => {
        (listeners?.onKeyDown as ((ev: unknown) => void) | undefined)?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) select(occ.courseId);
      }}
      className={`focus-ring group relative rounded-md border px-2 py-1.5 text-left text-sm transition-opacity ${sty.card} ${
        atRisk
          ? `border-2 ${unconfirmedEdge ? "border-dashed" : ""} !border-warn`
          : ""
      } ${outsideLens ? "opacity-30 saturate-0" : ""} ${
        isDragging ? "opacity-40" : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      title={riskFlags.map((f) => f.text).join("\n") || undefined}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sty.dot}`} />
        <span className="font-mono text-[13px] font-semibold">{course.code}</span>
        <span className="ml-auto font-mono text-xs text-ink-dim">
          {occ.countsForCredit ? occ.credits : 0} cr
        </span>
        {cardStatus === "completed" && (
          <span className="text-completed" aria-label="completed">
            ✓
          </span>
        )}
        {occ.retake && (
          <span className="rounded bg-surface-2 px-1 text-[10px] uppercase tracking-wide text-ink-dim">
            retake
          </span>
        )}
        {(placement?.block === "online" || occ.entry?.modality === "online") && (
          <span className="rounded bg-inprogress/15 px-1 text-[10px] text-inprogress">
            online
          </span>
        )}
        {atRisk && (
          <span className="text-warn" title="at-risk">
            ⚠
          </span>
        )}
      </div>
      <div className="truncate text-xs text-ink-dim">{course.title}</div>
      {occ.grade && (
        <div className="text-[11px] text-ink-faint">
          grade {occ.grade}
          {!occ.countsForCredit && " · no credit (retake)"}
        </div>
      )}
      {!course.isPlaceholder && !course.termsConfirmed && (
        <div className="mt-0.5 text-[10px] leading-tight text-ink-faint">
          offered terms unconfirmed
        </div>
      )}
      {/* M1: no block data exists for any course — manual assignment only.
          No block selected = full semester (the default). */}
      <div className="mt-1 flex items-center gap-1">
        <span className="text-[10px] text-ink-faint" title="Block availability unknown — check the class schedule. No selection = full semester.">
          block?
        </span>
        {occ.source === "placement" && placement ? (
          <>
            {[...BLOCK_LABELS, ...(course.online ? (["online"] as const) : [])].map(
              (b) => (
                <button
                  key={b}
                  onClick={(e) => {
                    e.stopPropagation();
                    setBlock(
                      placement.instanceId,
                      placement.block === b ? null : (b as BlockChoice),
                    );
                  }}
                  className={`rounded px-1 text-[10px] leading-4 ${
                    placement.block === b
                      ? "bg-planned/30 text-ink"
                      : "bg-surface-2 text-ink-faint hover:text-ink-dim"
                  }`}
                  title={
                    b === "online"
                      ? "Take the online section"
                      : `Assign to the ${b} half-semester block`
                  }
                >
                  {b}
                </button>
              ),
            )}
          </>
        ) : occ.entry?.modality === "online" ? (
          <span className="rounded bg-surface-2 px-1 text-[10px] text-inprogress">
            online
          </span>
        ) : (
          <span className="text-[10px] text-ink-faint">unknown</span>
        )}
      </div>
      {occ.source === "placement" && (
        <button
          aria-label={`Remove ${course.code}`}
          onClick={(e) => {
            e.stopPropagation();
            removePlacement(occ.placementId!);
          }}
          className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-surface-2 text-[10px] text-ink-dim hover:text-danger group-hover:flex"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Compact draggable chip used in the requirements rail and placeholder shelf. */
export function CourseChip({ courseId }: { courseId: string }) {
  const { model, obsolete } = useModel();
  const course = COURSE_BY_ID.get(courseId);
  const select = usePlan((s) => s.select);
  const picking = usePlan((s) => s.picking);
  const wished = usePlan((s) => s.wishlist.includes(courseId));
  const toggleWish = usePlan((s) => s.toggleWish);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip-${courseId}`,
    data: { kind: "course", courseId },
  });
  if (!course) return null;
  const d = model.derived.get(courseId)!;
  const sty = STATUS_STYLE[d.status];
  const isObsolete = obsolete.has(courseId);
  // Locked chips get a soft blue hue here — inside the rail they are by
  // definition part of the selected requirement, and gray-on-gray hides them.
  const card = isObsolete
    ? "border-dotted border-line/60 opacity-40"
    : d.status === "locked"
      ? "border-planned/50 bg-planned/10"
      : sty.card;
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => (picking ? toggleWish(courseId) : select(courseId))}
      className={`focus-ring flex w-full items-center gap-1.5 rounded border px-1.5 py-1 text-left text-xs ${card} ${
        wished ? "!border-planned ring-1 ring-planned" : ""
      } ${isDragging ? "opacity-40" : ""} ${
        picking ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
      }`}
      title={`${course.title} — ${
        isObsolete ? "not needed (option satisfied)" : sty.label
      }`}
    >
      {picking && (
        <span className={wished ? "text-planned" : "text-ink-faint"}>
          {wished ? "☑" : "☐"}
        </span>
      )}
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sty.dot}`} />
      <span className={`font-mono ${isObsolete ? "line-through" : ""}`}>
        {course.code}
      </span>
      <span className="ml-auto font-mono text-ink-faint">{course.credits}</span>
    </button>
  );
}
