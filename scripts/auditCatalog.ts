/* Re-runnable catalog audit — `npm run audit`.
 *
 * Compares every non-placeholder course in data/courses.json against the live
 * BYU-Idaho Kuali catalog and reports drift in prerequisites, corequisites,
 * credits, and titles.
 *
 * WHY THIS EXISTS: the 2026-07-27 import read only `preRequisites`. The API is
 * inconsistent — most course records use `prerequisites` (lowercase) and a
 * dozen state their rule entirely in `coRequisites`. Reading one field silently
 * returned "no prerequisite" for ~20 courses, and those gaps were then filled
 * by inference and marked verified:true. This script reads EVERY requisite
 * field, so that cannot happen again.
 *
 * Comparison is by the SET of course codes each side mentions, not by parsing
 * the catalog's HTML into a boolean expression — the and/or shape still needs a
 * human read. The catalog text is printed alongside every mismatch for that.
 */
import { writeFileSync } from "node:fs";
import { COURSES } from "../src/data";
import { prereqLeaves } from "../src/engine/plan";

const CATALOG_ID = "68dc4d77c3ad086d83653f48"; // 2026-2027
const BASE = "https://byui.kuali.co/api/v1/catalog";
const CONCURRENCY = 8;

/** Requisite-bearing fields, in every casing the API actually uses. */
const REQUISITE_FIELDS = [
  "prerequisites",
  "preRequisites",
  "coRequisites",
  "corequisites",
  "courseRequirements",
  "courseRequirementText",
] as const;

interface CatalogCourse {
  pid: string;
  __catalogCourseId?: string;
  title?: string;
  credits?: { credits?: { min?: string; max?: string } };
  [key: string]: unknown;
}

function plain(html: unknown): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<!--.*?-->/g, "")
    .replace(/<li[^>]*>/g, " • ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Placement/entrance tests read like course codes ("SAT 540") but are not. */
const NOT_SUBJECTS = new Set(["ACT", "SAT", "SATR", "TOEFL", "IELTS", "ALEKS"]);

/** Course codes named anywhere in the catalog's requisite prose. */
function codesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z]{2,6})\s?(\d{3}[A-Za-z]?)\b/g)) {
    if (NOT_SUBJECTS.has(m[1])) continue;
    // "last offered <year>" marks a retired alternative — not a live edge.
    const tail = text.slice(m.index! + m[0].length, m.index! + m[0].length + 30);
    if (/last offered/i.test(tail)) continue;
    out.add((m[1] + m[2]).toUpperCase());
  }
  return out;
}

/**
 * Alternatives the catalog names that this fixture deliberately does not model,
 * with the reason. Anything NOT listed here is real drift and fails the audit.
 * Adding an entry is a decision — record why, the same way DATA_GAPS.md does.
 */
const ACKNOWLEDGED: Record<string, { codes: string[]; why: string }> = {
  CSE111: {
    codes: ["CIT160"],
    why: "CIT 160 was last offered 2023, but this student passed it in Fall 2023 — a live edge for this transcript (DATA_GAPS U7).",
  },
  DS350: { codes: ["MATH325"], why: "MATH 325 is a standalone entry path; not in the fixture." },
  DS460: { codes: ["ITM327"], why: "ITM 327 is a third alternative branch; not in the fixture." },
  ECEN150: {
    codes: ["ECEN101"],
    why: "ECEN 101 is retired but kept as the Introduction option-2 branch in the EE program.",
  },
  ECEN470: { codes: ["ME305"], why: "ME 305 alternative to ECEN 250; not in the fixture." },
  ME310: { codes: ["ME305"], why: "ME 305 alternative to ECEN 250; not in the fixture." },
  PH250: { codes: ["PH223"], why: "PH 223 alternative to PH 220; not in the fixture." },
  ENG150: {
    codes: ["ENG106", "ENG106L", "ENG109", "ENG150"],
    why: "Developmental-writing and placement-exam entry paths are outside the fixture model.",
  },
  MATH109: { codes: ["MATH101"], why: "MATH 101 / placement scores are outside the fixture model." },
  MATH110X: { codes: ["MATH101"], why: "MATH 101 / placement scores are outside the fixture model." },
  MATH111: { codes: ["MATH101"], why: "MATH 101 / placement scores are outside the fixture model." },
  MATH112X: {
    codes: ["MATH109", "MATH110X", "MATH111"],
    why: "Stored with no edge: MATH 112X is already complete and the branches are 'not needed' (DATA_GAPS I9).",
  },
  MATH119: { codes: ["MATH101"], why: "MATH 101 / placement scores are outside the fixture model." },
  MATH423: {
    codes: ["MATH221A", "MATH221B", "MATH221C", "MATH221D"],
    why: "MATH 221A-D statistics alternatives; not in the fixture. MATH 330 is the EE path.",
  },
  MUSIC102: {
    codes: ["MUSIC172", "MUSIC130", "MUSIC155"],
    why: "Not open to Electrical Engineering (445) at all — see the course's restrictions.",
  },
};

function isAcknowledged(courseId: string, code: string): boolean {
  const ack = ACKNOWLEDGED[courseId];
  if (ack?.codes.includes(code)) return true;
  // MUSIC 160 A-Z is an inline lesson series, not individually modeled.
  return courseId === "MUSIC102" && /^MUSIC160[A-Z]$/.test(code);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  const queue = [...items.entries()];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (queue.length) {
        const [i, item] = queue.shift()!;
        out[i] = await fn(item);
      }
    }),
  );
  return out;
}

async function main(): Promise<void> {
  process.stdout.write("fetching catalog index… ");
  const index = (await (
    await fetch(`${BASE}/courses/${CATALOG_ID}`)
  ).json()) as CatalogCourse[];
  console.log(`${index.length} courses`);

  const byCode = new Map<string, CatalogCourse>();
  for (const c of index) {
    const key = String(c.__catalogCourseId ?? "").toUpperCase();
    if (key && !byCode.has(key)) byCode.set(key, c);
  }

  const wanted = COURSES.filter((c) => !c.isPlaceholder);
  process.stdout.write(`fetching ${wanted.length} course records… `);
  const records = await mapLimit(wanted, CONCURRENCY, async (c) => {
    const hit = byCode.get(c.id.toUpperCase());
    if (!hit) return null;
    const res = await fetch(`${BASE}/course/${CATALOG_ID}/${hit.pid}`);
    return res.ok ? ((await res.json()) as CatalogCourse) : null;
  });
  console.log("done\n");

  const snapshot: Record<string, unknown> = {};
  const problems: string[] = [];
  const absent: string[] = [];

  wanted.forEach((c, i) => {
    const d = records[i];
    if (!d) {
      absent.push(c.code);
      return;
    }

    const requisites = Object.fromEntries(
      REQUISITE_FIELDS.map((f) => [f, plain(d[f])]).filter(([, v]) => v),
    );
    const min = Number(d.credits?.credits?.min);
    const max = Number(d.credits?.credits?.max);
    snapshot[c.id] = { title: d.title, credits: { min, max }, ...requisites };

    const issues: string[] = [];
    if (!Number.isNaN(min) && !(min <= c.credits && c.credits <= max))
      issues.push(`credits: fixture ${c.credits}, catalog ${min}–${max}`);
    if (d.title && d.title.replace(/\s+/g, " ").trim() !== c.title)
      issues.push(`title: catalog "${d.title.replace(/\s+/g, " ").trim()}"`);

    const catalogCodes = codesIn(
      [requisites.prerequisites, requisites.preRequisites, requisites.coRequisites, requisites.corequisites]
        .filter(Boolean)
        .join(" "),
    );
    const fixtureCodes = new Set(
      [...prereqLeaves(c.prereq), ...prereqLeaves(c.coreq)].map((id) =>
        id.toUpperCase(),
      ),
    );
    const onlyCatalog = [...catalogCodes].filter(
      (x) => !fixtureCodes.has(x) && !isAcknowledged(c.id, x),
    );
    const onlyFixture = [...fixtureCodes].filter(
      (x) => !catalogCodes.has(x) && !isAcknowledged(c.id, x),
    );
    if (onlyCatalog.length)
      issues.push(`in catalog but not the fixture: ${onlyCatalog.join(", ")}`);
    if (onlyFixture.length)
      issues.push(`in the fixture but not the catalog: ${onlyFixture.join(", ")}`);

    if (issues.length) {
      problems.push(
        [
          `${c.code} — ${c.title}`,
          ...issues.map((s) => `    ${s}`),
          ...Object.entries(requisites).map(([k, v]) => `    catalog ${k}: ${v}`),
        ].join("\n"),
      );
    }
  });

  writeFileSync(
    new URL("../data/catalog-snapshot.json", import.meta.url),
    JSON.stringify(
      { _fetchedOn: new Date().toISOString().slice(0, 10), catalogId: CATALOG_ID, courses: snapshot },
      null,
      2,
    ) + "\n",
  );

  if (absent.length)
    console.log(
      `not in the ${CATALOG_ID} catalog (expected for retired courses): ${absent.join(", ")}\n`,
    );

  if (!problems.length) {
    console.log(`${wanted.length - absent.length} courses match the catalog.`);
    console.log("snapshot written to data/catalog-snapshot.json");
    return;
  }
  console.log(problems.join("\n\n"));
  console.log(
    `\n${problems.length} course(s) differ from the catalog. Codes are compared as a set — ` +
      `check the and/or shape by hand before editing courses.json, then re-run.`,
  );
  process.exitCode = 1;
}

void main();
