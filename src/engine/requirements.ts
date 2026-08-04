import { AI_MINOR, COURSE_BY_ID, EE, GE_ABET, PROGRAM_BY_ID } from "../data";
import type { Bucket, Program } from "../types";
import type { PlanModel } from "./plan";

/**
 * Courses that are unconditionally required — members of an allOf pool in any
 * of the three programs. There is no alternative to these; the tree marks
 * them with the "required" badge.
 */
let REQUIRED_CACHE: Set<string> | null = null;
export function requiredCourseIds(): Set<string> {
  if (REQUIRED_CACHE) return REQUIRED_CACHE;
  const out = new Set<string>();
  for (const prog of [EE, AI_MINOR, GE_ABET]) {
    const walk = (b: Bucket): void => {
      if (b.rule.type === "allOf") b.pool?.forEach((id) => out.add(id));
      b.groups?.forEach(walk);
    };
    prog.buckets.forEach(walk);
  }
  REQUIRED_CACHE = out;
  return out;
}

/** Evaluation result for one bucket (recursive). */
export interface BucketEval {
  bucket: Bucket;
  satisfied: boolean;
  /** progress counter, unit depends on the rule */
  have: number;
  need: number;
  unit: "courses" | "credits" | "groups" | "program";
  /** counting courses used by this bucket (ids; placeholders may repeat) */
  used: string[];
  /** credits those used courses contribute */
  appliedCredits: number;
  children: BucketEval[];
  /** slack for nCredits rules: poolCredits − required (insight §6.5) */
  slack: number | null;
  label: string;
  /**
   * True when this bucket is an unchosen option of an nOfGroups whose quota is
   * already met (e.g. Foundational Math options 2 and 3 once Calculus I is
   * done) — its courses are no longer needed.
   */
  notNeeded: boolean;
  /** the bucket's own resolved pool (after sharedPoolId), for obsolete-course math */
  poolResolved: string[];
}

export interface ProgramEval {
  program: Program;
  buckets: BucketEval[];
  satisfied: boolean;
  appliedCredits: number;
}

const COUNTING = new Set(["completed", "in-progress", "registered", "planned"]);

interface Ctx {
  model: PlanModel;
  /** courses already claimed by a no-double-count allocation (sharedPoolId) */
  claimed: Map<string, string>; // courseId -> bucketId that claimed it
}

function countingInfo(ctx: Ctx, id: string): { active: boolean; instances: number; credits: number } {
  const d = ctx.model.derived.get(id);
  const c = COURSE_BY_ID.get(id);
  if (!d || !c) return { active: false, instances: 0, credits: 0 };
  if (c.isPlaceholder) {
    const n = d.occurrences.filter((o) => o.state === "planned").length;
    return { active: n > 0, instances: n, credits: c.credits };
  }
  const active = COUNTING.has(d.status);
  return { active, instances: active ? 1 : 0, credits: active ? (d.status === "completed" ? d.earnedCredits : c.credits) : 0 };
}

/** Find a bucket by id anywhere in a program (for sharedPoolId). */
function findBucket(p: Program, id: string): Bucket | null {
  const walk = (b: Bucket): Bucket | null => {
    if (b.id === id) return b;
    for (const g of b.groups ?? []) {
      const hit = walk(g);
      if (hit) return hit;
    }
    return null;
  };
  for (const b of p.buckets) {
    const hit = walk(b);
    if (hit) return hit;
  }
  return null;
}

export function evaluateProgram(
  program: Program,
  model: PlanModel,
  claimed?: Map<string, string>,
): ProgramEval {
  const ctx: Ctx = { model, claimed: claimed ?? new Map() };
  const buckets = program.buckets.map((b) => evalBucket(b, program, ctx));
  const satisfied = buckets.every((b) => b.satisfied);
  // fillTo buckets report the whole plan total; don't add that into the program sum.
  const appliedCredits = buckets
    .filter((b) => b.bucket.rule.type !== "fillTo")
    .reduce((s, b) => s + b.appliedCredits, 0);
  return { program, buckets, satisfied, appliedCredits };
}

/** Unnamed sub-buckets fall back to a readable pool summary instead of a raw id. */
function fallbackLabel(bucket: Bucket): string | null {
  const pool = bucket.pool ?? [];
  if (pool.length === 0 || pool.length > 3) return null;
  return pool.map((id) => COURSE_BY_ID.get(id)?.code ?? id).join(" + ");
}

function evalBucket(bucket: Bucket, program: Program, ctx: Ctx): BucketEval {
  const rule = bucket.rule;
  const label =
    bucket.label ?? fallbackLabel(bucket) ?? bucket.id ?? rule.type;
  // Resolve the pool, following sharedPoolId ("draws from another bucket's pool").
  let pool = bucket.pool ?? [];
  let noDoubleCount = bucket.allowDoubleCount === false;
  if (bucket.sharedPoolId) {
    const src = findBucket(program, bucket.sharedPoolId);
    pool = src?.pool ?? [];
    noDoubleCount = true;
  }

  const base: Omit<BucketEval, "satisfied" | "have" | "need" | "unit"> = {
    bucket,
    used: [],
    appliedCredits: 0,
    children: [],
    slack: null,
    label,
    notNeeded: false,
    poolResolved: pool,
  };

  const poolEntries = pool.map((id) => ({ id, ...countingInfo(ctx, id) }));
  const availableEntries = poolEntries.filter(
    (e) =>
      e.active &&
      (!noDoubleCount ||
        !ctx.claimed.has(e.id) ||
        ctx.claimed.get(e.id) === (bucket.id ?? label)),
  );

  const claim = (ids: string[]) => {
    if (!noDoubleCount) return;
    for (const id of ids) ctx.claimed.set(id, bucket.id ?? label);
  };

  switch (rule.type) {
    case "allOf": {
      const present = poolEntries.filter((e) => e.active);
      const used = present.map((e) => e.id);
      return {
        ...base,
        used,
        appliedCredits: present.reduce((s, e) => s + e.credits * Math.max(1, e.instances), 0),
        satisfied: pool.length > 0 && present.length === pool.length,
        have: present.length,
        need: pool.length,
        unit: "courses",
      };
    }
    case "nOf": {
      const n = rule.n ?? 0;
      const take = availableEntries.slice(0, n);
      claim(take.map((e) => e.id));
      return {
        ...base,
        used: take.map((e) => e.id),
        appliedCredits: take.reduce((s, e) => s + e.credits, 0),
        satisfied: take.length >= n,
        have: Math.min(availableEntries.length, n),
        need: n,
        unit: "courses",
      };
    }
    case "nCredits": {
      const n = rule.n ?? 0;
      const poolCredits = pool.reduce(
        (s, id) => s + (COURSE_BY_ID.get(id)?.credits ?? 0),
        0,
      );
      let acc = 0;
      const used: string[] = [];
      let applied = 0;
      for (const e of availableEntries) {
        if (acc >= n) break;
        const contribution = e.credits * Math.max(1, e.instances);
        acc += contribution;
        applied += contribution;
        for (let i = 0; i < Math.max(1, e.instances); i++) used.push(e.id);
      }
      claim(used);
      return {
        ...base,
        used,
        appliedCredits: Math.min(applied, n),
        satisfied: acc >= n,
        have: Math.min(acc, n),
        need: n,
        unit: "credits",
        slack: poolCredits - n,
      };
    }
    case "allOfGroups": {
      const children = (bucket.groups ?? []).map((g) => evalBucket(g, program, ctx));
      return {
        ...base,
        children,
        used: children.flatMap((c) => c.used),
        appliedCredits: children.reduce((s, c) => s + c.appliedCredits, 0),
        satisfied: children.length > 0 && children.every((c) => c.satisfied),
        have: children.filter((c) => c.satisfied).length,
        need: children.length,
        unit: "groups",
      };
    }
    case "nOfGroups": {
      const n = rule.n ?? 0;
      const children = (bucket.groups ?? []).map((g) => evalBucket(g, program, ctx));
      // Quota already met → unchosen options (and their subtrees) are not needed.
      if (children.filter((c) => c.satisfied).length >= n) {
        const markNN = (c: BucketEval): void => {
          c.notNeeded = true;
          c.children.forEach(markNN);
        };
        children.filter((c) => !c.satisfied).forEach(markNN);
      }
      // Progress reads from the closest-to-done option so partial work shows.
      const best = children
        .slice()
        .sort(
          (a, b) =>
            Number(b.satisfied) - Number(a.satisfied) ||
            b.have / Math.max(1, b.need) - a.have / Math.max(1, a.need),
        )
        .slice(0, Math.max(1, n));
      return {
        ...base,
        children,
        used: best.flatMap((c) => c.used),
        appliedCredits: best.reduce((s, c) => s + c.appliedCredits, 0),
        satisfied: children.filter((c) => c.satisfied).length >= n,
        have: children.filter((c) => c.satisfied).length,
        need: n,
        unit: "groups",
      };
    }
    case "fillTo": {
      const n = rule.n ?? 0;
      const total = ctx.model.totalPlanCredits;
      return {
        ...base,
        satisfied: total >= n,
        have: Math.min(total, n),
        need: n,
        unit: "credits",
      };
    }
    case "programRef": {
      const ref = PROGRAM_BY_ID.get(rule.programId ?? "");
      if (!ref) {
        return { ...base, satisfied: false, have: 0, need: 1, unit: "program" };
      }
      // GE is nested inside the major and counted exactly once, here.
      const sub = evaluateProgram(ref, ctx.model, ctx.claimed);
      return {
        ...base,
        children: sub.buckets,
        used: sub.buckets.flatMap((b) => b.used),
        appliedCredits: sub.appliedCredits,
        satisfied: sub.satisfied,
        have: sub.appliedCredits,
        need: ref.totalCredits.min,
        unit: "credits",
      };
    }
  }
}

/** Flatten a program eval into rows for the requirements rail. */
export interface RailRow {
  depth: number;
  eval: BucketEval;
  path: string;
}

export function railRows(pe: ProgramEval): RailRow[] {
  const rows: RailRow[] = [];
  const walk = (be: BucketEval, depth: number, path: string) => {
    rows.push({ depth, eval: be, path });
    be.children.forEach((c, i) =>
      walk(c, depth + 1, `${path}/${c.bucket.id ?? i}`),
    );
  };
  pe.buckets.forEach((b, i) => walk(b, 0, `${pe.program.id}/${b.bucket.id ?? i}`));
  return rows;
}

const COUNTING_SET = new Set(["completed", "in-progress", "registered", "planned"]);

/**
 * Courses that only appear in not-needed option branches — e.g. MATH 109/110X/111
 * once Calculus I is complete, or CSE 121c + the retired ECEN 101 once ECEN 100
 * is done. The tree renders these as "not needed"; they never warn or star.
 */
export function obsoleteCourseIds(
  evals: ProgramEval[],
  model: PlanModel,
): Set<string> {
  const inactive = new Set<string>();
  const active = new Set<string>();
  const walk = (be: BucketEval, parentNN: boolean): void => {
    const nn = be.notNeeded || parentNN;
    for (const id of be.poolResolved) (nn ? inactive : active).add(id);
    be.children.forEach((c) => walk(c, nn));
  };
  evals.forEach((pe) => pe.buckets.forEach((b) => walk(b, false)));
  const out = new Set<string>();
  for (const id of inactive) {
    if (active.has(id)) continue; // still needed somewhere else
    const st = model.derived.get(id)?.status;
    if (st && COUNTING_SET.has(st)) continue; // taken/planned — display normally
    out.add(id);
  }
  return out;
}

/** All course ids in a bucket's pools (recursive, following sharedPoolId + programRef). */
export function bucketPoolIds(be: BucketEval, program: Program): Set<string> {
  const out = new Set<string>();
  const walk = (b: Bucket) => {
    let pool = b.pool ?? [];
    if (b.sharedPoolId) {
      const src = findBucket(program, b.sharedPoolId);
      pool = src?.pool ?? [];
    }
    pool.forEach((id) => out.add(id));
    if (b.rule.type === "programRef") {
      const ref = PROGRAM_BY_ID.get(b.rule.programId ?? "");
      ref?.buckets.forEach(walk);
    }
    (b.groups ?? []).forEach(walk);
  };
  walk(be.bucket);
  return out;
}
