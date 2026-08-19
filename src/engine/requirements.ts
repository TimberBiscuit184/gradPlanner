import { COURSE_BY_ID, PROGRAM_BY_ID } from "../data";
import { activeEnrollment } from "./scope";
import { assertsRequirements, trustOfProgram } from "./trust";
import type { Bucket, Program } from "../types";
import type { PlanModel } from "./plan";

/** A retired course (no offered season) can never be part of a viable path. */
function isReachable(id: string): boolean {
  const c = COURSE_BY_ID.get(id);
  if (!c) return false;
  return !c.termsConfirmed || c.terms.length > 0;
}

function creditsOf(id: string): number {
  return COURSE_BY_ID.get(id)?.credits ?? 0;
}

/** Every course id anywhere inside a bucket, following shared pools. */
function poolOfBucket(b: Bucket, program: Program): string[] {
  let pool = b.pool ?? [];
  if (b.sharedPoolId) pool = findBucket(program, b.sharedPoolId)?.pool ?? [];
  return pool;
}

/**
 * Courses you must take — not just the ones a program spells out as `allOf`,
 * but every course a rule leaves no way around:
 *
 *  - **allOf** — stated outright.
 *  - **nOf where the pool has exactly n reachable options** — no choice left.
 *  - **nCredits where dropping a course puts the pool below n.** This is the
 *    one that matters most. EE's Math & Science core pool holds 21 credits and
 *    demands 20, so the single credit of slack means every course of 2 credits
 *    or more is unavoidable; only PH 150 (1 cr) is genuinely optional. The same
 *    rule makes ECEN 250 + ECEN 299 required, since their pool is an exact fit.
 *  - **nOfGroups where only n groups are still reachable** — the Introduction
 *    bucket offers ECEN 100 *or* CSE 121c + the retired ECEN 101, so ECEN 100
 *    is the only surviving path and is therefore required.
 *
 * Recomputed from the data, so it stays correct if a pool or a retirement
 * changes. Used for the ★ marker in the tree and the add-course picker.
 */
const REQUIRED_CACHE = new Map<string, Set<string>>();
export function requiredCourseIds(): Set<string> {
  /**
   * Keyed by enrolment, because ★ is a statement about *this student's*
   * degree. It used to be a single global cache over every asserting program,
   * which was invisibly correct while three programs existed and the student
   * was enrolled in all three. The moment machine-read programs began
   * asserting, that same line marked 941 courses across the whole university
   * as unavoidable — for everyone, whatever they had picked.
   */
  const enrolled = activeEnrollment();
  const key = [...enrolled].sort().join("|");
  const cached = REQUIRED_CACHE.get(key);
  if (cached) return cached;

  /** Every course this bucket forces you to take, if you must satisfy it. */
  const forcedBy = (b: Bucket, prog: Program): Set<string> => {
    const out = new Set<string>();
    const pool = poolOfBucket(b, prog).filter(isReachable);

    switch (b.rule.type) {
      case "allOf":
        pool.forEach((id) => out.add(id));
        break;

      case "nOf":
        // As many picks as there are options left — no choice remains.
        if (
          b.rule.n !== undefined &&
          pool.length === b.rule.n &&
          !pool.some((id) => COURSE_BY_ID.get(id)?.isPlaceholder)
        )
          pool.forEach((id) => out.add(id));
        break;

      case "nCredits": {
        // A placeholder can be dropped as many times as you like, so a pool
        // containing one has unbounded credits and forces nothing. Without
        // this, Cornerstone's 6-credit REL pool looks like an exact fit and
        // wrongly marks REL 327 and REL 333 as unavoidable.
        if (pool.some((id) => COURSE_BY_ID.get(id)?.isPlaceholder)) break;
        const need = b.rule.n ?? 0;
        const total = pool.reduce((s, id) => s + creditsOf(id), 0);
        pool.forEach((id) => {
          if (total - creditsOf(id) < need) out.add(id);
        });
        break;
      }

      case "allOfGroups":
        for (const g of b.groups ?? [])
          forcedBy(g, prog).forEach((id) => out.add(id));
        break;

      /**
       * Follow the reference. General Education is nested inside the major, so
       * scoping to the enrolled programs alone would drop every GE course out
       * of the ★ set — the courses a first-year student most needs marked.
       */
      case "programRef": {
        const ref = PROGRAM_BY_ID.get(b.rule.programId ?? "");
        if (ref && assertsRequirements(trustOfProgram(ref)))
          for (const rb of ref.buckets)
            forcedBy(rb, ref).forEach((id) => out.add(id));
        break;
      }

      case "nOfGroups": {
        const n = b.rule.n ?? 1;
        const viable = (b.groups ?? []).filter((g) =>
          poolIdsDeep(g, prog).every(isReachable),
        );
        const forcedPerGroup = viable.map((g) => forcedBy(g, prog));
        // You must pick n of these. A course is unavoidable when fewer than n
        // of the options let you skip it — which is why MATH 112X is required
        // even though Foundational Math offers three routes: all three include
        // it, so no route avoids it.
        const every = new Set(forcedPerGroup.flatMap((s) => [...s]));
        for (const id of every) {
          const without = forcedPerGroup.filter((s) => !s.has(id)).length;
          if (without < n) out.add(id);
        }
        break;
      }
    }
    return out;
  };

  /**
   * The student's own programs, and only those that assert.
   *
   * This used to be the literal list `[EE, AI_MINOR, GE_ABET]`, which was right
   * by accident — those happened to be the only programs. With 204 more parsed
   * out of the catalogue, "★ required — no alternative" has to rest on
   * something better than a parser's self-assessment. See
   * `assertsRequirements` for why `exact` is not enough here when it is enough
   * for prerequisites.
   */
  const out = new Set<string>();
  for (const id of enrolled) {
    const prog = PROGRAM_BY_ID.get(id);
    if (!prog || !assertsRequirements(trustOfProgram(prog))) continue;
    for (const b of prog.buckets) forcedBy(b, prog).forEach((c) => out.add(c));
  }

  REQUIRED_CACHE.set(key, out);
  return out;
}

/** All course ids inside a bucket and its groups, following shared pools. */
function poolIdsDeep(b: Bucket, prog: Program): string[] {
  const out = [...poolOfBucket(b, prog)];
  for (const g of b.groups ?? []) out.push(...poolIdsDeep(g, prog));
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
/**
 * A name for a bucket the catalogue never named.
 *
 * A short pool names itself — "BUS 301 + ENG 301" is clearer than any heading.
 * Beyond three courses that becomes a wall of codes, so describe the rule
 * instead. This used to give up there and fall through to `bucket.id`, which is
 * how machine-read programs shipped requirements literally labelled `rule-1`,
 * `rule-2`, `rule-3` — visible in Music's emphasis, and in every generated
 * program with more than one clause under a heading.
 */
function fallbackLabel(bucket: Bucket): string | null {
  const pool = bucket.pool ?? [];
  /**
   * A `programRef` names itself by what it points at. Agribusiness references
   * sixteen programs as unlabelled sibling clauses, so a student saw four rows
   * reading `rule-1` … `rule-4`, each "needs 1 program", with no way to tell
   * which. 15 programs were affected.
   */
  if (bucket.rule.type === "programRef") {
    const ref = PROGRAM_BY_ID.get(bucket.rule.programId ?? "");
    return ref ? ref.label : "Referenced program (not carried)";
  }
  // `fillTo` is the catch-all elective — "at least N credits from any eligible
  // university credits". It names no courses, so a pool-first check never
  // reaches it and it shipped as `rule-4`.
  if (bucket.rule.type === "fillTo")
    return `${bucket.rule.n} credits of electives`;
  if (pool.length === 0) return null;
  /**
   * A short pool names itself — but the joiner has to match the rule. "PHIL
   * 201 + PHIL 202" on a `pick 1` rule reads as "take both", which is the
   * opposite of what it means. Conjunction for allOf, disjunction otherwise.
   */
  if (pool.length <= 3) {
    const codes = pool.map((id) => COURSE_BY_ID.get(id)?.code ?? id);
    return codes.join(bucket.rule.type === "allOf" ? " + " : " or ");
  }

  const rule = bucket.rule;
  if (rule.type === "nCredits") return `${rule.n} credits from ${pool.length} courses`;
  if (rule.type === "nOf") return `Choose ${rule.n} of ${pool.length}`;
  if (rule.type === "allOf") return `All ${pool.length} courses`;
  return null;
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
  const walk = (be: BucketEval, parentNN: boolean, asserts: boolean): void => {
    const nn = (be.notNeeded || parentNN) && asserts;
    for (const id of be.poolResolved) (nn ? inactive : active).add(id);
    be.children.forEach((c) => walk(c, nn, asserts));
  };
  /**
   * "Not needed" strikes a course through and prunes it from focus modes and
   * the autoplanner. Claiming that from a machine-read program could hide a
   * course the student actually needs, so only hand-checked programs get a
   * vote. Machine-read programs still contribute their *active* pools, so
   * nothing they require is ever marked obsolete by someone else's rule.
   */
  evals.forEach((pe) => {
    const asserts = assertsRequirements(trustOfProgram(pe.program));
    pe.buckets.forEach((b) => walk(b, false, asserts));
  });
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

/**
 * Course sets the catalogue says must be taken in ONE term.
 *
 * "The following courses must be taken together in the same semester" —
 * Business Management's IBC block, its Interdisciplinary Studies emphasis, and
 * the Small Business minor. Requiring the three courses was never the missing
 * part; nothing stopped a student spreading them across three semesters and
 * finishing with a plan that looks complete and cannot be registered.
 *
 * Scoped to the student's own enrolment, and to programs that assert. A
 * constraint read out of a program we have already flagged as incompletely
 * understood is not one to enforce.
 */
const SAME_TERM_CACHE = new Map<string, string[][]>();
export function sameTermGroups(): string[][] {
  const enrolled = activeEnrollment();
  const key = [...enrolled].sort().join("|");
  const cached = SAME_TERM_CACHE.get(key);
  if (cached) return cached;

  const out: string[][] = [];
  const walk = (b: Bucket) => {
    if (b.sameTerm && (b.pool ?? []).length > 1) out.push([...b.pool!]);
    for (const g of b.groups ?? []) walk(g);
    if (b.rule.type === "programRef") {
      const ref = PROGRAM_BY_ID.get(b.rule.programId ?? "");
      if (ref && assertsRequirements(trustOfProgram(ref))) ref.buckets.forEach(walk);
    }
  };
  for (const id of enrolled) {
    const prog = PROGRAM_BY_ID.get(id);
    if (!prog || !assertsRequirements(trustOfProgram(prog))) continue;
    prog.buckets.forEach(walk);
  }
  SAME_TERM_CACHE.set(key, out);
  return out;
}

/** The same-term set containing this course, if any. */
export function sameTermPartners(courseId: string): string[] {
  for (const g of sameTermGroups())
    if (g.includes(courseId)) return g.filter((id) => id !== courseId);
  return [];
}
