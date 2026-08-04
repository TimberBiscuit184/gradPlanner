import { useState } from "react";
import type { RailRow } from "../engine/requirements";
import { bucketPoolIds } from "../engine/requirements";
import { useHypotheticalBundle, useModel, type ModelBundle } from "../model";
import { usePlan } from "../store";
import { CourseChip } from "./CourseCard";
import { InsightPanel } from "./InsightPanel";
import type { Program } from "../types";

function ProgressBar({ have, need, ghost }: { have: number; need: number; ghost?: number }) {
  const pct = need > 0 ? Math.min(100, (have / need) * 100) : 0;
  const gpct = ghost !== undefined && need > 0 ? Math.min(100, (ghost / need) * 100) : null;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-surface-2">
      {gpct !== null && gpct > pct && (
        <div className="h-full bg-planned/40" style={{ width: `${gpct}%` }} />
      )}
      <div
        className={`h-full bg-completed ${gpct !== null && gpct > pct ? "-mt-1.5" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function RowView({
  row,
  program,
  hypoRow,
}: {
  row: RailRow;
  program: Program;
  hypoRow: RailRow | undefined;
}) {
  const lensPath = usePlan((s) => s.lensPath);
  const setLens = usePlan((s) => s.setLens);
  const [open, setOpen] = useState(false);
  const be = row.eval;
  const active = lensPath === row.path;
  const ghost = hypoRow && hypoRow.eval.have !== be.have ? hypoRow.eval.have : undefined;

  const unitText =
    be.unit === "courses"
      ? `${be.have}/${be.need} courses`
      : be.unit === "credits"
        ? `${be.have}/${be.need} cr`
        : be.unit === "groups"
          ? `${be.have}/${be.need} option${be.need === 1 ? "" : "s"}`
          : `${be.have}/${be.need} cr`;

  const pool = [...bucketPoolIds(be, program)];

  if (be.notNeeded) {
    return (
      <div
        style={{ marginLeft: row.depth * 10 }}
        className="flex items-center gap-2 rounded px-1.5 py-1 opacity-45"
        title="A different option already satisfies this requirement — these courses are not needed."
      >
        <span className="truncate text-xs text-ink-faint line-through">
          {be.label}
        </span>
        <span className="ml-auto shrink-0 text-[10px] italic text-ink-faint">
          not needed
        </span>
      </div>
    );
  }

  return (
    <div style={{ marginLeft: row.depth * 10 }}>
      <div
        className={`group flex items-center gap-2 rounded px-1.5 py-1 ${
          active ? "bg-planned/15 ring-1 ring-planned/50" : "hover:bg-surface-2"
        }`}
      >
        <button
          className="focus-ring flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() =>
            active ? setLens(null, null) : setLens(row.path, pool)
          }
          title={be.bucket.note ?? `Filter to ${be.label}`}
        >
          <span
            className={`truncate text-xs ${row.depth === 0 ? "font-semibold" : "text-ink-dim"}`}
          >
            {be.label}
          </span>
          {be.satisfied && <span className="text-[10px] text-completed">✓</span>}
          <span className={`ml-auto shrink-0 font-mono text-[10px] ${ghost !== undefined ? "text-planned" : "text-ink-faint"}`}>
            {ghost !== undefined ? `${be.have}→${ghost}` : unitText}
            {be.slack !== null && be.slack <= 2 && (
              <span className="ml-1 text-warn" title={`Only ${be.slack} credit(s) of slack in this pool`}>
                Δ{be.slack}
              </span>
            )}
          </span>
        </button>
        {pool.length > 0 && pool.length < 40 && (
          <button
            className="focus-ring hidden text-[10px] text-ink-faint group-hover:block"
            onClick={() => setOpen((v) => !v)}
            aria-label={`${open ? "Hide" : "Show"} courses in ${be.label}`}
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </div>
      <div className="px-1.5 pb-1">
        <ProgressBar have={be.have} need={be.need} ghost={ghost} />
      </div>
      {open && (
        <div className="mb-1.5 grid grid-cols-2 gap-1 px-1.5">
          {pool.map((id) => (
            <CourseChip key={id} courseId={id} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProgramSection({
  label,
  rows,
  hypoRows,
  program,
  applied,
  total,
}: {
  label: string;
  rows: RailRow[];
  hypoRows: RailRow[] | undefined;
  program: Program;
  applied: number;
  total: { min: number; max: number };
}) {
  return (
    <section className="mb-3">
      <header className="mb-1 flex items-baseline gap-2 px-1.5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink-dim">
          {label}
        </h3>
        <span className="ml-auto font-mono text-[11px] text-ink-dim">
          {applied} /{" "}
          {total.min === total.max ? total.min : `${total.min}–${total.max}`} cr
        </span>
      </header>
      {rows.map((r) => (
        <RowView
          key={r.path}
          row={r}
          program={program}
          hypoRow={hypoRows?.find((h) => h.path === r.path)}
        />
      ))}
    </section>
  );
}

export function RequirementsRail() {
  const bundle = useModel();
  const hypo = useHypotheticalBundle();
  const railOpen = usePlan((s) => s.railOpen);
  const railFocus = usePlan((s) => s.railFocus);
  const setRailOpen = usePlan((s) => s.setRailOpen);
  const setRailFocus = usePlan((s) => s.setRailFocus);
  const lensPath = usePlan((s) => s.lensPath);
  const setLens = usePlan((s) => s.setLens);
  const [tab, setTab] = useState<"requirements" | "insights">("requirements");

  if (!railOpen) {
    return (
      <button
        onClick={() => setRailOpen(true)}
        className="focus-ring absolute right-2 top-2 z-30 rounded border border-line bg-surface px-2 py-1 text-xs text-ink-dim hover:text-ink"
      >
        ◂ Requirements
      </button>
    );
  }

  const b: ModelBundle = bundle;
  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-l border-line bg-surface/70 ${
        railFocus ? "w-[50vw]" : "w-80"
      }`}
      style={{ resize: "horizontal" }}
    >
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <button
          onClick={() => setTab("requirements")}
          className={`focus-ring rounded px-2 py-0.5 text-xs ${tab === "requirements" ? "bg-surface-2 font-semibold" : "text-ink-dim"}`}
        >
          Requirements
        </button>
        <button
          onClick={() => setTab("insights")}
          className={`focus-ring rounded px-2 py-0.5 text-xs ${tab === "insights" ? "bg-surface-2 font-semibold" : "text-ink-dim"}`}
        >
          Insights
        </button>
        {lensPath && (
          <button
            onClick={() => setLens(null, null)}
            className="focus-ring ml-1 rounded bg-planned/20 px-2 py-0.5 text-[10px] text-planned"
            title="Clear the requirement lens"
          >
            lens ✕
          </button>
        )}
        <button
          onClick={() => setRailFocus(!railFocus)}
          className="focus-ring ml-auto text-xs text-ink-dim hover:text-ink"
          title="Focus toggle — expand to half screen"
        >
          {railFocus ? "⇥" : "⇤"}
        </button>
        <button
          onClick={() => setRailOpen(false)}
          className="focus-ring text-xs text-ink-dim hover:text-ink"
          title="Collapse the rail"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {tab === "requirements" ? (
          <>
            <ProgramSection
              label={b.eeEval.program.label}
              rows={b.eeRows}
              hypoRows={hypo?.eeRows}
              program={b.eeEval.program}
              applied={b.eeEval.appliedCredits}
              total={b.eeEval.program.totalCredits}
            />
            <ProgramSection
              label={b.minorEval.program.label}
              rows={b.minorRows}
              hypoRows={hypo?.minorRows}
              program={b.minorEval.program}
              applied={b.minorEval.appliedCredits}
              total={b.minorEval.program.totalCredits}
            />
            <div className="mt-2 rounded border border-line bg-surface px-2 py-1.5 text-[11px] text-ink-dim">
              Plan total:{" "}
              <span className="font-mono text-ink">{b.model.totalPlanCredits} cr</span>{" "}
              of 120 — General Education is nested inside the major and counted
              once.
            </div>
            <section className="mt-3">
              <h3 className="mb-1 px-1.5 text-xs font-bold uppercase tracking-wider text-ink-dim">
                Placeholder slots
              </h3>
              <p className="mb-1.5 px-1.5 text-[10px] text-ink-faint">
                Generic slots, droppable as many times as needed. No prereqs,
                never warn.
              </p>
              <div className="grid grid-cols-2 gap-1 px-1.5">
                {["GE_PLACEHOLDER", "REL_ELECTIVE", "FOREIGN_LANG"].map((id) => (
                  <CourseChip key={id} courseId={id} />
                ))}
              </div>
            </section>
          </>
        ) : (
          <InsightPanel />
        )}
      </div>
    </aside>
  );
}
