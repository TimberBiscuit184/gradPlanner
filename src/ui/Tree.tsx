import { useDraggable } from "@dnd-kit/core";
import {
  applyNodeChanges,
  Background,
  Handle,
  PanOnScrollMode,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { COURSES, COURSE_BY_ID } from "../data";
import { relevantCourseIds } from "../engine/scope";
import { clusters, clusterOf } from "../engine/clusters";
import { geGroupOf, geGroups } from "../engine/geGroups";
import {
  isAtRisk,
  prereqDepth,
  dependencyIds,
  prereqLeaves,
  programsContaining,
  transitiveAncestorsOf,
  transitiveDescendantsOf,
} from "../engine/plan";
import { requiredCourseIds } from "../engine/requirements";
import { layoutColumns } from "../engine/treeLayout";
import { useModel } from "../model";
import { useProfile } from "../profileStore";
import { usePlan } from "../store";
import { useFocusSet } from "./useFocusSet";
import type { PrereqNode } from "../types";

const NODE_W = 168;
const NODE_H = 56;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.5;
/**
 * Wheel-zoom rate, per pixel of scroll. React Flow's d3-zoom default works out
 * to about 1.15× per 100px notch, which takes a dozen scrolls to cross this
 * graph. At 0.004 a notch is ~1.49×. Turn it up if that still feels slow —
 * this is the only knob.
 */
const ZOOM_SENSITIVITY = 0.004;
const LABEL_W = 760;
const LABEL_H = 52;

type TreeNodeData = { courseId: string };
type LabelNodeData = {
  text: string;
  sub?: string;
  toggleId?: string;
  collapsed?: boolean;
  count?: number;
};

function TreeNode({ data }: NodeProps<Node<TreeNodeData>>) {
  const { courseId } = data;
  const { model, bottlenecks, obsolete } = useModel();
  const course = COURSE_BY_ID.get(courseId)!;
  const d = model.derived.get(courseId)!;
  const select = usePlan((s) => s.select);
  const setDownstream = usePlan((s) => s.setDownstream);
  const downstreamRoot = usePlan((s) => s.downstreamRoot);
  const whatBreaks = usePlan((s) => s.whatBreaks);
  const lensPool = usePlan((s) => s.lensPool);
  const picking = usePlan((s) => s.picking);
  const wished = usePlan((s) => s.wishlist.includes(courseId));
  const toggleWish = usePlan((s) => s.toggleWish);
  const selected = usePlan((s) => s.selectedCourse);

  /**
   * Two-step drag: a course is only draggable once it is the selected node.
   * With listeners on every node, any pointer-down started a drag, so panning
   * the canvas kept picking courses up. Unselected nodes now let the pointer
   * event through to React Flow, which pans as expected.
   */
  const armed = selected === courseId && !picking;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `node-${courseId}`,
    data: { kind: "course", courseId },
    disabled: !armed,
  });

  // Selecting a node lights up both directions: what it needs first (upstream)
  // and what it unlocks (downstream), in distinct hues.
  const relation = useMemo(() => {
    if (!downstreamRoot) return null;
    if (courseId === downstreamRoot) return "root" as const;
    if (transitiveAncestorsOf(downstreamRoot).has(courseId))
      return "upstream" as const;
    if (transitiveDescendantsOf(downstreamRoot).has(courseId))
      return "downstream" as const;
    return "none" as const;
  }, [downstreamRoot, courseId]);

  const emphSet = useFocusSet();

  const isObsolete = obsolete.has(courseId);
  const inHighlight = relation === null || relation !== "none";
  const inLens = lensPool === null || lensPool.includes(courseId);
  const inEmph = emphSet === null || emphSet.has(courseId);
  const selectionActive = lensPool !== null || emphSet !== null;
  const inSelection =
    selectionActive &&
    (lensPool?.includes(courseId) || emphSet?.has(courseId) || false);
  const atRisk = !isObsolete && isAtRisk(courseId, model);
  const required = !isObsolete && requiredCourseIds().has(courseId);
  const bottleneck =
    !isObsolete && bottlenecks.find((b) => b.courseId === courseId);
  const plannedOcc = d.occurrences.find((o) =>
    ["planned", "registered", "in-progress"].includes(o.state),
  );

  // Tree mode is the atmospheric one: glow for available, dim for locked.
  // A locked course inside an active lens/emphasis selection gets a soft blue
  // hue so it reads apart from the dulled-out rest.
  let statusClass =
    d.status === "locked"
      ? "dim-obsolete border-line bg-surface"
      : d.status === "available"
        ? "node-available border-available/70 bg-surface"
        : d.status === "completed"
          ? "border-completed/70 bg-completed/15"
          : d.status === "in-progress"
            ? "border-inprogress/70 bg-inprogress/15"
            : d.status === "registered"
              ? "border-registered/70 bg-registered/15"
              : d.status === "planned"
                ? "border-planned/70 bg-planned/15"
                : "border-danger/70 bg-danger/10";
  if (d.status === "locked" && inSelection) {
    statusClass =
      "border-planned/60 bg-planned/10 opacity-95 shadow-[0_0_10px_rgba(79,140,255,0.15)]";
  }
  if (isObsolete) {
    statusClass = "border-line/60 bg-surface dim-locked border-dotted";
  }

  // "What breaks if I drop this?" recolors only the downstream side — the
  // prerequisites behind a course are unaffected by dropping it.
  const warnTint =
    whatBreaks && (relation === "downstream" || relation === "root")
      ? "!border-warn !bg-warn/15 shadow-[0_0_18px_rgba(245,158,11,0.25)]"
      : "";

  const relationTint =
    whatBreaks || relation === null
      ? ""
      : relation === "root"
        ? "!border-ink ring-2 ring-ink/70"
        : relation === "upstream"
          ? "!border-registered shadow-[0_0_16px_rgba(167,139,250,0.28)]"
          : relation === "downstream"
            ? "!border-available shadow-[0_0_16px_rgba(251,191,36,0.28)]"
            : "";

  return (
    <div
      ref={setNodeRef}
      {...(armed ? listeners : {})}
      {...attributes}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => {
        // Only an armed (selected) node swallows the pointer event. Otherwise
        // it falls through to React Flow so the drag pans the canvas.
        if (!armed) return;
        e.stopPropagation();
        (listeners?.onPointerDown as ((ev: unknown) => void) | undefined)?.(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (picking) {
          toggleWish(courseId);
          return;
        }
        select(courseId);
        setDownstream(courseId);
      }}
      onKeyDown={(e) => {
        // Space lifts the card, but only once Enter has selected it — same
        // two-step rule as the pointer, so arrow-key panning stays free.
        if (armed)
          (listeners?.onKeyDown as ((ev: unknown) => void) | undefined)?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) {
          if (picking) toggleWish(courseId);
          else {
            select(courseId);
            setDownstream(courseId);
          }
        }
      }}
      className={`focus-ring nodrag ${
        armed ? "nopan" : ""
      } relative flex flex-col justify-center rounded-lg border-2 px-2.5 transition-opacity duration-200 ${statusClass} ${
        atRisk && !whatBreaks && relation === null
          ? // node-at-risk kills the amber available pulse, so an at-risk
            // available node reads red rather than amber-on-amber.
            `node-at-risk !border-risk ${!course.verified ? "border-dashed" : ""}`
          : ""
      } ${relationTint} ${warnTint} ${
        wished ? "!border-planned ring-2 ring-planned" : ""
      } ${
        !isObsolete && (!inHighlight || !inLens || !inEmph) ? "dim-muted" : ""
      } ${isDragging ? "opacity-40" : ""} ${
        armed ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      }`}
      style={{ width: NODE_W, height: NODE_H, touchAction: "none" }}
      title={`${course.title}${
        isObsolete
          ? "\nNot needed — a different option already satisfies this requirement."
          : ""
      }${required ? "\n★ Required — no alternative satisfies this requirement." : ""}${
        bottleneck ? `\n⧗ Bottleneck: ${bottleneck.reasons.join("; ")}` : ""
      }\n${d.flags.map((f) => f.text).join("\n")}${
        armed
          ? "\nDrag to a semester to plan it."
          : "\nClick to see its connections; click again to drag it."
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-line !border-0" />
      {/* The card is only draggable once selected — say so, or nobody finds it. */}
      {armed && !isDragging && (
        <span
          className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1 text-[9px] font-medium leading-[13px] text-bg"
          aria-hidden
        >
          drag to a term
        </span>
      )}
      <div className="flex items-center gap-1.5">
        {picking && (
          <span
            className={`text-[11px] ${wished ? "text-planned" : "text-ink-faint"}`}
            aria-label={wished ? "selected" : "not selected"}
          >
            {wished ? "☑" : "☐"}
          </span>
        )}
        {required && (
          <span className="text-[11px] text-danger" aria-label="required">
            ★
          </span>
        )}
        <span className="font-mono text-[13px] font-bold">{course.code}</span>
        {d.status === "completed" && <span className="text-completed text-xs">✓</span>}
        {atRisk && <span className="text-risk text-xs">⚠</span>}
        {bottleneck && (
          <span className="text-[11px] text-warn" aria-label="bottleneck" title={bottleneck.reasons.join("; ")}>
            ⧗
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-ink-dim">
          {course.credits}cr
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-ink-dim">
        {isObsolete ? (
          <span className="italic text-ink-faint">not needed — option satisfied</span>
        ) : (
          <span className="truncate">{course.title}</span>
        )}
        {!isObsolete && d.directUnlocks.length > 0 && (
          <span
            className="ml-auto shrink-0 rounded bg-surface-2 px-1 font-mono text-available"
            title={`Directly unlocks ${d.directUnlocks.length}: ${d.directUnlocks.join(", ")}`}
          >
            +{d.directUnlocks.length}
          </span>
        )}
        {plannedOcc && (
          <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px]">
            {plannedOcc.termId}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-line !border-0" />
    </div>
  );
}

function LabelNode({ data }: NodeProps<Node<LabelNodeData>>) {
  const toggleGroup = usePlan((s) => s.toggleGroup);
  if (!data.toggleId) {
    return (
      <div className="pointer-events-none select-none">
        <div className="text-lg font-bold uppercase tracking-[0.2em] text-ink-dim/70">
          {data.text}
        </div>
        {data.sub && <div className="text-[11px] text-ink-faint">{data.sub}</div>}
      </div>
    );
  }
  return (
    <button
      className="focus-ring nodrag nopan select-none rounded px-1 text-left hover:bg-surface/60"
      onClick={(e) => {
        e.stopPropagation();
        toggleGroup(data.toggleId!);
      }}
      title={data.collapsed ? "Expand section" : "Collapse section"}
    >
      <div className="text-lg font-bold uppercase tracking-[0.2em] text-ink-dim/70">
        {data.collapsed ? "▸" : "▾"} {data.text}
        {data.collapsed && data.count !== undefined && (
          <span className="ml-2 text-sm font-normal normal-case tracking-normal text-ink-faint">
            {data.count} courses
          </span>
        )}
      </div>
      {data.sub && !data.collapsed && (
        <div className="text-[11px] text-ink-faint">{data.sub}</div>
      )}
    </button>
  );
}

const nodeTypes = { course: TreeNode, label: LabelNode };

/* Theme tokens, not literals — these strokes have to follow light/dark like
   everything else. SVG accepts var() for stroke and fill. */
const PREREQ_STROKE = "var(--color-edge)";
const COREQ_STROKE = "var(--color-edge-coreq)";

type EdgeKind = "required" | "alternative" | "coreq";

/**
 * Leaves reachable without passing through an OR — the prerequisites a course
 * genuinely cannot avoid. Everything else is one route among several.
 */
function requiredLeaves(node: PrereqNode, out: Set<string> = new Set()): Set<string> {
  if (node == null) return out;
  if (typeof node === "string") {
    out.add(node);
    return out;
  }
  if ("and" in node) node.and.forEach((k) => requiredLeaves(k, out));
  return out; // an OR branch is optional by definition
}

/**
 * Not every edge deserves the same ink. Half the prerequisite edges are OR
 * alternatives the student will never use, and half cross between clusters,
 * where the two ends can sit 2,600px apart — drawn at equal weight they bury
 * the chain you actually care about. Alternatives go dashed, long-distance
 * edges go faint, and selecting a node restores everything in its neighbourhood
 * to full strength.
 */
function edgeStyle(kind: EdgeKind, cross: boolean): CSSProperties {
  const base =
    kind === "coreq"
      ? { stroke: COREQ_STROKE, strokeWidth: 1.2, strokeDasharray: "2 3" }
      : kind === "alternative"
        ? { stroke: PREREQ_STROKE, strokeWidth: 1.2, strokeDasharray: "5 5" }
        : { stroke: PREREQ_STROKE, strokeWidth: 1.5 };
  const opacity = cross
    ? kind === "required"
      ? 0.22
      : 0.1
    : kind === "alternative"
      ? 0.45
      : 1;
  return { ...base, opacity };
}

/**
 * Layout: the connected prerequisite graph (dagre), then a "Major electives"
 * grid, then one collapsible grid per GE group (they need little planning, so
 * they start collapsed).
 */
function layoutGraph(
  collapsed: string[],
  placedIds: ReadonlySet<string>,
): { nodes: Node[]; edges: Edge[] } {
  // The tree draws the planning scope, not the catalogue. Rendering all 2,031
  // harvested courses is both unreadable and beside the point — the graph
  // exists to show *your* prerequisite chains. Search and the picker still
  // reach every course.
  const scope = relevantCourseIds();
  const real = COURSES.filter(
    (c) =>
      !c.isPlaceholder &&
      // Scope, plus anything actually placed — planning a catalogue course from
      // the picker must put it on the graph, not leave it invisible.
      (scope.has(c.id) || placedIds.has(c.id)),
  );

  const connected = new Set<string>();
  for (const c of real) {
    const deps = dependencyIds(c).filter((p) => COURSE_BY_ID.has(p));
    if (deps.length) connected.add(c.id);
    deps.forEach((p) => connected.add(p));
  }

  const graphCourses = real.filter((c) => connected.has(c.id));
  const standalone = real.filter((c) => !connected.has(c.id));
  const majorStandalone = standalone.filter((c) =>
    programsContaining(c.id).some((p) => p.type !== "general-education"),
  );
  const geStandalone = standalone.filter((c) => !majorStandalone.includes(c));

  // All dependency edges, drawn regardless of which cluster each end sits in,
  // but weighted by how much each one matters (see edgeStyle).
  const edges: Edge[] = [];
  for (const c of graphCourses) {
    const must = requiredLeaves(c.prereq);
    for (const p of new Set(prereqLeaves(c.prereq))) {
      if (!COURSE_BY_ID.has(p)) continue;
      const kind: EdgeKind = must.has(p) ? "required" : "alternative";
      const cross = clusterOf(p) !== clusterOf(c.id);
      edges.push({
        id: `${p}->${c.id}`,
        source: p,
        target: c.id,
        data: { kind, cross },
        style: c.verified
          ? edgeStyle(kind, cross)
          : { stroke: "var(--color-edge-unverified)", strokeWidth: 1.5, strokeDasharray: "6 4" },
      });
    }
    for (const q of new Set(prereqLeaves(c.coreq))) {
      if (!COURSE_BY_ID.has(q)) continue;
      const cross = clusterOf(q) !== clusterOf(c.id);
      edges.push({
        id: `${q}=>${c.id}`,
        source: q,
        target: c.id,
        data: { kind: "coreq" as EdgeKind, cross },
        style: edgeStyle("coreq", cross),
      });
    }
  }

  // Every node carries explicit width/height: the layout is ours, so React Flow
  // never needs to measure the DOM (without this it leaves nodes
  // visibility:hidden and the viewport has no bounds to work with).
  const nodes: Node[] = [];

  const pushLabel = (
    id: string,
    y: number,
    text: string,
    sub: string,
    isCollapsed: boolean,
    count: number,
  ) => {
    nodes.push({
      id: `label-${id}`,
      type: "label",
      position: { x: 20, y },
      data: { text, sub, toggleId: id, collapsed: isCollapsed, count },
      draggable: false,
      selectable: false,
      // React Flow gives non-selectable nodes pointer-events:none, which made
      // these headings unclickable — force them back on.
      style: { pointerEvents: "all" },
      width: LABEL_W,
      height: LABEL_H,
    });
  };

  // Each cluster gets its own dagre run over only its internal edges, so
  // related chains stay tight instead of being interleaved with everything else.
  let y = 0;
  for (const cluster of clusters()) {
    const members = graphCourses.filter((c) => clusterOf(c.id) === cluster.id);
    if (!members.length) continue;
    const isCollapsed = collapsed.includes(cluster.id);
    pushLabel(
      cluster.id,
      y,
      cluster.label,
      cluster.sub,
      isCollapsed,
      members.length,
    );
    if (isCollapsed) {
      y += 74;
      continue;
    }

    /**
     * Columns and rows both come from `layoutColumns`.
     *
     * Columns used to be the *global* `prereqDepth`, ordered by a single
     * forward barycentre pass. Measuring that (`npm run tree:stats`) found 107
     * prerequisite edges across the degrees checked drawn level with — or
     * right of — the course that needed them. A backwards arrow is worse than
     * a crossing: a crossing is noise, but an arrow pointing the wrong way
     * says something untrue about which course comes first.
     *
     * Corequisites were also drawn as two arrows between courses that nothing
     * kept adjacent, which is most of what made Nursing's lecture/clinical
     * block a hairball. They now share a row key and land side by side.
     */
    const inScope = (id: string) => COURSE_BY_ID.has(id);
    const placement = layoutColumns(
      members.map((c) => c.id),
      {
        parentsOf: (id) => {
          const c = COURSE_BY_ID.get(id);
          return c ? [...new Set(prereqLeaves(c.prereq))].filter(inScope) : [];
        },
        peersOf: (id) => {
          const c = COURSE_BY_ID.get(id);
          return c ? [...new Set(prereqLeaves(c.coreq))].filter(inScope) : [];
        },
      },
      { depthOf: prereqDepth },
    );

    const top = y + 52;
    const rowGap = NODE_H + 16;
    let rows = 0;

    for (const c of members) {
      const at = placement.get(c.id) ?? { col: 0, row: 0 };
      nodes.push({
        id: c.id,
        type: "course",
        position: {
          x: 20 + at.col * (NODE_W + 90),
          y: top + at.row * rowGap,
        },
        data: { courseId: c.id },
        draggable: false,
        width: NODE_W,
        height: NODE_H,
      });
      rows = Math.max(rows, at.row + 1);
    }
    y = top + rows * rowGap + 48;
  }

  const grid = (
    courses: typeof real,
    label: string,
    sub: string,
    startY: number,
    groupId: string,
  ): number => {
    if (!courses.length) return startY;
    const isCollapsed = collapsed.includes(groupId);
    pushLabel(groupId, startY, label, sub, isCollapsed, courses.length);
    if (isCollapsed) return startY + 74;
    const perRow = 6;
    const gapX = NODE_W + 16;
    const gapY = NODE_H + 14;
    courses.forEach((c, i) => {
      nodes.push({
        id: c.id,
        type: "course",
        position: {
          x: 20 + (i % perRow) * gapX,
          y: startY + 48 + Math.floor(i / perRow) * gapY,
        },
        data: { courseId: c.id },
        draggable: false,
        width: NODE_W,
        height: NODE_H,
      });
    });
    return startY + 48 + Math.ceil(courses.length / perRow) * gapY + 40;
  };

  const sortByDept = (a: (typeof real)[number], b: (typeof real)[number]) =>
    a.dept.localeCompare(b.dept) || a.id.localeCompare(b.id);

  y = grid(
    [...majorStandalone].sort(sortByDept),
    "Major electives — no prerequisite chains",
    "Math & Science elective options and other standalone major courses",
    y,
    "major-standalone",
  );

  // GE split into its own groups, each collapsible
  const grouped = new Map<string, typeof real>();
  const other: typeof real = [];
  for (const c of geStandalone) {
    const grp = geGroupOf(c.id);
    if (!grp) {
      other.push(c);
      continue;
    }
    if (!grouped.has(grp.id)) grouped.set(grp.id, []);
    grouped.get(grp.id)!.push(c);
  }
  for (const grp of geGroups()) {
    const list = grouped.get(grp.id);
    if (!list?.length) continue;
    y = grid(
      list.sort(sortByDept),
      `GE · ${grp.label}`,
      "General Education — take any semester",
      y,
      grp.id,
    );
  }
  if (other.length) {
    grid(
      other.sort(sortByDept),
      "Other standalone",
      "Not tied to any requirement bucket (counts as general electives)",
      y,
      "other-standalone",
    );
  }

  // Collapsing a section removes its nodes — drop any edge that would dangle.
  const present = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: edges.filter((e) => present.has(e.source) && present.has(e.target)),
  };
}

const LEGEND: { cls: string; label: string }[] = [
  { cls: "bg-completed", label: "completed" },
  { cls: "bg-inprogress", label: "in progress" },
  { cls: "bg-registered", label: "registered" },
  { cls: "bg-planned", label: "planned" },
  { cls: "bg-available", label: "available" },
  { cls: "bg-ink-faint", label: "locked" },
  { cls: "bg-risk", label: "at-risk" },
];

export function Tree() {
  const collapsed = usePlan((s) => s.collapsedGroups);
  const placements = usePlan((s) => s.placements);
  const placedIds = useMemo(
    () => new Set(placements.map((p) => p.courseId)),
    [placements],
  );
  /**
   * Rebuild when the enrolment changes.
   *
   * `layoutGraph` reads the scope from `relevantCourseIds()`, which is module
   * state set from the enrolment — but this memo only listed `collapsed` and
   * `placedIds`, so picking a major never re-ran it. A new student opened the
   * tree with the pre-enrolment scope (three placeholders, i.e. empty), chose
   * their degree, and saw nothing happen; the graph then appeared to *grow* a
   * branch at a time, because planning a course changed `placedIds` and that
   * was the only thing that could refresh it.
   *
   * The tree is the planning tool. It has to show the whole degree the moment
   * the degree is known.
   */
  const enrolledIds = useProfile((s) => s.enrolledIds);
  const { nodes, edges } = useMemo(
    () => layoutGraph(collapsed, placedIds),
    [collapsed, placedIds, enrolledIds],
  );
  const setDownstream = usePlan((s) => s.setDownstream);
  const downstreamRoot = usePlan((s) => s.downstreamRoot);
  const focusCourse = usePlan((s) => s.focusCourse);
  const setFocusCourse = usePlan((s) => s.setFocusCourse);

  /**
   * The viewport is controlled here rather than via fitView/setCenter: every
   * coordinate comes from our own dagre layout, so centering is exact math and
   * does not depend on React Flow measuring the DOM first.
   */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const didFit = useRef(false);

  /**
   * A controlled `nodes` prop must also handle onNodesChange: React Flow writes
   * its measurements (and the handle positions edges are drawn from) back
   * through these changes. Without it the edge layer renders empty.
   */
  const [rfNodes, setRfNodes] = useState<Node[]>(nodes);
  useEffect(() => setRfNodes(nodes), [nodes]);
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setRfNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  /**
   * Our own ctrl/⌘ + wheel zoom. React Flow exposes no zoom-speed prop and its
   * d3-zoom default works out to roughly 1.15× per wheel notch, which takes a
   * dozen scrolls to cross this graph's range. The viewport is already
   * controlled here, so we do the math ourselves and zoom about the cursor.
   *
   * Registered natively with `passive: false` because React's synthetic wheel
   * listener is passive — preventDefault would be ignored — and in the capture
   * phase so it beats React Flow's own handler on the inner pane.
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // a plain wheel still pans
      e.preventDefault();
      e.stopPropagation();
      const box = el.getBoundingClientRect();
      const cx = e.clientX - box.left;
      const cy = e.clientY - box.top;
      // Normalize line/page wheels to pixels so a mouse and a trackpad agree.
      const dy =
        e.deltaMode === 1
          ? e.deltaY * 16
          : e.deltaMode === 2
            ? e.deltaY * box.height
            : e.deltaY;
      setViewport((v) => {
        const next = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, v.zoom * Math.exp(-dy * ZOOM_SENSITIVITY)),
        );
        const k = next / v.zoom;
        // Keep whatever is under the pointer pinned in place.
        return { zoom: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () =>
      el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  const centerOn = (x: number, y: number, zoom: number) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setViewport({
      x: box.width / 2 - x * zoom,
      y: box.height / 2 - y * zoom,
      zoom,
    });
  };

  /**
   * Frame the prerequisite graph — again, when the enrolment changes.
   *
   * A one-shot fit was right when the tree could only be built once. Now that
   * choosing a degree rebuilds it, the first fit may have framed an empty
   * canvas; without re-framing, the student's new tree is laid out somewhere
   * off-screen and the panel still looks blank.
   */
  useEffect(() => {
    didFit.current = false;
  }, [enrolledIds]);

  useEffect(() => {
    if (didFit.current || !nodes.length) return;
    didFit.current = true;
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const graph = nodes.filter((n) => n.type === "course");
    const maxX = Math.max(...graph.map((n) => n.position.x + NODE_W));
    const minX = Math.min(...graph.map((n) => n.position.x));
    const zoom = Math.min(1, Math.max(0.16, (box.width - 40) / (maxX - minX)));
    setViewport({ x: 24, y: 96 * zoom, zoom });
  }, [nodes]);

  // Search: center the found course (its group is expanded by the search box).
  useEffect(() => {
    if (!focusCourse) return;
    const node = nodes.find((n) => n.id === focusCourse);
    if (!node) return;
    centerOn(node.position.x + NODE_W / 2, node.position.y + NODE_H / 2, 1.1);
    setFocusCourse(null);
  }, [focusCourse, nodes, setFocusCourse]);

  const styledEdges = useMemo(() => {
    if (!downstreamRoot) return edges;
    const down = new Set(transitiveDescendantsOf(downstreamRoot));
    down.add(downstreamRoot);
    const up = new Set(transitiveAncestorsOf(downstreamRoot));
    up.add(downstreamRoot);
    return edges.map((e) => {
      const isDown = down.has(e.source) && down.has(e.target);
      const isUp = up.has(e.source) && up.has(e.target);
      if (!isDown && !isUp) return { ...e, style: { ...e.style, opacity: 0.1 } };
      return {
        ...e,
        // amber forward to what it unlocks, violet back to what it needs
        style: {
          ...e.style,
          stroke: isDown ? "var(--color-available)" : "var(--color-registered)",
          strokeWidth: 2,
          opacity: 1,
        },
        animated: true,
      };
    });
  }, [edges, downstreamRoot]);

  return (
    <div ref={wrapRef} className="relative h-full bg-bg-deep">
      {/* The graph draws the enrolled programs' courses. With none picked there
          is nothing to draw, and a blank canvas reads as a broken app rather
          than an empty one. */}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8">
          <div className="max-w-md rounded-lg border border-planned/50 bg-surface/95 px-4 py-3 text-center">
            <div className="text-sm font-semibold">No programs picked yet</div>
            <p className="mt-1 text-xs text-ink-dim">
              The tree shows the prerequisite chains for your major and minor.
              Choose them under{" "}
              <span className="font-mono text-ink">⋯ → Programs</span> and they
              will appear here.
            </p>
          </div>
        </div>
      )}
      <ReactFlow
        nodes={rfNodes}
        onNodesChange={onNodesChange}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        // The wheel scrolls the canvas instead of zooming — the graph is tall,
        // so scrolling to read it should not change the zoom out from under you.
        // Ctrl/⌘ + wheel still zooms, and pinch works on a trackpad.
        zoomOnScroll={false}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnPinch
        panOnDrag
        maxZoom={MAX_ZOOM}
        minZoom={MIN_ZOOM}
        viewport={viewport}
        onViewportChange={setViewport}
        onPaneClick={() => setDownstream(null)}
        proOptions={{ hideAttribution: false }}
      >
        <Background color="var(--color-canvas-dot)" gap={28} />
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface/85 px-2.5 py-1.5 text-[10px] text-ink-dim">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${l.cls}`} />
            {l.label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="text-danger">★</span> required
        </span>
        <span className="flex items-center gap-1">
          <span className="text-warn">⧗</span> bottleneck
        </span>
        <span className="flex items-center gap-1">
          <span className="border border-dotted border-line/80 px-0.5 text-ink-faint">
            ···
          </span>
          not needed
        </span>
        <span className="flex items-center gap-2 border-l border-line pl-3">
          <span className="flex items-center gap-1" title="A prerequisite you cannot avoid.">
            <svg width="18" height="4" aria-hidden>
              <line x1="0" y1="2" x2="18" y2="2" stroke={PREREQ_STROKE} strokeWidth="1.5" />
            </svg>
            required
          </span>
          <span
            className="flex items-center gap-1"
            title="One of several routes into this course — you only need one of them."
          >
            <svg width="18" height="4" aria-hidden>
              <line
                x1="0"
                y1="2"
                x2="18"
                y2="2"
                stroke={PREREQ_STROKE}
                strokeWidth="1.2"
                strokeDasharray="5 5"
              />
            </svg>
            alternative
          </span>
          <span
            className="flex items-center gap-1"
            title="Can be taken in the same semester as the course it points to."
          >
            <svg width="18" height="4" aria-hidden>
              <line
                x1="0"
                y1="2"
                x2="18"
                y2="2"
                stroke={COREQ_STROKE}
                strokeWidth="1.2"
                strokeDasharray="2 3"
              />
            </svg>
            corequisite
          </span>
          <span
            className="flex items-center gap-1 text-ink-faint"
            title="Edges between two sections are drawn faint so they don't bury the chain you're reading. Click a course to bring its own back to full strength."
          >
            <svg width="18" height="4" aria-hidden>
              <line
                x1="0"
                y1="2"
                x2="18"
                y2="2"
                stroke={PREREQ_STROKE}
                strokeWidth="1.5"
                opacity="0.22"
              />
            </svg>
            crosses sections
          </span>
        </span>
        {downstreamRoot && (
          <span className="flex items-center gap-2 border-l border-line pl-3">
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-registered" /> needed first
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-available" /> unlocks
            </span>
            <button
              className="focus-ring pointer-events-auto rounded border border-line px-1.5 text-ink-dim hover:text-ink"
              onClick={() => setDownstream(null)}
            >
              clear
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
