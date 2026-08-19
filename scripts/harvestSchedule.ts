/* Scrapes offered terms, blocks and online availability — `npm run schedule`.
 *
 * The catalogue API says what a course *is*; only the class schedule says when
 * it actually runs. The 2026-08-06 scrape covered the 33 subjects the fixture
 * touched; this covers all 108, so the 1,895 harvested courses stop saying
 * "offered terms unconfirmed".
 *
 * Everything here is shaped by how this site behaves, learned the hard way:
 *
 *  - **Strictly sequential.** Concurrency corrupts the results — the 2026-08-06
 *    attempt returned identical section counts for unrelated subjects and
 *    capped ECEN at 20 (DATA_GAPS S6). One request at a time, always.
 *  - **`multipart/form-data`.** The form declares that enctype; a URL-encoded
 *    POST is silently ignored and you get the portal home page back.
 *  - **Every hidden field must be echoed**, including `___BrowserRefresh`.
 *    Omitting it trips Jenzabar's anti-replay guard, which answers with "you
 *    attempted to navigate using your browser's Back or Refresh button" — a
 *    200, not an error, so it looks like an empty result.
 *  - **20 rows per page.** `pg0$V$lnkShowAll` is the postback that lifts it,
 *    and it needs the viewstate from the *results* page, not the search page.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE = "https://student.byui.edu/ics/class_schedule/";
const OUT = new URL("../data/schedule-full.json", import.meta.url);
const TERMS = ["2026;FA", "2026;WI", "2026;SP"] as const;
const SEASON: Record<string, "F" | "W" | "S"> = {
  "2026;FA": "F",
  "2026;WI": "W",
  "2026;SP": "S",
};

/** Published term boundaries — a section's date range is what names its block. */
const BOUNDS: Record<string, { full: string; first: string; second: string }> = {
  "2026;WI": { full: "01/07/2026", first: "02/20/2026", second: "02/23/2026" },
  "2026;SP": { full: "04/20/2026", first: "06/03/2026", second: "06/04/2026" },
  "2026;FA": { full: "09/14/2026", first: "10/27/2026", second: "10/28/2026" },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const attr = (tag: string, n: string) =>
  (tag.match(new RegExp(`${n}="([^"]*)"`, "i")) ?? [])[1];
const dec = (v = "") =>
  v
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

/** Every postable field on the page, in any attribute order. */
function formFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = attr(tag, "name");
    if (!name) continue;
    const type = (attr(tag, "type") ?? "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "image") continue;
    out[name] = dec(attr(tag, "value") ?? "");
  }
  return out;
}

interface Section {
  course: string;
  start: string;
  end: string;
  delivery: string;
}

/** One result row → a section, or null for chrome rows. */
function parseRows(html: string): Section[] {
  const out: Section[] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      dec(c[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
    );
    if (cells.length < 6) continue;
    const code = cells[1]?.match(/^([A-Z]{2,6})\s?(\d{3}[A-Za-z]?)-/);
    if (!code) continue;
    const dates = cells[4]?.match(
      /\((\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})\)/,
    );
    out.push({
      course: (code[1] + code[2]).toUpperCase(),
      start: dates?.[1] ?? "",
      end: dates?.[2] ?? "",
      delivery: cells[6] ?? "",
    });
  }
  return out;
}

function blockOf(term: string, s: Section): "full" | "1st" | "2nd" | null {
  const b = BOUNDS[term];
  if (!b || !s.start) return null;
  const startsAtTerm = s.start === b.full;
  const endsAtFirst = s.end === b.first;
  if (startsAtTerm && endsAtFirst) return "1st";
  if (startsAtTerm) return "full";
  if (s.start === b.second) return "2nd";
  return null; // an off-cycle range — recorded as a section, but not a block claim
}

interface Result {
  terms: string[];
  blocks: string[];
  online: boolean;
  sections: Record<string, number>;
}
interface File {
  _source: string;
  _method: string;
  _fetchedOn: string;
  _termBoundaries: typeof BOUNDS;
  done: string[];
  courses: Record<string, Result>;
}

function load(): File {
  if (existsSync(OUT)) {
    try {
      return JSON.parse(readFileSync(OUT, "utf8")) as File;
    } catch {
      /* start fresh */
    }
  }
  return {
    _source: `BYU-Idaho public class schedule (${BASE})`,
    _method:
      "Every section of all 108 discipline codes read for Fall/Winter/Spring 2026 — one complete cycle. Sequential; concurrency corrupts results (DATA_GAPS S6).",
    _fetchedOn: new Date().toISOString().slice(0, 10),
    _termBoundaries: BOUNDS,
    done: [],
    courses: {},
  };
}

const file = load();
const save = () => {
  file._fetchedOn = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, JSON.stringify(file, null, 1));
};

function record(term: string, sections: Section[]): void {
  const season = SEASON[term];
  for (const s of sections) {
    const c = (file.courses[s.course] ??= {
      terms: [],
      blocks: [],
      online: false,
      sections: {},
    });
    if (!c.terms.includes(season)) c.terms.push(season);
    c.sections[season] = (c.sections[season] ?? 0) + 1;
    const b = blockOf(term, s);
    if (b && !c.blocks.includes(b)) c.blocks.push(b);
    if (/online/i.test(s.delivery)) c.online = true;
  }
}

async function main(): Promise<void> {
  const home = await fetch(BASE);
  const homeHtml = await home.text();
  const cookie = (home.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  const sel = homeHtml.match(
    /<select[^>]*name="pg0\$V\$tabSearch\$ddlDiscipline"[^>]*>([\s\S]*?)<\/select>/i,
  );
  const disciplines = [...(sel?.[1] ?? "").matchAll(/<option[^>]*value="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter(Boolean);
  console.log(`${disciplines.length} disciplines × ${TERMS.length} terms`);

  const post = async (html: string, extra: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(formFields(html))) fd.set(k, v);
    fd.set("__EVENTTARGET", "");
    fd.set("__EVENTARGUMENT", "");
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const res = await fetch(BASE, {
      method: "POST",
      headers: { cookie, "user-agent": "Mozilla/5.0 GradTree", referer: BASE },
      body: fd,
    });
    return res.text();
  };

  let done = 0;
  for (const term of TERMS) {
    for (const disc of disciplines) {
      const key = `${term}|${disc}`;
      done++;
      if (file.done.includes(key)) continue;

      try {
        // Always start from a fresh search page: the results page's viewstate
        // is scoped to its own search, and reusing it across disciplines is
        // what makes this site hand back someone else's rows.
        const fresh = await (await fetch(BASE, { headers: { cookie } })).text();
        let html = await post(fresh, {
          "pg0$V$tabSearch$ddlTermSearch": term,
          "pg0$V$tabSearch$ddlDiscipline": disc,
          "pg0$V$tabSearch$ddlDivisionSearch": "",
          "pg0$V$tabSearch$ddlDept": "",
          "pg0$V$tabSearch$ddlDeliveryMethod": "",
          "pg0$V$tabSearch$btnSearch": "Search",
        });

        // 20 rows means there is probably a second page behind "Show All".
        if (parseRows(html).length >= 20 && html.includes("lnkShowAll")) {
          await sleep(250);
          html = await post(html, { __EVENTTARGET: "pg0$V$lnkShowAll" });
        }

        const rows = parseRows(html);
        record(term, rows);
        file.done.push(key);
        if (done % 25 === 0) {
          save();
          console.log(
            `  ${done}/${disciplines.length * TERMS.length}  ${key} (${rows.length} sections)`,
          );
        }
      } catch (err) {
        console.log(`  ${key} failed: ${(err as Error).message}`);
      }
      await sleep(300); // polite, and sequential by construction
    }
    save();
    console.log(`term ${term} complete — ${Object.keys(file.courses).length} courses so far`);
  }

  save();
  const n = Object.keys(file.courses).length;
  const online = Object.values(file.courses).filter((c) => c.online).length;
  console.log(`\n${n} courses seen; ${online} have an online section`);
  console.log("→ data/schedule-full.json");
}

void main();
