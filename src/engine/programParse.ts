import type { Bucket, Rule } from "../types";

/**
 * Catalogue program requirements (HTML) → the `Bucket` tree the app evaluates.
 *
 * Phase 6. The app claims to cover every BYU-Idaho major and minor, but three
 * programs were hand-written, so anyone else opened the picker to a single
 * choice. The catalogue publishes all 356 with their requirement structure, and
 * — like the prerequisite prose — the vocabulary turns out to be small and
 * closed:
 *
 *   624  Take the following course(s)                    → allOf
 *   314  Take N of the following courses                 → nOf
 *   220  Take at least N credit(s) from                   → nCredits
 *   174  Take at least N credit(s) to complete … program  → programRef
 *    69  … from any eligible university credits           → fillTo
 *   265  Complete all of the following  (group header)    → allOfGroups
 *    80  Complete N of the following    (group header)    → nOfGroups
 *
 * Unlike the prerequisite prose this is real markup — `<section>` per bucket,
 * a labelled header, a credit total, and `<a>` links carrying course codes —
 * so the structure is read rather than inferred. What still has to be graded is
 * whether every clause was understood.
 */

export type ProgramParseConfidence = "exact" | "parsed" | "unsure";

export interface ParsedProgram {
  buckets: Bucket[];
  confidence: ProgramParseConfidence;
  /** Clauses the parser could not turn into a rule, verbatim. */
  dropped: string[];
  /** Course codes named by the catalogue that the course set does not carry. */
  unknownCourses: string[];
}

const dec = (v = "") =>
  v
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Visible text of an HTML fragment, with Kuali's `<!-- -->` splices removed. */
export function textOf(html: string): string {
  return dec(
    html
      .replace(/<!--.*?-->/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Balanced-ish split into top-level `<section>` blocks — one per requirement. */
function sections(html: string): string[] {
  const out: string[] = [];
  const re = /<section\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let depth = 0;
    let i = m.index;
    const tag = /<\/?section\b/gi;
    tag.lastIndex = m.index;
    let t: RegExpExecArray | null;
    while ((t = tag.exec(html))) {
      depth += t[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        out.push(html.slice(i, t.index + "</section>".length));
        re.lastIndex = t.index;
        break;
      }
    }
    if (depth !== 0) break;
  }
  return out;
}

/** Course codes from the `<a href="#/courses/view/…">CODE</a>` links. */
function courseLinks(html: string): string[] {
  return [...html.matchAll(/<a[^>]*href="#\/courses\/view\/[^"]*"[^>]*>([^<]+)<\/a>/gi)].map(
    (m) => dec(m[1]).trim(),
  );
}

/** Kuali program ids from `<a href="#/programs/view/ID">`. */
function programLinks(html: string): string[] {
  return [...html.matchAll(/<a[^>]*href="#\/programs\/view\/([^"]+)"/gi)].map(
    (m) => m[1],
  );
}

interface Ctx {
  /** Catalogue course code → the id the app uses, or null when not carried. */
  resolveCourse: (code: string) => string | null;
  /** Kuali program id → this app's program id, or null. */
  resolveProgram: (kualiId: string) => string | null;
  /**
   * A clause that names its courses in prose instead of linking them —
   * "from any 300- or 400-level CSE, ECEN or WDD course", "from a foreign
   * language course". Returns the pool those words describe.
   *
   * Kept out of this module on purpose: the parser reads markup and knows
   * nothing about departments or course numbering. `buildPrograms.ts` owns
   * that vocabulary because it is the one holding the course set.
   */
  resolveProsePool?: (
    text: string,
  ) => { pool: string[]; usesPlaceholders?: boolean } | null;
}

interface RuleResult {
  rule: Rule;
  pool?: string[];
  ok: boolean;
  text: string;
  /** The catalogue's own wording, kept when the rule cannot name its courses. */
  note?: string;
  /** The pool is a generic slot (e.g. "any foreign language"), not real courses. */
  usesPlaceholders?: boolean;
  /** This clause announces that the courses that follow share one term. */
  declaresSameTerm?: boolean;
  /** This clause is the standalone line "No double counting". */
  declaresNoDoubleCount?: boolean;
}

/** One `ruleView-*-result` clause → a rule. */
function parseClause(html: string, ctx: Ctx, unknown: string[]): RuleResult {
  const text = textOf(html);
  /**
   * "…must be taken together in the same semester" / "Take the following
   * courses together in the same semester". Both programs that state this put
   * the sentence in one clause and the courses in the next, so the flag is
   * raised here and applied by the caller to the clause that follows.
   */
  const declaresSameTerm =
    /(taken?|take) the following courses?[^.]*together[^.]*same semester/i.test(text) ||
    /must be taken together in the same semester/i.test(text);

  /**
   * "No double counting" — a clause of its own in Computer Engineering, twice.
   * It names no courses and states no quantity, so it produced no rule and was
   * not a note either: two clauses the audit could never account for. It is a
   * real constraint, and `Bucket.allowDoubleCount` already models it.
   */
  const declaresNoDoubleCount = /^no double counting\.?$/i.test(text.trim());
  if (declaresNoDoubleCount)
    return {
      rule: { type: "allOf" },
      pool: [],
      ok: false,
      text,
      declaresNoDoubleCount: true,
    };

  // Program reference — "Take at least 27 credit(s) to complete the following
  // program(s): GE - ABET". Resolved by link, never by the visible title.
  if (/to complete the following program/i.test(text)) {
    const id = programLinks(html).map(ctx.resolveProgram).find(Boolean);
    if (id) return { rule: { type: "programRef", programId: id }, ok: true, text };
    return { rule: { type: "allOf" }, ok: false, text };
  }

  // Deduplicated: overlapping options repeat courses, and Civil Engineering's
  // Foundational Math pool listed MATH112X three times.
  const seenIds = new Set<string>();
  const pool: string[] = [];
  for (const code of courseLinks(html)) {
    const id = ctx.resolveCourse(code);
    if (!id) {
      unknown.push(code);
      continue;
    }
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    pool.push(id);
  }

  /**
   * The catch-all elective bucket. Two phrasings mean the same thing: "take at
   * least N credit(s) from any eligible university credits", and the longer
   * "in addition to courses meeting the requirements for this program,
   * students can take other…". Both accept anything, so both are `fillTo`.
   */
  if (
    /any eligible university credits/i.test(text) ||
    /in addition to courses meeting/i.test(text)
  ) {
    const n = Number(text.match(/at least ([\d.]+) credit/i)?.[1] ?? 0);
    return { rule: { type: "fillTo", n }, ok: true, text };
  }

  /**
   * No links, but the words name a pool. Business Management's 29-credit
   * "Elective Major Credits" and Software Engineering's "any 300- or 400-level
   * CSE … course" were unsatisfiable for exactly this reason: real
   * requirements the catalogue expresses in a sentence rather than a list.
   */
  /**
   * Open-ended by design. Three programs end with a requirement the catalogue
   * deliberately leaves to the student and their advisor:
   *
   *   "Take between 27 and 33 credits from the following: one Concentration."
   *   "…one Certificate, Cluster, or Minor."
   *   "Take at least 18 credit(s) from A secondary area of study."
   *
   * There is no pool to build because the answer is "whatever you and your
   * advisor choose". Modelled as `fillTo` — credits from anything — carrying
   * the catalogue's own sentence, so the student reads the real requirement
   * instead of staring at an impossible 0/18.
   */
  if (
    pool.length === 0 &&
    /one Concentration|Certificate, Cluster, or Minor|secondary area of study/i.test(
      text,
    )
  ) {
    const n = Number(
      text.match(/between (\d+) and \d+ credits?/i)?.[1] ??
        text.match(/at least ([\d.]+) credit/i)?.[1] ??
        0,
    );
    return { rule: { type: "fillTo", n }, ok: true, text, note: text.slice(0, 160) };
  }

  let usesPlaceholders = false;
  if (pool.length === 0 && ctx.resolveProsePool) {
    const prose = ctx.resolveProsePool(text);
    if (prose?.pool.length) {
      pool.push(...prose.pool);
      usesPlaceholders = !!prose.usesPlaceholders;
    }
  }
  const withPool = (rule: Rule): RuleResult => ({
    rule,
    pool,
    ok: true,
    text,
    ...(declaresSameTerm ? { declaresSameTerm: true } : {}),
    ...(usesPlaceholders ? { usesPlaceholders: true } : {}),
  });

  const between = text.match(/between (\d+) and (\d+) credits?/i);
  if (between) return withPool({ type: "nCredits", n: Number(between[1]) });

  const credits = text.match(/at least ([\d.]+) credit/i);
  if (credits) return withPool({ type: "nCredits", n: Number(credits[1]) });

  const nOf = text.match(/take (\d+) of the following/i);
  if (nOf) return withPool({ type: "nOf", n: Number(nOf[1]) });

  if (/take the following course/i.test(text)) return withPool({ type: "allOf" });

  /**
   * A placeholder requirement stated as a bare noun phrase: General Education
   * for Teacher Preparation lists "Any Foreign Language Course (4)" with no
   * verb at all. The prose resolver fills the slot, but no quantity pattern
   * matches, so it fell through to the drop pile — and a real requirement
   * disappeared from every teaching degree's General Education. The credit
   * figure is the trailing "(4)".
   */
  if (usesPlaceholders && pool.length) {
    const cr = Number(text.match(/\((\d+(?:\.\d+)?)\)\s*$/)?.[1] ?? 0);
    return withPool(cr > 0 ? { type: "nCredits", n: cr } : { type: "allOf" });
  }

  /**
   * Notes and prose carry no rule — but a note can still carry a *constraint*.
   * Business Management states the shared-semester rule as "NOTE: The
   * following courses must be taken together in the same semester:" in a
   * clause of its own, with the courses in the next clause. Dropping the note
   * without keeping its flag lost the constraint on the one program that most
   * needed it, while two lesser programs that phrase it inline kept theirs.
   */
  if (/^note\b/i.test(text) || pool.length === 0)
    return {
      rule: { type: "allOf" },
      pool: [],
      ok: false,
      text,
      ...(declaresSameTerm ? { declaresSameTerm: true } : {}),
    };

  return { rule: { type: "allOf" }, pool, ok: false, text };
}

/**
 * The body of one `<section>` → its rule and children.
 *
 * Two shapes: a single clause, or a group header ("Complete all/N of the
 * following") followed by `Option N:` blocks, each of which is itself a bucket.
 */
function parseBody(
  body: string,
  ctx: Ctx,
  dropped: string[],
  unknown: string[],
): Pick<
  Bucket,
  "rule" | "pool" | "groups" | "usesPlaceholders" | "sameTerm" | "allowDoubleCount"
> {
  const groupHeader = body.match(
    /<li><span>Complete\s*(?:<!--\s*-->)?\s*(all|\d+)\s*(?:<!--\s*-->)?\s*of the following<\/span>/i,
  );

  /**
   * Option blocks.
   *
   * A section that says "Complete 1 of the following" is a choice, and the
   * blocks that follow are the options — **whatever they are called**. This
   * used to require the header to start with the literal word "Option", which
   * is how Agribusiness's "Component Options — Complete 1 of the following"
   * became a demand to complete all fifteen: its options are named
   * ("Economics Minor", "Animal Reproduction Cluster"), so none of them
   * matched, the section fell through to the every-clause path, and a
   * pick-one turned into an all-of worth 272 credits.
   *
   * Two traps that shaped this, both found by benching against the
   * hand-written programs:
   *  - the header can carry a label — `Option 2: Professional Preparation` —
   *    so it cannot be matched as if it ended at the colon;
   *  - `AND` appears as a group header of its own, joining sub-blocks *within*
   *    an option. Treating it as another option turned EE's two-way
   *    experiential choice into an eight-way one.
   *
   * The header's own words become the group's label, so the student reads
   * "Economics Minor" rather than "Option 1".
   */
  const headers = [
    ...body.matchAll(
      /<span class="rules_groupHeader[^"]*">\s*([^<]*?)\s*<\/span>/gi,
    ),
  ];
  const optionBlocks: { label: string; html: string }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const label = dec(headers[i][1]).trim();
    const start = headers[i].index! + headers[i][0].length;
    const end = headers[i + 1]?.index ?? body.length;
    const block = body.slice(start, end);
    if (/^and$/i.test(label)) {
      if (optionBlocks.length) optionBlocks[optionBlocks.length - 1].html += block;
      continue;
    }
    optionBlocks.push({ label, html: block });
  }

  if (groupHeader && optionBlocks.length > 1) {
    const n = groupHeader[1].toLowerCase();
    const groups: Bucket[] = optionBlocks.map((opt, i) => {
      const inner = parseBody(opt.html, ctx, dropped, unknown);
      const named = opt.label && !/^option\s*\d*:?$/i.test(opt.label);
      return {
        id: `option-${i + 1}`,
        label: named ? opt.label : `Option ${i + 1}`,
        ...inner,
      };
    });
    const choice: Bucket = {
      id: "choice",
      label: n === "all" ? "Complete all" : `Choose ${n}`,
      rule:
        n === "all"
          ? { type: "allOfGroups" }
          : { type: "nOfGroups", n: Number(n) },
      groups,
    };

    /**
     * A section can hold a plain requirement *and* a choice — "take these six
     * courses, then pick one of these tracks". Everything before the first
     * `Option` header used to be discarded, which silently dropped six required
     * courses from Web Design and Development. Found by the completeness audit,
     * not by reading the code.
     */
    const firstOption = headers.find((h) => !/^and$/i.test(dec(h[1]).trim()));
    const pre = body.slice(0, firstOption?.index ?? 0);
    const preRules = [
      ...pre.matchAll(/data-test="ruleView-[^"]*-result"[^>]*>([\s\S]*?)<\/div>\s*<\/li>/gi),
    ]
      .map((m) => parseClause(m[1], ctx, unknown))
      .filter((r) => r.ok);

    if (!preRules.length) return { rule: choice.rule, groups: choice.groups };

    /**
     * A leading credit rule can draw on the options below it. The Physical
     * Science and Mathematics cluster reads "Take at least 12 credit(s) from
     * at least 2 of the following areas" and then names six areas; once the
     * areas were recognised as options, the 12-credit rule sat above them
     * pointing at nothing. Same borrow as the flat-clause path, applied to
     * the option pools.
     */
    const deepPool = (b: Bucket): string[] => [
      ...(b.pool ?? []),
      ...(b.groups ?? []).flatMap(deepPool),
    ];
    const optionPool = [...new Set(groups.flatMap(deepPool))];

    return {
      rule: { type: "allOfGroups" },
      groups: [
        ...preRules.map((r, i) => {
          const borrows =
            (r.pool ?? []).length === 0 &&
            r.rule.type === "nCredits" &&
            optionPool.length > 0 &&
            !/any other/i.test(r.text);
          return {
            id: `rule-${i + 1}`,
            rule: r.rule,
            pool: borrows ? optionPool : r.pool,
            ...(borrows ? { note: r.text.slice(0, 160) } : {}),
          };
        }),
        choice,
      ],
    };
  }

  const clauses = [
    ...body.matchAll(/data-test="ruleView-[^"]*-result"[^>]*>([\s\S]*?)<\/div>\s*<\/li>/gi),
  ].map((m) => m[1]);
  const all = clauses.map((c) => parseClause(c, ctx, unknown));
  /**
   * A clause that only announces "these must be taken together" carries no
   * courses of its own — the list is in the next clause. Carry the flag
   * forward one step, then let the announcing clause be dropped as usual.
   */
  for (let i = 0; i < all.length - 1; i++)
    if (all[i].declaresSameTerm && !(all[i].pool ?? []).length)
      all[i + 1].declaresSameTerm = true;

  /**
   * "No double counting" attaches to the rule it qualifies — which sits after
   * it in Computer Programming ("Complete all of the following · No double
   * counting · Take at least 2 credit(s) from…") and before it in Computer
   * Engineering. Look backwards first, then forwards; assuming one direction
   * accounted for the clause in one program and lost it in the other.
   */
  for (let i = 0; i < all.length; i++) {
    if (!all[i].declaresNoDoubleCount) continue;
    let target = -1;
    for (let j = i - 1; j >= 0 && target < 0; j--)
      if ((all[j].pool ?? []).length) target = j;
    for (let j = i + 1; j < all.length && target < 0; j++)
      if ((all[j].pool ?? []).length) target = j;
    if (target >= 0) all[target].declaresNoDoubleCount = true;
  }

  const parsed = all.filter((r) => {
    if (
      !r.ok &&
      r.text &&
      !/^note/i.test(r.text) &&
      !r.declaresSameTerm &&
      !r.declaresNoDoubleCount
    )
      dropped.push(r.text.slice(0, 90));
    return r.ok;
  });

  /**
   * Pooled courses from EVERY clause, including ones that produced no rule.
   *
   * The Physical Science and Mathematics cluster reads "Take at least 12
   * credit(s) from at least 2 of the following areas:" and then defines six
   * areas — "Take any Chemistry class numbered 105 or higher". Each area
   * resolves a pool but states no quantity, so it is an area *definition*
   * rather than a requirement and comes back `ok: false`. Building the sibling
   * pool from the surviving rules alone therefore left the 12-credit rule
   * drawing from nothing, in the one section where the courses were sitting
   * right there beside it.
   */
  const siblingPool = [...new Set(all.flatMap((p) => p.pool ?? []))];
  const borrowsFrom = (r: RuleResult) =>
    (r.pool ?? []).length === 0 &&
    r.rule.type === "nCredits" &&
    siblingPool.length > 0 &&
    /**
     * "any other X" is the exclusion idiom — GE Cornerstone's "at least 6
     * credits from any other REL courses" means *not* the four beside it, and
     * borrowing there pointed the rule at the courses it rules out.
     *
     * A bare "other" is not that. General Studies says "15 credits from the
     * same area or 15 credits from one other area", where the union of the
     * areas is exactly the right pool. Blocking on "other" alone deleted six
     * real 15-credit requirements from that degree, because a rule that
     * resolves to nothing is then pruned as noise.
     */
    !/\bany other\b/i.test(r.text);

  if (parsed.length === 0) {
    /**
     * No rule, but the clauses still named courses — an *area definition*
     * ("Take any Chemistry class numbered 105 or higher") under a parent that
     * supplies the quantity ("12 credits from at least 2 of the following
     * areas"). Returning an empty pool threw those courses away and left the
     * parent pointing at nothing.
     *
     * `nCredits: 0` because the area demands nothing on its own — the parent
     * does. Modelling it as `allOf` would require every chemistry course in
     * the catalogue.
     */
    const named = [...new Set(all.flatMap((r) => r.pool ?? []))];
    if (named.length) return { rule: { type: "nCredits", n: 0 }, pool: named };
    return { rule: { type: "allOf" }, pool: [] };
  }
  if (parsed.length === 1) {
    const borrows = borrowsFrom(parsed[0]);
    return {
      rule: parsed[0].rule,
      pool: borrows ? siblingPool : parsed[0].pool,
      ...(parsed[0].usesPlaceholders ? { usesPlaceholders: true } : {}),
      ...(parsed[0].declaresSameTerm ? { sameTerm: true } : {}),
      ...(parsed[0].declaresNoDoubleCount ? { allowDoubleCount: false } : {}),
      ...(borrows || parsed[0].note
        ? { note: parsed[0].note ?? parsed[0].text.slice(0, 160) }
        : {}),
    };
  }

  /**
   * Several clauses under one heading — all of them apply.
   *
   * One idiom needs help: a credit clause that lists no courses because it
   * draws on the ones already listed beside it. GE's Breadth section ends
   * "Take at least 6 credit(s) from 2 of the Breadth areas", and parsed
   * literally that is 6 credits from nothing — the student saw `0/6 cr` with
   * no way to move it. The pool is the union of its siblings.
   *
   * This deliberately under-constrains: "from 2 of the areas" is a
   * distribution rule the bucket model cannot express, so a student could
   * satisfy it within one area and not be told. That is the permissive
   * direction, and the clause's own words ride along as a note so the real
   * rule is visible. Refusing to count credits a student has genuinely earned
   * would be the worse failure.
   */
  return {
    rule: { type: "allOfGroups" },
    groups: parsed.map((p, i) => {
      /**
       * "other" is the tell that the pool is explicitly NOT the siblings.
       *
       * GE's Cornerstone reads "take these four REL courses AND at least 6
       * credits from any *other* REL courses". Borrowing the siblings there
       * pointed the second rule at the four courses the first rule already
       * requires — a wrong answer inherited by every program that references
       * General Education. Found by reading the catalogue, not by a check.
       */
      const borrows = borrowsFrom(p);
      return {
        id: `rule-${i + 1}`,
        rule: p.rule,
        pool: borrows ? siblingPool : p.pool,
        ...(p.usesPlaceholders ? { usesPlaceholders: true } : {}),
        ...(p.declaresSameTerm ? { sameTerm: true } : {}),
        ...(p.declaresNoDoubleCount ? { allowDoubleCount: false } : {}),
        ...(borrows || p.note ? { note: p.note ?? p.text.slice(0, 160) } : {}),
      };
    }),
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "bucket";

export function parseProgramRules(html: string, ctx: Ctx): ParsedProgram {
  const dropped: string[] = [];
  const unknownCourses: string[] = [];
  const buckets: Bucket[] = [];

  for (const sec of sections(html)) {
    const header = sec.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "";
    const label =
      textOf(header.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "") || "Requirement";
    const creditText = textOf(header).replace(label, "");
    const credits = Number(creditText.match(/([\d.]+)\s*Total Credits/i)?.[1] ?? NaN);

    const body = sec.replace(header, "");
    const parsed = parseBody(body, ctx, dropped, unknownCourses);

    buckets.push({
      id: slug(label),
      label,
      ...(Number.isFinite(credits) ? { credits: { min: credits, max: credits } } : {}),
      ...parsed,
    });
  }

  const confidence: ProgramParseConfidence =
    buckets.length === 0
      ? "unsure"
      : dropped.length
        ? "parsed"
        : unknownCourses.length
          ? "parsed"
          : "exact";

  return {
    buckets,
    confidence,
    dropped: [...new Set(dropped)],
    unknownCourses: [...new Set(unknownCourses)],
  };
}
