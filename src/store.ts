import { create } from "zustand";
import { geGroups } from "./engine/geGroups";
import { loadEdits, saveEdits } from "./engine/storage";
import type { BlockChoice, Placement } from "./types";

/** Undo depth. Deep enough to walk back a bad auto-fill, short enough to stay cheap. */
const HISTORY_LIMIT = 50;

export interface Toast {
  text: string;
  level: "info" | "warning" | "blocked" | "ok";
  unconfirmed?: boolean;
}

/** The editable half of a plan: what you added, and what you dropped. */
export interface PlanEdits {
  placements: Placement[];
  /**
   * Registrations dropped from a still-editable real term, as
   * `termId:courseId`. Completed history can never be dropped.
   */
  droppedRegistrations: string[];
}

interface PlanState extends PlanEdits {
  /** Snapshots of the edits before each mutation — see withHistory. */
  past: PlanEdits[];
  future: PlanEdits[];
  mode: "board" | "tree" | "projects";
  /** requirement-lens rail-row path, or null when no lens is active */
  lensPath: string | null;
  lensPool: string[] | null;
  /** Human-readable name of the lensed requirement, for the picker's filter chip. */
  lensLabel: string | null;
  selectedCourse: string | null;
  downstreamRoot: string | null;
  whatBreaks: boolean;
  railOpen: boolean;
  /** active emphasis-area filter (id from EMPHASES), or null */
  emphasis: string | null;
  /** tree sections currently collapsed (GE groups + standalone grids) */
  collapsedGroups: string[];
  /** course to center/scroll to after a search pick; cleared once handled */
  focusCourse: string | null;
  /** courses the user marked "I want to take this", pending auto-fill */
  wishlist: string[];
  /** true while the multi-select wishlist bar is active */
  picking: boolean;
  /** courseId currently being dragged (from tree, board, or rail) */
  dragging: string | null;
  /** termId currently hovered mid-drag */
  dragOverTerm: string | null;
  toast: Toast | null;
  /**
   * The add-course picker. `termId` opens it for a semester ("what can I take
   * in Spring 2027?"); `courseId` opens it for a course ("which term should
   * this go in?"). Both list rows with the same block/online chips.
   */
  picker: { termId?: string; courseId?: string } | null;

  setMode: (m: "board" | "tree" | "projects") => void;
  setLens: (
    path: string | null,
    pool: string[] | null,
    label?: string | null,
  ) => void;
  select: (courseId: string | null) => void;
  setDownstream: (courseId: string | null) => void;
  setWhatBreaks: (v: boolean) => void;
  setRailOpen: (v: boolean) => void;
  setEmphasis: (id: string | null) => void;
  toggleGroup: (id: string) => void;
  expandGroupFor: (groupId: string) => void;
  setFocusCourse: (courseId: string | null) => void;
  setPicking: (v: boolean) => void;
  toggleWish: (courseId: string) => void;
  clearWishlist: () => void;
  resetAll: () => void;
  setDragging: (courseId: string | null) => void;
  setDragOverTerm: (termId: string | null) => void;
  showToast: (t: Toast | null) => void;

  openPicker: (p: { termId?: string; courseId?: string }) => void;
  closePicker: () => void;

  addPlacement: (courseId: string, termId: string) => void;
  /** Place and set the half-semester/online choice in one undo step. */
  addPlacementWithBlock: (
    courseId: string,
    termId: string,
    block: BlockChoice,
  ) => void;
  addPlacements: (items: { courseId: string; termId: string }[]) => void;
  movePlacement: (instanceId: string, termId: string) => void;
  removePlacement: (instanceId: string) => void;
  setBlock: (instanceId: string, block: BlockChoice) => void;
  importPlan: (placements: Placement[]) => void;
  /** Drop a registered course, or put it back. */
  toggleRegistration: (termId: string, courseId: string) => void;
  undo: () => void;
  redo: () => void;
}

let seq = 0;
const nextId = () => `pl-${Date.now().toString(36)}-${seq++}`;

/**
 * Wraps a placements change so it becomes undoable: the pre-change array is
 * pushed onto `past` and the redo stack is dropped. Every mutation of
 * `placements` must go through this, or undo will skip it.
 */
const snapshot = (s: PlanState): PlanEdits => ({
  placements: s.placements,
  droppedRegistrations: s.droppedRegistrations,
});

const withHistory =
  (next: (edits: PlanEdits) => Partial<PlanEdits>) =>
  (s: PlanState): Partial<PlanState> => ({
    ...next(snapshot(s)),
    past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
    future: [],
  });

export const usePlan = create<PlanState>((set) => ({
  // Restored from localStorage when the browser allows it; falls back to empty
  // (and to Export/Import only) when storage throws. See engine/storage.ts.
  ...loadEdits(),
  past: [],
  future: [],
  mode: "board",
  lensPath: null,
  lensPool: null,
  lensLabel: null,
  selectedCourse: null,
  downstreamRoot: null,
  whatBreaks: false,
  railOpen: true,
  emphasis: null,
  // GE needs little planning — its tree sections start collapsed
  collapsedGroups: geGroups().map((g) => g.id),
  focusCourse: null,
  wishlist: [],
  picking: false,
  dragging: null,
  dragOverTerm: null,
  toast: null,
  picker: null,

  setMode: (mode) => set({ mode }),
  setLens: (lensPath, lensPool, lensLabel = null) =>
    set({ lensPath, lensPool, lensLabel }),
  select: (selectedCourse) =>
    set((s) => ({
      selectedCourse,
      whatBreaks: selectedCourse === s.selectedCourse ? s.whatBreaks : false,
    })),
  setDownstream: (downstreamRoot) => set({ downstreamRoot }),
  setWhatBreaks: (whatBreaks) => set({ whatBreaks }),
  setRailOpen: (railOpen) => set({ railOpen }),
  setEmphasis: (emphasis) => set({ emphasis }),
  toggleGroup: (id) =>
    set((s) => ({
      collapsedGroups: s.collapsedGroups.includes(id)
        ? s.collapsedGroups.filter((g) => g !== id)
        : [...s.collapsedGroups, id],
    })),
  expandGroupFor: (groupId) =>
    set((s) => ({
      collapsedGroups: s.collapsedGroups.filter((g) => g !== groupId),
    })),
  setFocusCourse: (focusCourse) => set({ focusCourse }),
  setPicking: (picking) => set({ picking }),
  toggleWish: (courseId) =>
    set((s) => ({
      wishlist: s.wishlist.includes(courseId)
        ? s.wishlist.filter((c) => c !== courseId)
        : [...s.wishlist, courseId],
    })),
  clearWishlist: () => set({ wishlist: [] }),
  resetAll: () =>
    set((s) => ({
      placements: [],
      droppedRegistrations: [],
      past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
      future: [],
      wishlist: [],
      picking: false,
      lensPath: null,
      lensPool: null,
      lensLabel: null,
      emphasis: null,
      selectedCourse: null,
      downstreamRoot: null,
      whatBreaks: false,
      toast: null,
      picker: null,
    })),
  setDragging: (dragging) => set({ dragging }),
  setDragOverTerm: (dragOverTerm) => set({ dragOverTerm }),
  showToast: (toast) => set({ toast }),

  openPicker: (picker) => set({ picker }),
  closePicker: () => set({ picker: null }),

  addPlacement: (courseId, termId) =>
    set(
      withHistory(({ placements: ps }) => ({
        placements: [
          ...ps,
          { instanceId: nextId(), courseId, termId, block: null },
        ],
      })),
    ),
  addPlacementWithBlock: (courseId, termId, block) =>
    set(
      withHistory(({ placements: ps }) => ({
        placements: [...ps, { instanceId: nextId(), courseId, termId, block }],
      })),
    ),
  addPlacements: (items) =>
    set(
      withHistory(({ placements: ps }) => ({
        placements: [
          ...ps,
          ...items.map((it) => ({
            instanceId: nextId(),
            courseId: it.courseId,
            termId: it.termId,
            block: null as BlockChoice,
          })),
        ],
      })),
    ),
  movePlacement: (instanceId, termId) =>
    set(
      withHistory(({ placements: ps }) => ({
        placements: ps.map((p) =>
          p.instanceId === instanceId ? { ...p, termId } : p,
        ),
      })),
    ),
  removePlacement: (instanceId) =>
    set(
      withHistory(({ placements: ps }) => ({
        placements: ps.filter((p) => p.instanceId !== instanceId),
      })),
    ),
  setBlock: (instanceId, block) =>
    set(
      withHistory(({ placements: ps }) => ({
        placements: ps.map((p) =>
          p.instanceId === instanceId ? { ...p, block } : p,
        ),
      })),
    ),
  importPlan: (placements) =>
    set(withHistory(() => ({ placements: [...placements] }))),

  toggleRegistration: (termId, courseId) =>
    set(
      withHistory(({ droppedRegistrations: dr }) => {
        const key = `${termId}:${courseId}`;
        return {
          droppedRegistrations: dr.includes(key)
            ? dr.filter((k) => k !== key)
            : [...dr, key],
        };
      }),
    ),

  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      return {
        ...s.past[s.past.length - 1],
        past: s.past.slice(0, -1),
        future: [snapshot(s), ...s.future].slice(0, HISTORY_LIMIT),
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      return {
        ...s.future[0],
        past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
      };
    }),
}));

/**
 * Autosave. One subscription rather than a write inside every action, so a new
 * mutation can never forget to persist. No-ops when storage is unavailable.
 */
let lastSaved = snapshot(usePlan.getState());
usePlan.subscribe((s) => {
  if (
    s.placements === lastSaved.placements &&
    s.droppedRegistrations === lastSaved.droppedRegistrations
  )
    return;
  lastSaved = snapshot(s);
  saveEdits(lastSaved);
});
