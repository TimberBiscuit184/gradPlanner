/* Every major, as a brand-new student — `npm run sweep`.
 *
 * Every major and minor, opened cold with an empty plan.
 *
 * The audit asks "did the parse lose anything". This asks the different
 * question the user actually cares about: **if I open this app and pick this
 * degree, does it work?** It runs the real engine over the real shipped data
 * and records anything a student would see as broken.
 */
import { PROGRAMS, COURSES } from "../src/data";
import type { Placement } from "../src/types";
import { buildPlan, validateDrop } from "../src/engine/plan";
import { evaluateProgram, railRows } from "../src/engine/requirements";
import { planWishlist } from "../src/engine/autoplan";
import { setActiveEnrollment } from "../src/engine/scope";

const COURSE_IDS = new Set(COURSES.map((c) => c.id));
const majors = PROGRAMS.filter((p) => p.type === "major");
const minors = PROGRAMS.filter((p) => p.type === "minor");

interface Problem {
  program: string;
  kind: string;
  detail: string;
}
const problems: Problem[] = [];
const add = (program: string, kind: string, detail: string) =>
  problems.push({ program, kind, detail });

for (const p of [...majors, ...minors]) {
  try {
    setActiveEnrollment([p.id]);
    const model = buildPlan([], [], [p.code]);
    const pe = evaluateProgram(p, model);
    const rows = railRows(pe);

    // 1. A label a student cannot read.
    for (const r of rows) {
      if (/^rule-\d|^option-\d|^bucket$|^choice$/.test(r.eval.label))
        add(p.label, "unreadable label", r.eval.label);
      if (!r.eval.label || r.eval.label === "undefined")
        add(p.label, "empty label", r.path);
    }

    /**
     * 2. A requirement with nothing to put in it.
     *
     * `fillTo` is the catch-all elective — it has no pool because it accepts
     * anything, so an empty pool there is correct, not broken. `programRef`
     * delegates to another program and holds no courses of its own. Counting
     * either as unsatisfiable flagged every program in the catalogue, EE
     * included, and said nothing.
     */
    for (const r of rows) {
      const leaf = r.eval.children.length === 0;
      const kind = r.eval.bucket.rule.type;
      if (kind === "fillTo" || kind === "programRef") continue;
      if (leaf && r.eval.need > 0 && r.eval.poolResolved.length === 0)
        add(p.label, "unsatisfiable", `${r.eval.label} needs ${r.eval.need} ${r.eval.unit}`);
    }

    // 3. A pool naming a course the app does not carry.
    for (const r of rows)
      for (const id of r.eval.poolResolved)
        if (!COURSE_IDS.has(id)) add(p.label, "phantom course", `${r.eval.label}: ${id}`);

    // 4. Numbers a student would see as broken.
    if (!Number.isFinite(pe.appliedCredits))
      add(p.label, "NaN credits", String(pe.appliedCredits));
    const total = p.totalCredits?.min ?? 0;
    if (!Number.isFinite(total) || total <= 0)
      add(p.label, "no credit total", String(total));
    for (const r of rows)
      if (!Number.isFinite(r.eval.need) || !Number.isFinite(r.eval.have))
        add(p.label, "NaN progress", r.eval.label);

    // 5. Satisfied before the student has done anything.
    if (pe.satisfied) add(p.label, "satisfied while empty", "program reports complete with 0 courses");
  } catch (err) {
    add(p.label, "THREW", (err as Error).message);
  }
}

/**
 * 6. Can the student actually *schedule* it?
 *
 * Requirements rendering correctly is half the job. This takes each major's
 * own required courses, asks the planner to place them, and then re-validates
 * every placement the planner made. A planner that produces a placement its
 * own validator rejects is the worst kind of bug: the board looks fine and the
 * degree is wrong.
 */
let planned = 0;
let placedTotal = 0;
for (const p of majors) {
  try {
    setActiveEnrollment([p.id]);
    const model = buildPlan([], [], [p.code]);
    const pe = evaluateProgram(p, model);
    const wanted = [
      ...new Set(railRows(pe).flatMap((r) => r.eval.poolResolved)),
    ].filter((id) => COURSE_IDS.has(id));
    if (!wanted.length) {
      add(p.label, "nothing to schedule", "no courses in any requirement");
      continue;
    }
    const res = planWishlist(model, wanted.slice(0, 40));
    planned++;
    placedTotal += res.additions.length;
    if (!res.additions.length) {
      add(p.label, "planner placed nothing", `${wanted.length} courses wanted`);
      continue;
    }
    /**
     * Re-validate the way a student would actually build the plan: add the
     * placements in term order, checking each against what is already on the
     * board. Validating against a model that already contains the placement
     * makes the validator reject it as a duplicate — which flagged 4,659 of
     * 4,669 placements and meant nothing.
     */
    /**
     * Order by the model's own timeline, never by the term id. Sorting the ids
     * as strings puts 2027F before 2027S before 2027W — Fall, Spring, Winter —
     * which is backwards, and made a correctly-ordered plan look like 216
     * prerequisite violations across 85 programs.
     */
    const termIndex = new Map(model.timeline.map((t, i) => [t.id, i]));
    const order = [...res.additions].sort(
      (a, b) => (termIndex.get(a.termId) ?? 0) - (termIndex.get(b.termId) ?? 0),
    );
    const placed: Placement[] = [];
    for (const a of order) {
      const soFar = buildPlan(placed, [], [p.code]);
      const v = validateDrop(a.courseId, a.termId, soFar);
      if (!v.allowed || v.level === "blocked")
        add(p.label, "planner made an invalid placement", `${a.courseId} → ${a.termId}: ${v.reason}`);
      placed.push({
        instanceId: `${a.courseId}@${a.termId}`,
        courseId: a.courseId,
        termId: a.termId,
        block: null,
      });
    }
  } catch (err) {
    add(p.label, "THREW (scheduling)", (err as Error).message);
  }
}

// 7. Major + minor together — the combination the user asked about.
let comboFails = 0;
const sampleMajors = majors.filter((_, i) => i % 7 === 0);
const sampleMinors = minors.filter((_, i) => i % 11 === 0);
for (const maj of sampleMajors)
  for (const min of sampleMinors) {
    try {
      setActiveEnrollment([maj.id, min.id]);
      const model = buildPlan([], [], [maj.code, min.code]);
      const claimed = new Map<string, string>();
      evaluateProgram(maj, model, claimed);
      evaluateProgram(min, model, claimed);
    } catch (err) {
      comboFails++;
      if (comboFails <= 5)
        add(`${maj.label} + ${min.label}`, "THREW (combo)", (err as Error).message);
    }
  }

const byKind = new Map<string, Problem[]>();
for (const pr of problems) {
  if (!byKind.has(pr.kind)) byKind.set(pr.kind, []);
  byKind.get(pr.kind)!.push(pr);
}

console.log(`\nSwept ${majors.length} majors + ${minors.length} minors as a blank-slate student`);
console.log(`majors scheduled: ${planned}, placements made: ${placedTotal}`);
console.log(`combinations tested: ${sampleMajors.length * sampleMinors.length}, threw: ${comboFails}\n`);
const affected = new Set(problems.map((p) => p.program));
console.log(`programs with at least one problem: ${affected.size}\n`);
for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${kind}  —  ${list.length} across ${new Set(list.map((l) => l.program)).size} programs`);
  for (const l of list) console.log(`    ${l.program.slice(0, 34).padEnd(36)} ${l.detail.slice(0, 70)}`);
  console.log();
}
