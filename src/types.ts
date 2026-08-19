// Core data-model types mirroring the fixture JSON in data/.

export type Season = "F" | "W" | "S";

export type PrereqNode =
  | string
  | { and: PrereqNode[] }
  | { or: PrereqNode[] }
  | null;

/**
 * How much a prerequisite expression can be relied on. Defined here rather than
 * beside the enforcement rules so `types.ts` stays the shared vocabulary and
 * does not import from `engine/` — see `src/engine/trust.ts` for what each
 * grade *means* for enforcement.
 */
export type PrereqTrust = "human" | "exact" | "parsed" | "unsure" | "none";

/**
 * An enrollment gate the catalogue states outside its requisite rules. Defined
 * here for the same reason as `PrereqTrust`: `types.ts` is the shared
 * vocabulary and must not import from `engine/`. See `engine/restrictions.ts`
 * for how each kind is checked.
 */
export type Restriction =
  | {
      kind: "declaredIn";
      programCodes: string[];
      /**
       * Set when the restriction only governs *some* sections — BUS 301 limits
       * its campus sections by program while its online sections are open to
       * everyone. Without this the gate reads as an absolute exclusion.
       */
      appliesTo?: "campus";
      text: string;
    }
  | { kind: "minCredits"; credits: number; text: string }
  | { kind: "approval"; of: "instructor" | "application"; text: string }
  | { kind: "delivery"; mode: "campus" | "online" | "concurrent"; text: string }
  | { kind: "note"; text: string };

export interface Course {
  id: string;
  code: string;
  title: string;
  credits: number;
  dept: string;
  prereq: PrereqNode;
  /**
   * Same boolean-expression shape as `prereq`. The catalog states several
   * corequisites as "completed or concurrently enrolled in at least 1 of …",
   * so a flat string[] cannot represent them.
   */
  coreq: PrereqNode;
  terms: Season[];
  blocks: string[] | null;
  online: boolean;
  tags: string[];
  /**
   * true = compared against the live catalog on `prereqCheckedOn` and matches.
   * Kept for the 136 hand-audited courses; `prereqTrust` supersedes it for
   * anything generated. See `src/engine/trust.ts`.
   */
  verified: boolean;
  /**
   * How much the prerequisite expression can be relied on. Absent means "derive
   * it from `verified`" — legacy fixture data was all human-checked. Only
   * `human` and `exact` are *enforced*; everything else warns, because refusing
   * a legal registration is worse than allowing an illegal one.
   */
  prereqTrust?: PrereqTrust;
  /** Catalogue codes or conditions the parser could not model, kept verbatim. */
  prereqDropped?: string[];
  termsConfirmed: boolean;
  blocksConfirmed: boolean;
  notes?: string;
  skills?: string[];
  prereqSource?: string;
  /** ISO date of the last catalog comparison. */
  prereqCheckedOn?: string;
  /** Where `terms`/`blocks`/`online` came from, and when. */
  scheduleSource?: string;
  scheduleCheckedOn?: string;
  /** Sections seen per season in the scraped year — a proxy for how easy it is to get in. */
  sectionCounts?: Partial<Record<Season, number>>;
  /**
   * `online` is the union of two sources that disagree on 9 courses. These
   * record which one backs it: an Online-delivery section actually seen in the
   * scraped schedule, and/or BYU-Idaho's curated online course list.
   */
  onlineConfirmedBySchedule?: boolean;
  onlineListed?: boolean;
  /** Enrollment gates the catalog states outside the requisite rules. */
  /** Legacy free prose. Parsed into `Restriction`s on read when the structured
   * form is absent — see `restrictionsOf`. */
  restrictions?: string[];
  /** Structured enrollment gates. Authoritative when present. */
  restrictionRules?: Restriction[];
  repeatable?: { maxCredits?: number; maxAttempts?: number };
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
  /**
   * Every course in this bucket must be taken in the SAME term.
   *
   * "The following courses must be taken together in the same semester" —
   * Business Management's IBC block (BUS 300 + BUS 302 + MKT 301) and the
   * Small Business minor. Requiring all three was never the hard part; the app
   * happily let a student spread them across three semesters, which is a plan
   * that looks complete and cannot be registered.
   */
  sameTerm?: boolean;
}

export interface Program {
  id: string;
  code: string;
  label: string;
  /**
   * `cluster` is a small BYU-Idaho credential (~12 cr) that some degrees are
   * assembled from — Interdisciplinary Studies is built entirely out of them.
   * Carried so those references resolve, but kept out of the picker: 110
   * clusters would bury the 205 majors and minors people actually choose.
   *
   * `certificate` is carried for the same reason: 13 degrees reference one,
   * and without them those references dangle and the program cannot assert.
   * Both are excluded from the picker by type, which is a one-line change to
   * reverse if students should be able to declare them directly.
   */
  type: "major" | "minor" | "general-education" | "cluster" | "certificate";
  catalogYear: string;
  totalCredits: { min: number; max: number };
  buckets: Bucket[];
  minGrade: string | null;
  /**
   * How this program's requirements were obtained. Absent means a human wrote
   * the file — see `engine/trust.ts`. Present means a parser read it out of the
   * catalogue, and how completely.
   */
  parseConfidence?: "exact" | "parsed" | "unsure";
  /** Requirement clauses the parser could not model, verbatim. */
  parseDropped?: string[];
  /** Courses the catalogue named for this program that we do not carry. */
  parseUnknownCourses?: string[];
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
  termGpa?: number;
  gradesPostedOn?: string;
  courses: TranscriptEntry[];
}

/** Figures read straight off the official transcript, used to check our math. */
export interface TranscriptSummary {
  advisor?: string;
  classification?: string;
  degree?: string;
  academicStatus?: string;
  cumulative: {
    attemptedCredits: number;
    earnedCredits: number;
    gpaCredits: number;
    qualityPoints: number;
    gpa: number;
  };
  testScores?: Record<string, unknown>;
}

export interface Declaration {
  code: string;
  label: string;
  catalogYear: string;
}

export interface Student {
  student: string;
  catalog: string;
  /**
   * Declarations are optional: the shipped record is blank so a new user picks
   * their own programs on first run. Everything that reads these must cope
   * with their absence rather than assuming a major exists.
   */
  major?: Declaration | null;
  minor?: Declaration | null;
  terms: StudentTerm[];
  track: { pattern: string };
  iplanTotals?: Record<string, number>;
  generalEducation?: Declaration | null;
  _transcript?: TranscriptSummary;
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
