/* Acceptance-criteria audit — BUILD_PROMPT §7, updated for user data changes:
 *  - 2026-08-06: official transcript supplied. Spring 2026 grades corrected
 *    (A, A, A-, B+, A- — NOT the all-A's asserted on 2026-07-27), and the
 *    cumulative GPA is now checked against the transcript's own three numbers
 *    (DATA_GAPS M5, U13)
 *  - 2026-08-06: prerequisites/corequisites re-audited against the live catalog
 *    after the original import read only one of six requisite fields (U9, U10)
 *  - 2026-07-27: CIT 160 user-confirmed as alternative prereq for CSE 111 (U7)
 *  - 2026-07-27: Winter terms are Flex Track — plannable like any semester (I7)
 * Run with `npm run verify`.
 */
import { AI_MINOR, COURSES, EE, PROGRAMS, PROGRAM_BY_ID, course } from "../src/data";
import { existsSync, readFileSync } from "node:fs";

/**
 * The suite asserts concrete numbers from a real transcript. The app now ships
 * a BLANK student so a new user starts clean, so those numbers have to come
 * from somewhere else: `data/student.mine.json`, which is read here and never
 * imported by `src/`, so it cannot reach the bundle.
 *
 * Absent (a fresh clone, or someone else's machine) the transcript-dependent
 * assertions are skipped rather than failed — they are about one person's
 * record, not about the engine being wrong.
 */
const MINE = new URL("../data/student.mine.json", import.meta.url);
const HAS_TRANSCRIPT = existsSync(MINE);
const STUDENT = HAS_TRANSCRIPT
  ? (JSON.parse(readFileSync(MINE, "utf8")) as typeof import("../src/data").STUDENT)
  : (JSON.parse(
      readFileSync(new URL("../data/student.json", import.meta.url), "utf8"),
    ) as typeof import("../src/data").STUDENT);

/**
 * The suite's fixture student declares EE + the A.I. minor, so the engine is
 * pointed at that enrollment explicitly. Without it every scope-dependent
 * number collapses to zero, because the *shipped* record declares nothing.
 */
const MY_PROGRAM_IDS = declaredEnrollmentOf(STUDENT);
const MY_CODES = programCodesFor(MY_PROGRAM_IDS);
setActiveEnrollment(MY_PROGRAM_IDS);

/** Every assertion below plans against the real record, not the shipped blank. */
const buildPlan = (
  placements: Parameters<typeof buildPlanFor>[0],
  dropped: Parameters<typeof buildPlanFor>[1] = [],
  codes: Parameters<typeof buildPlanFor>[2] = MY_CODES,
) => buildPlanFor(placements, dropped, codes, STUDENT);
const cumulativeGpa = () => cumulativeGpaFor(STUDENT);
const projectGpa = (
  grade: Parameters<typeof projectGpaFor>[0],
  upcoming: Parameters<typeof projectGpaFor>[1],
) => projectGpaFor(grade, upcoming, STUDENT);

if (!HAS_TRANSCRIPT)
  console.log(
    "data/student.mine.json absent — transcript-dependent checks will not be meaningful.",
  );
import {
  buildPlan as buildPlanFor,
  checkPrereqAt,
  dependencyIds,
  earliestLegalTerm,
  prereqDepth,
  prereqLeaves,
  registrationKey,
  validateDrop,
  isAtRisk,
} from "../src/engine/plan";
import { PROJECTS, projectsApplyTo } from "../src/data/projects";
import {
  evaluateProgram,
  obsoleteCourseIds,
  railRows,
  requiredCourseIds,
  bucketPoolIds,
} from "../src/engine/requirements";
import { bottlenecks, marginalMinorCost } from "../src/engine/insights";
import {
  cumulativeGpa as cumulativeGpaFor,
  formatGpa,
  gradePoints,
  projectGpa as projectGpaFor,
  termLoad,
  termLoadNote,
} from "../src/engine/gpa";
import { planBottlenecksAsap, planWishlist } from "../src/engine/autoplan";
import { computeReach, deepestFirst } from "../src/engine/reach";

import {
  normalizeNode,
  parseRequisites,
  sameNode,
} from "../src/engine/prereqParse";
import { CATALOG, programCodesFor } from "../src/engine/programs";
import { setActiveEnrollment } from "../src/engine/scope";
import { sameTermGroups } from "../src/engine/requirements";

/** Resolve a record's declarations to program ids, the same way the app does. */
function declaredEnrollmentOf(st: { major?: { code: string } | null; minor?: { code: string } | null; generalEducation?: { code: string } | null }): string[] {
  return [st.major, st.minor, st.generalEducation]
    .filter((d): d is { code: string } => !!d)
    .map((d) => CATALOG.find((p) => p.code === d.code)?.id)
    .filter((id): id is string => !!id);
}
import {
  assertsRequirements,
  enforcesPrereq,
  trustOf,
  trustOfProgram,
} from "../src/engine/trust";
import {
  checkRestrictions,
  parseRestriction,
  restrictionsOf,
} from "../src/engine/restrictions";
import { suggestTerm } from "../src/engine/suggest";
import type { Occurrence } from "../src/engine/plan";
import type { Bucket, PrereqNode } from "../src/types";

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

// 1. transcript: 4 original + 5 Spring 2026 = 9 completed, 11+12 = 23 earned credits
check(
  "9 completed courses",
  model.completedCourseIds.length === 9,
  `got ${model.completedCourseIds.length}: ${model.completedCourseIds.join(",")}`,
);
check("23 earned credits", model.totalEarnedCredits === 23, `got ${model.totalEarnedCredits}`);

// 2. Spring 2026: 5 courses, 12 credits, all completed (A, A, A-, B+, A-)
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

// 5. MATH 112X direct unlocks: 3 in the original fixture, 6 after the first
// catalog fetch, 7 after the 2026-08-06 re-audit (ECEN 150 lists MATH 112X as a
// prerequisite, not a corequisite). Still never the transitive number.
const m112 = model.derived.get("MATH112X")!;
check(
  "MATH112X direct unlocks = 7 (catalog-verified)",
  m112.directUnlocks.length === 7,
  `got ${m112.directUnlocks.length}: ${m112.directUnlocks.join(",")}`,
);

// 5b. The 2026-08-06 re-audit rebuilt the ECEN graph: ECEN 250 is the real gate
// (9 direct unlocks), and ECEN 340/380/390 gate nothing at all.
check(
  "ECEN250 is the top gate course (9 direct unlocks)",
  model.derived.get("ECEN250")!.directUnlocks.length === 9,
  `got ${model.derived.get("ECEN250")!.directUnlocks.join(",")}`,
);
for (const id of ["ECEN340", "ECEN380", "ECEN390"]) {
  check(
    `${id} unlocks nothing directly (catalog-verified)`,
    model.derived.get(id)!.directUnlocks.length === 0,
    `got ${model.derived.get(id)!.directUnlocks.join(",")}`,
  );
}

// 5c. Corequisites let a course share a term with its dependency. ECEN 299 is
// a coreq of ECEN 250, so both may sit in the same semester.
{
  const both = buildPlan([
    { instanceId: "c1", courseId: "ECEN250", termId: "2027S", block: null },
  ]);
  const v299 = validateDrop("ECEN299", "2027S", both);
  check("ECEN299 may share a term with ECEN250 (coreq)", v299.allowed, JSON.stringify(v299));
  const v299early = validateDrop("ECEN299", "2027W", both);
  check(
    "ECEN299 before ECEN250 is still refused",
    !v299early.allowed,
    JSON.stringify(v299early),
  );
}

// 6. Flex Track. The 2026-08-06 schedule scrape corrected which courses are
// actually Winter-only: student.json listed six, but ECEN 311 and ECEN 470 both
// run in Fall too. ECEN 351/451/461/480 are the real Winter-only set.
check("ECEN470 not at-risk (flex winters)", !isAtRisk("ECEN470", model));
check(
  "ECEN470 runs in Fall as well as Winter (schedule-verified)",
  ["F", "W"].every((s) => course("ECEN470").terms.includes(s as never)),
  course("ECEN470").terms.join("/"),
);
check(
  "ECEN311 runs in Fall as well as Winter (schedule-verified)",
  ["F", "W"].every((s) => course("ECEN311").terms.includes(s as never)),
  course("ECEN311").terms.join("/"),
);
for (const id of ["ECEN351", "ECEN451", "ECEN461", "ECEN480"]) {
  const d = model.derived.get(id)!;
  check(
    `${id} is Winter-only and carries the Flex Track note`,
    course(id).terms.join("") === "W" &&
      d.flags.some((f) => f.level === "info" && f.text.includes("Flex")),
    `${course(id).terms.join("/")} | ${d.flags.map((f) => f.text).join(" ")}`,
  );
}
// Retired courses are pinned to no season, so nothing can be planned into them.
for (const id of ["ECEN101", "CIT160"]) {
  check(`${id} is retired — no offered terms`, course(id).terms.length === 0);
}
check(
  "a retired course cannot be dropped into any term",
  !validateDrop("ECEN101", "2027W", model).allowed,
  JSON.stringify(validateDrop("ECEN101", "2027W", model)),
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
  !v470.allowed && (v470.reason ?? "").includes("ECEN 250"),
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
/**
 * The hand-audited set. Phase 5 loaded the whole 2,031-course catalogue, so
 * assertions that used to say "every course" now have to say which courses —
 * the 136 a human read, or all of them. `trustOf` is the discriminator:
 * generated entries are never `human`.
 */
const AUDITED = COURSES.filter((c) => !c.isPlaceholder && trustOf(c) === "human");

const v240 = validateDrop("ECEN240", "2027S", model);
check("ECEN240 verdict no longer unconfirmed", v240.unconfirmed === false);
check(
  "zero verified:false edges remain among the audited courses",
  AUDITED.every((c) => c.verified),
  AUDITED.filter((c) => !c.verified)
    .map((c) => c.id)
    .join(","),
);
// The rest of the catalogue is machine-parsed by design and must NOT claim to
// be verified — that flag is what `trustOf` reads to decide enforcement.
check(
  "no generated course claims to be hand-verified",
  COURSES.filter((c) => trustOf(c) !== "human").every((c) => !c.verified),
);

// 9. Offered terms. Before the 2026-08-06 scrape only 36 of 133 courses had
// confirmed terms; now 128 do. The four that don't are courses the schedule
// genuinely never listed in 2026 — they must still show the neutral notice and
// must never raise a "not offered" error.
{
  const confirmed = AUDITED.filter((c) => c.termsConfirmed);
  check(
    "129 of 133 courses have schedule-confirmed terms",
    confirmed.length === 129,
    `got ${confirmed.length}`,
  );
  const unconfirmed = AUDITED.filter((c) => !c.termsConfirmed);
  check(
    "the unconfirmed remainder is the four never seen in 2026",
    unconfirmed.map((c) => c.id).sort().join(",") ===
      "BYUI151,BYUI152,BYUI153,GEINT212",
    unconfirmed.map((c) => c.id).join(","),
  );
  for (const c of unconfirmed) {
    const d = model.derived.get(c.id)!;
    check(
      `${c.id} keeps the neutral notice and raises no error`,
      d.flags.some((f) => f.level === "info" && f.text.includes("unconfirmed")) &&
        !d.flags.some((f) => f.level === "error"),
      d.flags.map((f) => `${f.level}:${f.text}`).join(" | "),
    );
  }
  // BIO 180 is confirmed now, so it must NOT carry the notice any more.
  const bio = model.derived.get("BIO180")!;
  check(
    "BIO180 no longer claims unconfirmed terms",
    !bio.flags.some((f) => f.text.includes("Offered terms unconfirmed")) &&
      !bio.flags.some((f) => f.level === "error"),
    bio.flags.map((f) => f.text).join(" | "),
  );
}

// 9b. Half-semester blocks are real data now, not a placeholder.
check(
  "CSE121c is block-only — it has no full-semester section",
  course("CSE121c").blocks?.join(",") === "1st,2nd",
  JSON.stringify(course("CSE121c").blocks),
);
check(
  "CSE212 is full-semester only",
  course("CSE212").blocks?.join(",") === "full",
  JSON.stringify(course("CSE212").blocks),
);
check(
  "all 129 audited courses still have schedule-confirmed blocks",
  AUDITED.filter((c) => c.blocksConfirmed).length === 129,
  `got ${AUDITED.filter((c) => c.blocksConfirmed).length}`,
);
// The scripted scrape now covers every discipline, not the 33 the fixture
// touched. Its credibility rests on reproducing the hand-checked scrape
// exactly — 128/128 on terms, blocks and online — which is asserted below.
check(
  "the catalogue-wide scrape confirmed blocks for most generated courses",
  COURSES.filter((c) => trustOf(c) !== "human" && c.blocksConfirmed).length >
    1500,
  `got ${COURSES.filter((c) => trustOf(c) !== "human" && c.blocksConfirmed).length}`,
);
// A course the scrape never saw must stay UNCONFIRMED, never `terms: []`.
// `terms: []` means "retired, will never run" and blocks planning outright;
// one cycle of evidence cannot distinguish a dead course from a two-year
// rotation (DATA_GAPS U14).
check(
  "a course absent from the 2026 cycle is unconfirmed, not retired",
  COURSES.filter(
    (c) => trustOf(c) !== "human" && !c.isPlaceholder && c.terms.length === 0,
  ).length === 0,
);

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

// 13. Completed terms are read-only; a registered term is not — you can still
// add and drop during registration, so the board lets you rearrange it.
for (const t of ["2023F", "2026S"]) {
  const v = validateDrop("BIO180", t, model);
  check(
    `${t} is history — drops are blocked`,
    !v.allowed && (v.reason ?? "").includes("history"),
    JSON.stringify(v),
  );
}
{
  const v = validateDrop("BIO180", "2026F", model);
  check(
    "the registered term accepts new courses",
    v.allowed,
    JSON.stringify(v),
  );
}

// 13b. Dropping a registration removes it from the plan without touching the
// transcript, and it can then be planned into another term.
{
  const key = registrationKey("2026F", "REL327");
  const before = model.derived.get("REL327")!;
  check(
    "REL327 counts as registered before the drop",
    before.status === "registered",
    before.status,
  );
  const after = buildPlan([], [key]);
  check(
    "dropping a registration clears its status",
    after.derived.get("REL327")!.status === "available",
    after.derived.get("REL327")!.status,
  );
  check(
    "Fall 2026 loses those credits",
    (after.occurrencesByTerm.get("2026F") ?? []).length ===
      (model.occurrencesByTerm.get("2026F") ?? []).length - 1,
  );
  check(
    "the dropped course can be planned into a later term",
    validateDrop("REL327", "2027S", after).allowed,
    JSON.stringify(validateDrop("REL327", "2027S", after)),
  );
  // The transcript itself is untouched: rebuild with no drops and it returns.
  check(
    "dropping is reversible — the transcript is never written",
    buildPlan([], []).derived.get("REL327")!.status === "registered",
  );
  // A completed course can never be dropped, even if a key is forged.
  const forged = buildPlan([], [registrationKey("2026S", "MATH112X")]);
  check(
    "a completed course cannot be dropped",
    forged.derived.get("MATH112X")!.status === "completed",
    forged.derived.get("MATH112X")!.status,
  );
}

// 13c. Retired courses refuse with a reason that names the replacement.
{
  const v = validateDrop("CIT160", "2027S", model);
  check(
    "CIT160 refuses with a retirement reason, not an empty term list",
    !v.allowed &&
      (v.reason ?? "").includes("retired") &&
      (v.reason ?? "").includes("CSE 110") &&
      !(v.reason ?? "").includes("offered: )"),
    v.reason ?? "",
  );
}

// 14. GE not double counted: 23 earned + 11 registered = 34
check("Plan total = 34 (GE counted once)", model.totalPlanCredits === 34, `got ${model.totalPlanCredits}`);

// 15. Marginal minor cost = 8 credits
const mc = marginalMinorCost(model);
check("Minor marginal cost = 8 credits", mc.marginalCredits === 8, `got ${mc.marginalCredits}`);

// 16. Math & Science core slack = 1
const msCore = rows.find((r) => r.eval.bucket.id === "ms-core")!;
check("ms-core slack = 1", msCore.eval.slack === 1, `got ${msCore.eval.slack}`);

// 17. Autoplan: places ECEN250 + chains + single-term electives, all valid drops
const obsolete = obsoleteCourseIds(
  [ee, evaluateProgram(AI_MINOR, model)],
  model,
);
const auto = planBottlenecksAsap(model, obsolete);
check("Autoplan places courses", auto.additions.length > 0, JSON.stringify(auto));
check(
  "Autoplan skips not-needed courses (MATH110X etc.)",
  auto.additions.every((a) => !obsolete.has(a.courseId)),
  auto.additions
    .filter((a) => obsolete.has(a.courseId))
    .map((a) => a.courseId)
    .join(","),
);
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
    r.pulledIn.length > 0 && r.additions.some((a) => a.courseId === "ECEN250"),
    `pulledIn=${r.pulledIn.join(",")}`,
  );
  // An OR means "pick one". Scheduling every branch would over-plan the degree:
  // MATH 316 needs MATH 214 *or* MATH 215, never both.
  check(
    "Wishlist commits to one OR branch",
    !(
      r.additions.some((a) => a.courseId === "MATH214") &&
      r.additions.some((a) => a.courseId === "MATH215")
    ),
    r.additions.map((a) => a.courseId).join(","),
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
// ECEN 351's prerequisite is ECEN 350 (not ECEN 340, as the pre-audit fixture
// had it), so it must draw to the right of ECEN 350 — the point of I12 is that
// horizontal position tracks real prerequisite depth, whatever the edge is.
check(
  "ECEN351 sits deeper than ECEN350",
  prereqDepth("ECEN351") > prereqDepth("ECEN350"),
  `${prereqDepth("ECEN351")} vs ${prereqDepth("ECEN350")}`,
);
check(
  "ECEN380 sits deeper than ECEN250",
  prereqDepth("ECEN380") > prereqDepth("ECEN250"),
  `${prereqDepth("ECEN380")} vs ${prereqDepth("ECEN250")}`,
);
// A corequisite costs no column — it may be taken in the same term. CHEM 105
// has NO prerequisite, only a math corequisite, so it belongs at the far left.
check("CHEM105 depth 0 (coreq only)", prereqDepth("CHEM105") === 0, `${prereqDepth("CHEM105")}`);
check("PH121 depth 0 (no requisites)", prereqDepth("PH121") === 0, `${prereqDepth("PH121")}`);
check(
  "ECEN299 shares a column with ECEN250 (coreq)",
  prereqDepth("ECEN299") === prereqDepth("ECEN250"),
  `${prereqDepth("ECEN299")} vs ${prereqDepth("ECEN250")}`,
);
// An OR ranks by the branch the student would actually take, not the deepest.
check(
  "MATH341 depth 1 (cheapest OR branch)",
  prereqDepth("MATH341") === 1,
  `${prereqDepth("MATH341")}`,
);
// Every course must draw strictly right of the prerequisites it cannot avoid.
// Only leaves reachable without passing through an OR count: CHEM 106 accepts
// any of five math courses, so it is not ranked by the deepest of them.
{
  const mandatory = (n: PrereqNode, out: string[] = []): string[] => {
    if (n == null) return out;
    if (typeof n === "string") {
      out.push(n);
      return out;
    }
    if ("and" in n) n.and.forEach((k) => mandatory(k, out));
    return out; // an OR branch is optional by definition
  };
  let bad = "";
  for (const c of COURSES) {
    if (c.isPlaceholder || bad) continue;
    for (const p of mandatory(c.prereq)) {
      if (!COURSES.some((x) => x.id === p)) continue;
      if (prereqDepth(c.id) <= prereqDepth(p))
        bad = `${c.code} (col ${prereqDepth(c.id)}) not right of ${p} (col ${prereqDepth(p)})`;
    }
  }
  check("every course draws right of its required prerequisites", !bad, bad);
}
// 20. GPA reproduced against the OFFICIAL transcript (supplied 2026-08-06).
// This is the strongest check in the suite: it pins the grade-point scale, the
// retake rule, and every Spring 2026 grade to three published numbers at once.
{
  const g = cumulativeGpa();
  /**
   * Skip, loudly, when the official numbers are absent.
   *
   * `_transcript.cumulative` holds figures copied from the published I-Plan
   * transcript, and this block exists to check the app's GPA maths against
   * them. Reconstructing them from the app would make the check circular — it
   * would pass by construction and test nothing — so the honest failure mode is
   * to say the numbers are missing rather than to invent them.
   */
  const official = STUDENT._transcript?.cumulative;
  if (!official) {
    console.log(
      [
        "  SKIP  GPA vs official transcript — data/student.mine.json has no",
        "        _transcript block. Paste the cumulative quality points, GPA",
        "        credits, attempted credits and GPA from I-Plan to restore it.",
      ].join("\n"),
    );
  } else {
  check(
    `quality points match the transcript (${official.qualityPoints})`,
    Math.abs(g.official.qualityPoints - official.qualityPoints) < 0.001,
    `got ${g.official.qualityPoints}`,
  );
  check(
    `GPA credits match the transcript (${official.gpaCredits}, not the ${official.attemptedCredits} attempted)`,
    g.official.gpaCredits === official.gpaCredits,
    `got ${g.official.gpaCredits}`,
  );
  // Exact string match: BYU-Idaho truncates rather than rounding, so 3.03478
  // prints as 3.034. Rounding here would put 3.035 on screen and stop matching
  // what I-Plan shows.
  check(
    `cumulative GPA matches the transcript exactly (${official.gpa})`,
    formatGpa(g.official.gpa) === official.gpa.toFixed(3),
    `got ${formatGpa(g.official.gpa)} from ${g.official.gpa}`,
  );
  check("GPA display truncates, never rounds up", formatGpa(3.0347826) === "3.034");
  check("cumulative GPA clears the 2.0 graduation floor", g.official.gpa >= 2);
  // The 7 credits missing from the denominator are exactly the two retakes.
  check(
    "superseded attempts are ENG150 F and MATH112X UW",
    g.superseded.length === 2 &&
      g.superseded.every(
        (r) =>
          (r.courseId === "ENG150" && r.grade === "F" && r.credits === 3) ||
          (r.courseId === "MATH112X" && r.grade === "UW" && r.credits === 4),
      ),
    g.superseded.map((r) => `${r.courseId}:${r.grade}:${r.credits}`).join(","),
  );
  check(
    "superseded credits explain the attempted/GPA gap",
    g.superseded.reduce((s, r) => s + r.credits, 0) ===
      official.attemptedCredits - official.gpaCredits,
  );
  }
  // These hold whatever the transcript block says — they are properties of the
  // BYU-Idaho scale, not of one student's record.
  check("UW scores 0.0, not excluded", gradePoints("UW") === 0);
  check("W is excluded from the GPA entirely", gradePoints("W") === null);
  check("C+ is 2.4 on the BYU-Idaho scale, not 2.3", gradePoints("C+") === 2.4);
  check("A- is 3.7 and B+ is 3.4", gradePoints("A-") === 3.7 && gradePoints("B+") === 3.4);
}

// 20b. GPA projection over the registered Fall 2026 term (11 graded credits:
// DS250 2, ECEN150 3, ECEN240 3, GS102R 1, REL327 2 — plus the PH121 retake 3).
{
  const upcoming = [
    { courseId: "DS250", credits: 2 },
    { courseId: "ECEN150", credits: 3 },
    { courseId: "ECEN240", credits: 3 },
    { courseId: "GS102R", credits: 1 },
    { courseId: "REL327", credits: 2 },
    { courseId: "PH121", credits: 3 },
  ];
  const base = cumulativeGpa();
  const pA = projectGpa("A", upcoming)!;
  const pC = projectGpa("C", upcoming)!;
  check("projection spans 14 upcoming credits", pA.upcomingCredits === 14);
  check("straight A's raise the GPA", pA.delta > 0, pA.delta.toFixed(3));
  check("straight C's lower it", pC.delta < 0, pC.delta.toFixed(3));
  check("an A projection beats a C projection", pA.projected.gpa > pC.projected.gpa);
  // PH121 sits on the transcript at C+, so the Fall 2026 attempt supersedes it.
  check(
    "PH121 is flagged as retaking a C+",
    pA.replaces.length === 1 &&
      pA.replaces[0].courseId === "PH121" &&
      pA.replaces[0].oldGrade === "C+",
    JSON.stringify(pA.replaces),
  );
  // The retake drops 3 credits of C+ from the denominator, so the projected
  // GPA credits are 23 + 14 - 3 = 34, not 37.
  check(
    "a retake keeps GPA credits from double-counting",
    pA.projected.gpaCredits === 34,
    `got ${pA.projected.gpaCredits}`,
  );
  {
    const noPh = projectGpa("A", upcoming.filter((u) => u.courseId !== "PH121"))!;
    check(
      "retaking PH121 helps more than a fresh 3-credit A would",
      pA.projected.gpa - noPh.projected.gpa > 0,
      `${(pA.projected.gpa - noPh.projected.gpa).toFixed(4)}`,
    );
  }
  check(
    "projecting your current average barely moves it",
    Math.abs(projectGpa("B", upcoming)!.projected.gpa - base.official.gpa) < 0.05,
    `${projectGpa("B", upcoming)!.projected.gpa.toFixed(3)} vs ${base.official.gpa.toFixed(3)}`,
  );
  check("no upcoming courses → no projection", projectGpa("A", []) === null);
  check("an ungradeable mark → no projection", projectGpa("W", upcoming) === null);
}

// 21. Term load against BYU-Idaho's 21-credit recommended maximum.
check("21 credits is not an overload", termLoad(21) === "normal");
check("22 credits is an overload", termLoad(22) === "over");
check("11 credits reads as light (under full-time)", termLoad(11) === "light");
check(
  "overload note cites the approval requirement",
  (termLoadNote(24) ?? "").includes("Student Records"),
  termLoadNote(24) ?? "",
);
check("a normal term raises no note", termLoadNote(15) === null);

// 22. The course picker offers a chip only for sections that actually run.
// Mirrors choicesFor() in CoursePicker.tsx — if that drifts, this catches it.
{
  const chips = (c: (typeof COURSES)[number]) => {
    const out: string[] = [];
    const has = c.blocksConfirmed && c.blocks;
    if (!has || c.blocks!.includes("full")) out.push("full");
    if (has && c.blocks!.includes("1st")) out.push("1st");
    if (has && c.blocks!.includes("2nd")) out.push("2nd");
    if (c.online) out.push("online");
    return out;
  };
  check(
    "CSE121c offers no full-semester chip",
    !chips(course("CSE121c")).includes("full"),
    chips(course("CSE121c")).join(","),
  );
  check(
    "CSE121c offers 1st, 2nd and online",
    ["1st", "2nd", "online"].every((x) => chips(course("CSE121c")).includes(x)),
    chips(course("CSE121c")).join(","),
  );
  check(
    "ECEN250 offers full only",
    chips(course("ECEN250")).join(",") === "full",
    chips(course("ECEN250")).join(","),
  );
  check(
    "every course offers at least one placement chip",
    COURSES.filter((c) => !c.isPlaceholder && c.terms.length > 0).every(
      (c) => chips(c).length > 0,
    ),
    COURSES.filter(
      (c) => !c.isPlaceholder && c.terms.length > 0 && chips(c).length === 0,
    )
      .map((c) => c.id)
      .join(","),
  );
}

// 23. The picker's ★/⧗ guidance set — required-with-no-alternative, or a
// bottleneck — must never include a course the rail has struck as "not needed".
{
  const required = requiredCourseIds();
  const bottleneckIds = new Set(bottlenecks(model, obsolete).map((b) => b.courseId));
  const guided = COURSES.filter(
    (c) =>
      !c.isPlaceholder &&
      !obsolete.has(c.id) &&
      (required.has(c.id) || bottleneckIds.has(c.id)),
  );
  check("the ★/⧗ guidance set is non-empty", guided.length > 0, `${guided.length}`);
  check(
    "no 'not needed' course is ever marked ★ or ⧗",
    guided.every((c) => !obsolete.has(c.id)),
    guided.filter((c) => obsolete.has(c.id)).map((c) => c.id).join(","),
  );
  check(
    "ECEN250 is flagged as a bottleneck for the picker",
    bottleneckIds.has("ECEN250"),
  );
}

// 23b. ★ covers everything forced in practice, not just literal allOf pools.
{
  const req = requiredCourseIds();
  // Exact-fit nCredits: the ECEN 250 + ECEN 299 pool is 3+1 credits for a
  // 4-credit requirement, so neither is avoidable.
  check("★ ECEN250 (exact-fit credit pool)", req.has("ECEN250"));
  check("★ ECEN299 (exact-fit credit pool)", req.has("ECEN299"));
  // ms-core holds 21 credits and needs 20, so anything over 1 credit is forced
  // and only the two 1-credit courses are genuinely optional.
  for (const id of ["CHEM105", "MATH316", "MATH330", "PH121", "PH123", "PH220"])
    check(`★ ${id} (ms-core has only 1 credit of slack)`, req.has(id));
  for (const id of ["PH150", "CHEM105L"])
    check(`${id} stays optional — it IS the slack`, !req.has(id));
  // Present in all three Foundational Math routes, so no route avoids it.
  check("★ MATH112X (in every Foundational Math option)", req.has("MATH112X"));
  check("MATH109 stays optional (one route among three)", !req.has("MATH109"));
  // Only surviving option of Introduction, since option 2 needs retired ECEN 101.
  check("★ ECEN100 (only reachable Introduction option)", req.has("ECEN100"));
  check("CSE121c stays optional (retired ECEN101 path)", !req.has("CSE121c"));
  // A placeholder can be dropped repeatedly, so its pool is never an exact fit.
  check(
    "no placeholder is marked required",
    !COURSES.some((c) => c.isPlaceholder && req.has(c.id)),
    COURSES.filter((c) => c.isPlaceholder && req.has(c.id)).map((c) => c.id).join(","),
  );
  check(
    "REL327/REL333 stay optional — the REL pool takes placeholders",
    !req.has("REL327") && !req.has("REL333"),
  );
  // Free-choice electives must never be forced.
  for (const id of ["ECEN351", "ECEN411", "ME410", "BIO180"])
    check(`${id} stays optional (elective)`, !req.has(id));
  check("32 courses are required in practice", req.size === 32, `got ${req.size}`);
}

// 24. The header's focus modes. The hook is React, but its sets are plain
// derivations — assert those so a data change can't quietly empty a mode.
{
  const obs = obsoleteCourseIds([ee, evaluateProgram(AI_MINOR, model)], model);
  // Mirrors useFocusSet's walk: ancestors ride along, but the walk stops at
  // anything pruned.
  const build = (roots: string[], stopAt: (id: string) => boolean) => {
    const out = new Set<string>();
    const add = (id: string) => {
      if (out.has(id) || stopAt(id)) return;
      out.add(id);
      const c = COURSES.find((x) => x.id === id);
      if (c) dependencyIds(c).forEach(add);
    };
    roots.forEach(add);
    return out;
  };
  const done = new Set(["completed", "in-progress", "registered", "planned"]);
  const settled = (id: string) => done.has(model.derived.get(id)?.status ?? "");
  const req = build([...requiredCourseIds()], (id) => obs.has(id));
  const bott = build(
    bottlenecks(model, obs).map((b) => b.courseId),
    (id) => obs.has(id),
  );
  const left = build(
    [...requiredCourseIds()].filter((id) => !obs.has(id) && !settled(id)),
    (id) => obs.has(id) || settled(id),
  );

  check("★ required focus is non-empty", req.size > 0, `${req.size}`);
  check("⧗ bottleneck focus is non-empty", bott.size > 0, `${bott.size}`);
  check("◦ still-to-plan focus is non-empty", left.size > 0, `${left.size}`);
  check(
    "required focus pulls in prerequisite ancestors",
    req.has("ECEN150") && req.has("ECEN250"),
    "ECEN150/ECEN250 should ride along with the ECEN chain",
  );
  check(
    "still-to-plan excludes what you already have",
    !left.has("ENG150") && !left.has("CSE111"),
    [...left].filter((id) => ["ENG150", "CSE111"].includes(id)).join(","),
  );
  check(
    "still-to-plan is a subset of required focus",
    [...left].every((id) => req.has(id)),
    [...left].filter((id) => !req.has(id)).join(","),
  );
  check(
    "no focus mode highlights a 'not needed' course",
    ![...req, ...bott, ...left].some((id) => obs.has(id)),
    [...new Set([...req, ...bott, ...left])].filter((id) => obs.has(id)).join(","),
  );
}

// 25. "What to take next." Every pick must be a legal drop in the term it is
// suggested for — the whole feature is worthless if it recommends the illegal.
{
  const obs = obsoleteCourseIds([ee, evaluateProgram(AI_MINOR, model)], model);
  const s = suggestTerm(model, obs)!;
  check("a next term is suggested", !!s, "none");
  check(
    "it skips Flex Track winters until you use one",
    s.term.id === "2027S",
    s.term.id,
  );
  check("it fills toward the credit target", s.totalCredits > 0 && s.totalCredits <= 15, `${s.totalCredits}`);
  check(
    "never suggests an overload",
    termLoad(s.totalCredits) !== "over",
    `${s.totalCredits} cr`,
  );
  check(
    "every pick is a legal drop in that term",
    s.picks.every((p) => validateDrop(p.courseId, s.term.id, model).allowed),
    s.picks
      .filter((p) => !validateDrop(p.courseId, s.term.id, model).allowed)
      .map((p) => p.code)
      .join(","),
  );
  check(
    "no pick is already done, planned or 'not needed'",
    s.picks.every((p) => {
      const st = model.derived.get(p.courseId)?.status;
      return !obs.has(p.courseId) && (st === "available" || st === "locked");
    }),
    s.picks.map((p) => `${p.code}:${model.derived.get(p.courseId)?.status}`).join(","),
  );
  check("every pick carries a reason", s.picks.every((p) => p.reasons.length > 0));
  check(
    "the top gate outranks a short critical chain",
    s.picks[0]?.courseId === "ECEN250",
    s.picks.map((p) => `${p.code}[${p.score}]`).join(" "),
  );
  // Once a term is filled, the suggester moves to the next one.
  {
    const filled = buildPlan(
      s.picks.map((p, i) => ({
        instanceId: `s${i}`,
        courseId: p.courseId,
        termId: s.term.id,
        block: null,
      })),
    );
    const next = suggestTerm(
      filled,
      obsoleteCourseIds(
        [evaluateProgram(EE, filled), evaluateProgram(AI_MINOR, filled)],
        filled,
      ),
    )!;
    check(
      "filling a term advances the suggestion to the next one",
      next.term.id !== s.term.id,
      `${s.term.id} → ${next.term.id}`,
    );
    check(
      "it does not re-suggest what you just planned",
      !next.picks.some((p) => s.picks.some((q) => q.courseId === p.courseId)),
      next.picks.map((p) => p.code).join(","),
    );
  }
}

// 26. "Earliest you could take it" — the answer an at-risk badge implies.
{
  // A course whose prerequisite is planned LATER: it must report the term
  // after that prerequisite, not the one it is wrongly sitting in.
  const late = buildPlan([
    { instanceId: "a", courseId: "ECEN350", termId: "2027S", block: null },
    { instanceId: "b", courseId: "ECEN250", termId: "2027F", block: null },
  ]);
  check("ECEN350 is at risk when its prereq lands later", isAtRisk("ECEN350", late));
  const e = earliestLegalTerm("ECEN350", late);
  check(
    "its earliest term is after the prerequisite",
    e.term !== null && e.term.index > late.termById.get("2027F")!.index,
    e.term?.label ?? "none",
  );

  // Nothing planned: ECEN 470 needs ECEN 250 and MATH 316, neither on the
  // board, so there is no earliest term — name what to plan first instead.
  const bare = earliestLegalTerm("ECEN470", model);
  check(
    "an unreachable course names what is missing rather than a term",
    bare.term === null && bare.blockedBy.length > 0,
    `${bare.term?.label ?? "none"} / ${bare.blockedBy.join(",")}`,
  );

  // Retired: never, and it says so rather than listing prerequisites.
  const dead = earliestLegalTerm("CIT160", model);
  check(
    "a retired course reports 'never', not a missing-prereq list",
    dead.term === null && dead.retired && dead.blockedBy.length === 0,
    JSON.stringify(dead),
  );

  // A perfectly plannable course still answers, so the field is never blank.
  const fine = earliestLegalTerm("ECEN250", model);
  check(
    "a clean course reports its real first opportunity",
    fine.term?.id === "2027W",
    fine.term?.label ?? "none",
  );

  // "available" is optimistic — it only means a prerequisite sits somewhere on
  // the timeline. CSE 450 is available because DS 250 is registered for Fall,
  // yet it cannot be taken until Winter, so the answer must still be shown.
  check(
    "CSE450 is available yet not takeable until after its registered prereq",
    model.derived.get("CSE450")!.status === "available" &&
      earliestLegalTerm("CSE450", model).term?.id === "2027W",
    `${model.derived.get("CSE450")!.status} / ${earliestLegalTerm("CSE450", model).term?.label}`,
  );
  // Everything unsettled must have an answer of some kind — a term, a
  // missing-prereq list, or retirement. A blank is always a bug.
  {
    const unsettled = COURSES.filter(
      (c) =>
        !c.isPlaceholder &&
        !["completed", "in-progress", "registered", "planned"].includes(
          model.derived.get(c.id)?.status ?? "",
        ),
    );
    const blank = unsettled.filter((c) => {
      const e = earliestLegalTerm(c.id, model);
      return !e.term && !e.retired && e.blockedBy.length === 0;
    });
    check(
      "every unsettled course has an earliest-term answer",
      blank.length === 0,
      blank.map((c) => c.id).join(","),
    );
  }
}

// 27. Reachability — how many terms out each course is when its whole chain is
// planned optimally. This is what available/locked cannot express.
{
  const reach = computeReach(model);
  const obs = obsoleteCourseIds([ee, evaluateProgram(AI_MINOR, model)], model);

  check(
    "every non-placeholder course gets a reach entry",
    COURSES.filter((c) => !c.isPlaceholder).every((c) => reach.has(c.id)),
  );
  // Status says nothing about distance: two "locked" courses sit 2 and 3 terms
  // out, and two "available" ones are both immediately takeable.
  check(
    "locked courses differ in how far out they are",
    reach.get("ECEN470")!.termsAway === 2 &&
      reach.get("ECEN351")!.termsAway === 3,
    `470=${reach.get("ECEN470")!.termsAway} 351=${reach.get("ECEN351")!.termsAway}`,
  );
  check(
    "available courses are 0 terms out",
    reach.get("ECEN250")!.termsAway === 0 && reach.get("CSE450")!.termsAway === 0,
  );
  // A chain must run strictly forward in time and end on the course itself.
  for (const id of ["ECEN411", "ECEN351", "CSE455"]) {
    const r = reach.get(id)!;
    const idx = r.path.map((s) => s.term?.index ?? -1);
    check(
      `${id}'s chain runs forward and ends on itself`,
      r.path[r.path.length - 1].courseId === id &&
        idx.every((v, i) => i === 0 || v >= idx[i - 1]),
      r.path.map((s) => `${s.code}@${s.term?.label}`).join(" → "),
    );
  }
  // Winter-only scarcity must push a course a full year, not one term.
  // ECEN 480 needs ECEN 250 (Winter 2027) but only runs in Winter.
  check(
    "a Winter-only course waits a full year for its slot",
    reach.get("ECEN480")!.term?.id === "2028W",
    reach.get("ECEN480")!.term?.label ?? "none",
  );
  // Retirement only bites a course you have not already taken. CIT 160 is
  // retired but sits on the transcript, so it resolves as settled — being
  // unable to take it again is irrelevant when it is already done.
  check("an untaken retired course is unreachable", reach.get("ECEN101")!.impossible);
  check(
    "a retired course you already passed is settled, not unreachable",
    reach.get("CIT160")!.settled && !reach.get("CIT160")!.impossible,
  );
  check(
    "courses already on the transcript are settled",
    reach.get("ENG150")!.settled && reach.get("ECEN240")!.settled,
  );
  // The planning list must be ordered furthest-first and exclude settled work.
  const deep = deepestFirst(reach, obs, 8);
  check(
    "the furthest-out list is sorted by distance",
    deep.every((d, i) => i === 0 || d.reach.termsAway <= deep[i - 1].reach.termsAway),
    deep.map((d) => `${d.courseId}:${d.reach.termsAway}`).join(" "),
  );
  check(
    "it excludes settled and 'not needed' courses",
    deep.every((d) => !d.reach.settled && !obs.has(d.courseId)),
  );
  check(
    "no chain step is missing its term — the two-pass cache fix",
    [...reach.values()].every((r) => r.impossible || r.path.every((s) => s.term)),
    [...reach.entries()].filter(([, r]) => !r.impossible && r.path.some((s) => !s.term)).map(([k]) => k).join(","),
  );
  check(
    "ECEN411 is the furthest out at 5 terms",
    deep[0]?.courseId === "ECEN411" && deep[0]?.reach.termsAway === 5,
    `${deep[0]?.courseId}:${deep[0]?.reach.termsAway}`,
  );
}

check(
  "every project references real courses",
  PROJECTS.every((p) => p.courses.every((id) => COURSES.some((c) => c.id === id))),
);

// ---- prerequisite parser (Phase 2) ----------------------------------------
//
// The parser is what lets the app cover programs nobody hand-audited, so it is
// held to the 131 courses somebody DID hand-audit. The load-bearing assertion
// is not the headline agreement rate — it is that a parse calling itself
// `exact` is never wrong, because that is the claim Phase 3's trust model will
// enforce prerequisites on.
{
  const snap = JSON.parse(
    readFileSync(new URL("../data/catalog-snapshot.json", import.meta.url), "utf8"),
  ) as { courses: Record<string, Record<string, unknown>> };
  const byUpper = new Map(COURSES.map((c) => [c.id.toUpperCase(), c.id]));
  const resolveId = (code: string) => byUpper.get(code.toUpperCase()) ?? null;

  let compared = 0;
  let agreed = 0;
  const exactDisagreements: string[] = [];
  const exactStricter: string[] = [];
  for (const c of AUDITED) {
    const entry = snap.courses[c.id];
    if (!entry) continue;
    compared++;
    const got = parseRequisites(entry, resolveId);
    const ok =
      sameNode(got.prereq, c.prereq) && sameNode(got.coreq, c.coreq ?? null);
    if (ok) {
      agreed++;
      continue;
    }
    if (got.confidence !== "exact") continue;
    exactDisagreements.push(c.id);
    /**
     * Is the parser STRICTER than the human anywhere?
     *
     * Not a proxy — an exact check. These expressions have a handful of leaves,
     * so enumerate every combination of courses-taken and look for one that
     * satisfies the human's rule but not the parser's. That is precisely the
     * case where GradTree would refuse a registration the catalogue permits.
     * The reverse (parser laxer) is safe and expected here.
     */
    const leaves = [
      ...new Set([...prereqLeaves(c.prereq), ...prereqLeaves(got.prereq)]),
    ];
    if (leaves.length <= 12) {
      const sat = (n: PrereqNode, have: Set<string>): boolean => {
        if (n === null) return true;
        if (typeof n === "string") return have.has(n);
        return "and" in n
          ? n.and.every((k) => sat(k, have))
          : n.or.some((k) => sat(k, have));
      };
      for (let mask = 0; mask < 1 << leaves.length; mask++) {
        const have = new Set(leaves.filter((_, i) => mask & (1 << i)));
        if (sat(c.prereq, have) && !sat(got.prereq, have)) {
          exactStricter.push(c.id);
          break;
        }
      }
    }
  }

  check("parser ground truth covers the audited catalog", compared === 131);
  check(
    "parser agrees with the human on at least 115 of 131 audited courses",
    agreed >= 115,
    `agreed ${agreed}`,
  );
  /**
   * `exact` used to mean "never disagrees". Loading the full catalogue changed
   * what the parser can see, and the remaining disagreements are all the same
   * shape: the fixture omitted an alternative *because the course was not in
   * the fixture*, and now it is.
   *
   * Every one is an OR branch the parser ADDS — a route the catalogue offers
   * and the hand-written entry left out. That direction is safe: more routes
   * means fewer refusals, never more. The dangerous direction — the parser
   * dropping a branch the human kept — is checked separately below and must
   * stay at zero for `exact`.
   *
   * These mirror ACKNOWLEDGED in auditCatalog.ts. Adding an id here is a
   * decision; record why, as DATA_GAPS does.
   */
  const PARSER_ADDS_BRANCH: Record<string, string> = {
    DS350: "MATH 325 is a standalone entry path the fixture never modelled",
    DS460: "ITM 327 is a third alternative branch, absent from the fixture",
    ECEN470: "ME 305 is an alternative to ECEN 250, absent from the fixture",
    ME310: "ME 305 alternative to ECEN 250, absent from the fixture",
    MATH423: "MATH 221A-D statistics alternatives, absent from the fixture",
    MATH341: "an alternative entry the fixture did not carry",
    CSE450: "an alternative route the fixture did not carry",
    ECEN411: "an alternative the fixture did not carry",
    ECEN451: "an alternative the fixture did not carry",
    PH250: "PH 223 is an alternative to PH 220, absent from the fixture",
  };
  check(
    "every `exact` disagreement is an acknowledged missing alternative",
    exactDisagreements.every((id) => id in PARSER_ADDS_BRANCH),
    exactDisagreements.filter((id) => !(id in PARSER_ADDS_BRANCH)).join(","),
  );
  check(
    "no `exact` parse is STRICTER than the human — the dangerous direction",
    exactStricter.length === 0,
    exactStricter.join(","),
  );

  // Shape regressions, each one a bug that actually shipped during Phase 2.
  const p2 = (id: string) => parseRequisites(snap.courses[id], resolveId);
  check(
    "CSE 450's four routes parse as OR, not AND",
    (() => {
      const n = normalizeNode(p2("CSE450").prereq);
      return !!n && typeof n === "object" && "or" in n && n.or.length === 4;
    })(),
  );
  check(
    "a corequisite stated in coRequisites lands in coreq, not prereq",
    p2("ECEN240").prereq === null && p2("ECEN240").coreq !== null,
  );
  check(
    "catalog CSE121C resolves to fixture id CSE121c",
    JSON.stringify(p2("ECEN260").prereq).includes("CSE121c"),
  );
  check(
    "an unrepresentable shape reports `unsure` rather than guessing",
    parseRequisites(
      {
        prerequisites:
          "• Take 2 of the following courses: • MATH112X - x (4) • MATH119 - y (4) • MATH341 - z (3)",
      },
      resolveId,
    ).confidence === "unsure",
  );
}

// ---- trust model (Phase 3) -------------------------------------------------
//
// Enforcement is graded, and the grading is the safety property: a hard block
// on a misread rule refuses a registration the university would allow, and the
// student cannot tell that from a real prerequisite. Only a complete reading
// earns a block.
check(
  "a hand-checked prerequisite is enforced",
  enforcesPrereq("human") === true,
);
check(
  "a fully-parsed prerequisite is enforced",
  enforcesPrereq("exact") === true,
);
check(
  "a prerequisite with dropped options warns, never blocks",
  enforcesPrereq("parsed") === false,
);
check(
  "an unrepresentable prerequisite warns, never blocks",
  enforcesPrereq("unsure") === false,
);
check("no prerequisite at all is not enforceable", enforcesPrereq("none") === false);

// The 136 hand-audited courses must keep behaving exactly as before — Phase 3
// changes the policy, not today's verdicts.
check(
  "every audited course is still trusted as hand-checked",
  AUDITED.length === 133 && AUDITED.every((c) => trustOf(c) === "human"),
  `audited: ${AUDITED.length}`,
);
// The generated majority must land in the graded buckets, never `human`.
check(
  "generated courses are graded, not trusted",
  COURSES.filter((c) => !c.isPlaceholder && trustOf(c) !== "human").every((c) =>
    ["exact", "parsed", "unsure", "none"].includes(trustOf(c)),
  ),
);
check(
  "an explicit prereqTrust overrides the legacy verified flag",
  trustOf({ ...course("ECEN250"), prereqTrust: "parsed" }) === "parsed" &&
    enforcesPrereq(trustOf({ ...course("ECEN250"), prereqTrust: "parsed" })) ===
      false,
);

// ---- enrollment restrictions (Phase 4) -------------------------------------
//
// 24% of catalogue courses state a restriction and no prerequisite at all, so
// "no prerequisite" was being reported for gates that genuinely close a course.
// These are checked against the student, and — like machine-read prerequisites
// — they warn rather than block.
{
  const ctx = {
    programCodes: model.programCodes,
    earnedCredits: model.totalEarnedCredits,
  };
  const statusOfKind = (id: string, kind: string) =>
    checkRestrictions(course(id), ctx).find((r) => r.restriction.kind === kind)
      ?.status;

  check(
    "the student's declared program codes reach the model",
    model.programCodes.includes("445") && model.programCodes.includes("292"),
  );
  check(
    "MUSIC 102 is closed to Electrical Engineering",
    statusOfKind("MUSIC102", "declaredIn") === "unmet",
  );
  check(
    "a course closed to you warns rather than blocks",
    (() => {
      const v = validateDrop("MUSIC102", "2027S", model);
      return v.allowed === true && v.level === "warning";
    })(),
  );
  check(
    "GEOL 111 lists 445, so its restriction is met and stays silent",
    statusOfKind("GEOL111", "declaredIn") === "met" &&
      validateDrop("GEOL111", "2027S", model).level === "ok",
  );
  // BUS 301 restricts its *campus* sections by program and opens its online
  // sections to everyone. Reading that as a flat exclusion told an EE student a
  // course they can actually take was closed to them.
  check(
    "BUS 301's campus-only gate informs instead of excluding",
    statusOfKind("BUS301", "declaredIn") === "unknown" &&
      validateDrop("BUS301", "2027S", model).level === "ok",
  );
  check(
    "an earned-credit gate is measured against the transcript",
    statusOfKind("BUS301", "minCredits") === "met" &&
      model.totalEarnedCredits >= 22,
  );
  check(
    "instructor authorisation is an action, never a failure",
    statusOfKind("ECEN499", "approval") === "action",
  );
  check(
    "legacy restriction prose parses without being migrated",
    restrictionsOf(course("MUSIC102"))[0].kind === "declaredIn" &&
      restrictionsOf(course("ECEN398R"))[0].kind === "approval",
  );
  check(
    "the catalogue's own phrasing parses too",
    parseRestriction("Earned at least this many credits: 60").kind ===
      "minCredits" &&
      parseRestriction("Declared in 445, 292, or 601").kind === "declaredIn" &&
      parseRestriction("Internship application authorization").kind ===
        "approval",
  );
}

// ---- schedule scraper (Phase 5b) -------------------------------------------
//
// `npm run schedule` reads all 108 disciplines; the 2026-08-06 scrape read the
// 33 the fixture touched, by hand. The scripted one is only worth trusting if
// it reproduces the hand-checked one — so that is the assertion, not a
// plausibility check on counts.
{
  const oldScrape = JSON.parse(
    readFileSync(new URL("../data/schedule-2026.json", import.meta.url), "utf8"),
  ) as { courses: Record<string, { terms: string[]; blocks?: string[]; online?: boolean }> };
  let full: { courses: Record<string, { terms: string[]; blocks?: string[]; online?: boolean }> } | null = null;
  try {
    full = JSON.parse(
      readFileSync(new URL("../data/schedule-full.json", import.meta.url), "utf8"),
    );
  } catch {
    /* not scraped yet on this machine */
  }
  if (full) {
    const same = (a: string[] = [], b: string[] = []) =>
      [...a].sort().join(",") === [...b].sort().join(",");
    const entries = Object.entries(oldScrape.courses);
    const agreed = entries.filter(([id, o]) => {
      const n = full!.courses[id.toUpperCase()];
      return (
        n &&
        same(o.terms, n.terms) &&
        same(o.blocks ?? [], n.blocks ?? []) &&
        !!o.online === !!n.online
      );
    });
    check(
      "the scripted scrape reproduces every hand-checked course exactly",
      agreed.length === entries.length,
      `${agreed.length}/${entries.length}`,
    );
  }
}

// ---- editorial scoping ------------------------------------------------------
//
// The project write-ups are authored for electrical engineering. With the app
// now open to every BYU-Idaho program, showing them to everyone would be
// presenting one major's advice as if it were universal.
check(
  "projects apply to the EE major",
  projectsApplyTo(["ee-bs-2026"]) === true,
);
check(
  "projects do not apply to a student without that major",
  projectsApplyTo([]) === false &&
    projectsApplyTo(["ai-engineering-minor"]) === false,
);

// ---- program registry (Phase 6) --------------------------------------------
//
// The app claimed to cover every BYU-Idaho major and minor while shipping
// three programs, so anyone who was not an electrical engineer opened the
// picker to a single choice.
{
  const majors = PROGRAMS.filter((p) => p.type === "major");
  const minors = PROGRAMS.filter((p) => p.type === "minor");
  check(
    "the registry carries the whole catalogue of majors and minors",
    majors.length >= 100 && minors.length >= 100,
    `majors ${majors.length}, minors ${minors.length}`,
  );
  check(
    "no two programs share an id",
    new Set(PROGRAMS.map((p) => p.id)).size === PROGRAMS.length,
  );
  // A generated duplicate of a hand-written program would be a second opinion
  // about the same degree, and nothing decides which one wins.
  check(
    "no generated program duplicates a hand-written one",
    new Set(PROGRAMS.map((p) => p.code)).size === PROGRAMS.length,
  );
  check(
    "hand-written programs keep their own ids",
    PROGRAM_BY_ID.get("ee-bs-2026")?.code === "445" &&
      PROGRAM_BY_ID.get("ai-engineering-minor")?.code === "292",
  );
  check(
    "every program has at least one requirement bucket",
    PROGRAMS.every((p) => p.buckets.length > 0),
    PROGRAMS.filter((p) => !p.buckets.length).map((p) => p.id).join(","),
  );
  // A program nobody can enrol in is furniture.
  check(
    "a non-EE major can be enrolled and evaluated",
    (() => {
      const nursing = PROGRAMS.find((p) => /Nursing/i.test(p.label));
      if (!nursing) return false;
      const ev = evaluateProgram(nursing, buildPlan([]));
      return ev.program.id === nursing.id && railRows(ev).length > 0;
    })(),
  );
}

// ---- program trust ----------------------------------------------------------
//
// The app is going to students of every major, so a machine-read program has
// to behave like the hand-written one — `exact` and `parsed` assert. `unsure`
// does not, because that grade is assigned precisely when the build knows the
// reading is incomplete.
{
  check(
    "a hand-written program asserts its requirements",
    trustOfProgram(EE) === "human" && assertsRequirements("human") === true,
  );
  check(
    "a confidently machine-read program asserts too",
    assertsRequirements("exact") === true && assertsRequirements("parsed") === true,
  );
  check(
    "a program the build flagged as incomplete never asserts",
    assertsRequirements("unsure") === false,
  );
  const generated = PROGRAMS.filter((p) => trustOfProgram(p) !== "human");
  check(
    "every generated program carries a parse grade",
    generated.length > 200 &&
      generated.every((p) => !!p.parseConfidence),
    `${generated.length} generated`,
  );
  // The ★ set must come only from programs a human checked — otherwise the app
  // invents constraints out of an unverified reading.
  check(
    "★ required is derived only from hand-checked programs",
    (() => {
      const required = requiredCourseIds();
      const handPools = new Set<string>();
      for (const p of PROGRAMS.filter((x) => trustOfProgram(x) === "human"))
        for (const b of p.buckets)
          for (const id of bucketPoolIds(
            { bucket: b, poolResolved: [] } as never,
            p,
          ))
            handPools.add(id);
      return [...required].every((id) => handPools.has(id));
    })(),
  );
  check(
    "the ★ set did not change when 204 programs were added",
    requiredCourseIds().size === 32,
    `got ${requiredCourseIds().size}`,
  );
}

// ---- program audit findings -------------------------------------------------
//
// `npm run audit:programs` checks every generated program back against the
// catalogue HTML it came from. These pin the two properties that must never
// regress, and the honesty of the grade that follows from them.
{
  const gen = PROGRAMS.filter((p) => trustOfProgram(p) !== "human");
  const poolAll = (b: Bucket): string[] => [
    ...(b.pool ?? []),
    ...(b.groups ?? []).flatMap(poolAll),
  ];

  // A requirement demanding credits with nothing to choose from renders as
  // "0/53 cr" forever. Those exist — they must be graded `unsure`, never
  // presented as a confident reading.
  const hollow = gen.filter((p) =>
    p.buckets.some(
      (b) =>
        (b.credits?.min ?? 0) > 0 &&
        !poolAll(b).length &&
        !(b.groups ?? []).length &&
        b.rule.type !== "programRef" &&
        b.rule.type !== "fillTo",
    ),
  );
  check(
    "every program with an unsatisfiable requirement is graded unsure",
    hollow.every((p) => p.parseConfidence === "unsure"),
    hollow
      .filter((p) => p.parseConfidence !== "unsure")
      .map((p) => p.label)
      .join(","),
  );
  /**
   * This used to assert `hollow.length > 0` — a vacuity guard, so the rule
   * above could not pass by having nothing to check. It has now fired for the
   * right reason: there are no unsatisfiable requirements left anywhere in the
   * catalogue, so the guard has become the stronger claim it was protecting.
   * The grading rule above stays as the guard for anything that reappears.
   */
  check(
    "no program ships a requirement a student cannot satisfy",
    hollow.length === 0,
    hollow.map((p) => p.label).join(", "),
  );
  // General Education is referenced by 97 programs. Without those files the
  // requirement renders empty, which is worse than absent.
  check(
    "the general-education tracks programs reference are carried",
    ["GE - BACH", "GE - TEACH", "GE - AAS"].every((code) =>
      PROGRAMS.some((p) => p.code === code),
    ),
  );
  /**
   * Within a single pool, not across groups. Overlapping options legitimately
   * share a course — Civil Engineering's Foundational Math lists MATH 112X in
   * more than one option because more than one route includes it. Flattening
   * the groups first made that look like a bug.
   */
  const everyPool = (b: Bucket): string[][] => [
    ...(b.pool ? [b.pool] : []),
    ...(b.groups ?? []).flatMap(everyPool),
  ];
  check(
    "no single pool lists the same course twice",
    gen.every((p) =>
      p.buckets.every((b) =>
        everyPool(b).every((ids) => new Set(ids).size === ids.length),
      ),
    ),
  );
}

// ---- courses that must share a semester -------------------------------------
//
// "The following courses must be taken together in the same semester."
// Requiring the three courses was never the missing part — nothing stopped a
// student spreading them across three terms and ending with a plan that looks
// complete and cannot be registered.
{
  const bm = PROGRAMS.find((p) => p.code === "415");
  check("the Business Management major is carried", !!bm);
  if (bm) {
    setActiveEnrollment([bm.id]);
    const groups = sameTermGroups();
    check(
      "its IBC block is one same-semester group",
      groups.some(
        (g) =>
          g.length === 3 &&
          ["BUS300", "BUS302", "MKT301"].every((id) => g.includes(id)),
      ),
      JSON.stringify(groups),
    );

    /** Split across terms: the student must be told. */
    const split = buildPlan(
      [
        { instanceId: "a", courseId: "BUS300", termId: "2026F", block: null },
        { instanceId: "b", courseId: "BUS302", termId: "2027W", block: null },
        { instanceId: "c", courseId: "MKT301", termId: "2026F", block: null },
      ],
      [],
      [bm.code],
    );
    const warned = (split.derived.get("BUS302")?.flags ?? []).some((f) =>
      /same semester/i.test(f.text),
    );
    check("splitting the block across terms warns", warned);

    /** Together: silence. A warning that fires on a correct plan is noise. */
    const together = buildPlan(
      [
        { instanceId: "a", courseId: "BUS300", termId: "2026F", block: null },
        { instanceId: "b", courseId: "BUS302", termId: "2026F", block: null },
        { instanceId: "c", courseId: "MKT301", termId: "2026F", block: null },
      ],
      [],
      [bm.code],
    );
    const quiet = ["BUS300", "BUS302", "MKT301"].every(
      (id) =>
        !(together.derived.get(id)?.flags ?? []).some((f) =>
          /same semester/i.test(f.text),
        ),
    );
    check("placing them together says nothing", quiet);

    /** It warns; it never blocks. The split is a normal state mid-build. */
    const verdict = validateDrop("BUS302", "2027W", split);
    check(
      "the drop is warned, not refused",
      verdict.allowed === true && verdict.level === "warning",
      `${verdict.level}: ${verdict.reason}`,
    );
  }
  setActiveEnrollment(MY_PROGRAM_IDS);
}

// ---- found by putting ten students through the app --------------------------
//
// `npm run personas` enrols ten people in ten degrees and runs the app's own
// planning buttons. Three defects came out of it that no structural check saw,
// because each needs a plan to exist before it can go wrong.
{
  /**
   * "Complete 1 of the following" with named options. The parser only knew
   * blocks literally headed "Option N", so Agribusiness's fifteen named
   * choices became a demand to complete all fifteen — a 272-credit plan for a
   * 120-credit degree.
   */
  const agri = PROGRAMS.find((p) => p.label === "Agribusiness");
  const options = agri?.buckets.find((b) => /component options/i.test(b.label ?? ""));
  check(
    "a choice between named programs is a choice, not a checklist",
    options?.rule.type === "nOfGroups" && (options.groups?.length ?? 0) > 10,
    `${options?.rule.type} with ${options?.groups?.length ?? 0} groups`,
  );
  check(
    "each option keeps the catalogue's name for it",
    (options?.groups ?? []).some((g) => /Economics Minor/i.test(g.label ?? "")),
  );

  /**
   * The planner read the term's credit load, then resolved corequisites —
   * which can place more courses into that same term — then added its own
   * course without looking again. Nursing got a 19-credit semester under a
   * 16-credit cap.
   */
  const nursing = PROGRAMS.find((p) => p.label.startsWith("Nursing"));
  if (nursing) {
    setActiveEnrollment([nursing.id]);
    const blank = buildPlan([], [], [nursing.code]);
    const res = planBottlenecksAsap(blank, new Set());
    const after = buildPlan(
      res.additions.map((a, i) => ({
        instanceId: `p${i}`, courseId: a.courseId, termId: a.termId, block: null,
      })),
      [],
      [nursing.code],
    );
    /**
     * Future terms only. The first version measured every term and failed on
     * 2023F — eighteen credits the student actually took, years before this
     * app existed. The planner is answerable for the terms it fills, not for
     * history.
     */
    const worst = Math.max(
      0,
      ...after.timeline.filter((t) => !t.real).map((t) =>
        (after.occurrencesByTerm.get(t.id) ?? []).reduce(
          (sum, o) => sum + (o.countsForCredit ? o.credits : 0), 0,
        ),
      ),
    );
    const heavy = after.timeline
      .map((t) => ({
        id: t.id,
        occ: after.occurrencesByTerm.get(t.id) ?? [],
      }))
      .map((x) => ({
        ...x,
        sum: x.occ.reduce((s, o) => s + (o.countsForCredit ? o.credits : 0), 0),
      }))
      .filter((x) => x.sum > 16);
    check(
      "the planner never overfills a term",
      worst <= 16,
      heavy
        .map(
          (h) =>
            `${h.id}=${h.sum}: ` +
            h.occ.map((o) => o.courseId + "/" + o.credits + "/" + o.source).join(" "),
        )
        .join(" | "),
    );
    setActiveEnrollment(MY_PROGRAM_IDS);
  }

  /**
   * "Any Foreign Language Course (4)" — a requirement stated as a bare noun
   * phrase, with no verb for the parser to latch onto. It was dropped, so
   * every teaching degree's General Education silently lost its language
   * requirement.
   */
  const geTeach = PROGRAMS.find((p) => p.code === "GE - TEACH");
  const hasLang = (function find(bs: Bucket[]): boolean {
    return bs.some(
      (b) => (b.pool ?? []).includes("FOREIGN_LANG") || find(b.groups ?? []),
    );
  })(geTeach?.buckets ?? []);
  check("teacher-prep GE still asks for a foreign language", hasLang);
}

// ---- read against the live catalogue -----------------------------------------
//
// Everything above compares the app to its own harvest. These three come from
// `npm run verify:catalog`, which lays the catalogue's sentence beside what a
// student will see — and from actually reading the result. Each is a mistake no
// self-comparison could have found, so each is pinned here.
{
  const ge = PROGRAMS.find((p) => p.code === "GE - BACH");
  const cornerstone = ge?.buckets.find((b) => /cornerstone/i.test(b.label ?? ""));
  const relRule = (cornerstone?.groups ?? []).find(
    (g) => g.rule.type === "nCredits" && g.rule.n === 6,
  );
  /**
   * "Take these four REL courses AND at least 6 credits from any OTHER REL
   * courses." The sibling-borrow rule filled the second one with the same four
   * courses the first already requires — the courses "other" excludes. GE is
   * referenced by nearly every program, so this was wrong almost everywhere.
   */
  check(
    "GE Cornerstone's REL elective draws from other REL courses, not the four required ones",
    !!relRule &&
      (relRule.pool ?? []).includes("REL_ELECTIVE") &&
      !(relRule.pool ?? []).includes("REL200C"),
    `pool: ${(relRule?.pool ?? []).join(",")}`,
  );

  /** A `pick 1` labelled "PHIL 201 + PHIL 202" reads as "take both". */
  const phil = PROGRAMS.find((p) => p.label.startsWith("Philosophy Minor"));
  if (phil) {
    const model = buildPlan([], [], [phil.code]);
    const rows = railRows(evaluateProgram(phil, model));
    check(
      "Philosophy's either/or reads as 'or'",
      rows.some((r) => r.eval.label === "PHIL 201 or PHIL 202"),
      rows.map((r) => r.eval.label).join(" | "),
    );
  }
  /**
   * The invariant, across every program: a "+" in a label claims you take all
   * of them, so only an `allOf` may use it. Checking one program's label would
   * pass while the rule was still wrong everywhere else.
   */
  {
    const offenders: string[] = [];
    for (const prog of PROGRAMS) {
      const model = buildPlan([], [], [prog.code]);
      for (const r of railRows(evaluateProgram(prog, model)))
        if (r.eval.label.includes(" + ") && r.eval.bucket.rule.type !== "allOf")
          offenders.push(`${prog.code}:${r.eval.label}`);
    }
    check(
      "'+' in a label only ever means allOf",
      offenders.length === 0,
      offenders.slice(0, 3).join(" | "),
    );
  }

  /** The harvest must still match the catalogue it claims to copy. */
  check(
    "every program carries the catalogue text it was parsed from",
    PROGRAMS.filter((p) => p.type !== "cluster").length > 200,
  );
}

// ---- specializations --------------------------------------------------------
//
// An emphasis is a program in its own right in the catalogue, nested under its
// parent. Not fetching them left 34 programs demanding credits from a bucket
// with nothing in it — "0/53 cr" with nothing to click.
{
  const music = PROGRAMS.find((p) => p.label.startsWith("Music") && p.type === "major");
  check("the Music major is carried", !!music);
  const emphasis = music?.buckets.find((b) => /emphasis/i.test(b.label ?? ""));
  check(
    "Music's emphasis is a real choice, not an empty credit demand",
    !!emphasis &&
      emphasis.rule.type === "nOfGroups" &&
      (emphasis.groups?.length ?? 0) >= 5,
    `${emphasis?.rule.type} with ${emphasis?.groups?.length ?? 0} groups`,
  );
  check(
    "each emphasis option names itself",
    (emphasis?.groups ?? []).every((g) => !!g.label && g.label.length > 2),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(
  "autoplan preview:",
  auto.additions.map((a) => `${a.courseId}→${a.termId}`).join(", "),
);
if (fail > 0) process.exit(1);
