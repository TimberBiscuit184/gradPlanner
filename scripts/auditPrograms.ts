/* Audits parsed programs against the catalogue source — `npm run audit:programs`
 *
 * `bench:programs` scores the parser against the three programs a human wrote.
 * That is a tiny sample, so it cannot say much about the other 204. This asks a
 * different, checkable question of *every* program: **did the parse lose
 * anything?**
 *
 * Four completeness checks, each comparing the generated buckets back against
 * the raw catalogue HTML they came from:
 *
 *   sections   every <section> in the source became a bucket
 *   courses    every course the source links appears in a pool, or is recorded
 *              as dropped — nothing vanishes silently
 *   clauses    every rule clause produced a rule or was explicitly dropped
 *   credits    every "Total Credits" figure was captured
 *
 * Completeness is not correctness — a rule can be fully read and still mapped
 * to the wrong type. That is what the `--sample` mode is for: it prints the
 * catalogue's own words beside the parsed structure so a person can judge.
 *
 *   npm run audit:programs            structural audit of all programs
 *   npm run audit:programs -- --sample 8   …plus 8 side-by-side reviews
 */
import { readFileSync } from "node:fs";
import { COURSES, PROGRAMS } from "../src/data";
import { parseProgramRules, textOf } from "../src/engine/programParse";
import { trustOfProgram } from "../src/engine/trust";
import type { Bucket } from "../src/types";
import type { RawProgram } from "./harvestPrograms";

const raw = JSON.parse(
  readFileSync(new URL("../data/programs-raw.json", import.meta.url), "utf8"),
) as { programs: Record<string, RawProgram> };

const byUpper = new Map(COURSES.map((c) => [c.id.toUpperCase(), c.id]));
const resolveCourse = (code: string) =>
  byUpper.get(code.replace(/\s+/g, "").toUpperCase()) ?? null;
const KUALI_TO_ID: Record<string, string> = {};
for (const p of Object.values(raw.programs)) {
  const mine = PROGRAMS.find((x) => x.code === p.code);
  if (mine) KUALI_TO_ID[p.kualiId] = mine.id;
}
const resolveProgram = (k: string) => KUALI_TO_ID[k] ?? null;

const poolOf = (b: Bucket): string[] => [
  ...(b.pool ?? []),
  ...(b.groups ?? []).flatMap(poolOf),
];

const countSections = (html: string) =>
  (html.match(/<section\b/gi) ?? []).length -
  (html.match(/<section\b[^>]*>\s*<\/section>/gi) ?? []).length;

interface Row {
  code: string;
  label: string;
  sectionsOk: boolean;
  coursesOk: boolean;
  clausesOk: boolean;
  creditsOk: boolean;
  hollowOk: boolean;
  refsOk: boolean;
  detail: string[];
}

const rows: Row[] = [];

for (const p of PROGRAMS) {
  if (trustOfProgram(p) === "human") continue; // hand-written: bench covers these
  const src = Object.values(raw.programs).find((r) => r.code === p.code);
  if (!src) continue;

  /**
   * Audit the SHIPPED program, not a re-parse of the source.
   *
   * This used to call the parser again and measure that, which meant it never
   * saw anything `buildPrograms.ts` adds afterwards — so it kept reporting 34
   * unsatisfiable Emphasis buckets that had already been filled from the
   * program's specializations. Auditing a re-derivation instead of the artifact
   * is how you get a green report on a broken build, or a red one on a fixed
   * build.
   */
  const parsed = { buckets: p.buckets, dropped: p.parseDropped ?? [] };
  const detail: string[] = [];

  // 1. sections → buckets
  // At least one bucket per section. More is legitimate: a program whose
  // emphasis options had nowhere to attach gets an extra Emphasis bucket
  // appended from its specializations.
  const srcSections = countSections(src.rules);
  const sectionsOk = parsed.buckets.length >= srcSections;
  if (!sectionsOk)
    detail.push(`sections ${srcSections} → buckets ${parsed.buckets.length}`);

  // 2. every linked course lands somewhere
  const linked = new Set(
    [...src.rules.matchAll(/<a[^>]*href="#\/courses\/view\/[^"]*"[^>]*>([^<]+)<\/a>/gi)]
      .map((m) => resolveCourse(m[1].trim()))
      .filter((x): x is string => !!x),
  );
  const inPools = new Set(parsed.buckets.flatMap(poolOf));
  const lost = [...linked].filter((id) => !inPools.has(id));
  const coursesOk = lost.length === 0;
  if (!coursesOk) detail.push(`courses not in any pool: ${lost.slice(0, 6).join(",")}`);

  // 3. every clause produced a rule or was recorded as dropped
  const clauseCount = (
    src.rules.match(/data-test="ruleView-[^"]*-result"/gi) ?? []
  ).length;
  const ruleCount = (function count(bs: Bucket[]): number {
    return bs.reduce(
      (n, b) => n + (b.groups?.length ? count(b.groups) : 1),
      0,
    );
  })(parsed.buckets);
  /**
   * NOTE clauses carry no requirement — "students who pass the LUC test may
   * receive credit for CSE 110" is advice, not a rule — so producing nothing
   * from them is correct. Counting them as unaccounted-for flagged four
   * perfectly good programs.
   */
  const noteCount = (
    src.rules.match(/data-test="ruleView-[^"]*-result"[^>]*>\s*(?:<div>\s*)?NOTE?:/gi) ??
    []
  ).length;
  /**
   * A clause can also be consumed as a *constraint* rather than a rule. "The
   * following courses must be taken together in the same semester" produces no
   * bucket of its own — it sets `sameTerm` on the bucket that follows — so
   * counting only rules, drops and notes left Small Business Innovation
   * permanently one clause short for a clause that was fully understood.
   */
  const constraintCount = (function count(bs: Bucket[]): number {
    return bs.reduce(
      (n, b) =>
        n +
        (b.sameTerm ? 1 : 0) +
        (b.allowDoubleCount === false ? 1 : 0) +
        count(b.groups ?? []),
      0,
    );
  })(parsed.buckets);
  const clausesOk =
    ruleCount + parsed.dropped.length + noteCount + constraintCount >= clauseCount;
  if (!clausesOk)
    detail.push(
      `clauses ${clauseCount} → rules ${ruleCount} + dropped ${parsed.dropped.length} + notes ${noteCount} + constraints ${constraintCount}`,
    );

  /**
   * 4. No hollow requirement. A bucket that demands credits but offers no
   * courses and no sub-groups can never be satisfied — the student sees
   * "0/53 cr" forever with nothing to click. Music's Emphasis bucket was
   * exactly this, and the completeness checks all passed on it because the
   * bucket existed. Reading six programs by hand is what found it.
   */
  /**
   * Walk nested groups too. This check used to look only at top-level buckets,
   * so it passed General Education while GE's Breadth section carried a nested
   * "6 credits from nothing" — visible in the app as `0/6 cr` with a shortfall
   * warning and no way to move it. A requirement is unsatisfiable wherever it
   * sits in the tree.
   */
  const flatten = (b: Bucket): Bucket[] => [b, ...(b.groups ?? []).flatMap(flatten)];
  const hollow = parsed.buckets.flatMap(flatten).filter(
    (b) =>
      ((b.credits?.min ?? 0) > 0 ||
        (b.rule.type === "nCredits" && (b.rule.n ?? 0) > 0)) &&
      !poolOf(b).length &&
      !(b.groups ?? []).length &&
      b.rule.type !== "programRef" &&
      b.rule.type !== "fillTo",
  );
  const hollowOk = hollow.length === 0;
  if (!hollowOk)
    detail.push(`unsatisfiable: ${hollow.map((b) => b.label).join(", ").slice(0, 60)}`);

  /** 5. Every `programRef` points at a program we actually carry. */
  // Nested references count too — see buildPrograms.ts on Agribusiness.
  const countRefs = (bs: Bucket[]): number =>
    bs.reduce(
      (n, b) => n + (b.rule.type === "programRef" ? 1 : 0) + countRefs(b.groups ?? []),
      0,
    );
  const refs = { length: countRefs(parsed.buckets) };
  const srcRefs = (src.rules.match(/to complete the following program\(s\)/gi) ?? [])
    .length;
  const refsOk = refs.length >= srcRefs;
  if (!refsOk)
    detail.push(`programRef ${srcRefs} in source → ${refs.length} resolved`);

  // 6. credit totals captured
  /**
   * Section totals only. Every program ends with "Grand Total Credits: 120",
   * which is the degree's total and belongs to no section — counting it meant
   * Interdisciplinary Studies could never satisfy this check, needing six
   * totals from five sections.
   */
  const totals =
    (src.rules.match(/Total Credits/gi) ?? []).length -
    (src.rules.match(/Grand Total Credits/gi) ?? []).length;
  const withCredits = parsed.buckets.filter((b) => b.credits).length;
  const creditsOk = withCredits >= Math.min(totals, parsed.buckets.length);
  if (!creditsOk) detail.push(`credit totals ${totals} → captured ${withCredits}`);

  rows.push({
    code: p.code,
    label: p.label,
    sectionsOk,
    coursesOk,
    clausesOk,
    creditsOk,
    hollowOk,
    refsOk,
    detail,
  });
}

const clean = rows.filter(
  (r) =>
    r.sectionsOk && r.coursesOk && r.clausesOk && r.creditsOk && r.hollowOk && r.refsOk,
);
const pct = (n: number) => ((n / rows.length) * 100).toFixed(1);

console.log(`\nProgram completeness audit — ${rows.length} machine-read programs\n`);
console.log(`  clean on all six checks: ${clean.length}  (${pct(clean.length)}%)`);
for (const [name, key] of [
  ["sections → buckets", "sectionsOk"],
  ["every linked course pooled", "coursesOk"],
  ["every clause consumed", "clausesOk"],
  ["credit totals captured", "creditsOk"],
  ["no unsatisfiable bucket", "hollowOk"],
  ["program references resolved", "refsOk"],
] as const) {
  const ok = rows.filter((r) => r[key]).length;
  console.log(`    ${name.padEnd(28)} ${ok}/${rows.length}  (${pct(ok)}%)`);
}

const bad = rows.filter((r) => r.detail.length);
if (bad.length) {
  console.log(`\n  ${bad.length} needing review:`);
  for (const r of bad)
    console.log(`    ${r.label.slice(0, 42).padEnd(44)} ${r.detail.join(" · ").slice(0, 90)}`);
}

// ---- side-by-side sample for human judgement ------------------------------
const sampleArg = process.argv.indexOf("--sample");
if (sampleArg > -1) {
  const n = Number(process.argv[sampleArg + 1] ?? 6);
  // Spread across departments rather than taking the first N alphabetically.
  const step = Math.max(1, Math.floor(rows.length / n));
  const picks = rows.filter((_, i) => i % step === 0).slice(0, n);

  for (const r of picks) {
    const src = Object.values(raw.programs).find((x) => x.code === r.code)!;
    const parsed = parseProgramRules(src.rules, { resolveCourse, resolveProgram });
    console.log(`\n${"=".repeat(78)}\n${r.label}  (${r.code})`);
    console.log("--- catalogue says ---");
    for (const sec of src.rules.split("<section>").slice(1)) {
      const t = textOf(sec).slice(0, 190);
      if (t) console.log("  " + t);
    }
    console.log("--- parsed as ---");
    for (const b of parsed.buckets) {
      const rule = `${b.rule.type}${b.rule.n !== undefined ? `(${b.rule.n})` : ""}`;
      const pool = poolOf(b);
      console.log(
        `  ${(b.label ?? "?").slice(0, 34).padEnd(36)} ${rule.padEnd(16)}` +
          `${b.credits ? `${b.credits.min}cr ` : ""}${pool.length ? `[${pool.slice(0, 8).join(",")}${pool.length > 8 ? ",…" : ""}]` : ""}`,
      );
    }
  }
}
console.log();
