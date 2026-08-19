/* Ten students, ten degrees, one plan each — `npm run personas`
 *
 * `sweep` asks whether a program *renders* correctly. This asks the question a
 * student asks: **can I actually get through this degree with this app?** Each
 * persona enrols, runs the app's own planning buttons, and then has the
 * resulting plan taken apart:
 *
 *   every placement re-validated against the board as it was built
 *   every prerequisite satisfied by an earlier term
 *   every course offered in the term it landed in
 *   no term over the credit cap
 *   same-semester blocks kept together
 *   progress actually made against the degree
 *
 * The planning calls here are the ones the buttons call — `planBottlenecksAsap`
 * is "Plan bottlenecks ASAP" in Insights, `planWishlist` is "Select courses…"
 * then Fill — so a failure here is a failure a student would hit.
 */
import { COURSE_BY_ID, PROGRAMS } from "../src/data";
import { planBottlenecksAsap, planWishlist } from "../src/engine/autoplan";
import { buildPlan, validateDrop } from "../src/engine/plan";
import {
  evaluateProgram,
  railRows,
  requiredCourseIds,
  sameTermGroups,
} from "../src/engine/requirements";
import { obsoleteCourseIds } from "../src/engine/requirements";
import { setActiveEnrollment } from "../src/engine/scope";
import type { Placement } from "../src/types";

interface Persona {
  name: string;
  about: string;
  major: string;
  minor?: string;
}

/** Ten people, chosen to spread across colleges rather than to be easy. */
const PEOPLE: Persona[] = [
  { name: "Marisol", about: "wants to run a neonatal unit", major: "Nursing - Pre Licensure" },
  { name: "Devin", about: "builds guitar pedals, wants to design medical devices", major: "Electrical Engineering, B.S.", minor: "Mathematics Minor" },
  { name: "Priya", about: "teaches piano, wants to conduct", major: "Music", minor: "Business Management Minor" },
  { name: "Caleb", about: "family farm, wants to modernise it", major: "Agribusiness", minor: "Economics Minor" },
  { name: "Tomás", about: "writes short fiction, wants to edit", major: "English", minor: "Communication Theory Minor" },
  { name: "Anya", about: "wants to build climate models", major: "Computer Science", minor: "Mathematics Minor" },
  { name: "Jonah", about: "coaches youth soccer, wants to run a clinic", major: "Exercise and Rehabilitation Sciences" },
  { name: "Leila", about: "wants to counsel families", major: "Marriage and Family Studies", minor: "Psychology Minor" },
  { name: "Bennett", about: "restores old houses", major: "Construction Management" },
  { name: "Sofia", about: "wants to teach high-school chemistry", major: "Chemistry", minor: "Physics Minor" },
];

const MAX_TERM_CREDITS = 18;

function findProgram(label: string, type: "major" | "minor") {
  return (
    PROGRAMS.find((p) => p.type === type && p.label === label) ??
    PROGRAMS.find((p) => p.type === type && p.label.startsWith(label))
  );
}

interface Result {
  who: string;
  degree: string;
  ok: boolean;
  placed: number;
  credits: number;
  termsUsed: number;
  problems: string[];
  progress: string;
}

const results: Result[] = [];

for (const person of PEOPLE) {
  const major = findProgram(person.major, "major");
  const minor = person.minor ? findProgram(person.minor, "minor") : undefined;
  const problems: string[] = [];

  if (!major) {
    results.push({
      who: person.name, degree: person.major, ok: false, placed: 0, credits: 0,
      termsUsed: 0, problems: [`no major named "${person.major}" in the picker`], progress: "—",
    });
    continue;
  }
  if (person.minor && !minor) problems.push(`no minor named "${person.minor}" in the picker`);

  const enrolled = [major.id, ...(minor ? [minor.id] : [])];
  setActiveEnrollment(enrolled);
  const codes = [major.code, ...(minor ? [minor.code] : [])];

  // ---- plan, using the app's own buttons ---------------------------------
  let model = buildPlan([], [], codes);
  const evalsOf = (m: typeof model) =>
    [major, ...(minor ? [minor] : [])].map((p) => evaluateProgram(p, m));
  const obsolete = obsoleteCourseIds(evalsOf(model), model);
  const first = planBottlenecksAsap(model, obsolete);

  let placements: Placement[] = first.additions.map((a, i) => ({
    instanceId: `b${i}`, courseId: a.courseId, termId: a.termId, block: null,
  }));
  model = buildPlan(placements, [], codes);

  /** Then "Select courses…": everything the degree still requires. */
  const need = [...requiredCourseIds()].filter(
    (id) => !placements.some((p) => p.courseId === id) && !obsolete.has(id),
  );
  if (need.length) {
    const second = planWishlist(model, need, { maxCredits: MAX_TERM_CREDITS });
    placements = [
      ...placements,
      ...second.additions.map((a, i) => ({
        instanceId: `w${i}`, courseId: a.courseId, termId: a.termId, block: null,
      })),
    ];
    model = buildPlan(placements, [], codes);
  }

  // ---- now take the plan apart -------------------------------------------
  const termIndex = new Map(model.timeline.map((t, i) => [t.id, i]));
  const inOrder = [...placements].sort(
    (a, b) => (termIndex.get(a.termId) ?? 0) - (termIndex.get(b.termId) ?? 0),
  );

  // 1. every placement valid against the board as it was built
  const sofar: Placement[] = [];
  for (const p of inOrder) {
    const v = validateDrop(p.courseId, p.termId, buildPlan(sofar, [], codes));
    if (!v.allowed || v.level === "blocked")
      problems.push(`${COURSE_BY_ID.get(p.courseId)?.code}: ${v.reason}`);
    sofar.push(p);
  }

  // 2. nothing the final model considers broken
  for (const p of placements) {
    const d = model.derived.get(p.courseId);
    for (const f of d?.flags ?? [])
      if (f.level === "error")
        problems.push(`${COURSE_BY_ID.get(p.courseId)?.code}: ${f.text}`);
  }

  // 3. credit load per term
  for (const t of model.timeline) {
    const load = (model.occurrencesByTerm.get(t.id) ?? []).reduce(
      (s, o) => s + (o.countsForCredit ? o.credits : 0), 0,
    );
    if (load > MAX_TERM_CREDITS)
      problems.push(`${t.label} is ${load} credits — over the ${MAX_TERM_CREDITS} cap`);
  }

  // 4. same-semester blocks held together
  for (const g of sameTermGroups()) {
    const terms = new Set(
      g.map((id) => placements.find((p) => p.courseId === id)?.termId).filter(Boolean),
    );
    if (terms.size > 1)
      problems.push(`same-semester block split: ${g.map((id) => COURSE_BY_ID.get(id)?.code).join(" + ")}`);
  }

  // 5. did the plan actually move the degree along?
  const pe = evaluateProgram(major, model);
  const rows = railRows(pe);
  const done = rows.filter((r) => r.eval.satisfied).length;
  if (pe.appliedCredits === 0) problems.push("plan earns no credit toward the major");

  const credits = placements.reduce(
    (s, p) => s + (COURSE_BY_ID.get(p.courseId)?.credits ?? 0), 0,
  );

  results.push({
    who: person.name,
    degree: major.label + (minor ? ` + ${minor.label}` : ""),
    ok: problems.length === 0,
    placed: placements.length,
    credits,
    termsUsed: new Set(placements.map((p) => p.termId)).size,
    problems,
    progress: `${done}/${rows.length} requirements met · ${pe.appliedCredits}/${major.totalCredits.min} cr`,
  });
}

// ---- report ----------------------------------------------------------------
console.log(`\nTen students, ten degrees\n${"=".repeat(74)}`);
for (const r of results) {
  const mark = r.ok ? "OK  " : "FAIL";
  console.log(`\n${mark} ${r.who.padEnd(9)} ${r.degree}`);
  console.log(
    `     ${r.placed} courses · ${r.credits} cr · ${r.termsUsed} terms · ${r.progress}`,
  );
  for (const p of r.problems.slice(0, 6)) console.log(`     ! ${p}`);
  if (r.problems.length > 6) console.log(`     …and ${r.problems.length - 6} more`);
}
const good = results.filter((r) => r.ok).length;
console.log(`\n${"=".repeat(74)}`);
console.log(`${good}/${results.length} plans clean\n`);
