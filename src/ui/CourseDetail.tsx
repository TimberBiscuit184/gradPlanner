import { COURSE_BY_ID } from "../data";
import {
  earliestLegalTerm,
  isAtRisk,
  programsContaining,
} from "../engine/plan";
import { describeTrust } from "../engine/trust";
import { useModel } from "../model";
import { usePlan } from "../store";
import { FloatingPanel } from "./panels/FloatingPanel";
import { PANEL_IDS } from "./panels/panelStore";
import { STATUS_STYLE } from "./status";
import type { PrereqNode } from "../types";

export function PrereqText({ node }: { node: PrereqNode }) {
  if (node == null) return <span className="text-ink-faint">none</span>;
  if (typeof node === "string")
    return <span className="font-mono">{COURSE_BY_ID.get(node)?.code ?? node}</span>;
  const isAnd = "and" in node;
  const kids = isAnd ? node.and : node.or;
  return (
    <span>
      (
      {kids.map((k, i) => (
        <span key={i}>
          {i > 0 && <span className="text-ink-dim"> {isAnd ? "and" : "or"} </span>}
          <PrereqText node={k} />
        </span>
      ))}
      )
    </span>
  );
}

/**
 * Everything known about a course, minus the panel chrome. Shared by the
 * floating detail panel and the add-course picker's detail view so the two can
 * never drift apart.
 */
/** "Winter 2028" → "W28", so a five-link chain still fits on two lines. */
function shortTerm(label: string): string {
  const [season, year] = label.split(" ");
  return `${season[0]}${year.slice(2)}`;
}

export function CourseDetailBody({ courseId }: { courseId: string }) {
  const { model, reach: reachMap } = useModel();
  const setDownstream = usePlan((s) => s.setDownstream);
  const whatBreaks = usePlan((s) => s.whatBreaks);
  const setWhatBreaks = usePlan((s) => s.setWhatBreaks);
  const setMode = usePlan((s) => s.setMode);
  const closePicker = usePlan((s) => s.closePicker);

  const course = COURSE_BY_ID.get(courseId);
  if (!course) return null;
  const d = model.derived.get(courseId)!;
  const sty = STATUS_STYLE[d.status];
  const programs = programsContaining(courseId);
  const trust = describeTrust(course);
  const selected = courseId;
  const atRisk = !course.isPlaceholder && isAtRisk(courseId, model);
  /**
   * Show the earliest term for anything not already settled. "Available" is
   * optimistic — it only means a prerequisite is somewhere on the timeline, not
   * that you can take the course now. CSE 450 reads available because DS 250 is
   * registered for Fall, but the soonest it can actually be taken is Winter.
   * Courses already completed or on the board need no answer, unless something
   * about their placement is wrong.
   */
  const SETTLED = ["completed", "in-progress", "registered", "planned"];
  const showEarliest =
    !course.isPlaceholder && (atRisk || !SETTLED.includes(d.status));
  const earliest = earliestLegalTerm(courseId, model);
  const reach = reachMap.get(courseId);
  /** A blocked answer reads as a problem only when the course is at risk. */
  const problem = atRisk ? "text-risk" : "text-ink-dim";

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`rounded px-1.5 py-0.5 ${sty.card} border`}>{sty.label}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">
          {course.credits} cr
        </span>
        {d.directUnlocks.length > 0 && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-available">
            unlocks {d.directUnlocks.length}
          </span>
        )}
        {course.online && (
          <span
            className={`rounded bg-surface-2 px-1.5 py-0.5 ${
              course.onlineConfirmedBySchedule ? "text-ink-dim" : "text-warn"
            }`}
            title={
              course.onlineConfirmedBySchedule
                ? "An Online section ran in the 2026 schedule."
                : "Listed on BYU-Idaho's online course list, but no Online section appeared in the 2026 schedule — verify before relying on it."
            }
          >
            online{course.onlineConfirmedBySchedule ? "" : "?"}
          </span>
        )}
      </div>

      <dl className="mt-2 space-y-1 text-[11px]">
        <div>
          <dt className="inline text-ink-faint">Prereq: </dt>
          <dd className="inline">
            <PrereqText node={course.prereq} />
            {/* Say how much this rule can be relied on, and — crucially —
                whether the app will act on it. A prerequisite we only half-read
                is not enforced, and hiding that would let a warning read like a
                refusal. */}
            {!trust.enforced && (
              <span
                className="ml-1 text-warn"
                title={`${trust.label}. Because of that, Sprout will warn about this prerequisite but never block a drop on it.${
                  trust.dropped.length
                    ? `\n\nNot modelled: ${trust.dropped.join("; ")}`
                    : ""
                }`}
              >
                ({trust.trust === "parsed"
                  ? "partly read from the catalog"
                  : "unconfirmed prerequisite"}
                {trust.dropped.length > 0 &&
                  ` — ${trust.dropped.length} option${trust.dropped.length === 1 ? "" : "s"} not modelled`}
                )
              </span>
            )}
          </dd>
        </div>
        {course.coreq != null && (
          <div>
            <dt className="inline text-ink-faint">Coreq: </dt>
            <dd className="inline">
              <PrereqText node={course.coreq} />
              <span className="ml-1 text-ink-dim">
                — may be taken in the same semester.
              </span>
            </dd>
          </div>
        )}
        <div>
          <dt className="inline text-ink-faint">Terms: </dt>
          <dd className="inline">
            {course.terms.join(", ")}
            {!course.termsConfirmed && (
              <span className="text-ink-dim">
                {" "}
                — offered terms unconfirmed; check the class schedule before
                registering.
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="inline text-ink-faint">How it runs: </dt>
          <dd className="inline text-ink-dim">
            {!course.blocksConfirmed
              ? "block availability unknown — check the class schedule"
              : course.blocks?.length === 0
                ? "not scheduled"
                : course.blocks?.join(", ") === "full"
                  ? "full semester only"
                  : course.blocks?.includes("full")
                    ? `full semester, or ${course.blocks.filter((b) => b !== "full").join(" / ")} block`
                    : `${course.blocks?.join(" / ")} block only — no full-semester section`}
            {/* Online is a placement option alongside the blocks, so it belongs
                on this line and not only in the badge row. */}
            {course.online && (
              <>
                {" · "}
                <span
                  className={
                    course.onlineConfirmedBySchedule ? "text-inprogress" : "text-warn"
                  }
                  title={
                    course.onlineConfirmedBySchedule
                      ? "An Online-delivery section ran in the 2026 schedule."
                      : "Listed on BYU-Idaho's online course list, but no Online section appeared in the 2026 schedule — verify before relying on it."
                  }
                >
                  online section
                  {course.onlineConfirmedBySchedule ? "" : " (unconfirmed)"}
                </span>
              </>
            )}
            {!course.online && course.blocksConfirmed && (
              <span className="text-ink-faint"> · no online section</span>
            )}
          </dd>
        </div>
        {course.sectionCounts && (
          <div>
            <dt className="inline text-ink-faint">Sections: </dt>
            <dd className="inline text-ink-dim">
              {Object.entries(course.sectionCounts)
                .map(([s, n]) => `${n} in ${s === "F" ? "Fall" : s === "W" ? "Winter" : "Spring"}`)
                .join(", ")}{" "}
              <span className="text-ink-faint">(2026)</span>
            </dd>
          </div>
        )}
        {course.repeatable && (
          <div>
            <dt className="inline text-ink-faint">Repeatable: </dt>
            <dd className="inline text-ink-dim">
              {course.repeatable.maxCredits
                ? `up to ${course.repeatable.maxCredits} credits`
                : `up to ${course.repeatable.maxAttempts} attempts`}
            </dd>
          </div>
        )}
        {course.prereqSource && (
          <div>
            <dt className="inline text-ink-faint">Prereq source: </dt>
            <dd className="inline text-ink-dim">
              {course.prereqSource}
              {course.prereqCheckedOn && ` Checked ${course.prereqCheckedOn}.`}
            </dd>
          </div>
        )}
        {programs.length > 0 && (
          <div>
            <dt className="inline text-ink-faint">Counts toward: </dt>
            <dd className="inline text-ink-dim">
              {programs.map((p) => p.label).join(" · ")}
            </dd>
          </div>
        )}
        {course.notes && <div className="text-ink-faint">{course.notes}</div>}
      </dl>

      {/* The question `status` cannot answer: not "is it unlocked" but "how far
          away is it, and what has to happen first". Shown for every course you
          have not already finished or scheduled. */}
      {showEarliest && reach && (
        <div
          className={`mt-2 rounded border px-1.5 py-1 text-[11px] ${
            atRisk ? "border-risk/50 bg-risk/10" : "border-line bg-surface-2/50"
          }`}
        >
          <div>
            <span className="text-ink-faint">Soonest you could take it: </span>
            {reach.impossible ? (
              <span className={problem}>
                never — {course.code} is retired and no longer runs
              </span>
            ) : (
              <>
                <span className="font-medium text-ink">{reach.term?.label}</span>
                <span className="ml-1 text-ink-faint">
                  {reach.termsAway === 0
                    ? "— the next term you can plan"
                    : `— ${reach.termsAway} term${reach.termsAway === 1 ? "" : "s"} out`}
                </span>
              </>
            )}
          </div>

          {/* The chain that sets that date, and when each link has to land. */}
          {!reach.impossible && reach.path.length > 1 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] leading-tight">
              {reach.path.map((s, i) => (
                <span key={s.courseId} className="flex items-center gap-1">
                  {i > 0 && <span className="text-ink-faint">→</span>}
                  <span
                    className={
                      s.settled
                        ? "text-completed"
                        : i === reach.path.length - 1
                          ? "font-medium text-ink"
                          : "text-ink-dim"
                    }
                    title={`${s.code} — ${s.settled ? "already handled" : "must be taken"} in ${s.term?.label ?? "an unknown term"}`}
                  >
                    <span className="font-mono">{s.code}</span>
                    {s.settled && " ✓"}
                    <span className="ml-0.5 text-ink-faint">
                      {s.term ? shortTerm(s.term.label) : "?"}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          )}

          <div className="mt-0.5 text-[10px] leading-tight text-ink-faint">
            Assumes you plan that chain as early as the schedule allows.
          </div>

          {/* When it is already placed somewhere that does not work, the
              optimistic date is not the whole story — say what is wrong now. */}
          {atRisk && earliest.term && earliest.term.id !== reach.term?.id && (
            <div className="mt-1 text-[10px] leading-tight text-risk">
              Where it sits now does not work. Leaving the prerequisites where
              they are, the earliest is {earliest.term.label}.
            </div>
          )}
        </div>
      )}

      {d.flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {d.flags.map((f, i) => (
            <li
              key={i}
              className={`rounded border px-1.5 py-1 text-[11px] ${
                f.level === "error"
                  ? "border-danger/60 text-danger"
                  : f.level === "warning"
                    ? `${f.unconfirmed ? "border-dashed" : ""} border-warn/70 text-warn`
                    : "border-line text-ink-dim"
              }`}
            >
              {f.text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-line pt-2">
        <div className="text-[10px] uppercase tracking-wide text-ink-faint">Skills</div>
        {course.skills?.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {course.skills.map((s) => (
              <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
                {s}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-ink-faint">not yet tagged</div>
        )}
      </div>

      {!course.isPlaceholder && (
        <div className="mt-2 flex gap-1.5">
          <button
            className="focus-ring rounded border border-line px-2 py-1 text-[11px] hover:bg-surface-2"
            onClick={() => {
              setMode("tree");
              setDownstream(selected);
              setWhatBreaks(false);
              closePicker();
            }}
          >
            Show downstream
          </button>
          <button
            className={`focus-ring rounded border px-2 py-1 text-[11px] ${
              whatBreaks
                ? "border-warn bg-warn/15 text-warn"
                : "border-line hover:bg-surface-2"
            }`}
            onClick={() => {
              setMode("tree");
              setDownstream(selected);
              setWhatBreaks(!whatBreaks);
              closePicker();
            }}
            title="Re-render the transitive subtree in the warning hue"
          >
            What breaks if I drop this?
          </button>
        </div>
      )}
    </>
  );
}

/** The floating panel. Hidden while the picker is open — it shows the same body. */
export function CourseDetail() {
  const selected = usePlan((s) => s.selectedCourse);
  const select = usePlan((s) => s.select);
  const picker = usePlan((s) => s.picker);

  if (!selected || picker) return null;
  const course = COURSE_BY_ID.get(selected);
  if (!course) return null;

  return (
    <FloatingPanel
      id={PANEL_IDS.detail}
      // Bottom-left by default because that is where it always was — an
      // existing habit is worth more than a tidier default. Every other
      // position is now one drag away.
      initial={{ dock: "bl", fw: 0.26, fh: 0.6, x: 12, y: 140, w: 340, h: 440 }}
      label={`${course.code} — course detail`}
      title={<span className="font-mono">{course.code}</span>}
      subtitle={course.title}
      onClose={() => select(null)}
    >
      <div className="px-3 pb-3 pt-2">
        <CourseDetailBody courseId={selected} />
      </div>
    </FloatingPanel>
  );
}
