import type { Season, Student, TimelineTerm } from "../types";

// Order within a calendar year is Winter -> Spring -> Fall.
const SEASON_ORDER: Record<Season, number> = { W: 0, S: 1, F: 2 };
const SEASON_LABEL: Record<Season, string> = {
  W: "Winter",
  S: "Spring",
  F: "Fall",
};

export function parseTermId(id: string): { year: number; season: Season } {
  return { year: Number(id.slice(0, 4)), season: id.slice(4) as Season };
}

export function termLabel(id: string): string {
  const { year, season } = parseTermId(id);
  return `${SEASON_LABEL[season]} ${year}`;
}

export function compareTermIds(a: string, b: string): number {
  const ta = parseTermId(a);
  const tb = parseTermId(b);
  return ta.year - tb.year || SEASON_ORDER[ta.season] - SEASON_ORDER[tb.season];
}

/**
 * Real terms from student.json plus generated terms 2026F..2031F inclusive.
 * 2026F already exists as a real (registered) term, so the real term wins and
 * generation effectively starts at 2027W. Winter terms on a spring-fall
 * pattern are "Flex Track": fully editable like any other semester, just
 * labeled so the student knows they'd be adding an off-pattern semester.
 */
export function buildTimeline(student: Student): TimelineTerm[] {
  const springFall = student.track.pattern === "spring-fall";
  const map = new Map<string, TimelineTerm>();

  for (const t of student.terms) {
    const { year, season } = parseTermId(t.id);
    map.set(t.id, {
      id: t.id,
      year,
      season,
      label: t.label,
      index: -1,
      real: true,
      status: t.status,
      flex: false,
    });
  }

  for (let year = 2026; year <= 2031; year++) {
    for (const season of ["W", "S", "F"] as Season[]) {
      const id = `${year}${season}`;
      if (compareTermIds(id, "2026F") < 0) continue;
      if (map.has(id)) continue;
      map.set(id, {
        id,
        year,
        season,
        label: termLabel(id),
        index: -1,
        real: false,
        flex: springFall && season === "W",
      });
    }
  }

  const sorted = [...map.values()].sort((a, b) => compareTermIds(a.id, b.id));
  sorted.forEach((t, i) => (t.index = i));
  return sorted;
}
