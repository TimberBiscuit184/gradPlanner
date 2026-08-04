import { AI_MINOR, EE, GE_ABET } from "../data";
import type { Bucket } from "../types";

/**
 * Subject clusters for the tree layout. Laying the whole prerequisite graph out
 * as one dagre run interleaves unrelated chains — ENG 150's writing chain would
 * land hundreds of pixels from BUS 301 simply because both sit at busy ranks.
 * Laying each cluster out separately keeps related courses together.
 */
export interface Cluster {
  id: string;
  label: string;
  sub: string;
}

export const CLUSTERS: Cluster[] = [
  {
    id: "cluster-core",
    label: "Engineering & Computing core",
    sub: "The main chain — ECEN and CSE courses every EE takes",
  },
  {
    id: "cluster-supplemental",
    label: "Supplemental engineering electives",
    sub: "Choose 4 (or 6 without an internship) — emphasis areas live here",
  },
  {
    id: "cluster-math-science",
    label: "Math & Science",
    sub: "Calculus, physics, chemistry, and the science elective options",
  },
  {
    id: "cluster-ai",
    label: "A.I. Engineering minor",
    sub: "The data-science courses beyond the EE major",
  },
  {
    id: "cluster-ge",
    label: "General Education with prerequisites",
    sub: "Writing sequence and other GE courses that chain",
  },
  { id: "cluster-other", label: "Other", sub: "Not tied to a requirement pool" },
];

function poolOf(buckets: Bucket[], pred: (b: Bucket) => boolean): Set<string> {
  const out = new Set<string>();
  const walk = (b: Bucket, on: boolean): void => {
    const active = on || pred(b);
    if (active) b.pool?.forEach((id) => out.add(id));
    b.groups?.forEach((g) => walk(g, active));
  };
  buckets.forEach((b) => walk(b, false));
  return out;
}

const CORE = poolOf(
  EE.buckets,
  (b) => b.id === "core-engineering" || b.id === "introduction",
);
const SUPPLEMENTAL = poolOf(EE.buckets, (b) => b.id === "supplemental");
const MATH_SCI = poolOf(
  EE.buckets,
  (b) => b.id === "math-science" || b.id === "foundational-math",
);
const AI = poolOf(AI_MINOR.buckets, () => true);
const GE = poolOf(GE_ABET.buckets, () => true);

/** First match wins — a course shows up in exactly one cluster. */
export function clusterOf(courseId: string): string {
  if (CORE.has(courseId)) return "cluster-core";
  if (SUPPLEMENTAL.has(courseId)) return "cluster-supplemental";
  if (MATH_SCI.has(courseId)) return "cluster-math-science";
  if (AI.has(courseId)) return "cluster-ai";
  if (GE.has(courseId)) return "cluster-ge";
  return "cluster-other";
}
