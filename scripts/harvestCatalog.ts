/* Harvests every course in the BYU-Idaho catalogue — `npm run harvest`.
 *
 * Phase 2. `auditCatalog.ts` fetches the 136 courses the fixture already knows
 * about; this fetches all ~2,000 so the app can eventually cover every major
 * and minor. Same API, same six inconsistent requisite fields (DATA_GAPS U9),
 * same rule that the raw text is kept verbatim so a human can always check what
 * a parser concluded.
 *
 * Output: `data/catalog-raw.json`. That file is **not imported by the app** —
 * nothing in `src/data/index.ts` references it, so it never reaches the bundle.
 * It is an input to the build-time pipeline, not runtime data.
 *
 * Resumable on purpose: 2,000 sequential-ish requests over a public API will be
 * interrupted eventually, and re-fetching everything to recover from one
 * timeout is how you end up hammering a university's server. Re-running only
 * fetches what is missing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { plainText, REQUISITE_FIELDS } from "../src/engine/prereqParse";

const CATALOG_ID = "68dc4d77c3ad086d83653f48"; // 2026-2027
const BASE = "https://byui.kuali.co/api/v1/catalog";
const OUT = new URL("../data/catalog-raw.json", import.meta.url);

/** Polite: the audit uses 8 against 136 records. Same ceiling, 15× the volume. */
const CONCURRENCY = 6;
/** Flush this often so an interrupted run keeps its progress. */
const SAVE_EVERY = 150;

interface IndexEntry {
  pid: string;
  __catalogCourseId?: string;
  title?: string;
  subjectCode?: { name?: string };
}

export interface RawCourse {
  id: string;
  code: string;
  title: string;
  subject: string;
  credits: { min: number; max: number } | null;
  /** Requisite prose, verbatim, by the field it arrived in. */
  requisites: Record<string, string>;
  pid: string;
}

interface RawFile {
  _fetchedOn: string;
  catalogId: string;
  _note: string;
  courses: Record<string, RawCourse>;
}

function load(): RawFile {
  if (existsSync(OUT)) {
    try {
      return JSON.parse(readFileSync(OUT, "utf8")) as RawFile;
    } catch {
      console.log("existing catalog-raw.json unreadable — starting fresh");
    }
  }
  return {
    _fetchedOn: new Date().toISOString().slice(0, 10),
    catalogId: CATALOG_ID,
    _note:
      "Raw harvest of the live BYU-Idaho Kuali catalogue. Requisite prose is verbatim. Not imported by the app — build-time input only. Regenerate with `npm run harvest`.",
    courses: {},
  };
}

function save(file: RawFile): void {
  file._fetchedOn = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, JSON.stringify(file, null, 1));
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<void>,
): Promise<void> {
  const queue = [...items.entries()];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (queue.length) {
        const [i, item] = queue.shift()!;
        await fn(item, i);
      }
    }),
  );
}

async function main(): Promise<void> {
  const file = load();
  const had = Object.keys(file.courses).length;

  process.stdout.write("fetching catalogue index… ");
  const index = (await (
    await fetch(`${BASE}/courses/${CATALOG_ID}`)
  ).json()) as IndexEntry[];
  console.log(`${index.length} courses`);

  // One record per course id; the index carries duplicates across catalogues.
  const wanted: IndexEntry[] = [];
  const seen = new Set<string>();
  for (const e of index) {
    const id = String(e.__catalogCourseId ?? "").toUpperCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!file.courses[id]) wanted.push(e);
  }

  console.log(
    `already harvested ${had}; fetching ${wanted.length} more` +
      (had ? " (resuming)" : ""),
  );
  if (!wanted.length) {
    console.log("nothing to do.");
    return;
  }

  let done = 0;
  let failed = 0;
  await mapLimit(wanted, CONCURRENCY, async (e) => {
    const id = String(e.__catalogCourseId).toUpperCase();
    try {
      const res = await fetch(`${BASE}/course/${CATALOG_ID}/${e.pid}`);
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as Record<string, unknown>;

      const requisites: Record<string, string> = {};
      for (const f of REQUISITE_FIELDS) {
        const text = plainText(d[f]);
        if (text) requisites[f] = text;
      }

      const cr = (d.credits as { credits?: { min?: string; max?: string } })
        ?.credits;
      const min = Number(cr?.min);
      const max = Number(cr?.max ?? cr?.min);

      file.courses[id] = {
        id,
        code: String(d.__catalogCourseId ?? id),
        title: String(d.title ?? e.title ?? ""),
        subject: String(e.subjectCode?.name ?? "").trim(),
        credits: Number.isFinite(min)
          ? { min, max: Number.isFinite(max) ? max : min }
          : null,
        requisites,
        pid: e.pid,
      };
    } catch (err) {
      failed++;
      // Leaving it absent is what makes the next run pick it up.
      if (failed <= 5)
        console.log(`  ${id} failed: ${(err as Error).message}`);
    }
    if (++done % SAVE_EVERY === 0) {
      save(file);
      process.stdout.write(`  …${done}/${wanted.length}\n`);
    }
  });

  save(file);
  const total = Object.keys(file.courses).length;
  const withReq = Object.values(file.courses).filter(
    (c) => Object.keys(c.requisites).length,
  ).length;
  console.log(
    `\nharvested ${total} courses (${withReq} carry requisite text), ${failed} failed`,
  );
  console.log("→ data/catalog-raw.json");
  if (failed) console.log("re-run `npm run harvest` to retry the failures.");
}

void main();
