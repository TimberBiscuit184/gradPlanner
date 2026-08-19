import { STUDENT } from "../data";
import type { TranscriptEntry, Student } from "../types";

/**
 * Grade points, transcribed from BYU-Idaho Student Records
 * (byui.edu/student-records/grades/calculate-gpa and .../grading-system).
 * Not the generic 4/3/2/1 scale — BYU-Idaho uses 3.4 for B+ and 2.4 for C+,
 * not the 3.3/2.3 many schools use.
 */
const GRADE_POINTS: Record<string, number> = {
  A: 4.0,
  "A-": 3.7,
  "B+": 3.4,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.4,
  C: 2.0,
  "C-": 1.7,
  "D+": 1.4,
  D: 1.0,
  "D-": 0.7,
  F: 0.0,
  /** Unofficial withdrawal — counted as a failing grade value, per BYU-Idaho. */
  UW: 0.0,
};

/** Marks that earn no grade points and are excluded from the GPA entirely. */
const NON_GPA = new Set(["P", "W", "I", "T", "NR", "IP", "NC"]);

export function gradePoints(grade: string | undefined): number | null {
  if (!grade) return null;
  if (NON_GPA.has(grade)) return null;
  return GRADE_POINTS[grade] ?? null;
}

export interface GpaTotals {
  gpa: number;
  qualityPoints: number;
  gpaCredits: number;
}

export interface GpaResult {
  /** The cumulative GPA as BYU-Idaho computes it. */
  official: GpaTotals;
  /**
   * Attempts excluded because a later retake replaced them. Kept so the UI can
   * explain why GPA credits (23) are lower than credits attempted (30).
   */
  superseded: { courseId: string; grade: string; credits: number }[];
}

/**
 * Cumulative GPA from the transcript.
 *
 * A retake REMOVES the superseded attempt from the cumulative GPA — confirmed
 * 2026-08-06 against the official transcript, which reports 30 credits
 * attempted but 23 GPA credits and 69.8 quality points for a 3.034 cumulative.
 * The 7 missing GPA credits are exactly the ENG 150 F (3) and MATH 112X UW (4).
 *
 * This was an open question (DATA_GAPS U13) because BYU-Idaho's public GPA
 * calculator disclaims retake handling and the published repeat policy is
 * written about courses repeatable *for credit*. The transcript settled it.
 * `npm run verify` reproduces all three official numbers exactly — if that
 * check ever fails, the grade scale or the retake rule has drifted.
 */
interface GradedAttempt {
  courseId: string;
  grade: string;
  credits: number;
  /** Transcript order, so "most recent attempt" is well-defined. */
  order: number;
}

/** Every graded attempt on the transcript, oldest first. */
function gradedAttempts(student: Student = STUDENT): GradedAttempt[] {
  const rows: GradedAttempt[] = [];
  let order = 0;
  for (const term of student.terms) {
    for (const e of term.courses as TranscriptEntry[]) {
      const pts = gradePoints(e.grade);
      if (pts === null) continue;
      rows.push({
        courseId: e.id,
        grade: e.grade!,
        credits: e.credits,
        order: order++,
      });
    }
  }
  return rows;
}

/** Quality points / GPA credits over a set of attempts. */
function totals(rows: GradedAttempt[]): GpaTotals {
  const qualityPoints = rows.reduce(
    (s, r) => s + gradePoints(r.grade)! * r.credits,
    0,
  );
  const gpaCredits = rows.reduce((s, r) => s + r.credits, 0);
  return {
    qualityPoints,
    gpaCredits,
    gpa: gpaCredits ? qualityPoints / gpaCredits : 0,
  };
}

/** Keep only each course's most recent attempt; return what was dropped. */
function applyRetakeRule(rows: GradedAttempt[]): {
  kept: GradedAttempt[];
  superseded: GradedAttempt[];
} {
  const latest = new Map<string, GradedAttempt>();
  for (const r of rows) {
    const prev = latest.get(r.courseId);
    if (!prev || r.order > prev.order) latest.set(r.courseId, r);
  }
  const keptSet = new Set([...latest.values()].map((r) => r.order));
  return {
    kept: [...latest.values()],
    superseded: rows.filter((r) => !keptSet.has(r.order)),
  };
}

export function cumulativeGpa(student: Student = STUDENT): GpaResult {
  const { kept, superseded } = applyRetakeRule(gradedAttempts(student));
  return {
    official: totals(kept),
    superseded: superseded.map((r) => ({
      courseId: r.courseId,
      grade: r.grade,
      credits: r.credits,
    })),
  };
}

/**
 * BYU-Idaho **truncates** the GPA rather than rounding: 69.8 / 23 is 3.03478,
 * which the transcript prints as 3.034, not 3.035. Display anything else and
 * the number stops matching what the student sees in I-Plan.
 */
export function formatGpa(gpa: number, places = 3): string {
  const f = 10 ** places;
  return (Math.trunc(gpa * f) / f).toFixed(places);
}

/** Grades worth offering as a projection assumption, best first. */
export const PROJECTABLE_GRADES = [
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
] as const;

export interface GpaProjection {
  assumedGrade: string;
  /** Credits the projection is spread across (registered + planned). */
  upcomingCredits: number;
  projected: GpaTotals;
  delta: number;
  /**
   * Upcoming courses that retake something already graded. Each one lifts the
   * GPA twice over: it adds its own points AND removes the old grade's credits
   * from the denominator.
   */
  replaces: { courseId: string; oldGrade: string }[];
}

/**
 * "What happens to my GPA if I average <grade> from here?"
 *
 * `upcoming` is every registered / in-progress / planned course — anything with
 * credits but no grade yet. Retakes run through the same rule as the cumulative
 * figure: the superseded attempt drops out of GPA credits entirely.
 * Returns null when there is nothing left to project.
 */
export function projectGpa(
  assumedGrade: string,
  upcoming: { courseId: string; credits: number }[],
  student: Student = STUDENT,
): GpaProjection | null {
  const pts = gradePoints(assumedGrade);
  if (pts === null || !upcoming.length) return null;

  const graded = gradedAttempts(student);
  const base = cumulativeGpa(student);
  let order = graded.length;
  const { kept } = applyRetakeRule([
    ...graded,
    ...upcoming.map((u) => ({
      courseId: u.courseId,
      grade: assumedGrade,
      credits: u.credits,
      order: order++,
    })),
  ]);

  const gradedIds = new Map(graded.map((r) => [r.courseId, r]));
  const projected = totals(kept);
  return {
    assumedGrade,
    upcomingCredits: upcoming.reduce((s, u) => s + u.credits, 0),
    projected,
    delta: projected.gpa - base.official.gpa,
    replaces: upcoming
      .filter((u) => gradedIds.has(u.courseId))
      .map((u) => ({
        courseId: u.courseId,
        oldGrade: gradedIds.get(u.courseId)!.grade,
      })),
  };
}

/**
 * BYU-Idaho registration limits, from the Registration FAQ: 21 credits per
 * semester is the recommended maximum, and going above it requires permission
 * from Student Records and Registration plus a successful academic history.
 */
export const RECOMMENDED_MAX_CREDITS = 21;
/** Full-time enrollment floor, used only to label a term as light. */
export const FULL_TIME_CREDITS = 12;

export type TermLoad = "empty" | "light" | "normal" | "over";

export function termLoad(credits: number): TermLoad {
  if (credits === 0) return "empty";
  if (credits > RECOMMENDED_MAX_CREDITS) return "over";
  if (credits < FULL_TIME_CREDITS) return "light";
  return "normal";
}

export function termLoadNote(credits: number): string | null {
  const load = termLoad(credits);
  if (load === "over")
    return `${credits} credits is above BYU-Idaho's recommended maximum of ${RECOMMENDED_MAX_CREDITS} — it needs permission from Student Records and Registration.`;
  if (load === "light")
    return `${credits} credits is below the ${FULL_TIME_CREDITS}-credit full-time threshold.`;
  return null;
}
