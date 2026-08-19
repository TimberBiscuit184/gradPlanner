import type { Placement } from "../types";

/**
 * Plan persistence.
 *
 * The original build banned localStorage outright because the target sandbox
 * threw on access. That is a real constraint, but assuming it everywhere meant
 * a single refresh destroyed the user's work in a normal browser. So: probe it
 * once, use it when it works, and degrade silently to in-memory when it does
 * not. Nothing here ever throws into React.
 */
const KEY = "gradtree:plan:v1";

let available: boolean | null = null;

/** One-time probe. A write is the only honest test — Safari private mode has the API but throws on set. */
export function storageAvailable(): boolean {
  if (available !== null) return available;
  try {
    const probe = "__gradtree_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

function isPlacement(v: unknown): v is Placement {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.courseId === "string" && typeof p.termId === "string";
}

export interface StoredEdits {
  placements: Placement[];
  droppedRegistrations: string[];
}

const EMPTY = (): StoredEdits => ({ placements: [], droppedRegistrations: [] });

/**
 * A stored plan is untrusted input — normalize every field on the way in.
 * Shared by both sources so a plan restored from the desktop backup gets
 * exactly the same scrutiny as one restored from `localStorage`.
 */
function normalize(value: unknown): StoredEdits | null {
  if (typeof value !== "object" || value === null) return null;
  const parsed = value as {
    placements?: unknown;
    droppedRegistrations?: unknown;
  };
  return {
    placements: Array.isArray(parsed.placements)
      ? parsed.placements.filter(isPlacement).map((p, i) => ({
          instanceId:
            typeof p.instanceId === "string" ? p.instanceId : `restored-${i}`,
          courseId: p.courseId,
          termId: p.termId,
          block:
            p.block === "1st" || p.block === "2nd" || p.block === "online"
              ? p.block
              : null,
        }))
      : [],
    droppedRegistrations: Array.isArray(parsed.droppedRegistrations)
      ? parsed.droppedRegistrations.filter(
          (k): k is string => typeof k === "string" && k.includes(":"),
        )
      : [],
  };
}

const isEmpty = (e: StoredEdits) =>
  e.placements.length === 0 && e.droppedRegistrations.length === 0;

/**
 * `localStorage` first, then the desktop shell's `plan.json`.
 *
 * The fallback is what makes "your work is saved" true on the desktop even if
 * the Chromium profile is reset, since `localStorage` lives inside an opaque
 * database in that profile. It only applies when `localStorage` has nothing to
 * offer, so a real plan can never be overwritten by a stale backup.
 */
export function loadEdits(): StoredEdits {
  if (storageAvailable()) {
    try {
      const raw = window.localStorage.getItem(KEY);
      const stored = raw ? normalize(JSON.parse(raw)) : null;
      if (stored && !isEmpty(stored)) {
        // Seed the backup on the way past. Autosave only fires on a *change*,
        // so a plan made before this existed — or made in the browser and
        // imported — would otherwise sit with no backup until the next edit,
        // which is precisely the window where "it's saved" needs to be true.
        window.gradtree?.savePlan({ app: "gradtree", version: 2, ...stored });
        return stored;
      }
    } catch {
      /* fall through to the desktop backup */
    }
  }
  const backup = normalize(window.gradtree?.savedPlan);
  if (!backup || isEmpty(backup)) return EMPTY();
  // Put a recovered plan straight back into localStorage. Autosave only fires
  // on a *change*, so without this the two stores stay out of step until the
  // next edit — and a plan that was just rescued from one lost store is the
  // worst moment to be relying on a single copy again.
  saveJson(KEY, { app: "gradtree", version: 2, ...backup });
  return backup;
}

export function saveEdits(edits: StoredEdits): void {
  const payload = { app: "gradtree", version: 2, ...edits };
  saveJson(KEY, payload);
  // Desktop only, and deliberately unconditional: mirroring on every save is
  // what makes the file a backup rather than a snapshot of whenever we last
  // remembered to write it.
  window.gradtree?.savePlan(payload);
}

/**
 * The same probe-and-degrade contract for anything else worth remembering
 * between sessions — panel layout, at the moment. Kept here rather than beside
 * the UI so there is still exactly one module in the codebase that touches
 * `localStorage`, and so a blocked-storage browser silently loses a layout
 * instead of throwing into React.
 *
 * Shape validation is the caller's job: this returns the fallback on anything
 * it cannot parse, but it cannot know what a valid value looks like.
 */
export function loadJson<T>(key: string, fallback: T): T {
  if (!storageAvailable()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return parsed === null || typeof parsed !== "object"
      ? fallback
      : (parsed as T);
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    available = false; // quota or a mid-session policy change — stop trying
  }
}
