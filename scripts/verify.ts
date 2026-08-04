/* Acceptance-criteria audit — BUILD_PROMPT §7, updated for user data changes:
 *  - 2026-07-27: Spring 2026 grades user-asserted as all A's (DATA_GAPS M5)
 *  - 2026-07-27: CIT 160 user-confirmed as alternative prereq for CSE 111 (U7)
 *  - 2026-07-27: Winter terms are Flex Track — plannable like any semester (I7)
 * Run with `npm run verify`.
 */
import { COURSES, EE, course } from "../src/data";
import {
  buildPlan,
  checkPrereqAt,
  prereqDepth,
  validateDrop,
  isAtRisk,
} from "../src/engine/plan";
import { PROJECTS } from "../src/data/projects";
import { evaluateProgram, railRows } from "../src/engine/requirements";
import { marginalMinorCost } from "../src/engine/insights";
import { planBottlenecksAsap, planWishlist } from "../src/engine/autoplan";
import type { Occurrence } from "../src/engine/plan";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const model = buildPlan([]);

// 1. transcript: 4 original + 5 Spring 2026 (all A) = 9 completed, 11+12 = 23 credits
check(
  "9 completed courses",
  model.completedCourseIds.length === 9,
  `got ${model.completedCourseIds.length}: ${model.completedCourseIds.join(",")}`,
);
check("23 earned credits", model.totalEarnedCredits === 23, `got ${model.totalEarnedCredits}`);

// 2. Spring 2026: 5 courses, 12 credits, all completed (user-asserted A's)
const spring = model.occurrencesByTerm.get("2026S")!;
check("Spring 2026 has 5 courses", spring.length === 5, `got ${spring.length}`);
check(
  "Spring 2026 = 12 credits",
  spring.reduce((s, o) => s + o.credits, 0) === 12,
);
check(
  "Spring 2026 all completed",
  spring.every((o) => o.state === "completed"),
  spring.map((o) => `${o.courseId}:${o.state}`).join(","),
);

// 3. Fall 2026: 6 courses, 11 credits counting toward the degree
const fall = model.occurrencesByTerm.get("2026F")!;
const countingCr = (o: Occurrence) => (o.countsForCredit ? o.credits : 0);
check("Fall 2026 has 6 courses", fall.length === 6, `got ${fall.length}`);
check(
  "Fall 2026 = 11 counting credits",
  fall.reduce((s, o) => s + countingCr(o), 0) === 11,
  `got ${fall.reduce((s, o) => s + countingCr(o), 0)}`,
);

// 4. Core Engineering still 3 of 12 touched (CSE111 completed, ECEN150/240 registered)
const ee = evaluateProgram(EE, model);
const rows = railRows(ee);
const coreReq = rows.find((r) => r.eval.bucket.id === "core-required")!;
check(
  "Core Engineering required 3 of 12 touched",
  coreReq.eval.have === 3 && coreReq.eval.need === 12,
  `got ${coreReq.eval.have}/${coreReq.eval.need} (${coreReq.eval.used.join(",")})`,
);

// 5. MATH 112X direct unlocks: was 3 in the original fixture; catalog-fetched
// prereqs (2026-07-27) added MATH113, CHEM106, GEOL435 → 6. Still never the
// transitive number.
const m112 = model.derived.get("MATH112X")!;
check(
  "MATH112X direct unlocks = 6 (catalog-verified)",
  m112.directUnlocks.length === 6,
  `got ${m112.directUnlocks.length}: ${m112.directUnlocks.join(",")}`,
);

// 6. Flex Track: ECEN470 (Winter-only) is NOT at-risk anymore, but carries the flex info note
const e470 = model.derived.get("ECEN470")!;
check("ECEN470 not at-risk (flex winters)", !isAtRisk("ECEN470", model));
check(
  "ECEN470 carries Flex Track note",
  e470.flags.some((f) => f.level === "info" && f.text.includes("Flex")),
);
// (ECEN470 itself still needs ECEN380 first — so test flex-droppability with a
// prereq-free course, and confirm ECEN470's winter refusal is about prereqs, not the term)
const vWinter = validateDrop("BIO180", "2027W", model);
check(
  "Flex (Winter) term accepts drops like any semester",
  vWinter.allowed,
  JSON.stringify(vWinter),
);
const v470 = validateDrop("ECEN470", "2028W", model);
check(
  "ECEN470 winter refusal cites prereqs, not the term",
  !v470.allowed && (v470.reason ?? "").includes("ECEN 380"),
  JSON.stringify(v470),
);

// 7. ECEN 350 before ECEN 250 is refused with a reason
const v350 = validateDrop("ECEN350", "2027S", model);
check(
  "ECEN350 drop before ECEN250 refused",
  !v350.allowed && v350.reason !== null,
  JSON.stringify(v350),
);

// 8. ECEN 240's inferred edge was replaced by the catalog truth (no prereq at
// all) — its verdict is no longer unconfirmed, and no unverified edges remain.
const v240 = validateDrop("ECEN240", "2027S", model);
check("ECEN240 verdict no longer unconfirmed", v240.unconfirmed === false);
check(
  "zero verified:false edges remain",
  COURSES.every((c) => c.verified),
  COURSES.filter((c) => !c.verified)
    .map((c) => c.id)
    .join(","),
);

// 9. BIO 180: terms-unconfirmed notice, no term error
const bio = model.derived.get("BIO180")!;
check(
  "BIO180 has unconfirmed-terms notice",
  bio.flags.some((f) => f.level === "info" && f.text.includes("unconfirmed")),
);
check("BIO180 raises no error", !bio.flags.some((f) => f.level === "error"));

// 10. CSE 450 or-prereq satisfied by DS 250 alone (registered 2026F)
const occ = new Map(
  [...model.derived.entries()].map(([id, d]) => [id, d.occurrences]),
);
const t2027S = model.termById.get("2027S")!;
const cse450 = checkPrereqAt(course("CSE450"), t2027S.index, occ);
check("CSE450 or-prereq satisfied via DS250", cse450.ok, JSON.stringify(cse450));

// 11. CIT 160 accepted as CSE 111 alternative prereq — no warning on CSE 111
const cse111 = model.derived.get("CSE111")!;
check(
  "CSE111 has no prereq warning (CIT160 alternative)",
  !cse111.flags.some((f) => f.level === "warning"),
  cse111.flags.map((f) => f.text).join(" | "),
);

// 12. EE total renders as the range 109–120
check(
  "EE total is a 109–120 range",
  EE.totalCredits.min === 109 && EE.totalCredits.max === 120,
);

// 13. Real terms are read-only
const vReal = validateDrop("BIO180", "2026F", model);
check("Real term drop is blocked", !vReal.allowed);

// 14. GE not double counted: 23 earned + 11 registered = 34
check("Plan total = 34 (GE counted once)", model.totalPlanCredits === 34, `got ${model.totalPlanCredits}`);

// 15. Marginal minor cost = 8 credits
const mc = marginalMinorCost(model);
check("Minor marginal cost = 8 credits", mc.marginalCredits === 8, `got ${mc.marginalCredits}`);

// 16. Math & Science core slack = 1
const msCore = rows.find((r) => r.eval.bucket.id === "ms-core")!;
check("ms-core slack = 1", msCore.eval.slack === 1, `got ${msCore.eval.slack}`);

// 17. Autoplan: places ECEN250 + chains + single-term electives, all valid drops
const auto = planBottlenecksAsap(model);
check("Autoplan places courses", auto.additions.length > 0, JSON.stringify(auto));
check(
  "Autoplan includes ECEN250 (gate course)",
  auto.additions.some((a) => a.courseId === "ECEN250"),
  auto.additions.map((a) => `${a.courseId}→${a.termId}`).join(","),
);
{
  // Apply sequentially — each placement must validate against the plan as built so far.
  let working: { courseId: string; termId: string }[] = [];
  let allValid = true;
  let firstBad = "";
  for (const a of auto.additions) {
    const m = buildPlan(
      working.map((w, i) => ({
        instanceId: `t${i}`,
        courseId: w.courseId,
        termId: w.termId,
        block: null,
      })),
    );
    const v = validateDrop(a.courseId, a.termId, m);
    if (!v.allowed) {
      allValid = false;
      firstBad = `${a.courseId}→${a.termId}: ${v.reason}`;
      break;
    }
    working.push(a);
  }
  check("Autoplan placements all validate", allValid, firstBad);
}

// 18. Wishlist auto-fill: schedules a chosen set and pulls in missing prereqs
{
  const wish = ["ECEN470", "CSE455"];
  const r = planWishlist(model, wish, { maxCredits: 15 });
  check(
    "Wishlist schedules every requested course",
    wish.every((id) => r.additions.some((a) => a.courseId === id)),
    JSON.stringify(r.additions.map((a) => `${a.courseId}->${a.termId}`)),
  );
  check(
    "Wishlist pulls in missing prerequisites",
    r.pulledIn.length > 0 && r.additions.some((a) => a.courseId === "ECEN380"),
    `pulledIn=${r.pulledIn.join(",")}`,
  );
  // each placement must be legal against the plan built so far
  const acc: { courseId: string; termId: string }[] = [];
  let ok = true;
  let bad = "";
  for (const a of r.additions) {
    const m = buildPlan(
      acc.map((w, i) => ({
        instanceId: `w${i}`,
        courseId: w.courseId,
        termId: w.termId,
        block: null,
      })),
    );
    const v = validateDrop(a.courseId, a.termId, m);
    if (!v.allowed) {
      ok = false;
      bad = `${a.courseId}->${a.termId}: ${v.reason}`;
      break;
    }
    acc.push(a);
  }
  check("Wishlist placements all validate", ok, bad);
  const overCap = new Map<string, number>();
  for (const a of r.additions) {
    const cr = course(a.courseId).credits;
    overCap.set(a.termId, (overCap.get(a.termId) ?? 0) + cr);
  }
  check(
    "Wishlist respects the credit cap",
    [...overCap.values()].every((v) => v <= 15),
    JSON.stringify([...overCap]),
  );
}

// 19. Prerequisite depth drives the tree stagger
check("MATH112X depth 0", prereqDepth("MATH112X") === 0);
check(
  "ECEN351 sits deeper than ECEN340",
  prereqDepth("ECEN351") > prereqDepth("ECEN340"),
  `${prereqDepth("ECEN351")} vs ${prereqDepth("ECEN340")}`,
);
check(
  "every project references real courses",
  PROJECTS.every((p) => p.courses.every((id) => COURSES.some((c) => c.id === id))),
);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(
  "autoplan preview:",
  auto.additions.map((a) => `${a.courseId}→${a.termId}`).join(", "),
);
if (fail > 0) process.exit(1);
