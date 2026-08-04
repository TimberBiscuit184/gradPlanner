import { GE_ABET } from "../data";
import type { Bucket } from "../types";

/**
 * Map each GE course to a display group for the tree's collapsible sections.
 * Groups come from ge-abet's own top-level buckets (breadth splits into its
 * two children so Arts/Humanities and Social Science read separately).
 */
export interface GeGroup {
  id: string;
  label: string;
  courseIds: string[];
}

let CACHE: GeGroup[] | null = null;

export function geGroups(): GeGroup[] {
  if (CACHE) return CACHE;
  const groups: GeGroup[] = [];
  const collect = (b: Bucket): string[] => {
    const out = [...(b.pool ?? [])];
    (b.groups ?? []).forEach((g) => out.push(...collect(g)));
    return out;
  };
  for (const bucket of GE_ABET.buckets) {
    if (bucket.id === "breadth") {
      for (const child of bucket.groups ?? []) {
        groups.push({
          id: child.id ?? "breadth-child",
          label: child.label ?? child.id ?? "Breadth",
          courseIds: [...new Set(collect(child))],
        });
      }
    } else {
      groups.push({
        id: bucket.id ?? "ge",
        label:
          bucket.id === "cornerstone"
            ? "Cornerstone — Religion"
            : (bucket.label ?? bucket.id ?? "GE"),
        courseIds: [...new Set(collect(bucket))],
      });
    }
  }
  CACHE = groups;
  return CACHE;
}

export function geGroupOf(courseId: string): GeGroup | null {
  return geGroups().find((g) => g.courseIds.includes(courseId)) ?? null;
}
