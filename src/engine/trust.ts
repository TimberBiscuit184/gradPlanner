import type { Course, PrereqTrust, Program } from "../types";

/**
 * How much this app is willing to bet on a prerequisite.
 *
 * Phase 3. Until now the question was binary — `verified: true` meant a human
 * had compared the course against the live catalogue, and `validateDrop` hard-
 * blocked on it. That was safe when all 136 courses had been read by a person.
 * It stops being safe the moment most prerequisites are machine-parsed, because
 * a hard block on a misread rule *refuses a registration the university would
 * allow*, and the student has no way to tell the difference.
 *
 * So enforcement is now graded, and the grade travels with the data.
 */
export type { PrereqTrust };

/**
 * **The asymmetry that decides the whole policy.**
 *
 * A dropped OR branch makes us *stricter* than the university: the catalogue
 * offers a route we cannot see, so we would refuse a legal registration. A
 * dropped AND element makes us *laxer*: we allow something the university would
 * refuse, and the student finds out at registration having lost nothing.
 *
 * Those costs are not symmetric. Being wrongly refused by your own planner is
 * the failure that makes the tool untrustworthy, so anything short of a
 * complete reading warns instead of blocking.
 */
export function enforcesPrereq(trust: PrereqTrust): boolean {
  return trust === "human" || trust === "exact";
}

/**
 * The trust grade for a course.
 *
 * `prereqTrust` is authoritative when present — that is where generated data
 * records what the parser concluded. Everything without it is legacy fixture
 * data, whose `verified` flag already means "a human checked this against the
 * catalogue", so it maps to `human`. Nothing needed migrating.
 */
export function trustOf(course: Course): PrereqTrust {
  if (course.prereqTrust) return course.prereqTrust;
  if (course.verified) return "human";
  // `verified: false` predates the parser and means "inferred, never checked".
  // `unsure` is the honest grade: we do not know the shape is right.
  return "unsure";
}

export const TRUST_LABEL: Record<PrereqTrust, string> = {
  human: "checked against the catalog by hand",
  exact: "read from the catalog in full",
  parsed: "read from the catalog, with parts we could not model",
  unsure: "not confirmed — the catalog's wording did not fit our model",
  none: "the catalog lists no prerequisite",
};

/** One line for the UI: what we know, and whether it is enforced. */
export function describeTrust(course: Course): {
  trust: PrereqTrust;
  label: string;
  enforced: boolean;
  /** Catalogue text or codes this course's rule dropped, if any. */
  dropped: string[];
} {
  const trust = trustOf(course);
  return {
    trust,
    label: TRUST_LABEL[trust],
    enforced: enforcesPrereq(trust),
    dropped: course.prereqDropped ?? [],
  };
}

/* ------------------------------------------------------------- programs --- */

/**
 * How a program's *requirements* were obtained. Same idea as `PrereqTrust`,
 * different evidence — and deliberately a different policy.
 */
export type ProgramTrust = "human" | "exact" | "parsed" | "unsure";

export function trustOfProgram(program: Program): ProgramTrust {
  return program.parseConfidence ?? "human";
}

/**
 * May the app make *claims* about this program — ★ "required, no alternative"
 * and the "not needed" strike-through?
 *
 * **This used to be hand-written programs only.** The owner's decision, once
 * the app was headed for the whole student body: a nursing student should get
 * what the electrical engineering student got, or the app is a demo with 205
 * decorations attached. Withholding the markers from everyone else does not
 * make the app careful — it makes it useless to all but one person.
 *
 * So `exact` and `parsed` now assert, and the evidence caught up to justify it:
 * `npm run sweep` opens all 102 majors and 104 minors cold and finds **zero**
 * programs with an unsatisfiable requirement, an unreadable label, or a phantom
 * course, and the planner's 4,670 placements all pass its own validator.
 *
 * `unsure` still does not assert, and that is not timidity — it is the one
 * grade the build assigns when it *knows* the reading is incomplete: a
 * requirement it could not fill, or a reference to a program not carried.
 * Starring a course as unavoidable on the strength of a parse we have already
 * flagged as broken is how a student drops a class they needed.
 *
 * Progress bars, pools and credit counts are shown for every program regardless
 * — those describe the catalogue rather than making a claim about it.
 */
export function assertsRequirements(trust: ProgramTrust): boolean {
  return trust === "human" || trust === "exact" || trust === "parsed";
}

export const PROGRAM_TRUST_LABEL: Record<ProgramTrust, string> = {
  human: "checked against the catalog by hand",
  exact: "read from the catalog automatically",
  parsed: "read from the catalog, with parts we could not model",
  unsure: "could not be read reliably",
};
