// Static fixture data. Imported once, never fetched, never mutated at runtime.
import coursesJson from "../../data/courses.json";
import studentJson from "../../data/student.json";
import eeJson from "../../data/programs/ee-bs-2024.json";
import aiJson from "../../data/programs/ai-engineering-minor-2026.json";
import geJson from "../../data/programs/ge-abet.json";
import type { Course, CoursesFile, Program, Student } from "../types";

export const COURSES: Course[] = (coursesJson as unknown as CoursesFile).courses;
export const COURSE_BY_ID: ReadonlyMap<string, Course> = new Map(
  COURSES.map((c) => [c.id, c]),
);

export const STUDENT = studentJson as unknown as Student;

export const EE = eeJson as unknown as Program;
export const AI_MINOR = aiJson as unknown as Program;
export const GE_ABET = geJson as unknown as Program;

export const PROGRAM_BY_ID: ReadonlyMap<string, Program> = new Map([
  [EE.id, EE],
  [AI_MINOR.id, AI_MINOR],
  [GE_ABET.id, GE_ABET],
]);

export function course(id: string): Course {
  const c = COURSE_BY_ID.get(id);
  if (!c) throw new Error(`Unknown course id: ${id}`);
  return c;
}
