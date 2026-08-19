import { create } from "zustand";
import { PROGRAM_BY_ID } from "./data";
import {
  DEFAULT_ENROLLED_IDS,
  NESTED_PROGRAM_IDS,
  sortEnrollment,
} from "./engine/programs";
import { loadJson, saveJson } from "./engine/storage";

/**
 * Who the student is, as opposed to what they have planned.
 *
 * A separate store from `usePlan` for the same reasons panel layout is:
 * changing which programs you are doing must not enter the plan's undo stack,
 * must not ride along in an exported plan file, and must survive *Reset plan*.
 * It is also the seam Phase 2 plugs into — once the catalogue holds every
 * BYU-Idaho program, this is the only state that has to change to point the
 * whole app at a different degree.
 */
const KEY = "gradtree:profile:v1";

export interface ProfileState {
  /** Program ids the student is enrolled in, majors first. */
  enrolledIds: string[];
  enroll: (programId: string) => void;
  unenroll: (programId: string) => void;
  /** Back to what `student.json` declares. */
  resetEnrollment: () => void;
}

/**
 * A saved profile is untrusted input, and the catalogue moves underneath it.
 * Unknown ids are dropped rather than trusted — a program file that has been
 * renamed should cost you a rail section, not crash the app — and an empty
 * result falls back to the declared enrollment so the app is never degreeless.
 */
function restore(): string[] {
  const raw = loadJson<{ enrolledIds?: unknown }>(KEY, {});
  const ids = Array.isArray(raw.enrolledIds)
    ? raw.enrolledIds.filter(
        (id): id is string => typeof id === "string" && PROGRAM_BY_ID.has(id),
      )
    : [];
  return ids.length ? sortEnrollment(ids) : [...DEFAULT_ENROLLED_IDS];
}

export const useProfile = create<ProfileState>((set) => ({
  enrolledIds: restore(),

  enroll: (programId) =>
    set((s) => {
      // Nested programs (General Education) are evaluated inside their host and
      // must never be enrolled as siblings — that is the ~27-credit double count.
      if (!PROGRAM_BY_ID.has(programId) || NESTED_PROGRAM_IDS.has(programId))
        return {};
      if (s.enrolledIds.includes(programId)) return {};
      return { enrolledIds: sortEnrollment([...s.enrolledIds, programId]) };
    }),

  unenroll: (programId) =>
    set((s) => ({
      enrolledIds: s.enrolledIds.filter((id) => id !== programId),
    })),

  resetEnrollment: () => set({ enrolledIds: [...DEFAULT_ENROLLED_IDS] }),
}));

/** One subscription rather than a write per action, as with the plan autosave. */
let last = useProfile.getState().enrolledIds;
useProfile.subscribe((s) => {
  if (s.enrolledIds === last) return;
  last = s.enrolledIds;
  saveJson(KEY, { enrolledIds: s.enrolledIds });
});
