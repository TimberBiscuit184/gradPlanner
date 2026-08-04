import { useDraggable } from "@dnd-kit/core";
import {
  applyNodeChanges,
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COURSES, COURSE_BY_ID } from "../data";
import { EMPHASES } from "../data/emphases";
import { CLUSTERS, clusterOf } from "../engine/clusters";
import { geGroupOf, geGroups } from "../engine/geGroups";
import {
  isAtRisk,
  prereqDepth,
  prereqLeaves,
  programsContaining,
  transitiveAncestorsOf,
  transitiveDescendantsOf,
} from "../engine/plan";
import { requiredCourseIds } from "../engine/requirements";
import { useModel } from "../model";
import { usePlan } from "../store";

const NODE_W = 168;
const NODE_H = 56;
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

/** Emphasis highlight set: the emphasis's courses plus their prereq ancestors. */
function emphasisSet(emphasisId: string | null): Set<string> | null {
  if (!emphasisId) return null;
  const e = EMPHASES.find((x) => x.id === emphasisId);
  if (!e) return null;
  const out = new Set<string>();
  const addWithAncestors = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    const c = COURSE_BY_ID.get(id);
    if (!c) return;
    for (const p of prereqLeaves(c.prereq)) addWithAncestors(p);
    for (const q of c.coreq) addWithAncestors(q);
  };
  [...e.supplemental, ...e.core].forEach(addWithAncestors);
  return out;
}

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
  const emphasis = usePlan((s) => s.emphasis);
  const picking = usePlan((s) => s.picking);
  const wished = usePlan((s) => s.wishlist.includes(courseId));
  const toggleWish = usePlan((s) => s.toggleWish);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `node-${courseId}`,
    data: { kind: "course", courseId },
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

  const emphSet = useMemo(() => emphasisSet(emphasis), [emphasis]);

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
      ? "opacity-40 border-line bg-surface"
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
    statusClass = "border-line/60 bg-surface opacity-25 border-dotted";
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
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => {
        // keep React Flow from panning the canvas with the drag
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
        (listeners?.onKeyDown as ((ev: unknown) => void) | undefined)?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) {
          if (picking) toggleWish(courseId);
          else {
            select(courseId);
            setDownstream(courseId);
          }
        }
      }}
      className={`focus-ring nodrag nopan flex flex-col justify-center rounded-lg border-2 px-2.5 transition-opacity duration-200 ${statusClass} ${
        atRisk && !whatBreaks && relation === null
          ? `!border-warn ${!course.verified ? "border-dashed" : ""}`
          : ""
      } ${relationTint} ${warnTint} ${
        wished ? "!border-planned ring-2 ring-planned" : ""
      } ${
        !isObsolete && (!inHighlight || !inLens || !inEmph) ? "!opacity-[0.15]" : ""
      } ${isDragging ? "opacity-40" : ""} ${
        picking ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
      }`}
      style={{ width: NODE_W, height: NODE_H, touchAction: "none" }}
      title={`${course.title}${
        isObsolete
          ? "\nNot needed — a different option already satisfies this requirement."
          : ""
      }${required ? "\n★ Required — no alternative satisfies this requirement." : ""}${
        bottleneck ? `\n⧗ Bottleneck: ${bottleneck.reasons.join("; ")}` : ""
      }\n${d.flags.map((f) => f.text).join("\n")}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-line !border-0" />
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
        {atRisk && <span className="text-warn text-xs">⚠</span>}
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

/**
 * Layout: the connected prerequisite graph (dagre), then a "Major electives"
 * grid, then one collapsible grid per GE group (they need little planning, so
 * they start collapsed).
 */
function layoutGraph(collapsed: string[]): { nodes: Node[]; edges: Edge[] } {
  const real = COURSES.filter((c) => !c.isPlaceholder);

  const connected = new Set<string>();
  for (const c of real) {
    const deps = [...new Set([...prereqLeaves(c.prereq), ...c.coreq])].filter(
      (p) => COURSE_BY_ID.has(p),
    );
    if (deps.length) connected.add(c.id);
    deps.forEach((p) => connected.add(p));
  }

  const graphCourses = real.filter((c) => connected.has(c.id));
  const standalone = real.filter((c) => !connected.has(c.id));
  const majorStandalone = standalone.filter((c) =>
    programsContaining(c.id).some((p) => p.type !== "general-education"),
  );
  const geStandalone = standalone.filter((c) => !majorStandalone.includes(c));

  // All dependency edges, drawn regardless of which cluster each end sits in.
  const edges: Edge[] = [];
  for (const c of graphCourses) {
    for (const p of new Set(prereqLeaves(c.prereq))) {
      if (!COURSE_BY_ID.has(p)) continue;
      edges.push({
        id: `${p}->${c.id}`,
        source: p,
        target: c.id,
        style: c.verified
          ? { stroke: "#3f4552", strokeWidth: 1.5 }
          : { stroke: "#8a6d1f", strokeWidth: 1.5, strokeDasharray: "6 4" },
      });
    }
    for (const q of c.coreq) {
      if (!COURSE_BY_ID.has(q)) continue;
      edges.push({
        id: `${q}=>${c.id}`,
        source: q,
        target: c.id,
        style: { stroke: "#1f6a63", strokeWidth: 1.2, strokeDasharray: "2 3" },
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
  for (const cluster of CLUSTERS) {
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
     * Columns come from the *global* prerequisite depth, so a course sitting
     * four prerequisites deep is drawn four columns right even when its
     * prerequisites live in another cluster. Dagre ranks only within its own
     * subgraph, which made advanced electives like ECEN 351 look like
     * entry-level courses.
     */
    const byDepth = new Map<number, typeof members>();
    for (const c of members) {
      const d = prereqDepth(c.id);
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(c);
    }

    const top = y + 52;
    const rowGap = NODE_H + 16;
    const placed = new Map<string, number>(); // courseId -> row index
    let rows = 0;

    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
      const column = byDepth.get(depth)!;
      // Order each column near its prerequisites (barycenter of already-placed
      // parents) so the connecting lines stay short and mostly untangled.
      const scored = column.map((c) => {
        const parents = [...new Set([...prereqLeaves(c.prereq), ...c.coreq])]
          .map((p) => placed.get(p))
          .filter((v): v is number => v !== undefined);
        return {
          c,
          key: parents.length
            ? parents.reduce((s, v) => s + v, 0) / parents.length
            : Number.POSITIVE_INFINITY,
        };
      });
      scored.sort(
        (a, b) => a.key - b.key || a.c.id.localeCompare(b.c.id),
      );
      scored.forEach(({ c }, i) => {
        placed.set(c.id, i);
        nodes.push({
          id: c.id,
          type: "course",
          position: {
            x: 20 + depth * (NODE_W + 90),
            y: top + i * rowGap,
          },
          data: { courseId: c.id },
          draggable: false,
          width: NODE_W,
          height: NODE_H,
        });
      });
      rows = Math.max(rows, column.length);
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
  { cls: "bg-warn", label: "at-risk" },
];

export function Tree() {
  const collapsed = usePlan((s) => s.collapsedGroups);
  const { nodes, edges } = useMemo(() => layoutGraph(collapsed), [collapsed]);
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

  const centerOn = (x: number, y: number, zoom: number) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setViewport({
      x: box.width / 2 - x * zoom,
      y: box.height / 2 - y * zoom,
      zoom,
    });
  };

  // Initial view: frame the prerequisite graph (the part worth looking at).
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
          stroke: isDown ? "#fbbf24" : "#a78bfa",
          strokeWidth: 2,
          opacity: 1,
        },
        animated: true,
      };
    });
  }, [edges, downstreamRoot]);

  return (
    <div ref={wrapRef} className="relative h-full bg-bg-deep">
      <ReactFlow
        nodes={rfNodes}
        onNodesChange={onNodesChange}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnScroll
        panOnDrag
        minZoom={0.1}
        viewport={viewport}
        onViewportChange={setViewport}
        onPaneClick={() => setDownstream(null)}
        proOptions={{ hideAttribution: false }}
      >
        <Background color="#232732" gap={28} />
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
