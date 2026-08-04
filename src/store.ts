import { create } from "zustand";
import { geGroups } from "./engine/geGroups";
import type { BlockChoice, Placement } from "./types";

export interface Toast {
  text: string;
  level: "info" | "warning" | "blocked" | "ok";
  unconfirmed?: boolean;
}

interface PlanState {
  placements: Placement[];
  mode: "board" | "tree" | "projects";
  /** requirement-lens rail-row path, or null when no lens is active */
  lensPath: string | null;
  lensPool: string[] | null;
  selectedCourse: string | null;
  downstreamRoot: string | null;
  whatBreaks: boolean;
  railOpen: boolean;
  railFocus: boolean;
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

  setMode: (m: "board" | "tree" | "projects") => void;
  setLens: (path: string | null, pool: string[] | null) => void;
  select: (courseId: string | null) => void;
  setDownstream: (courseId: string | null) => void;
  setWhatBreaks: (v: boolean) => void;
  setRailOpen: (v: boolean) => void;
  setRailFocus: (v: boolean) => void;
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

  addPlacement: (courseId: string, termId: string) => void;
  addPlacements: (items: { courseId: string; termId: string }[]) => void;
  movePlacement: (instanceId: string, termId: string) => void;
  removePlacement: (instanceId: string) => void;
  setBlock: (instanceId: string, block: BlockChoice) => void;
  importPlan: (placements: Placement[]) => void;
}

let seq = 0;
const nextId = () => `pl-${Date.now().toString(36)}-${seq++}`;

export const usePlan = create<PlanState>((set) => ({
  // In-memory only: the target sandbox has no localStorage. Export/Import JSON instead.
  placements: [],
  mode: "board",
  lensPath: null,
  lensPool: null,
  selectedCourse: null,
  downstreamRoot: null,
  whatBreaks: false,
  railOpen: true,
  railFocus: false,
  emphasis: null,
  // GE needs little planning — its tree sections start collapsed
  collapsedGroups: geGroups().map((g) => g.id),
  focusCourse: null,
  wishlist: [],
  picking: false,
  dragging: null,
  dragOverTerm: null,
  toast: null,

  setMode: (mode) => set({ mode }),
  setLens: (lensPath, lensPool) => set({ lensPath, lensPool }),
  select: (selectedCourse) =>
    set((s) => ({
      selectedCourse,
      whatBreaks: selectedCourse === s.selectedCourse ? s.whatBreaks : false,
    })),
  setDownstream: (downstreamRoot) => set({ downstreamRoot }),
  setWhatBreaks: (whatBreaks) => set({ whatBreaks }),
  setRailOpen: (railOpen) => set({ railOpen }),
  setRailFocus: (railFocus) => set({ railFocus }),
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
    set({
      placements: [],
      wishlist: [],
      picking: false,
      lensPath: null,
      lensPool: null,
      emphasis: null,
      selectedCourse: null,
      downstreamRoot: null,
      whatBreaks: false,
      toast: null,
    }),
  setDragging: (dragging) => set({ dragging }),
  setDragOverTerm: (dragOverTerm) => set({ dragOverTerm }),
  showToast: (toast) => set({ toast }),

  addPlacement: (courseId, termId) =>
    set((s) => ({
      placements: [
        ...s.placements,
        { instanceId: nextId(), courseId, termId, block: null },
      ],
    })),
  addPlacements: (items) =>
    set((s) => ({
      placements: [
        ...s.placements,
        ...items.map((it) => ({
          instanceId: nextId(),
          courseId: it.courseId,
          termId: it.termId,
          block: null,
        })),
      ],
    })),
  movePlacement: (instanceId, termId) =>
    set((s) => ({
      placements: s.placements.map((p) =>
        p.instanceId === instanceId ? { ...p, termId } : p,
      ),
    })),
  removePlacement: (instanceId) =>
    set((s) => ({
      placements: s.placements.filter((p) => p.instanceId !== instanceId),
    })),
  setBlock: (instanceId, block) =>
    set((s) => ({
      placements: s.placements.map((p) =>
        p.instanceId === instanceId ? { ...p, block } : p,
      ),
    })),
  importPlan: (placements) => set({ placements }),
}));
