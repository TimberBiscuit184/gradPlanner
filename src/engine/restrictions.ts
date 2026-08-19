import type { Course, Restriction } from "../types";

/**
 * Enrollment restrictions — the gates the catalogue states *outside* its
 * requisite rules.
 *
 * Phase 4, and the reason it jumped the queue: `npm run coverage` showed that
 * 374 of the 1,540 courses carrying requisite text (24%) produce no
 * prerequisite expression at all, because their entire "requisite" is a
 * restriction. Roughly 380 say "Declared in <program>", 137 demand a credit
 * minimum, and 200 want somebody's authorisation. Treating those as "no
 * prerequisite" is right for the graph and wrong for the student: MUSIC 102 is
 * flatly closed to Electrical Engineering, and until now planning it produced
 * no warning whatsoever.
 *
 * These were captured as free prose (DATA_GAPS M6). This turns them into
 * something the app can *check*.
 */

export type { Restriction };

/**
 * `action` is deliberately not a failure: an instructor signature is something
 * you go and get, not something you lack. `unknown` means we hold no data to
 * judge it — never a quiet pass.
 */
export type RestrictionStatus = "met" | "unmet" | "action" | "unknown";

export interface RestrictionCheck {
  restriction: Restriction;
  status: RestrictionStatus;
  /** What to tell the student, already resolved against their record. */
  detail: string;
}

/** Program codes are 3-4 digits; "445 = Electrical Engineering" is commentary. */
const CODE_RE = /\b(\d{3,4})\b/g;

/**
 * Recognise one restriction from prose.
 *
 * Two dialects have to work: the catalogue's own phrasing ("Earned at least
 * this many credits: 22") and the hand-written summaries already in
 * `courses.json` ("Requires at least 22 earned credits."). Keeping both means
 * the 14 existing entries become structured without being rewritten, and the
 * harvested prose parses with the same function.
 */
export function parseRestriction(raw: string): Restriction {
  const text = raw.trim();

  if (/declaration in program|declared in( program)?\b/i.test(text)) {
    // Only the codes before any explanatory aside — "(445 = Electrical
    // Engineering …)" repeats a code that is commentary, not a requirement.
    const upTo = text.split(/[—–(]/)[0];
    const codes = [...upTo.matchAll(CODE_RE)].map((m) => m[1]);
    // "Campus/day sections require declaration in …" governs one delivery mode,
    // not the course. BUS 301 says exactly this and then adds that its online
    // sections are open to everyone — flattening that into a plain exclusion
    // told an EE student a course they can take is closed to them.
    const campusOnly = /campus\/day sections|campus sections/i.test(text);
    if (codes.length)
      return {
        kind: "declaredIn",
        programCodes: codes,
        ...(campusOnly ? { appliesTo: "campus" as const } : {}),
        text,
      };
  }

  const credits =
    text.match(/earned at least this many credits:\s*(\d+)/i) ??
    text.match(/requires at least (\d+) earned credits/i) ??
    text.match(/at least (\d+) credits/i);
  if (credits) return { kind: "minCredits", credits: Number(credits[1]), text };

  if (/internship application authorization/i.test(text))
    return { kind: "approval", of: "application", text };
  if (/instructor authorization|instructor approval/i.test(text))
    return { kind: "approval", of: "instructor", text };

  if (/concurrent-enrollment/i.test(text))
    return { kind: "delivery", mode: "concurrent", text };
  if (/online .*students only|pathway online/i.test(text))
    return { kind: "delivery", mode: "online", text };
  if (/campus.*students only|day \(campus\)|available to campus/i.test(text))
    return { kind: "delivery", mode: "campus", text };

  return { kind: "note", text };
}

/**
 * Structured restrictions for a course.
 *
 * `restrictionRules` wins when present — that is where generated data will put
 * the parsed form. Everything else is parsed from the legacy prose on the fly,
 * so the 14 hand-written entries need no migration and cannot drift from it.
 */
export function restrictionsOf(course: Course): Restriction[] {
  if (course.restrictionRules?.length) return course.restrictionRules;
  return (course.restrictions ?? []).map(parseRestriction);
}

export interface RestrictionContext {
  /** Program codes the student is enrolled in — "445", "292". */
  programCodes: readonly string[];
  /** Credits already earned, for the standing gates. */
  earnedCredits: number;
}

export function checkRestriction(
  r: Restriction,
  ctx: RestrictionContext,
): RestrictionCheck {
  switch (r.kind) {
    case "declaredIn": {
      const mine = ctx.programCodes.filter((c) => r.programCodes.includes(c));
      if (mine.length)
        return {
          restriction: r,
          status: "met",
          detail: `Open to you — you are declared in ${mine.join(", ")}.`,
        };
      // A section-scoped gate is not an exclusion from the course: another
      // delivery mode may still be open, so this informs rather than warns.
      if (r.appliesTo === "campus")
        return {
          restriction: r,
          status: "unknown",
          detail:
            `Campus sections are limited to programs ${r.programCodes.join(", ")}, ` +
            "which yours is not among — look for an online section.",
        };
      return {
        restriction: r,
        status: "unmet",
        detail:
          `Restricted to programs ${r.programCodes.join(", ")}. ` +
          (ctx.programCodes.length
            ? `You are declared in ${ctx.programCodes.join(", ")}.`
            : "You have no declared program on file."),
      };
    }
    case "minCredits":
      return ctx.earnedCredits >= r.credits
        ? {
            restriction: r,
            status: "met",
            detail: `You have ${ctx.earnedCredits} of the ${r.credits} credits required.`,
          }
        : {
            restriction: r,
            status: "unmet",
            detail: `Needs ${r.credits} earned credits; you have ${ctx.earnedCredits}.`,
          };
    case "approval":
      return {
        restriction: r,
        status: "action",
        detail:
          r.of === "instructor"
            ? "Needs an instructor's authorisation before you can register."
            : "Needs an approved application before you can register.",
      };
    case "delivery":
      // Campus vs online enrolment is not something this app is told, and
      // guessing would turn a real gate into a false reassurance.
      return {
        restriction: r,
        status: "unknown",
        detail: `Limited to ${r.mode} students — check that this matches how you are enrolled.`,
      };
    default:
      return { restriction: r, status: "unknown", detail: r.text };
  }
}

export function checkRestrictions(
  course: Course,
  ctx: RestrictionContext,
): RestrictionCheck[] {
  return restrictionsOf(course).map((r) => checkRestriction(r, ctx));
}

/** The one-line summary a drop verdict needs, or null when nothing is wrong. */
export function blockingRestriction(
  course: Course,
  ctx: RestrictionContext,
): RestrictionCheck | null {
  return checkRestrictions(course, ctx).find((c) => c.status === "unmet") ?? null;
}
