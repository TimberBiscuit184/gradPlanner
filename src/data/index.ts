// Static fixture data. Imported once, never fetched, never mutated at runtime.
/**
 * The app loads the MERGED set: the 136 hand-audited courses plus the rest of
 * the catalogue, parsed and graded. `data/courses.json` stays the audited
 * source of truth and is never generated over — `npm run merge` reads it and
 * writes `courses-full.json`, which is what ships.
 */
import coursesJson from "../../data/courses-full.json";
import studentJson from "../../data/student.json";
import eeJson from "../../data/programs/ee-bs-2026.json";
import aiJson from "../../data/programs/ai-engineering-minor-2026.json";
import geJson from "../../data/programs/ge-abet.json";
import generatedPrograms from "../../data/programs-generated.json";
import type { Course, CoursesFile, Program, Student } from "../types";

export const COURSES: Course[] = (coursesJson as unknown as CoursesFile).courses;
export const COURSE_BY_ID: ReadonlyMap<string, Course> = new Map(
  COURSES.map((c) => [c.id, c]),
);

export const STUDENT = studentJson as unknown as Student;

export const EE = eeJson as unknown as Program;
export const AI_MINOR = aiJson as unknown as Program;
export const GE_ABET = geJson as unknown as Program;

/**
 * Every program the app knows about.
 *
 * The registry, not the three named exports, is what the engine should read —
 * those exist for the EE-specific editorial modules (insights, clusters,
 * emphases) that have not been generalised yet. Adding a program to this array
 * is all it should ever take; see `src/engine/programs.ts`.
 */
/**
 * Hand-written programs first, then everything parsed from the catalogue.
 *
 * Order matters: `PROGRAM_BY_ID` is built from this array, and the three
 * hand-written files carry decisions a parser cannot make — placeholder slots,
 * prose-only options, the nested General Education reference. They are
 * authoritative; `buildPrograms.ts` skips their codes so there is never a
 * duplicate to disagree with.
 */
export const GENERATED_PROGRAMS = (
  generatedPrograms as unknown as { programs: Program[] }
).programs;

export const PROGRAMS: readonly Program[] = [
  EE,
  AI_MINOR,
  GE_ABET,
  ...GENERATED_PROGRAMS,
];

export const PROGRAM_BY_ID: ReadonlyMap<string, Program> = new Map(
  PROGRAMS.map((p) => [p.id, p]),
);

export function course(id: string): Course {
  const c = COURSE_BY_ID.get(id);
  if (!c) throw new Error(`Unknown course id: ${id}`);
  return c;
}
