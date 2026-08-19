/* How readable is each degree's tree? — `npm run tree:stats [filter…]`
 *
 * "The stats and nursing ones are so confusing" is measurable. Two things make
 * a prerequisite graph hard to read, and they are not the same thing:
 *
 *   flat   a prerequisite drawn level with, or right of, the course that needs
 *          it — a backwards arrow, and always a layout fault
 *   cross  two edges that cross, which the eye has to trace past
 *
 * Both are counted for the ordering the tree used to use and the one it uses
 * now. Statistics turned out to have exactly one crossing and fourteen flat
 * edges, which is why fixing crossings alone did nothing for it.
 */
import { COURSES, COURSE_BY_ID, PROGRAMS } from "../src/data";
import { prereqLeaves, prereqDepth } from "../src/engine/plan";
import { relevantCourseIds, setActiveEnrollment } from "../src/engine/scope";
import { clusterOf, clusters } from "../src/engine/clusters";
import {
  countCrossings,
  countFlatEdges,
  layoutColumns,
} from "../src/engine/treeLayout";

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const majors = PROGRAMS.filter(
  (p) => p.type === "major" && (!only.length || only.some((o) => p.label.includes(o))),
);

const inScope = (id: string) => COURSE_BY_ID.has(id);
const prereqsOf = (id: string) => {
  const c = COURSE_BY_ID.get(id);
  return c ? [...new Set(prereqLeaves(c.prereq))].filter(inScope) : [];
};
const coreqsOf = (id: string) => {
  const c = COURSE_BY_ID.get(id);
  return c ? [...new Set(prereqLeaves(c.coreq))].filter(inScope) : [];
};

interface Row {
  label: string;
  nodes: number;
  flatBefore: number;
  flatAfter: number;
  crossBefore: number;
  crossAfter: number;
}
const rows: Row[] = [];

for (const program of majors) {
  setActiveEnrollment([program.id]);
  const scope = relevantCourseIds();
  const real = COURSES.filter((c) => !c.isPlaceholder && scope.has(c.id));
  const connected = new Set<string>();
  for (const c of real) {
    const deps = [...prereqsOf(c.id), ...coreqsOf(c.id)];
    if (deps.length) connected.add(c.id);
    deps.forEach((d) => connected.add(d));
  }
  const graph = real.filter((c) => connected.has(c.id)).map((c) => c.id);

  const input = { parentsOf: prereqsOf, peersOf: coreqsOf };
  let fb = 0, fa = 0, cb = 0, ca = 0;

  for (const cluster of clusters()) {
    const ids = graph.filter((id) => clusterOf(id) === cluster.id);
    if (ids.length < 2) continue;
    const present = new Set(ids);
    const parents = (id: string) => prereqsOf(id).filter((p) => present.has(p));

    const before = layoutColumns(ids, input, {
      sweeps: 0,
      longestPath: false,
      depthOf: prereqDepth,
    });
    const after = layoutColumns(ids, input, { depthOf: prereqDepth });

    fb += countFlatEdges(ids, before, parents);
    fa += countFlatEdges(ids, after, parents);
    cb += countCrossings(ids, before, parents);
    ca += countCrossings(ids, after, parents);
  }

  rows.push({
    label: program.label,
    nodes: graph.length,
    flatBefore: fb,
    flatAfter: fa,
    crossBefore: cb,
    crossAfter: ca,
  });
}

rows.sort((a, b) => b.flatBefore + b.crossBefore - (a.flatBefore + a.crossBefore));

console.log(`\nTree readability\n${"=".repeat(76)}`);
console.log(
  `${"degree".padEnd(38)}${"nodes".padStart(6)}${"flat".padStart(12)}${"crossings".padStart(16)}`,
);
for (const r of rows.slice(0, 16))
  console.log(
    r.label.slice(0, 36).padEnd(38) +
      String(r.nodes).padStart(6) +
      `${r.flatBefore}→${r.flatAfter}`.padStart(12) +
      `${r.crossBefore}→${r.crossAfter}`.padStart(16),
  );

const sum = (k: keyof Row) => rows.reduce((s, r) => s + (r[k] as number), 0);
const pct = (b: number, a: number) => (b ? Math.round(((b - a) / b) * 100) : 0);
console.log(
  `\n${rows.length} degrees` +
    `\n  backwards edges ${sum("flatBefore")} → ${sum("flatAfter")} (${pct(sum("flatBefore"), sum("flatAfter"))}% fewer)` +
    `\n  crossings       ${sum("crossBefore")} → ${sum("crossAfter")} (${pct(sum("crossBefore"), sum("crossAfter"))}% fewer)`,
);
/**
 * Report the size of a regression, not just its existence.
 *
 * The first version flagged any increase at all, which listed 31 degrees and
 * said nothing useful: every one of them had traded 3–27 backwards edges for
 * one to three extra crossings. A backwards arrow misstates the order of two
 * courses; a crossing is noise the eye steps over. Trading many of the first
 * for a few of the second is the point, so only a real regression — more
 * backwards edges, or crossings up by a visible margin — is worth a warning.
 */
const regressed = rows.filter(
  (r) =>
    r.flatAfter > r.flatBefore ||
    (r.crossAfter > r.crossBefore + 4 && r.flatBefore === r.flatAfter),
);
if (regressed.length) {
  console.log(`\nWARNING: ${regressed.length} degree(s) genuinely worse:`);
  for (const r of regressed)
    console.log(
      `  ${r.label.slice(0, 36).padEnd(38)} flat ${r.flatBefore}→${r.flatAfter}  crossings ${r.crossBefore}→${r.crossAfter}`,
    );
} else {
  const traded = rows.filter((r) => r.crossAfter > r.crossBefore);
  console.log(
    `\nno degree got worse overall` +
      (traded.length
        ? ` — ${traded.length} traded up to ${Math.max(
            ...traded.map((r) => r.crossAfter - r.crossBefore),
          )} crossing(s) for straight prerequisite arrows`
        : ""),
  );
}
console.log();
