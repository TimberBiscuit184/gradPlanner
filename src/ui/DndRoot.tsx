import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { type ReactNode } from "react";
import { COURSE_BY_ID } from "../data";
import { validateDrop } from "../engine/plan";
import { useModel } from "../model";
import { usePlan } from "../store";

/** Drag payloads: a fresh course (from tree/rail) or an existing board placement. */
export type DragData =
  | { kind: "course"; courseId: string }
  | { kind: "placement"; instanceId: string; courseId: string };

/**
 * Keyboard drags jump between term drop zones (space to lift, arrows to move,
 * space to drop, escape to cancel) instead of nudging by pixels.
 */
const termCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context: { droppableRects, droppableContainers, collisionRect } },
) => {
  if (!collisionRect) return undefined;
  if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key))
    return undefined;
  event.preventDefault();

  const zones = droppableContainers
    .getEnabled()
    .filter((c) => String(c.id).startsWith("term:"))
    .map((c) => ({ id: c.id, rect: droppableRects.get(c.id) }))
    .filter((z) => z.rect)
    .sort((a, b) => a.rect!.left - b.rect!.left || a.rect!.top - b.rect!.top);
  if (!zones.length) return undefined;

  const cx = collisionRect.left;
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const next = forward
    ? (zones.find((z) => z.rect!.left > cx + 4) ?? zones[0])
    : ([...zones].reverse().find((z) => z.rect!.left < cx - 4) ??
      zones[zones.length - 1]);
  return { x: next.rect!.left + 8, y: next.rect!.top + 8 };
};

/** Pointer drags hit what's under the cursor; keyboard drags (no pointer) fall back to rects. */
const hybridCollision: CollisionDetection = (args) => {
  const withPointer = pointerWithin(args);
  return withPointer.length ? withPointer : rectIntersection(args);
};

export function DndRoot({ children }: { children: ReactNode }) {
  const { model } = useModel();
  const store = usePlan;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: termCoordinateGetter }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData | undefined;
    if (!data) return;
    store.getState().setDragging(data.courseId);
    store.getState().showToast(null);
  };

  const onDragOver = (e: DragOverEvent) => {
    const overId = e.over ? String(e.over.id) : null;
    store
      .getState()
      .setDragOverTerm(
        overId?.startsWith("term:") ? overId.slice(5) : null,
      );
  };

  const onDragEnd = (e: DragEndEvent) => {
    const s = store.getState();
    const data = e.active.data.current as DragData | undefined;
    s.setDragging(null);
    s.setDragOverTerm(null);
    if (!data || !e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith("term:")) return;
    const termId = overId.slice(5);

    const verdict = validateDrop(data.courseId, termId, model);
    const code = COURSE_BY_ID.get(data.courseId)?.code ?? data.courseId;
    if (!verdict.allowed) {
      s.showToast({
        text: verdict.reason ?? `${code} cannot go there.`,
        level: "blocked",
        unconfirmed: verdict.unconfirmed,
      });
      return;
    }
    if (data.kind === "placement") s.movePlacement(data.instanceId, termId);
    else s.addPlacement(data.courseId, termId);
    if (verdict.reason) {
      s.showToast({
        text: verdict.reason,
        level: verdict.level === "warning" ? "warning" : "info",
        unconfirmed: verdict.unconfirmed,
      });
    } else {
      s.showToast({ text: `${code} planned.`, level: "ok" });
    }
  };

  const onDragCancel = () => {
    store.getState().setDragging(null);
    store.getState().setDragOverTerm(null);
  };

  const dragging = usePlan((s) => s.dragging);
  const draggedCourse = dragging ? COURSE_BY_ID.get(dragging) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={hybridCollision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${String(active.id)}. Use arrow keys to choose a term, space to drop, escape to cancel.`,
          onDragOver: ({ over }) =>
            over ? `Over ${String(over.id).replace("term:", "term ")}.` : "",
          onDragEnd: ({ over }) =>
            over ? `Dropped on ${String(over.id)}.` : "Drag cancelled.",
          onDragCancel: () => "Drag cancelled.",
        },
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {draggedCourse ? (
          <div
            className={`pointer-events-none rounded-md border px-3 py-2 text-sm font-medium bg-surface-2 text-ink shadow-xl ${
              draggedCourse.verified ? "border-planned" : "border-dashed border-warn"
            }`}
          >
            <span className="font-mono">{draggedCourse.code}</span>
            <span className="ml-2 text-ink-dim">{draggedCourse.credits} cr</span>
            {!draggedCourse.verified && (
              <div className="text-xs text-warn">unconfirmed prerequisite</div>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
