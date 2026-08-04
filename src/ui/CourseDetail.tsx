import { COURSE_BY_ID } from "../data";
import { programsContaining } from "../engine/plan";
import { useModel } from "../model";
import { usePlan } from "../store";
import { STATUS_STYLE } from "./status";
import type { PrereqNode } from "../types";

function PrereqText({ node }: { node: PrereqNode }) {
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

export function CourseDetail() {
  const { model } = useModel();
  const selected = usePlan((s) => s.selectedCourse);
  const select = usePlan((s) => s.select);
  const setDownstream = usePlan((s) => s.setDownstream);
  const whatBreaks = usePlan((s) => s.whatBreaks);
  const setWhatBreaks = usePlan((s) => s.setWhatBreaks);
  const setMode = usePlan((s) => s.setMode);

  if (!selected) return null;
  const course = COURSE_BY_ID.get(selected);
  if (!course) return null;
  const d = model.derived.get(selected)!;
  const sty = STATUS_STYLE[d.status];
  const programs = programsContaining(selected);

  return (
    <div className="absolute bottom-2 left-2 z-30 w-80 rounded-lg border border-line bg-surface p-3 shadow-2xl">
      <div className="flex items-start gap-2">
        <div>
          <div className="font-mono text-sm font-bold">{course.code}</div>
          <div className="text-xs text-ink-dim">{course.title}</div>
        </div>
        <button
          onClick={() => select(null)}
          className="focus-ring ml-auto text-ink-dim hover:text-ink"
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
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
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-dim">online</span>
        )}
      </div>

      <dl className="mt-2 space-y-1 text-[11px]">
        <div>
          <dt className="inline text-ink-faint">Prereq: </dt>
          <dd className="inline">
            <PrereqText node={course.prereq} />
            {!course.verified && (
              <span className="ml-1 text-warn">(unconfirmed prerequisite)</span>
            )}
          </dd>
        </div>
        {course.coreq.length > 0 && (
          <div>
            <dt className="inline text-ink-faint">Coreq: </dt>
            <dd className="inline font-mono">
              {course.coreq.map((c) => COURSE_BY_ID.get(c)?.code ?? c).join(", ")}
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
          <dt className="inline text-ink-faint">Blocks: </dt>
          <dd className="inline text-ink-dim">
            block availability unknown — check the class schedule
          </dd>
        </div>
        {course.prereqSource && (
          <div>
            <dt className="inline text-ink-faint">Prereq source: </dt>
            <dd className="inline text-ink-dim">{course.prereqSource}</dd>
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
            }}
            title="Re-render the transitive subtree in the warning hue"
          >
            What breaks if I drop this?
          </button>
        </div>
      )}
    </div>
  );
}
