import { PROGRAM_BY_ID } from "../data";
import type { Bucket, Program } from "../types";
import { activeEnrollment } from "./scope";

/**
 * Subject clusters for the tree layout. Laying the whole prerequisite graph out
 * as one dagre run interleaves unrelated chains — ENG 150's writing chain would
 * land hundreds of pixels from BUS 301 simply because both sit at busy ranks.
 * Laying each cluster out separately keeps related courses together.
 *
 * **The clusters are the student's own requirements.** This file used to hold
 * six hand-written groups taken from the electrical engineering major — "The
 * main chain — ECEN and CSE courses every EE takes" — which is what a nursing
 * student saw printed above their biology courses. A course from any other
 * degree either fell into whichever EE pool happened to contain it or dropped
 * into "Other".
 *
 * Now each top-level requirement of each enrolled program becomes a cluster,
 * which is exactly what EE's hand-written clusters were: its own buckets. The
 * headings therefore read "Nursing Core", "Prerequisite Courses", "General
 * Education" for a nursing student, and still read "Core Engineering",
 * "Supplemental" for an electrical engineer.
 */
export interface Cluster {
  id: string;
  label: string;
  sub: string;
}

/** Every course id anywhere inside a bucket. */
function poolOf(b: Bucket, out: Set<string> = new Set()): Set<string> {
  b.pool?.forEach((id) => out.add(id));
  b.groups?.forEach((g) => poolOf(g, out));
  return out;
}

interface Built {
  clusters: Cluster[];
  member: Map<string, string>;
}

const CACHE = new Map<string, Built>();

const OTHER: Cluster = {
  id: "cluster-other",
  label: "Other",
  sub: "Not tied to a requirement pool",
};

function build(enrolledIds: readonly string[]): Built {
  const key = [...enrolledIds].sort().join("|");
  const hit = CACHE.get(key);
  if (hit) return hit;

  const clusters: Cluster[] = [];
  const member = new Map<string, string>();

  const programs = enrolledIds
    .map((id) => PROGRAM_BY_ID.get(id))
    .filter((p): p is Program => !!p);

  /**
   * Referenced programs become clusters too — General Education is nested
   * inside nearly every major, and its courses are a third of the tree. Left
   * unclustered they all landed in "Other".
   */
  const seen = new Set<string>();
  const expand = (p: Program): Program[] => {
    if (seen.has(p.id)) return [];
    seen.add(p.id);
    const out = [p];
    const walk = (b: Bucket): void => {
      if (b.rule.type === "programRef" && b.rule.programId) {
        const ref = PROGRAM_BY_ID.get(b.rule.programId);
        if (ref) out.push(...expand(ref));
      }
      b.groups?.forEach(walk);
    };
    p.buckets.forEach(walk);
    return out;
  };
  const all = programs.flatMap(expand);

  for (const p of all) {
    for (const b of p.buckets) {
      // A bucket that only delegates has no courses of its own; its target is
      // already in `all` and contributes its own clusters.
      if (b.rule.type === "programRef") continue;
      const pool = poolOf(b);
      if (!pool.size) continue;
      const id = `cluster-${p.id}-${b.id ?? b.label ?? clusters.length}`;
      clusters.push({
        id,
        label: b.label ?? "Requirement",
        // Name the degree the requirement belongs to — with a major and a
        // minor enrolled, two clusters can otherwise both read "Core".
        sub: p.label,
      });
      // First match wins, so a course shared by two requirements is drawn once.
      for (const c of pool) if (!member.has(c)) member.set(c, id);
    }
  }

  clusters.push(OTHER);
  const built = { clusters, member };
  CACHE.set(key, built);
  return built;
}

/** The tree's sections, for the programs the student is doing. */
export function clusters(enrolledIds: readonly string[] = activeEnrollment()): Cluster[] {
  return build(enrolledIds).clusters;
}

/** First match wins — a course shows up in exactly one cluster. */
export function clusterOf(
  courseId: string,
  enrolledIds: readonly string[] = activeEnrollment(),
): string {
  return build(enrolledIds).member.get(courseId) ?? OTHER.id;
}
