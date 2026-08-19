/**
 * Column and row placement for the prerequisite tree.
 *
 * The tree used to take its columns straight from `prereqDepth` — a global
 * measure over the whole catalogue — and order rows with one forward
 * barycentre pass. Measuring the result (`npm run tree:stats`) showed why
 * Nursing and Statistics were unreadable, and it was not what it looked like:
 *
 *  - **14 prerequisite edges in each were drawn inside a single column.**
 *    A global depth does not have to increase along the edges this particular
 *    tree draws, so a prerequisite could land level with the course that needs
 *    it. On screen that is a horizontal line between two stacked boxes, which
 *    reads as "these are related somehow" rather than "this one comes first".
 *  - **Corequisites were drawn as two arrows and ordered apart.** BIO 221 and
 *    BIO 222 each list the other, so the graph had 221→222 *and* 222→221, and
 *    nothing kept the pair adjacent. Nursing pairs every lecture with its
 *    clinical this way, which is most of that hairball.
 *
 * So: columns are a longest-path over the prerequisite edges actually present,
 * which guarantees every prerequisite sits strictly left of its dependent;
 * corequisites do not affect columns at all, and are pulled together in the
 * row ordering instead.
 */

export interface LayoutInput {
  /** Prerequisites — these set the columns. Only in-scope ids. */
  parentsOf: (id: string) => string[];
  /** Corequisites — same term by definition, so they never change a column. */
  peersOf?: (id: string) => string[];
}

export interface LayoutOptions {
  /** Barycentre passes. `0` reproduces the original single forward pass. */
  sweeps?: number;
  /** `false` reproduces the original global-depth columns, for comparison. */
  longestPath?: boolean;
  /** Fallback column when longestPath is off. */
  depthOf?: (id: string) => number;
}

export interface Placement {
  col: number;
  row: number;
}
export type Layout = Map<string, Placement>;

/**
 * Columns by longest path. A course sits one column right of its deepest
 * prerequisite, so every drawn prerequisite edge points strictly rightwards.
 * Cycles (a course listing a descendant, which the catalogue does contain)
 * stop at the visited set rather than looping.
 */
function columnsByLongestPath(
  ids: string[],
  parentsOf: (id: string) => string[],
): Map<string, number> {
  const present = new Set(ids);
  const col = new Map<string, number>();
  const visiting = new Set<string>();

  const depth = (id: string): number => {
    const done = col.get(id);
    if (done !== undefined) return done;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let best = 0;
    for (const p of parentsOf(id)) {
      if (!present.has(p) || p === id) continue;
      best = Math.max(best, depth(p) + 1);
    }
    visiting.delete(id);
    col.set(id, best);
    return best;
  };

  for (const id of ids) depth(id);
  return col;
}

/** Edge crossings, counted exactly, between each pair of adjacent columns. */
export function countCrossings(
  ids: string[],
  layout: Layout,
  parentsOf: (id: string) => string[],
): number {
  const present = new Set(ids);
  const bySpan = new Map<string, { from: number; to: number }[]>();
  for (const id of ids) {
    const to = layout.get(id);
    if (!to) continue;
    for (const p of parentsOf(id)) {
      if (!present.has(p)) continue;
      const from = layout.get(p);
      if (!from) continue;
      const key = `${from.col}->${to.col}`;
      if (!bySpan.has(key)) bySpan.set(key, []);
      bySpan.get(key)!.push({ from: from.row, to: to.row });
    }
  }
  let n = 0;
  for (const edges of bySpan.values())
    for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        const a = edges[i];
        const b = edges[j];
        if ((a.from - b.from) * (a.to - b.to) < 0) n++;
      }
  return n;
}

/** Prerequisite edges that do not point rightwards — always a layout fault. */
export function countFlatEdges(
  ids: string[],
  layout: Layout,
  parentsOf: (id: string) => string[],
): number {
  const present = new Set(ids);
  let n = 0;
  for (const id of ids) {
    const to = layout.get(id);
    if (!to) continue;
    for (const p of parentsOf(id)) {
      if (!present.has(p) || p === id) continue;
      const from = layout.get(p);
      if (from && from.col >= to.col) n++;
    }
  }
  return n;
}

/**
 * Choose the column assignment per cluster, on evidence.
 *
 * Longest-path columns guarantee no backwards edges, but they are not free:
 * they push courses further right, which puts more edges between the same pair
 * of columns and can raise crossings. In Nursing's Core — 18 courses, the
 * lecture/clinical block — the global depth already had zero backwards edges,
 * so longest-path bought nothing there and cost 30 crossings. The backwards
 * edges were in other clusters entirely.
 *
 * So: correctness first, readability second. Take whichever assignment has
 * fewer backwards edges; if they tie, take the one with fewer crossings.
 */
export function layoutColumns(
  ids: string[],
  input: LayoutInput,
  opts: LayoutOptions = {},
): Layout {
  if (opts.depthOf && opts.longestPath !== false) {
    const present = new Set(ids);
    const parents = (id: string) =>
      input.parentsOf(id).filter((p) => present.has(p) && p !== id);
    const a = layoutOne(ids, input, { ...opts, longestPath: true });
    const b = layoutOne(ids, input, { ...opts, longestPath: false });
    const fa = countFlatEdges(ids, a, parents);
    const fb = countFlatEdges(ids, b, parents);
    if (fa !== fb) return fa < fb ? a : b;
    return countCrossings(ids, a, parents) <= countCrossings(ids, b, parents) ? a : b;
  }
  return layoutOne(ids, input, opts);
}

function layoutOne(
  ids: string[],
  input: LayoutInput,
  opts: LayoutOptions = {},
): Layout {
  const sweeps = opts.sweeps ?? 8;
  const present = new Set(ids);
  const parents = (id: string) =>
    input.parentsOf(id).filter((p) => present.has(p) && p !== id);
  const peers = (id: string) =>
    (input.peersOf?.(id) ?? []).filter((p) => present.has(p) && p !== id);

  const col =
    opts.longestPath === false && opts.depthOf
      ? new Map(ids.map((id) => [id, opts.depthOf!(id)]))
      : columnsByLongestPath(ids, parents);

  const byCol = new Map<number, string[]>();
  for (const id of ids) {
    const c = col.get(id) ?? 0;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(id);
  }
  for (const list of byCol.values()) list.sort();
  const cols = [...byCol.keys()].sort((a, b) => a - b);

  const children = new Map<string, string[]>();
  for (const id of ids)
    for (const p of parents(id)) {
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(id);
    }

  const row = new Map<string, number>();
  const pack = (): Layout => {
    const out: Layout = new Map();
    for (const id of ids) out.set(id, { col: col.get(id) ?? 0, row: row.get(id) ?? 0 });
    return out;
  };

  // Pass 0 — the original forward ordering, and the baseline to beat.
  for (const c of cols) {
    const scored = byCol.get(c)!.map((id) => {
      const seen = parents(id)
        .map((p) => row.get(p))
        .filter((v): v is number => v !== undefined);
      return {
        id,
        key: seen.length
          ? seen.reduce((s, v) => s + v, 0) / seen.length
          : Number.POSITIVE_INFINITY,
      };
    });
    scored.sort((a, b) => a.key - b.key || a.id.localeCompare(b.id));
    scored.forEach(({ id }, i) => row.set(id, i));
  }

  let best = pack();
  let bestScore = countCrossings(ids, best, parents);

  const sweep = (order: number[], forward: boolean) => {
    for (const c of order) {
      const scored = byCol.get(c)!.map((id) => {
        const seen = (forward ? parents(id) : (children.get(id) ?? []))
          .map((n) => row.get(n))
          .filter((v): v is number => v !== undefined);
        let key = seen.length
          ? seen.reduce((s, v) => s + v, 0) / seen.length
          : (row.get(id) ?? 0);
        /**
         * Corequisites share a key, so the pair sorts to the same place and
         * lands adjacent — a lecture and its clinical end up side by side with
         * a short link instead of at opposite ends of the column.
         */
        const co = peers(id)
          .map((p) => row.get(p))
          .filter((v): v is number => v !== undefined);
        if (co.length) key = (key + co.reduce((s, v) => s + v, 0) / co.length) / 2;
        return { id, key };
      });
      scored.sort((a, b) => a.key - b.key || a.id.localeCompare(b.id));
      scored.forEach(({ id }, i) => row.set(id, i));
    }
  };

  /**
   * Transpose: swap adjacent rows whenever it removes crossings.
   *
   * Barycentre alone was not enough here. Fixing the columns so prerequisites
   * point rightwards moved nodes into different columns, which *raised*
   * Nursing's crossings from 127 to 157 — a real regression traded for the
   * backwards-edge fix. This is the standard Sugiyama companion pass, and it
   * is what actually pulls the count down: it keeps swapping neighbours until
   * no single swap helps.
   */
  /**
   * Each candidate swap re-counts every crossing, which is quadratic in edges.
   * That is nothing on a 20-course cluster and unusable on General Studies,
   * whose subject-code pools put 448 courses in a single column. Above the
   * cap the barycentre sweeps still run; only this refinement is skipped.
   */
  const tooBigToTranspose = ids.length > 80;

  const transpose = () => {
    if (tooBigToTranspose) return;
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 24) {
      improved = false;
      for (const c of cols) {
        const column = byCol.get(c)!.slice().sort((a, b) => row.get(a)! - row.get(b)!);
        for (let i = 0; i + 1 < column.length; i++) {
          const a = column[i];
          const b = column[i + 1];
          const before = countCrossings(ids, pack(), parents);
          const ra = row.get(a)!;
          const rb = row.get(b)!;
          row.set(a, rb);
          row.set(b, ra);
          if (countCrossings(ids, pack(), parents) < before) {
            improved = true;
            column[i] = b;
            column[i + 1] = a;
          } else {
            row.set(a, ra);
            row.set(b, rb);
          }
        }
      }
    }
  };

  const down = [...cols];
  const up = [...cols].reverse();
  for (let i = 0; i < sweeps; i++) {
    sweep(i % 2 === 0 ? down : up, i % 2 === 0);
    transpose();
    const score = countCrossings(ids, pack(), parents);
    if (score < bestScore) {
      bestScore = score;
      best = pack();
    }
  }
  return best;
}
