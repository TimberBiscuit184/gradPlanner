/**
 * Panel geometry and snap-zone maths.
 *
 * Pure functions, no React and no DOM — the whole point is that the drag
 * handler, the snap preview and the layout insets all derive their rectangles
 * from the *same* code, so the preview can never lie about where a panel will
 * land.
 *
 * The docking model, deliberately:
 *   - Edge docks (left/right/top/bottom) **reserve** space. The board and the
 *     tree shrink to fit, because a docked requirements rail you have to keep
 *     moving out of the way is worse than no rail at all.
 *   - Corner docks and `full` **overlay**. A quarter-panel is a glance, not a
 *     workspace, and "maximise" means "cover everything for a moment".
 *   - `float` is free-form, positioned in layer pixels.
 */

export type Dock =
  | "float"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | "full";

export interface PanelGeom {
  dock: Dock;
  /** Dock size as a fraction of the layer: width for left/right and corners. */
  fw: number;
  /** Dock size as a fraction of the layer: height for top/bottom and corners. */
  fh: number;
  /**
   * Free-float rectangle in layer pixels. Kept while docked on purpose —
   * undocking a panel should return it to the size you last gave it, not to a
   * default that throws your layout away.
   */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayerRect {
  width: number;
  height: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Small enough that a panel can never be resized into an invisible sliver. */
export const MIN_W = 260;
export const MIN_H = 140;

/** Edge band that triggers a snap, as a fraction of the layer. */
const EDGE = 0.075;
/** How much of an edge counts as its corner rather than its middle. */
const CORNER = 0.26;
/** The strip at the top-centre that means "cover everything". */
const MAX_BAND = 0.03;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Which zone the pointer is currently over, or null for "leave it floating".
 *
 * Mirrors what Windows and every tiling harness trained people to expect: edges
 * snap, corners quarter, top-centre maximises. Returning null is a real answer
 * — dropping in open space must leave the panel exactly where you dropped it.
 */
export function zoneFor(
  px: number,
  py: number,
  rect: LayerRect,
): Dock | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const fx = px / rect.width;
  const fy = py / rect.height;

  if (fy < MAX_BAND && fx > 0.32 && fx < 0.68) return "full";
  if (fx < EDGE)
    return fy < CORNER ? "tl" : fy > 1 - CORNER ? "bl" : "left";
  if (fx > 1 - EDGE)
    return fy < CORNER ? "tr" : fy > 1 - CORNER ? "br" : "right";
  if (fy < EDGE) return "top";
  if (fy > 1 - EDGE) return "bottom";
  return null;
}

/** The rectangle a panel occupies, in layer pixels. */
export function boxFor(g: PanelGeom, rect: LayerRect): Box {
  const W = rect.width;
  const H = rect.height;
  const dw = clamp(g.fw, 0.15, 0.85) * W;
  const dh = clamp(g.fh, 0.15, 0.9) * H;

  switch (g.dock) {
    case "left":
      return { left: 0, top: 0, width: dw, height: H };
    case "right":
      return { left: W - dw, top: 0, width: dw, height: H };
    case "top":
      return { left: 0, top: 0, width: W, height: dh };
    case "bottom":
      return { left: 0, top: H - dh, width: W, height: dh };
    case "tl":
      return { left: 0, top: 0, width: dw, height: dh };
    case "tr":
      return { left: W - dw, top: 0, width: dw, height: dh };
    case "bl":
      return { left: 0, top: H - dh, width: dw, height: dh };
    case "br":
      return { left: W - dw, top: H - dh, width: dw, height: dh };
    case "full":
      return { left: 0, top: 0, width: W, height: H };
    default: {
      // Float. Clamp so a panel can never be dragged fully off-screen, and so a
      // saved layout from a bigger window still comes back reachable.
      const width = clamp(g.w, MIN_W, Math.max(MIN_W, W));
      const height = clamp(g.h, MIN_H, Math.max(MIN_H, H));
      return {
        left: clamp(g.x, -width + 80, Math.max(0, W - 80)),
        top: clamp(g.y, 0, Math.max(0, H - 32)),
        width,
        height,
      };
    }
  }
}

/** True for docks that push the main content aside rather than covering it. */
export function reservesSpace(dock: Dock): boolean {
  return dock === "left" || dock === "right" || dock === "top" || dock === "bottom";
}

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How much room the open, space-reserving panels take. Two panels docked to the
 * same edge overlap rather than stack, so the inset is the widest of them.
 */
export function insetsFor(
  geoms: PanelGeom[],
  rect: LayerRect,
): Insets {
  const out: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const g of geoms) {
    if (!reservesSpace(g.dock)) continue;
    const b = boxFor(g, rect);
    if (g.dock === "left") out.left = Math.max(out.left, b.width);
    else if (g.dock === "right") out.right = Math.max(out.right, b.width);
    else if (g.dock === "top") out.top = Math.max(out.top, b.height);
    else out.bottom = Math.max(out.bottom, b.height);
  }
  return out;
}

/** Human-readable zone name, for the snap preview label and tooltips. */
export const DOCK_LABEL: Record<Dock, string> = {
  float: "Floating",
  left: "Dock left",
  right: "Dock right",
  top: "Dock top",
  bottom: "Dock bottom",
  tl: "Top left",
  tr: "Top right",
  bl: "Bottom left",
  br: "Bottom right",
  full: "Cover everything",
};

/**
 * Which corners stay square when docked. A panel flush against the window edge
 * with rounded corners reads as floating-but-stuck; squaring the outer corners
 * is what makes a dock look deliberate.
 */
export function radiusFor(dock: Dock): string {
  switch (dock) {
    case "left":
      return "0 0.5rem 0.5rem 0";
    case "right":
      return "0.5rem 0 0 0.5rem";
    case "top":
      return "0 0 0.5rem 0.5rem";
    case "bottom":
      return "0.5rem 0.5rem 0 0";
    case "tl":
      return "0 0 0.5rem 0";
    case "tr":
      return "0 0 0 0.5rem";
    case "bl":
      return "0 0.5rem 0 0";
    case "br":
      return "0.5rem 0 0 0";
    case "full":
      return "0";
    default:
      return "0.5rem";
  }
}

/** Resize handles that make sense for a dock — you cannot drag an outer edge. */
export function handlesFor(dock: Dock): string[] {
  switch (dock) {
    case "left":
      return ["e"];
    case "right":
      return ["w"];
    case "top":
      return ["s"];
    case "bottom":
      return ["n"];
    case "tl":
      return ["e", "s", "se"];
    case "tr":
      return ["w", "s", "sw"];
    case "bl":
      return ["e", "n", "ne"];
    case "br":
      return ["w", "n", "nw"];
    case "full":
      return [];
    default:
      return ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  }
}
