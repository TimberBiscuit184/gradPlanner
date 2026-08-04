// Grade order per BUILD_PROMPT §2. F and UW never pass and never earn credit.
const PASSING_ORDER = [
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
];

export function earnsCredit(grade: string | undefined): boolean {
  if (!grade) return false;
  return PASSING_ORDER.includes(grade);
}

/**
 * Whether a grade meets a program's minGrade threshold.
 * minGrade null (ge-abet) means any credit-earning grade passes — this is how
 * REL 333's D counts as completed (see DATA_GAPS I1).
 */
export function meetsThreshold(
  grade: string | undefined,
  minGrade: string | null,
): boolean {
  if (!earnsCredit(grade)) return false;
  if (minGrade === null) return true;
  const g = PASSING_ORDER.indexOf(grade!);
  const m = PASSING_ORDER.indexOf(minGrade);
  if (m === -1) return true;
  return g <= m;
}
