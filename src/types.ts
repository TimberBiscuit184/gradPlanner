// Core data-model types mirroring the fixture JSON in data/.

export type Season = "F" | "W" | "S";

export type PrereqNode =
  | string
  | { and: PrereqNode[] }
  | { or: PrereqNode[] }
  | null;

export interface Course {
  id: string;
  code: string;
  title: string;
  credits: number;
  dept: string;
  prereq: PrereqNode;
  coreq: string[];
  terms: Season[];
  blocks: string[] | null;
  online: boolean;
  tags: string[];
  verified: boolean;
  termsConfirmed: boolean;
  blocksConfirmed: boolean;
  notes?: string;
  skills?: string[];
  prereqSource?: string;
  isPlaceholder?: boolean;
}

export interface CoursesFile {
  _note: string;
  courses: Course[];
}

export type RuleType =
  | "allOf"
  | "nOf"
  | "nCredits"
  | "allOfGroups"
  | "nOfGroups"
  | "fillTo"
  | "programRef";

export interface Rule {
  type: RuleType;
  n?: number;
  programId?: string;
}

export interface Bucket {
  id?: string;
  label?: string;
  credits?: { min: number; max: number };
  rule: Rule;
  pool?: string[];
  groups?: Bucket[];
  allowDoubleCount?: boolean;
  sharedPoolId?: string;
  usesPlaceholders?: boolean;
  note?: string;
}

export interface Program {
  id: string;
  code: string;
  label: string;
  type: "major" | "minor" | "general-education";
  catalogYear: string;
  totalCredits: { min: number; max: number };
  buckets: Bucket[];
  minGrade: string | null;
  programNotes?: string[];
  doubleCountsWith?: Record<string, string[] | string>;
  marginalCredits?: { estimate: number };
}

export type AttemptState =
  | "completed"
  | "failed"
  | "in-progress"
  | "registered"
  | "withdrawn";

export interface TranscriptEntry {
  id: string;
  section: string;
  grade?: string;
  credits: number;
  earned?: number;
  state: AttemptState;
  retake?: boolean;
  countsForCredit?: boolean;
  schedule?: string;
  modality?: string;
}

export interface StudentTerm {
  id: string;
  label: string;
  status: "complete" | "in-progress" | "registered";
  attemptedCredits?: number;
  earnedCredits?: number;
  gradesPostedOn?: string;
  courses: TranscriptEntry[];
}

export interface Student {
  student: string;
  catalog: string;
  major: { code: string; label: string; catalogYear: string };
  minor: { code: string; label: string; catalogYear: string };
  terms: StudentTerm[];
  track: { pattern: string };
  iplanTotals: Record<string, number>;
  generalEducation: { code: string; label: string; catalogYear: string };
}

// ---- Derived / engine types ----

export type CourseStatus =
  | "completed"
  | "failed"
  | "in-progress"
  | "registered"
  | "planned"
  | "available"
  | "locked";

/**
 * null = full semester (the default). "1st"/"2nd" = half-semester block rows.
 * "online" marks a planned course as an online section (only offered for
 * courses with online: true). Legacy "full" values are normalized to null.
 */
export type BlockChoice = "1st" | "2nd" | "online" | null;

/** A course card the user placed on the board (not from the transcript). */
export interface Placement {
  instanceId: string;
  courseId: string;
  termId: string;
  block: BlockChoice;
}

export interface TimelineTerm {
  id: string;
  year: number;
  season: Season;
  label: string;
  index: number;
  /** Real terms come from student.json and are read-only history/registration. */
  real: boolean;
  status?: "complete" | "in-progress" | "registered";
  /** Winter terms on a spring-fall pattern: "Flex Track" — fully plannable, just labeled. */
  flex: boolean;
}

export type WarningLevel = "error" | "warning" | "info";

export interface CourseFlag {
  level: WarningLevel;
  /** true when the flag rests on a verified:false prereq edge */
  unconfirmed: boolean;
  text: string;
}
