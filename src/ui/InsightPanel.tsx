import { useState } from "react";
import { COURSE_BY_ID } from "../data";
import { planBottlenecksAsap } from "../engine/autoplan";
import { useModel } from "../model";
import { usePlan } from "../store";
import { STATUS_STYLE } from "./status";

/** §6 — the things the official planner cannot compute. */
export function InsightPanel() {
  const { marginal, critical, bottlenecks, fork, skills, model } = useModel();
  const plannedCount = usePlan((s) => s.placements.length);
  const [skillTermIdx, setSkillTermIdx] = useState(
    Math.min(6, skills.length - 1),
  );

  return (
    <div className="space-y-4 text-xs">
      {/* 1. marginal cost of the minor — two-colour dependency chart */}
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
              const result = planBottlenecksAsap(model);
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
