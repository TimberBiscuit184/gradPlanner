/* Harvests every program in the catalogue — `npm run harvest:programs`.
 *
 * Phase 6. The app was scoped to "all BYU-Idaho majors and minors", but the
 * registry still holds three programs, so anyone who is not an electrical
 * engineer opens the program picker and finds a single choice. The catalogue
 * exposes 356 programs — 81 bachelor majors, 104 minors, 110 clusters, 34
 * certificates, 21 associate majors, 6 general-education tracks — each with its
 * requirement structure in `newProgramRules1`.
 *
 * Output: `data/programs-raw.json`. Verbatim HTML, kept so a human can always
 * check what the parser concluded. Not imported by the app.
 *
 * Same discipline as `harvestCatalog.ts`: resumable, modest concurrency, and
 * the raw text preserved rather than parsed on the way in.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CATALOG_ID = "68dc4d77c3ad086d83653f48"; // 2026-2027
const BASE = "https://byui.kuali.co/api/v1/catalog";
const OUT = new URL("../data/programs-raw.json", import.meta.url);
const CONCURRENCY = 6;
const SAVE_EVERY = 50;

interface IndexEntry {
  pid: string;
  id: string;
  code?: string;
  title?: string;
  programType?: { name?: string };
  department?: { name?: string };
}

/**
 * An emphasis / track. The catalogue models these as programs in their own
 * right, nested under their parent and carrying the same `newProgramRules1`
 * structure — which is why the audit found 34 programs demanding credits from
 * an "Emphasis" bucket with nothing in it: the options were never fetched.
 */
export interface RawSpecialization {
  pid: string;
  code: string;
  title: string;
  rules: string;
}

export interface RawProgram {
  pid: string;
  code: string;
  title: string;
  type: string;
  department: string;
  /** The requirement structure, as HTML. Verbatim. */
  rules: string;
  programNotes: string;
  /** Kuali's own id, used to resolve `programRef` links between programs. */
  kualiId: string;
  /** Emphases/tracks, each with its own requirement structure. */
  specializations: RawSpecialization[];
}

interface RawFile {
  _fetchedOn: string;
  catalogId: string;
  _note: string;
  programs: Record<string, RawProgram>;
}

function load(): RawFile {
  if (existsSync(OUT)) {
    try {
      return JSON.parse(readFileSync(OUT, "utf8")) as RawFile;
    } catch {
      console.log("existing programs-raw.json unreadable — starting fresh");
    }
  }
  return {
    _fetchedOn: new Date().toISOString().slice(0, 10),
    catalogId: CATALOG_ID,
    _note:
      "Raw harvest of BYU-Idaho program requirements. `rules` is verbatim HTML from the catalogue. Not imported by the app — build-time input only. Regenerate with `npm run harvest:programs`.",
    programs: {},
  };
}

const file = load();
const save = () => {
  file._fetchedOn = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, JSON.stringify(file, null, 1));
};

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item) await fn(item);
      }
    }),
  );
}

async function main(): Promise<void> {
  process.stdout.write("fetching program index… ");
  const index = (await (
    await fetch(`${BASE}/programs/${CATALOG_ID}`)
  ).json()) as IndexEntry[];
  console.log(`${index.length} programs`);

  const byType: Record<string, number> = {};
  for (const p of index) {
    const t = p.programType?.name ?? "?";
    byType[t] = (byType[t] ?? 0) + 1;
  }
  console.log("  " + JSON.stringify(byType));

  const wanted = index.filter((p) => p.pid && !file.programs[p.pid]);
  console.log(`already have ${Object.keys(file.programs).length}; fetching ${wanted.length}`);
  if (!wanted.length) {
    console.log("nothing to do.");
    return;
  }

  let done = 0;
  let failed = 0;
  await mapLimit(wanted, CONCURRENCY, async (e) => {
    try {
      const res = await fetch(`${BASE}/program/${CATALOG_ID}/${e.pid}`);
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as Record<string, unknown>;
      file.programs[e.pid] = {
        pid: e.pid,
        kualiId: String(d.id ?? e.id ?? ""),
        code: String(d.code ?? e.code ?? ""),
        title: String(d.title ?? e.title ?? ""),
        type: String(e.programType?.name ?? ""),
        department: String(e.department?.name ?? ""),
        rules: typeof d.newProgramRules1 === "string" ? d.newProgramRules1 : "",
        programNotes:
          typeof d.programNotes === "string" ? d.programNotes : "",
        specializations: Array.isArray(d.specializations)
          ? (d.specializations as Record<string, unknown>[])
              .map((sp) => ({
                pid: String(sp.pid ?? ""),
                code: String(sp.code ?? ""),
                title: String(sp.title ?? ""),
                rules:
                  typeof sp.newProgramRules1 === "string"
                    ? sp.newProgramRules1
                    : "",
              }))
              .filter((sp) => sp.rules)
          : [],
      };
    } catch (err) {
      failed++;
      if (failed <= 5) console.log(`  ${e.code ?? e.pid} failed: ${(err as Error).message}`);
    }
    if (++done % SAVE_EVERY === 0) {
      save();
      process.stdout.write(`  …${done}/${wanted.length}\n`);
    }
  });

  save();
  const all = Object.values(file.programs);
  const withRules = all.filter((p) => p.rules.length > 0).length;
  console.log(
    `\nharvested ${all.length} programs (${withRules} carry requirement rules), ${failed} failed`,
  );
  const specs = all.reduce((n, p) => n + p.specializations.length, 0);
  const withSpecs = all.filter((p) => p.specializations.length).length;
  console.log(`  ${specs} specializations across ${withSpecs} programs`);
  console.log("→ data/programs-raw.json");
}

void main();
