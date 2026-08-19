import { useMemo, useState } from "react";
import { COURSE_BY_ID } from "../data";
import { planBottlenecksAsap } from "../engine/autoplan";
import {
  cumulativeGpa,
  formatGpa,
  projectGpa,
  PROJECTABLE_GRADES,
} from "../engine/gpa";
import { deepestFirst } from "../engine/reach";
import { useModel } from "../model";
import { useProfile } from "../profileStore";
import { usePlan } from "../store";
import { STATUS_STYLE } from "./status";

/**
 * "What should I take next?" — the first thing worth answering, so it sits at
 * the top. Ranked by the engine (see suggest.ts); every pick carries its own
 * justification so the advice is auditable rather than a black box.
 */
function SuggestedTerm() {
  const { suggestion, model } = useModel();
  const addPlacements = usePlan((s) => s.addPlacements);
  const openPicker = usePlan((s) => s.openPicker);
  const setEmphasis = usePlan((s) => s.setEmphasis);
  const emphasis = usePlan((s) => s.emphasis);
  const showToast = usePlan((s) => s.showToast);
  const setMode = usePlan((s) => s.setMode);

  if (!suggestion) {
    return (
      <section>
        <h4 className="mb-1 font-semibold text-ink">What to take next</h4>
        <p className="text-ink-dim">
          Every future term already carries a full-time load — nothing left to
          suggest.
        </p>
      </section>
    );
  }

  const { term, picks, totalCredits, targetCredits, runnersUp, notes } =
    suggestion;
  const focused = emphasis === "focus:suggested";

  return (
    <section className="rounded border border-planned/40 bg-planned/5 p-2">
      <div className="mb-1 flex items-baseline gap-2">
        <h4 className="font-semibold text-ink">Suggested for {term.label}</h4>
        <span className="ml-auto font-mono text-[10px] text-ink-dim">
          {totalCredits}/{targetCredits} cr
        </span>
      </div>

      {picks.length > 0 ? (
        <>
          <ul className="space-y-1">
            {picks.map((p) => (
              <li key={p.courseId} className="flex items-baseline gap-1.5">
                <span className="w-20 shrink-0 font-mono text-[11px] font-semibold">
                  {p.code}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                  {p.credits}cr
                </span>
                <span className="min-w-0 flex-1 text-[10px] leading-tight text-ink-dim">
                  {p.reasons[0]}
                  {p.reasons.length > 1 && (
                    <span className="text-ink-faint">
                      {" · "}
                      {p.reasons.slice(1).join(" · ")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              className="focus-ring rounded border border-planned bg-planned/25 px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-planned/40"
              title={`Place all ${picks.length} into ${term.label}. One undo step.`}
              onClick={() => {
                addPlacements(
                  picks.map((p) => ({ courseId: p.courseId, termId: term.id })),
                );
                showToast({
                  text: `Planned ${picks.length} courses into ${term.label} (${totalCredits} cr): ${picks.map((p) => p.code).join(", ")}. Undo puts it all back.`,
                  level: "ok",
                });
              }}
            >
              Plan all {picks.length} into {term.label}
            </button>
            <button
              className={`focus-ring rounded border px-2 py-0.5 text-[11px] ${
                focused
                  ? "border-planned bg-planned/20 text-ink"
                  : "border-line text-ink-dim hover:text-ink"
              }`}
              title="Dim everything except these courses and their prerequisite chains"
              onClick={() => setEmphasis(focused ? null : "focus:suggested")}
            >
              {focused ? "Clear highlight" : "Highlight these"}
            </button>
            <button
              className="focus-ring rounded border border-line px-2 py-0.5 text-[11px] text-ink-dim hover:text-ink"
              title={`Open the full list of courses offered in ${term.label}`}
              onClick={() => {
                setMode("board");
                openPicker({ termId: term.id });
              }}
            >
              Browse {term.label}
            </button>
          </div>
        </>
      ) : null}

      {runnersUp.length > 0 && (
        <p className="mt-1.5 text-[10px] leading-tight text-ink-faint">
          Also legal that term:{" "}
          {runnersUp.map((r) => r.code).join(", ")}
        </p>
      )}
      {notes.map((n) => (
        <p key={n} className="mt-1 text-[10px] leading-tight text-ink-faint">
          {n}
        </p>
      ))}
      <p className="mt-1 text-[10px] leading-tight text-ink-faint">
        Ranked by what delays graduation: the critical path first, then courses
        that gate others, then ones offered only once a year. Advice, not an
        audit — {model.timeline.length > 0 ? "check it against I-Plan" : ""}.
      </p>
    </section>
  );
}

/**
 * Which courses stay out of reach longest — the chains worth starting now.
 * `status` cannot show this: available/locked only says whether a prerequisite
 * is on the timeline at all, never how many semesters deep the course sits.
 */
function FurthestOut() {
  const { reach, obsolete } = useModel();
  const select = usePlan((s) => s.select);
  const rows = useMemo(() => deepestFirst(reach, obsolete, 8), [reach, obsolete]);
  if (!rows.length) return null;

  return (
    <section>
      <h4 className="mb-1 font-semibold text-ink">
        Furthest out — start these chains first
      </h4>
      <p className="mb-1.5 text-[10px] leading-tight text-ink-faint">
        Soonest each could be taken if you planned its prerequisites as early as
        the schedule allows. Green links are already handled.
      </p>
      <ul className="space-y-1.5">
        {rows.map(({ courseId, reach: r }) => (
          <li key={courseId}>
            <button
              onClick={() => select(courseId)}
              className="focus-ring flex w-full items-baseline gap-1.5 text-left"
            >
              <span className="w-20 shrink-0 font-mono text-[11px] font-semibold">
                {COURSE_BY_ID.get(courseId)?.code}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-available">
                +{r.termsAway}
              </span>
              <span className="truncate text-[10px] text-ink-dim">
                {r.term?.label}
              </span>
            </button>
            <div className="ml-[5.25rem] flex flex-wrap items-center gap-x-1 text-[10px] leading-tight text-ink-faint">
              {r.path.map((s, i) => (
                <span key={s.courseId}>
                  {i > 0 && <span className="mr-1">→</span>}
                  <span className={s.settled ? "text-completed" : "text-ink-dim"}>
                    {s.code}
                    {s.settled && " ✓"}
                  </span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** §6 — the things the official planner cannot compute. */
export function InsightPanel() {
  const enrolledIds = useProfile((s) => s.enrolledIds);
  const minorEnrolled = enrolledIds.includes("ai-engineering-minor");
  const { marginal, critical, bottlenecks, fork, skills, model, obsolete } =
    useModel();
  const plannedCount = usePlan((s) => s.placements.length);
  const [skillTermIdx, setSkillTermIdx] = useState(
    Math.min(6, skills.length - 1),
  );
  // Transcript-only, so it never changes with the plan.
  const gpa = useMemo(() => cumulativeGpa(), []);
  const [assumed, setAssumed] = useState("B");

  /** Everything with credits but no grade yet — registered, in progress, planned. */
  const upcoming = useMemo(() => {
    const out: { courseId: string; credits: number }[] = [];
    for (const d of model.derived.values()) {
      for (const o of d.occurrences) {
        if (o.grade) continue;
        if (!["registered", "in-progress", "planned"].includes(o.state)) continue;
        const c = COURSE_BY_ID.get(o.courseId);
        if (!c || c.isPlaceholder) continue; // a placeholder has no grade to earn
        out.push({ courseId: o.courseId, credits: o.credits });
      }
    }
    return out;
  }, [model]);

  const projection = useMemo(
    () => projectGpa(assumed, upcoming),
    [assumed, upcoming],
  );

  return (
    <div className="space-y-4 text-xs">
      <SuggestedTerm />
      <FurthestOut />

      {/* 0. GPA — the 2.0 graduation floor is a real requirement nothing else checks */}
      <section>
        <h4 className="mb-1 font-semibold text-ink">Cumulative GPA</h4>
        <div className="flex items-baseline gap-2">
          <span
            className={`font-mono text-2xl ${
              gpa.official.gpa >= 2 ? "text-completed" : "text-danger"
            }`}
          >
            {formatGpa(gpa.official.gpa)}
          </span>
          <span className="text-[10px] leading-tight text-ink-faint">
            {gpa.official.qualityPoints.toFixed(1)} quality points
            <br />
            {gpa.official.gpaCredits} GPA credits
          </span>
        </div>
        <p className="mt-1 text-ink-dim">
          Graduation needs a <span className="font-mono">2.0</span> cumulative
          GPA, and EE major courses need a{" "}
          <span className="font-mono">C-</span> each.
        </p>
        {gpa.superseded.length > 0 && (
          <p className="mt-1 text-[10px] leading-tight text-ink-faint">
            Retaking a course removes the old attempt from your GPA entirely —{" "}
            {gpa.superseded
              .map(
                (r) =>
                  `${COURSE_BY_ID.get(r.courseId)?.code ?? r.courseId} (${r.grade}, ${r.credits} cr)`,
              )
              .join(" and ")}{" "}
            {gpa.superseded.length === 1 ? "is" : "are"} excluded, which is why
            GPA credits are lower than credits attempted.
          </p>
        )}

        {/* Projection — updates as you plan, since `upcoming` reads the model */}
        <div className="mt-2 rounded border border-line px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-ink-dim">If I average</span>
            {PROJECTABLE_GRADES.map((g) => (
              <button
                key={g}
                onClick={() => setAssumed(g)}
                className={`focus-ring rounded px-1.5 py-0.5 font-mono text-[11px] ${
                  assumed === g
                    ? "bg-planned/30 text-ink"
                    : "bg-surface-2 text-ink-faint hover:text-ink-dim"
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {projection ? (
            <>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span
                  className={`font-mono text-lg ${
                    projection.projected.gpa >= 2
                      ? "text-completed"
                      : "text-danger"
                  }`}
                >
                  {formatGpa(projection.projected.gpa)}
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    projection.delta >= 0 ? "text-completed" : "text-danger"
                  }`}
                >
                  {projection.delta >= 0 ? "▲" : "▼"}
                  {Math.abs(projection.delta).toFixed(3)}
                </span>
                <span className="text-[10px] text-ink-faint">
                  over {projection.projected.gpaCredits} GPA credits
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-tight text-ink-faint">
                Assumes that grade across the {projection.upcomingCredits}{" "}
                credits you have registered or planned.
                {projection.replaces.length > 0 && (
                  <>
                    {" "}
                    {projection.replaces
                      .map(
                        (r) =>
                          `${COURSE_BY_ID.get(r.courseId)?.code ?? r.courseId} retakes a ${r.oldGrade}`,
                      )
                      .join(", ")}{" "}
                    — worth double, since it also drops the old grade out of your
                    GPA credits.
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[10px] text-ink-faint">
              Nothing registered or planned yet — plan some courses and this
              projects forward from them.
            </p>
          )}
        </div>
      </section>

      {/* 1. marginal cost of the minor — two-colour dependency chart.
          Hidden unless the minor is actually enrolled: the numbers are computed
          against the EE major and the A.I. minor specifically, so showing them
          to a student doing neither would be confidently wrong. Generalising
          the calculation itself is a later phase. */}
      {minorEnrolled && (
      <section>
        <h4 className="mb-1 font-semibold text-ink">
          What the A.I. minor actually costs
        </h4>
        <p className="mb-1.5 text-ink-dim">
          <span className="font-mono text-available">{marginal.marginalCredits} cr</span>{" "}
          net-new · {marginal.sharedCredits} cr already inside the EE major
        </p>
        <div className="space-y-1">
          {marginal.rows.map((r) => (
            <div key={r.courseId} className="flex items-center gap-1.5">
              <span className="w-20 shrink-0 font-mono">{r.code}</span>
              <div
                className={`h-3.5 rounded-sm ${
                  r.sharedWithMajor ? "bg-completed/60" : "bg-available/70"
                }`}
                style={{ width: `${r.credits * 22}px` }}
                title={
                  (r.sharedWithMajor
                    ? "Already required by the EE major"
                    : "Net-new for the minor") + (r.note ? ` — ${r.note}` : "")
                }
              />
              <span className="font-mono text-ink-faint">{r.credits}</span>
              {r.note && (
                <span className="text-warn" title={r.note}>
                  *
                </span>
              )}
              <span className={`ml-auto ${STATUS_STYLE[r.status as keyof typeof STATUS_STYLE]?.text ?? "text-ink-faint"}`}>
                {r.status}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-3 text-[10px] text-ink-faint">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-completed/60" />
            shared with major
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-available/70" />
            net-new
          </span>
          <span>* conditional — see tooltip</span>
        </div>
      </section>

      )}

      {/* 2. critical path — horizontal strip */}
      <section>
        <h4 className="mb-1 font-semibold text-ink">Critical path</h4>
        <div className="flex flex-wrap items-center gap-1">
          {critical.chain.map((id, i) => (
            <span key={id} className="flex items-center gap-1">
              {i > 0 && <span className="text-ink-faint">→</span>}
              <span
                className={`rounded border px-1.5 py-0.5 font-mono ${
                  model.derived.get(id)?.status === "in-progress" ||
                  model.derived.get(id)?.status === "registered"
                    ? "border-inprogress/60 text-inprogress"
                    : "border-line text-ink"
                }`}
              >
                {COURSE_BY_ID.get(id)?.code ?? id}
              </span>
            </span>
          ))}
        </div>
        <p className="mt-1 text-ink-dim">
          Longest incomplete prerequisite chain ({critical.chain.length} courses).
          Earliest finish on your spring–fall track:{" "}
          <span className="text-ink">{critical.earliestFinish ?? "—"}</span>
        </p>
      </section>

      {/* 3. bottlenecks */}
      <section>
        <div className="mb-1 flex items-center gap-2">
          <h4 className="font-semibold text-ink">Bottlenecks</h4>
          {plannedCount > 0 && (
            <button
              className="focus-ring ml-auto rounded border border-line px-2 py-0.5 text-[11px] text-ink-dim hover:bg-surface-2"
              title="Remove every course you have planned (your transcript and registered terms are untouched)."
              onClick={() => {
                usePlan.getState().importPlan([]);
                usePlan.getState().showToast({
                  text: `Cleared ${plannedCount} planned course${plannedCount === 1 ? "" : "s"}. Your real terms are untouched.`,
                  level: "info",
                });
              }}
            >
              Clear planned ({plannedCount})
            </button>
          )}
          <button
            className={`focus-ring ${plannedCount > 0 ? "" : "ml-auto"} rounded border border-planned/60 bg-planned/15 px-2 py-0.5 text-[11px] text-planned hover:bg-planned/25`}
            title="Place gate courses and enough single-term supplemental electives at their earliest valid terms, prerequisite chains included. One supplemental slot stays open for CSE 450 (A.I. minor)."
            onClick={() => {
              const result = planBottlenecksAsap(model, obsolete);
              if (result.additions.length === 0) {
                usePlan.getState().showToast({
                  text:
                    plannedCount > 0
                      ? "Nothing to add — these bottlenecks are already on your plan. Use “Clear planned” first to rebuild from scratch."
                      : "Nothing to place — no unplanned bottlenecks remain.",
                  level: "info",
                });
                return;
              }
              usePlan.getState().addPlacements(result.additions);
              const summary = result.additions
                .map(
                  (a) =>
                    `${COURSE_BY_ID.get(a.courseId)?.code ?? a.courseId} → ${a.termId}`,
                )
                .join(", ");
              usePlan.getState().showToast({
                text: `Planned ${result.additions.length} courses: ${summary}${
                  result.notes.length ? ` · ${result.notes.join(" · ")}` : ""
                }`,
                level: "ok",
              });
            }}
          >
            Plan bottlenecks ASAP
          </button>
        </div>
        <div className="space-y-0.5">
          {bottlenecks.slice(0, 10).map((b) => (
            <div key={b.courseId} className="flex gap-2">
              <span className="w-20 shrink-0 font-mono">{b.code}</span>
              <span className="text-ink-dim">{b.reasons.join(" · ")}</span>
            </div>
          ))}
          {bottlenecks.length === 0 && (
            <p className="text-ink-faint">No unplanned bottlenecks.</p>
          )}
        </div>
      </section>

      {/* 5. slack is surfaced inline on nCredits rows (Δ badges); 6. experiential fork */}
      <section>
        <h4 className="mb-1 font-semibold text-ink">Experiential fork</h4>
        <div className="space-y-1.5">
          <div className="rounded border border-line bg-surface px-2 py-1.5">
            <div className="font-medium">{fork.internship.label}</div>
            <div className="text-ink-dim">
              {fork.internship.electives} supplemental electives ·{" "}
              <span className="font-mono">{fork.internship.credits} cr</span> total
            </div>
          </div>
          <div className="rounded border border-line bg-surface px-2 py-1.5">
            <div className="font-medium">{fork.noInternship.label}</div>
            <div className="text-ink-dim">
              {fork.noInternship.electives} supplemental electives ·{" "}
              <span className="font-mono">{fork.noInternship.credits} cr</span> total
              — skipping the internship costs 2 extra electives
            </div>
          </div>
          <p className="text-[10px] text-ink-faint">
            {fork.winterOnlyElectives.length} of{" "}
            {fork.reachableElectives + fork.winterOnlyElectives.length} electives
            are Winter-only (
            {fork.winterOnlyElectives
              .map((id) => COURSE_BY_ID.get(id)?.code)
              .join(", ")}
            ) — plannable in Flex Track semesters; {fork.reachableElectives} fit
            the spring–fall pattern directly.
          </p>
        </div>
      </section>

      {/* 4. career mapping — shell only; course→skill is the only hop in the data */}
      <section>
        <h4 className="mb-1 font-semibold text-ink">Skills by term</h4>
        <input
          type="range"
          min={0}
          max={skills.length - 1}
          value={skillTermIdx}
          onChange={(e) => setSkillTermIdx(Number(e.target.value))}
          className="w-full accent-planned"
          aria-label="Skills-by-term slider"
        />
        <p className="mb-1 text-ink-dim">
          By <span className="text-ink">{skills[skillTermIdx]?.label}</span>:{" "}
          {skills[skillTermIdx]?.cumulative.length ?? 0} skills
        </p>
        <div className="flex flex-wrap gap-1">
          {(skills[skillTermIdx]?.cumulative ?? []).map((s) => (
            <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
              {s}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-ink-faint">
          Skill tags exist on 28 of 136 courses; the rest are not yet tagged.
          Course → occupation mapping is not in the data, so no job titles are
          shown — a fabricated mapping would be worse than none.
        </p>
      </section>
    </div>
  );
}
