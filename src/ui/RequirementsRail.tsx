import { useState } from "react";
import type { RailRow } from "../engine/requirements";
import { bucketPoolIds } from "../engine/requirements";
import { useHypotheticalBundle, useModel, type ModelBundle } from "../model";
import { usePlan } from "../store";
import { CourseChip } from "./CourseCard";

/** Chips rendered before a pool is summarised instead. */
const CHIP_LIMIT = 60;
import { InsightPanel } from "./InsightPanel";
import { FloatingPanel } from "./panels/FloatingPanel";
import { PANEL_IDS, usePanels } from "./panels/panelStore";
import {
  assertsRequirements,
  PROGRAM_TRUST_LABEL,
  trustOfProgram,
} from "../engine/trust";
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
            active ? setLens(null, null) : setLens(row.path, pool, be.label)
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
        {/* Always visible, and present for every pool.

            This was `hidden group-hover:block`, so the only way to find out
            which courses satisfy a requirement was to already have the pointer
            on the right row — the answer to the most common question in the
            app was undiscoverable. It was also gated on `pool.length < 40`,
            which removed it entirely from the large elective pools where the
            question matters most: GE's 57-course Breadth requirement offered
            no way to see a single option. */}
        {pool.length > 0 && (
          <button
            className="focus-ring shrink-0 text-[10px] text-ink-faint hover:text-ink"
            onClick={() => setOpen((v) => !v)}
            aria-label={`${open ? "Hide" : "Show"} the ${pool.length} courses in ${be.label}`}
            title={`${open ? "Hide" : "Show"} the ${pool.length} courses that count here`}
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </div>
      <div className="px-1.5 pb-1">
        <ProgressBar have={be.have} need={be.need} ghost={ghost} />
      </div>
      {open && (
        <div className="mb-1.5 px-1.5">
          <div className="grid grid-cols-2 gap-1">
            {pool.slice(0, CHIP_LIMIT).map((id) => (
              <CourseChip key={id} courseId={id} />
            ))}
          </div>
          {/* Big pools are capped rather than hidden. Rendering 500 chips
              stalls the panel; rendering none was the old behaviour and left
              the student with no idea what qualified. Search finds the rest. */}
          {pool.length > CHIP_LIMIT && (
            <p className="mt-1 text-[10px] text-ink-faint">
              …and {pool.length - CHIP_LIMIT} more — search by code to find them.
            </p>
          )}
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
  const trust = trustOfProgram(program);
  const asserts = assertsRequirements(trust);
  return (
    <section className="mb-3">
      <header className="mb-1 flex items-baseline gap-2 px-1.5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink-dim">
          {label}
        </h3>
        {/* Say where these requirements came from — two different things to
            say, so two different badges.

            A machine-read program now asserts, so the neutral badge is no
            longer an apology for missing markers; it is provenance. Students
            across every major will use this, and "where did this come from"
            deserves an answer whether or not the answer is worrying.

            `unsure` is the worrying one: the build flagged that reading as
            incomplete, so the ★ and "not needed" markers are withheld and the
            badge says so in the warning colour. */}
        {trust !== "human" && (
          <span
            className={`shrink-0 rounded bg-surface-2 px-1 text-[9px] uppercase tracking-wide ${
              asserts ? "text-ink-faint" : "text-warn"
            }`}
            title={`These requirements were ${PROGRAM_TRUST_LABEL[trust]}.${
              asserts
                ? " Always confirm against the catalog before you register."
                : ' Progress and course pools are shown, but Sprout will not mark a course ★ required or strike it out as "not needed" from a reading it knows is incomplete.'
            }${
              program.parseDropped?.length
                ? `

Not modelled: ${program.parseDropped.slice(0, 4).join("; ")}`
                : ""
            }`}
          >
            {asserts ? "auto-read" : "unverified"}
          </span>
        )}
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

/** The size the ⇤ toggle jumps to, and the size it comes back to. */
const RAIL_NARROW = 0.24;
const RAIL_WIDE = 0.5;

export function RequirementsRail() {
  const bundle = useModel();
  const hypo = useHypotheticalBundle();
  const railOpen = usePlan((s) => s.railOpen);
  const setRailOpen = usePlan((s) => s.setRailOpen);
  const lensPath = usePlan((s) => s.lensPath);
  const setLens = usePlan((s) => s.setLens);
  const geom = usePanels((s) => s.geom[PANEL_IDS.rail]);
  const setGeom = usePanels((s) => s.setGeom);
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

  // The old "focus" toggle used to swap a Tailwind width class. Now that the
  // rail is a panel with a real width, it writes that width instead — one
  // source of truth, so dragging the edge and pressing the button cannot
  // disagree about how wide the rail is.
  const wide = (geom?.fw ?? RAIL_NARROW) >= 0.4;

  const b: ModelBundle = bundle;
  return (
    <FloatingPanel
      id={PANEL_IDS.rail}
      initial={{
        dock: "right",
        fw: RAIL_NARROW,
        fh: 0.6,
        x: 0,
        y: 12,
        w: 360,
        h: 640,
      }}
      label="Requirements and insights"
      // Not "Requirements" — the tab row directly underneath already says that,
      // and a panel whose title repeats its first tab reads like a bug.
      title="Degree progress"
      onClose={() => setRailOpen(false)}
      headerRight={
        <button
          onClick={() =>
            geom &&
            setGeom(PANEL_IDS.rail, {
              ...geom,
              fw: wide ? RAIL_NARROW : RAIL_WIDE,
            })
          }
          className="focus-ring shrink-0 rounded px-1 text-xs text-ink-dim hover:bg-surface-2 hover:text-ink"
          title="Focus toggle — expand to half screen"
        >
          {wide ? "⇥" : "⇤"}
        </button>
      }
      toolbar={
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
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
        </div>
      }
    >
      <div className="p-2">
        {tab === "requirements" ? (
          <>
            {/* One section per enrolled program, majors first. Two minors, or
                none, render correctly without touching this file. */}
            {b.programs.map((pv) => (
              <ProgramSection
                key={pv.program.id}
                label={pv.program.label}
                rows={pv.rows}
                hypoRows={
                  hypo?.programs.find((h) => h.program.id === pv.program.id)?.rows
                }
                program={pv.program}
                applied={pv.eval.appliedCredits}
                total={pv.program.totalCredits}
              />
            ))}
            {b.programs.length === 0 && (
              <div className="rounded border border-planned/60 bg-planned/10 px-2 py-2 text-[11px]">
                <div className="font-semibold text-ink">Start here</div>
                <p className="mt-1 text-ink-dim">
                  Pick your major — and a minor if you have one — under{" "}
                  <span className="font-mono text-ink">⋯ → Programs</span>. The
                  requirements, the prerequisite tree and the suggestions all
                  follow from that.
                </p>
                <p className="mt-1 text-ink-faint">
                  Until then you can still search the whole catalogue and browse
                  what each semester offers.
                </p>
              </div>
            )}
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
    </FloatingPanel>
  );
}
