/* Scores the program parser against the hand-written programs — `npm run bench:programs`
 *
 * Same discipline as `parserBench.ts`: three program files were built by a
 * human reading the catalogue (EE, the A.I. minor, GE - ABET). If the parser
 * cannot reproduce those, it has no business generating the other 353.
 *
 * Structural comparison, bucket by bucket — labels, credit totals, rule types
 * and pool membership. Differences are printed rather than summarised, because
 * the useful output here is *which* rule went wrong.
 */
import { readFileSync } from "node:fs";
import { COURSES, PROGRAMS } from "../src/data";
import { parseProgramRules } from "../src/engine/programParse";
import type { Bucket, Program } from "../src/types";
import type { RawProgram } from "./harvestPrograms";

const raw = JSON.parse(
  readFileSync(new URL("../data/programs-raw.json", import.meta.url), "utf8"),
) as { programs: Record<string, RawProgram> };

const byUpper = new Map(COURSES.map((c) => [c.id.toUpperCase(), c.id]));
const resolveCourse = (code: string) =>
  byUpper.get(code.replace(/\s+/g, "").toUpperCase()) ?? null;

/** Kuali id → our program id, for `programRef` links. */
const KUALI_TO_ID: Record<string, string> = {};
for (const p of Object.values(raw.programs)) {
  const mine = PROGRAMS.find((x) => x.code === p.code);
  if (mine) KUALI_TO_ID[p.kualiId] = mine.id;
}
const resolveProgram = (kualiId: string) => KUALI_TO_ID[kualiId] ?? null;

const poolOf = (b: Bucket): string[] => {
  const out = [...(b.pool ?? [])];
  for (const g of b.groups ?? []) out.push(...poolOf(g));
  return out.sort();
};
const shape = (b: Bucket): string =>
  `${b.rule.type}${b.rule.n !== undefined ? `(${b.rule.n})` : ""}`;

let compared = 0;
let matched = 0;

for (const mine of PROGRAMS) {
  const entry = Object.values(raw.programs).find((p) => p.code === mine.code);
  if (!entry) {
    console.log(`\n${mine.label}: NOT FOUND in the harvest (code ${mine.code})`);
    continue;
  }
  compared++;

  const got = parseProgramRules(entry.rules, { resolveCourse, resolveProgram });
  const hand: Program = mine;

  console.log(`\n=== ${hand.label} (${hand.code}) — parser says ${got.confidence}`);
  console.log(`  buckets: hand ${hand.buckets.length}  parsed ${got.buckets.length}`);

  let bucketsOk = 0;
  for (const hb of hand.buckets) {
    // Match on label first; fall back to pool overlap for renamed buckets.
    const pb =
      got.buckets.find(
        (b) => (b.label ?? "").toLowerCase() === (hb.label ?? "").toLowerCase(),
      ) ??
      got.buckets.find((b) => {
        const a = new Set(poolOf(b));
        return poolOf(hb).some((id) => a.has(id));
      });
    if (!pb) {
      console.log(`  ✗ ${hb.label} — no matching parsed bucket`);
      continue;
    }
    const sameRule = shape(pb) === shape(hb);
    const hp = poolOf(hb);
    const pp = poolOf(pb);
    const missing = hp.filter((id) => !pp.includes(id));
    const extra = pp.filter((id) => !hp.includes(id));
    if (sameRule && !missing.length && !extra.length) {
      bucketsOk++;
      continue;
    }
    console.log(
      `  ~ ${hb.label}: rule ${shape(hb)} → ${shape(pb)}` +
        (missing.length ? `  missing ${missing.slice(0, 6).join(",")}` : "") +
        (extra.length ? `  extra ${extra.slice(0, 6).join(",")}` : ""),
    );
  }
  console.log(`  buckets fully matching: ${bucketsOk}/${hand.buckets.length}`);
  if (bucketsOk === hand.buckets.length) matched++;
  if (got.dropped.length)
    console.log(`  dropped: ${got.dropped.slice(0, 3).join(" | ").slice(0, 200)}`);
  if (got.unknownCourses.length)
    console.log(`  unknown courses: ${got.unknownCourses.slice(0, 10).join(", ")}`);
}

console.log(`\n${matched}/${compared} hand-written programs reproduced exactly\n`);
