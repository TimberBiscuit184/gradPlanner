/* Checks shipped programs against the LIVE catalogue — `npm run verify:catalog`
 *
 * Every other check in this repo compares the parse to `programs-raw.json`.
 * That proves the parser is faithful to the harvest; it cannot notice that the
 * harvest itself is stale, truncated, or was read wrong. This one goes back to
 * byui.kuali.co and asks two separate questions:
 *
 *   FIDELITY  does the live catalogue still say what we harvested?
 *   MEANING   does the parsed rule mean what the sentence means?
 *
 * Fidelity is machine-decidable and this script decides it. **Meaning is not.**
 * A rule can be read completely and still be mapped to the wrong type, and no
 * amount of self-comparison catches that — so for meaning this script only
 * lays the catalogue's sentence beside the parsed rule and leaves the verdict
 * to a person. That is the honest division of labour, and it is why the output
 * is a worksheet rather than a pass/fail.
 *
 *   npm run verify:catalog                fidelity over a spread sample
 *   npm run verify:catalog -- --all       fidelity over every program
 *   npm run verify:catalog -- --read 6    …plus 6 side-by-side worksheets
 */
import { readFileSync } from "node:fs";
import { COURSES, PROGRAMS } from "../src/data";
import { buildPlan } from "../src/engine/plan";
import { textOf } from "../src/engine/programParse";
import { evaluateProgram, railRows } from "../src/engine/requirements";
import { trustOfProgram } from "../src/engine/trust";
import type { Program } from "../src/types";
import type { RawProgram } from "./harvestPrograms";

const CATALOG_ID = "68dc4d77c3ad086d83653f48";
const BASE = "https://byui.kuali.co/api/v1/catalog";

const raw = JSON.parse(
  readFileSync(new URL("../data/programs-raw.json", import.meta.url), "utf8"),
) as { _fetchedOn: string; programs: Record<string, RawProgram> };

const CODE_OF = new Map(COURSES.map((c) => [c.id, c.code]));
const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? (process.argv[i + 1] ?? "") : null;
};

/** Sample spread across the catalogue rather than the first N alphabetically. */
function pick(all: RawProgram[], n: number): RawProgram[] {
  if (n >= all.length) return all;
  const step = all.length / n;
  return Array.from({ length: n }, (_, i) => all[Math.floor(i * step)]);
}

interface Row {
  code: string;
  title: string;
  status: "identical" | "changed" | "gone" | "error";
  detail: string;
}

async function fidelity(sample: RawProgram[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const p of sample) {
    try {
      const res = await fetch(`${BASE}/program/${CATALOG_ID}/${p.pid}`);
      if (!res.ok) {
        rows.push({ code: p.code, title: p.title, status: "gone", detail: `HTTP ${res.status}` });
        continue;
      }
      const d = (await res.json()) as Record<string, unknown>;
      const live = typeof d.newProgramRules1 === "string" ? d.newProgramRules1 : "";
      if (live === p.rules) {
        rows.push({ code: p.code, title: p.title, status: "identical", detail: "" });
      } else {
        // Compare what the rules MEAN to a reader, not the markup. Kuali
        // re-serialises whitespace and comment splices between requests; a
        // byte diff would cry wolf on every program.
        const a = textOf(live);
        const b = textOf(p.rules);
        rows.push({
          code: p.code,
          title: p.title,
          status: a === b ? "identical" : "changed",
          detail: a === b ? "markup only" : `${b.length} chars harvested vs ${a.length} live`,
        });
      }
    } catch (err) {
      rows.push({ code: p.code, title: p.title, status: "error", detail: (err as Error).message });
    }
  }
  return rows;
}

/**
 * Render from the app's own evaluation, not from the raw buckets.
 *
 * The first version of this printed `b.label ?? "(unnamed)"` and so showed
 * "(unnamed)" for every group the catalogue never titled — while the app
 * itself labels those from the rule ("Choose 1 of 2", "3 credits from 4
 * courses"). A reviewer signing off on a rendering the students will never see
 * is worse than no review, because it produces confidence about the wrong
 * artifact.
 */
function renderProgram(prog: Program): string[] {
  const model = buildPlan([], [], [prog.code]);
  const rows = railRows(evaluateProgram(prog, model));
  return rows.map((r) => {
    const b = r.eval.bucket;
    const rule = b.rule;
    const how =
      rule.type === "nOf" ? `pick ${rule.n}`
      : rule.type === "nCredits" ? `${rule.n} credits`
      : rule.type === "nOfGroups" ? `pick ${rule.n} of the groups below`
      : rule.type === "allOfGroups" ? "all of the groups below"
      : rule.type === "fillTo" ? `${rule.n} credits from anything`
      : rule.type === "programRef" ? `complete program: ${rule.programId}`
      : "all of";
    const pool = (b.pool ?? []).map((id) => CODE_OF.get(id) ?? id);
    const shown =
      pool.length > 12 ? `${pool.slice(0, 12).join(", ")} …+${pool.length - 12}` : pool.join(", ");
    const note = b.note ? `
${"  ".repeat(r.depth + 2)}note: ${b.note}` : "";
    return `${"  ".repeat(r.depth + 1)}${r.eval.label} — ${how}${pool.length ? `: ${shown}` : ""}${note}`;
  });
}

function worksheet(src: RawProgram, prog: Program): string {
  const lines: string[] = [];
  lines.push(`\n${"═".repeat(78)}`);
  lines.push(`${prog.label}   (${prog.code})   trust=${trustOfProgram(prog)}`);
  lines.push(`https://byui.kuali.co/catalog#/programs/${src.pid}`);

  lines.push(`\n── THE CATALOGUE SAYS ${"─".repeat(56)}`);
  // Never truncate. The clause a reviewer most needs is usually the last one
  // in a long section — cutting at 400 characters hid the third Advanced
  // Movement Studies rule in Dance, which is exactly the kind of omission this
  // worksheet exists to catch.
  for (const sec of src.rules.split("<section>").slice(1)) {
    const t = textOf(sec);
    if (t) lines.push("  " + t.replace(/(.{110}\S*)\s+/g, "$1\n    "));
  }

  lines.push(`\n── GRADTREE SHOWS ${"─".repeat(60)}`);
  lines.push(...renderProgram(prog));

  lines.push(`\n── VERDICT ${"─".repeat(67)}`);
  lines.push("  [ ] every requirement above is present and means the same thing");
  lines.push("  [ ] no requirement was invented");
  lines.push("  reviewer: ______________________  date: ____________");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const all = Object.values(raw.programs).filter((p) => p.rules);
  const everything = process.argv.includes("--all");
  const n = Number(arg("--sample") ?? 24);
  const sample = everything ? all : pick(all, n);

  console.log(
    `\nChecking ${sample.length} of ${all.length} programs against the live catalogue`,
  );
  console.log(`harvested ${raw._fetchedOn} · catalog ${CATALOG_ID}\n`);

  const rows = await fidelity(sample);
  const byStatus = new Map<Row["status"], Row[]>();
  for (const r of rows) {
    if (!byStatus.has(r.status)) byStatus.set(r.status, []);
    byStatus.get(r.status)!.push(r);
  }

  console.log("FIDELITY — does the live catalogue still say what we harvested?");
  for (const s of ["identical", "changed", "gone", "error"] as const) {
    const list = byStatus.get(s) ?? [];
    if (!list.length) continue;
    console.log(`  ${s.padEnd(10)} ${list.length}`);
    if (s !== "identical")
      for (const r of list.slice(0, 10))
        console.log(`      ${r.title.slice(0, 40).padEnd(42)} ${r.detail}`);
  }

  const bad = rows.filter((r) => r.status !== "identical").length;
  console.log(
    bad === 0
      ? "\n  the harvest is a faithful copy of the catalogue as it stands today.\n"
      : `\n  ${bad} program(s) differ from the live catalogue — re-run npm run harvest:programs\n`,
  );

  const readN = Number(arg("--read") ?? 0);
  if (readN > 0) {
    console.log(
      "MEANING — not machine-decidable. Below, the catalogue's own words beside\n" +
        "what GradTree will show a student. A person has to read these.\n",
    );
    /**
     * `--only` names the programs to read. Default sampling spreads across the
     * catalogue, which is right for an unbiased estimate and wrong for a first
     * review: the programs worth a human's attention are the ones where the
     * build *inferred* a pool from prose rather than reading course links.
     * Those are the only places the app can invent a requirement.
     */
    const only = arg("--only");
    const pool = only
      ? all.filter((p) => only.split(",").includes(p.code))
      : all;
    const withProg = pick(pool, only ? pool.length : readN)
      .map((src) => ({ src, prog: PROGRAMS.find((p) => p.code === src.code) }))
      .filter((x): x is { src: RawProgram; prog: Program } => !!x.prog);
    for (const { src, prog } of withProg) console.log(worksheet(src, prog));
  }
}

void main();
