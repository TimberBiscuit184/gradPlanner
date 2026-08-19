/* Plans for the screenshot run — `npm run shots:plans`
 *
 * The showcase shots need boards that look like real work: a part-built plan,
 * a finished one, and one with a genuine mistake in it. Computing them here
 * with the app's own planner keeps the screenshots honest — every course sits
 * where Sprout actually put it — and keeps the Electron driver simple, since
 * it only has to seed localStorage and press the shutter.
 */
import { writeFileSync } from "node:fs";
import { COURSE_BY_ID, PROGRAMS } from "../src/data";
import { planBottlenecksAsap } from "../src/engine/autoplan";
import { buildPlan } from "../src/engine/plan";
import { evaluateProgram, obsoleteCourseIds } from "../src/engine/requirements";
import { setActiveEnrollment } from "../src/engine/scope";

interface Seed {
  enrolledIds: string[];
  placements: {
    instanceId: string;
    courseId: string;
    termId: string;
    block: null;
  }[];
}

function planFor(labels: string[], limit?: number): Seed {
  const programs = labels
    .map((l) => PROGRAMS.find((p) => p.label === l))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const ids = programs.map((p) => p.id);
  const codes = programs.map((p) => p.code);
  setActiveEnrollment(ids);

  const model = buildPlan([], [], codes);
  const obsolete = obsoleteCourseIds(
    programs.map((p) => evaluateProgram(p, model)),
    model,
  );
  const res = planBottlenecksAsap(model, obsolete);
  const additions = limit ? res.additions.slice(0, limit) : res.additions;
  return {
    enrolledIds: ids,
    placements: additions.map((a, i) => ({
      instanceId: `s${i}`,
      courseId: a.courseId,
      termId: a.termId,
      block: null,
    })),
  };
}

const seeds: Record<string, Seed> = {
  nursingPartial: planFor(["Nursing - Pre Licensure"], 9),
  nursingFull: planFor(["Nursing - Pre Licensure"]),
  csFull: planFor(["Computer Science", "Mathematics Minor"]),
};

/**
 * A plan with a real mistake in it, for the shot that shows Sprout catching
 * one. Business Management's catalogue says BUS 300, BUS 302 and MKT 301 must
 * be taken in the same semester; this splits them deliberately.
 */
const bm = PROGRAMS.find((p) => p.label === "Business Management")!;
seeds.businessSplit = {
  enrolledIds: [bm.id],
  placements: [
    { instanceId: "x0", courseId: "BUS100", termId: "2026F", block: null },
    { instanceId: "x1", courseId: "BUS200", termId: "2026F", block: null },
    { instanceId: "x2", courseId: "BUS300", termId: "2027W", block: null },
    { instanceId: "x3", courseId: "MKT301", termId: "2027W", block: null },
    { instanceId: "x4", courseId: "BUS302", termId: "2027S", block: null },
  ].filter((p) => COURSE_BY_ID.has(p.courseId)),
};

writeFileSync(
  new URL("./.shotplans.json", import.meta.url),
  JSON.stringify(seeds, null, 1),
);
for (const [k, v] of Object.entries(seeds))
  console.log(`${k.padEnd(16)} ${v.placements.length} courses`);
console.log("→ scripts/.shotplans.json");
