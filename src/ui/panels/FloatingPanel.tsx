import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePanels } from "./panelStore";
import {
  boxFor,
  DOCK_LABEL,
  handlesFor,
  insetsFor,
  MIN_H,
  MIN_W,
  radiusFor,
  zoneFor,
  type Dock,
  type Insets,
  type LayerRect,
  type PanelGeom,
} from "./snap";

/* ------------------------------------------------------------------ layer */

interface Layer {
  rect: LayerRect;
  ref: React.RefObject<HTMLDivElement | null>;
}

const LayerCtx = createContext<Layer>({
  rect: { width: 0, height: 0 },
  ref: { current: null },
});

/**
 * The region panels live in — everything below the header and above the
 * semester rail. Panels are positioned against *this* box rather than the
 * viewport, so "dock left" means the left of the workspace and never slides
 * under the header.
 */
export function PanelHost({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<LayerRect>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setRect((r) =>
        r.width === el.clientWidth && r.height === el.clientHeight
          ? r
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // ResizeObserver is the fast path but it is not the only one: it does not
    // fire in a background tab, and in dev Vite injects the stylesheet *after*
    // the first layout, so the very first measurement can land on an unstyled,
    // zero-height box. A short catch-up and a resize listener cover both
    // without leaving a permanently wrong layout behind.
    window.addEventListener("resize", measure);
    let ticks = 0;
    const catchUp = window.setInterval(() => {
      measure();
      if (++ticks > 20) window.clearInterval(catchUp);
    }, 50);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.clearInterval(catchUp);
    };
  }, []);

  const value = useMemo<Layer>(() => ({ rect, ref }), [rect]);

  return (
    <div ref={ref} className="relative flex min-h-0 flex-1">
      <LayerCtx.Provider value={value}>
        {children}
        <SnapPreview />
      </LayerCtx.Provider>
    </div>
  );
}

/**
 * How much room the docked panels are taking. The main view reads this and
 * shrinks, which is the difference between docking and merely covering.
 */
export function usePanelInsets(): Insets {
  const { rect } = useContext(LayerCtx);
  const geom = usePanels((s) => s.geom);
  const open = usePanels((s) => s.open);
  return useMemo(
    () =>
      insetsFor(
        open.map((id) => geom[id]).filter((g): g is PanelGeom => !!g),
        rect,
      ),
    [open, geom, rect],
  );
}

/** The translucent target that appears under the cursor mid-drag. */
function SnapPreview() {
  const { rect } = useContext(LayerCtx);
  const zone = usePanels((s) => s.zone);
  const owner = usePanels((s) => s.zoneOwner);
  const geom = usePanels((s) => s.geom);
  if (!zone || !owner) return null;
  const g = geom[owner];
  if (!g) return null;
  const box = boxFor({ ...g, dock: zone }, rect);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-30 flex items-center justify-center border-2 border-planned bg-planned/10 transition-all duration-100 ease-out"
      style={{ ...box, borderRadius: radiusFor(zone) }}
    >
      <span className="rounded bg-planned/90 px-2 py-0.5 text-[11px] font-medium text-bg shadow-lg">
        {DOCK_LABEL[zone]}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Runs a pointer gesture off `window` listeners rather than
 * `setPointerCapture`.
 *
 * Capture looked like the tidier option and does not work here: only the first
 * `pointermove` after the capture arrived, so a dragged panel jumped once and
 * then froze under the cursor. Listening on the window has no such problem, and
 * it also survives the panel re-rendering into a different branch mid-drag —
 * which the picker does every time you open a course.
 *
 * Every handler works from a snapshot taken at pointer-down. Nothing else
 * mutates a panel's geometry while you are dragging it, so a snapshot is both
 * simpler than chasing the latest render and immune to stale-closure bugs.
 */
function beginGesture(
  onMove: (e: PointerEvent) => void,
  onEnd: (e: PointerEvent) => void,
) {
  const move = (e: PointerEvent) => onMove(e);
  const end = (e: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    onEnd(e);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

export interface FloatingPanelProps {
  id: string;
  /** Only applied the first time this panel is ever opened. */
  initial: PanelGeom;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Rendered left of the title — a back button, a status dot. */
  headerLeft?: ReactNode;
  /** Rendered right of the title, before the layout controls. */
  headerRight?: ReactNode;
  onClose?: () => void;
  /** Pinned under the scrolling body. */
  footer?: ReactNode;
  /** Pinned above the scrolling body — search boxes, tabs, filter chips. */
  toolbar?: ReactNode;
  label: string;
  children: ReactNode;
}

/**
 * A draggable, dockable, resizable panel.
 *
 * Everything the app used to render as a fixed overlay in a hard-coded corner
 * goes through this: the requirements rail, the course detail, the add-course
 * picker. They were three different pieces of positioning code with three
 * different behaviours; now they are one, and the user decides where each of
 * them lives.
 *
 * Drag the header to move. Near an edge a preview appears — release to snap.
 * Release in open space and the panel stays exactly where it was dropped.
 */
export function FloatingPanel({
  id,
  initial,
  title,
  subtitle,
  headerLeft,
  headerRight,
  onClose,
  footer,
  toolbar,
  label,
  children,
}: FloatingPanelProps) {
  const { rect, ref: layerRef } = useContext(LayerCtx);
  const geom = usePanels((s) => s.geom[id]);
  const order = usePanels((s) => s.order);
  const setGeom = usePanels((s) => s.setGeom);
  const raise = usePanels((s) => s.raise);
  const register = usePanels((s) => s.register);
  const unregister = usePanels((s) => s.unregister);
  const previewZone = usePanels((s) => s.previewZone);

  /** What double-clicking the header restores you to. */
  const lastDock = useRef<Dock>(initial.dock === "float" ? "right" : initial.dock);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    register(id, initial);
    return () => {
      unregister(id);
      previewZone(null, null);
    };
    // `initial` is a default, not a prop that should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const g = geom ?? initial;
  const box = boxFor(g, rect);
  const z = 20 + Math.max(0, order.indexOf(id));

  // Before the workspace has been measured every rectangle would be zero-sized.
  // Rendering nothing for that one frame beats flashing a collapsed panel.
  if (rect.width <= 0 || rect.height <= 0) return null;

  /** Layer-relative pointer position. Panels are positioned in this space. */
  const local = (e: { clientX: number; clientY: number }) => {
    const r = layerRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (r?.left ?? 0),
      y: e.clientY - (r?.top ?? 0),
    };
  };

  /* ---------------------------------------------------------------- move */

  const onHeaderDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Buttons and fields inside the header stay clickable; only the chrome drags.
    if ((e.target as HTMLElement).closest("button,input,select,textarea,a,[data-nodrag]"))
      return;
    raise(id);

    const g0 = g;
    const start = local(e);
    /** Where in the panel the pointer grabbed, as a fraction of its width. */
    const fx = box.width ? clamp((start.x - box.left) / box.width, 0, 1) : 0.5;
    /**
     * …and how far down, clamped to the header. Lifting a full-height docked
     * panel would otherwise teleport the cursor to its vertical middle.
     */
    const gy = clamp(start.y - box.top, 0, 34);
    const w = clamp(g0.w, MIN_W, Math.max(MIN_W, rect.width));
    let moved = false;

    beginGesture(
      (ev) => {
        if (!moved) {
          // A few pixels of slop, or every click on the title bar undocks.
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4)
            return;
          moved = true;
          setDragging(true);
          document.documentElement.classList.add("panel-dragging");
          if (g0.dock !== "float") lastDock.current = g0.dock;
        }
        const p = local(ev);
        setGeom(id, { ...g0, dock: "float", x: p.x - fx * w, y: p.y - gy });
        previewZone(id, zoneFor(p.x, p.y, rect));
      },
      (ev) => {
        document.documentElement.classList.remove("panel-dragging");
        setDragging(false);
        previewZone(null, null);
        if (!moved) return;
        const p = local(ev);
        const zone = zoneFor(p.x, p.y, rect);
        if (zone) {
          lastDock.current = zone;
          setGeom(id, { ...g0, dock: zone });
        }
      },
    );
  };

  /* -------------------------------------------------------------- resize */

  const onHandleDown = (dir: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    raise(id);

    const g0 = g;
    const w0 = box.width;
    const h0 = box.height;

    beginGesture(
      (ev) => {
        // A handle on the west or north side grows the panel when dragged
        // *away* from it, so the delta flips. Same rule docked or floating.
        const dw = dir.includes("e")
          ? ev.clientX - e.clientX
          : dir.includes("w")
            ? e.clientX - ev.clientX
            : 0;
        const dh = dir.includes("s")
          ? ev.clientY - e.clientY
          : dir.includes("n")
            ? e.clientY - ev.clientY
            : 0;

        if (g0.dock === "float") {
          const w = clamp(w0 + dw, MIN_W, rect.width);
          const h = clamp(h0 + dh, MIN_H, rect.height);
          setGeom(id, {
            ...g0,
            w,
            h,
            x: dir.includes("w") ? g0.x + (w0 - w) : g0.x,
            y: dir.includes("n") ? g0.y + (h0 - h) : g0.y,
          });
        } else {
          setGeom(id, {
            ...g0,
            fw: dw ? clamp((w0 + dw) / rect.width, 0.15, 0.85) : g0.fw,
            fh: dh ? clamp((h0 + dh) / rect.height, 0.15, 0.9) : g0.fh,
          });
        }
      },
      () => {},
    );
  };

  /* ---------------------------------------------------------------- view */

  const toggleDock = () => {
    if (g.dock === "float") {
      setGeom(id, { ...g, dock: lastDock.current });
    } else {
      lastDock.current = g.dock;
      setGeom(id, { ...g, dock: "float" });
    }
  };

  return (
    <section
      role="dialog"
      aria-label={label}
      onPointerDown={() => raise(id)}
      className={`absolute flex flex-col overflow-hidden border border-line bg-surface/95 shadow-2xl backdrop-blur-sm ${
        dragging ? "cursor-grabbing select-none opacity-90" : ""
      }`}
      style={{ ...box, zIndex: z, borderRadius: radiusFor(g.dock) }}
    >
      <header
        onPointerDown={onHeaderDown}
        onDoubleClick={toggleDock}
        title="Drag to move — release near an edge to dock. Double-click to dock or float."
        className={`flex shrink-0 items-start gap-2 border-b border-line bg-surface px-2.5 py-1.5 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        {headerLeft}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">{title}</div>
          {subtitle && (
            <div className="truncate text-[11px] leading-tight text-ink-dim">
              {subtitle}
            </div>
          )}
        </div>
        {headerRight}
        <DockMenu
          dock={g.dock}
          onPick={(dock) => {
            if (dock !== "float") lastDock.current = dock;
            setGeom(id, { ...g, dock });
          }}
        />
        {onClose && (
          <button
            onClick={onClose}
            className="focus-ring shrink-0 rounded px-1 text-ink-dim hover:bg-surface-2 hover:text-ink"
            aria-label={`Close ${label}`}
            title="Close (Esc)"
          >
            ✕
          </button>
        )}
      </header>

      {toolbar}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}

      {handlesFor(g.dock).map((dir) => (
        <div
          key={dir}
          onPointerDown={onHandleDown(dir)}
          className={`absolute ${HANDLE_CLASS[dir]}`}
          aria-hidden
        />
      ))}
    </section>
  );
}

/** Hit areas wide enough to grab without being wide enough to swallow clicks. */
const HANDLE_CLASS: Record<string, string> = {
  n: "left-2 right-2 top-0 h-1.5 cursor-ns-resize",
  s: "left-2 right-2 bottom-0 h-1.5 cursor-ns-resize",
  e: "top-2 bottom-2 right-0 w-1.5 cursor-ew-resize",
  w: "top-2 bottom-2 left-0 w-1.5 cursor-ew-resize",
  ne: "top-0 right-0 h-3 w-3 cursor-nesw-resize",
  nw: "top-0 left-0 h-3 w-3 cursor-nwse-resize",
  se: "bottom-0 right-0 h-3 w-3 cursor-nwse-resize",
  sw: "bottom-0 left-0 h-3 w-3 cursor-nesw-resize",
};

/**
 * The 3×3 zone picker. Dragging is the fast path once you know it exists; this
 * is how you find out that it does, and the only way to reach a zone by
 * keyboard.
 */
function DockMenu({
  dock,
  onPick,
}: {
  dock: Dock;
  onPick: (d: Dock) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const GRID: Dock[][] = [
    ["tl", "top", "tr"],
    ["left", "full", "right"],
    ["bl", "bottom", "br"],
  ];

  return (
    <div ref={wrap} className="relative shrink-0" data-nodrag>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Panel position"
        title={`Panel position — ${DOCK_LABEL[dock]}`}
        className={`focus-ring rounded px-1 text-xs leading-5 ${
          open ? "bg-surface-2 text-ink" : "text-ink-dim hover:bg-surface-2 hover:text-ink"
        }`}
      >
        ⛶
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 rounded-md border border-line bg-surface p-1.5 shadow-2xl"
        >
          <div className="grid grid-cols-3 gap-0.5">
            {GRID.flat().map((d) => (
              <button
                key={d}
                role="menuitem"
                onClick={() => {
                  onPick(d);
                  setOpen(false);
                }}
                title={DOCK_LABEL[d]}
                aria-label={DOCK_LABEL[d]}
                className={`h-5 w-7 rounded-sm border ${
                  dock === d
                    ? "border-planned bg-planned/40"
                    : "border-line bg-surface-2 hover:border-planned/60 hover:bg-planned/20"
                }`}
              />
            ))}
          </div>
          <button
            role="menuitem"
            onClick={() => {
              onPick("float");
              setOpen(false);
            }}
            className={`mt-1 w-full rounded px-1.5 py-0.5 text-[11px] ${
              dock === "float"
                ? "bg-planned/25 text-ink"
                : "text-ink-dim hover:bg-surface-2 hover:text-ink"
            }`}
          >
            Float
          </button>
        </div>
      )}
    </div>
  );
}
