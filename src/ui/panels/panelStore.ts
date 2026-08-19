import { create } from "zustand";
import { loadJson, saveJson } from "../../engine/storage";
import type { Dock, PanelGeom } from "./snap";

/**
 * Where every panel sits, and which one is on top.
 *
 * Deliberately a *separate* store from `usePlan`. Layout is not part of a plan:
 * it must never enter the undo stack (Ctrl+Z should take back a course, not a
 * window move), it must never ride along in an exported plan file, and it must
 * survive `Reset plan`. Keeping it out of `PlanEdits` is what guarantees all
 * three.
 */
const KEY = "gradtree:panels:v1";

/** Ids are stable strings because they key the saved layout. Don't rename. */
export const PANEL_IDS = {
  rail: "requirements",
  detail: "course-detail",
  picker: "course-picker",
} as const;

export interface PanelState {
  geom: Record<string, PanelGeom>;
  /** Front-to-back order, last is on top. */
  order: string[];
  /** Panels currently mounted — only these reserve layout space. */
  open: string[];
  /** Live snap target while a panel is being dragged, for the preview overlay. */
  zone: Dock | null;
  zoneOwner: string | null;

  setGeom: (id: string, g: PanelGeom) => void;
  raise: (id: string) => void;
  register: (id: string, initial: PanelGeom) => void;
  unregister: (id: string) => void;
  previewZone: (owner: string | null, zone: Dock | null) => void;
  resetLayout: () => void;
}

function sane(v: unknown): v is PanelGeom {
  if (typeof v !== "object" || v === null) return false;
  const g = v as Record<string, unknown>;
  return (
    typeof g.dock === "string" &&
    typeof g.fw === "number" &&
    typeof g.fh === "number" &&
    Number.isFinite(g.x) &&
    Number.isFinite(g.y) &&
    Number.isFinite(g.w) &&
    Number.isFinite(g.h)
  );
}

/** A saved layout is untrusted input — drop any entry that isn't a full geometry. */
function restore(): Record<string, PanelGeom> {
  const raw = loadJson<Record<string, unknown>>(KEY, {});
  const out: Record<string, PanelGeom> = {};
  for (const [k, v] of Object.entries(raw)) if (sane(v)) out[k] = v;
  return out;
}

export const usePanels = create<PanelState>((set) => ({
  geom: restore(),
  order: [],
  open: [],
  zone: null,
  zoneOwner: null,

  setGeom: (id, g) =>
    set((s) => ({ geom: { ...s.geom, [id]: g } })),

  raise: (id) =>
    set((s) =>
      s.order[s.order.length - 1] === id
        ? {}
        : { order: [...s.order.filter((o) => o !== id), id] },
    ),

  /**
   * Called from the panel's mount effect. The default only applies the first
   * time a panel is ever seen — after that the saved geometry wins, or moving a
   * panel would be undone by every remount.
   */
  register: (id, initial) =>
    set((s) => ({
      geom: s.geom[id] ? s.geom : { ...s.geom, [id]: initial },
      open: s.open.includes(id) ? s.open : [...s.open, id],
      order: s.order.includes(id) ? s.order : [...s.order, id],
    })),

  unregister: (id) =>
    set((s) => ({ open: s.open.filter((o) => o !== id) })),

  previewZone: (zoneOwner, zone) => set({ zone, zoneOwner }),

  resetLayout: () => set({ geom: {}, order: [] }),
}));

/** One subscription rather than a write per action, same as the plan autosave. */
let lastGeom = usePanels.getState().geom;
usePanels.subscribe((s) => {
  if (s.geom === lastGeom) return;
  lastGeom = s.geom;
  saveJson(KEY, s.geom);
});
