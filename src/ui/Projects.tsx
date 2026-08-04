import { useMemo, useState } from "react";
import { COURSE_BY_ID } from "../data";
import { PROJECTS, type Project } from "../data/projects";
import { useModel } from "../model";
import { usePlan } from "../store";

const DONE = new Set(["completed", "in-progress"]);
const ON_PLAN = new Set(["completed", "in-progress", "registered", "planned"]);

type Readiness = "ready" | "soon" | "later";

interface Scored {
  project: Project;
  readiness: Readiness;
  have: string[];
  planned: string[];
  missing: string[];
  /** earliest term by which every course is on the plan, if all are */
  readyBy: string | null;
}

const READINESS_STYLE: Record<Readiness, { label: string; cls: string }> = {
  ready: {
    label: "Buildable now",
    cls: "border-completed/60 bg-completed/10 text-completed",
  },
  soon: {
    label: "After planned coursework",
    cls: "border-planned/60 bg-planned/10 text-planned",
  },
  later: { label: "Not yet reachable", cls: "border-line text-ink-faint" },
};

export function Projects() {
  const { model } = useModel();
  const select = usePlan((s) => s.select);
  const setMode = usePlan((s) => s.setMode);
  const setFocusCourse = usePlan((s) => s.setFocusCourse);
  const [filter, setFilter] = useState<"all" | Readiness>("all");
  const [open, setOpen] = useState<string | null>(null);

  const scored: Scored[] = useMemo(() => {
    return PROJECTS.map((project) => {
      const have: string[] = [];
      const planned: string[] = [];
      const missing: string[] = [];
      for (const id of project.courses) {
        const st = model.derived.get(id)?.status;
        if (st && DONE.has(st)) have.push(id);
        else if (st && ON_PLAN.has(st)) planned.push(id);
        else missing.push(id);
      }
      // Simple, honest rule: you can build it when you've actually taken the
      // material; it's coming when everything is at least on the plan.
      const readiness: Readiness =
        missing.length === 0 && planned.length === 0
          ? "ready"
          : missing.length === 0
            ? "soon"
            : "later";

      let readyBy: string | null = null;
      if (missing.length === 0) {
        let latest = -1;
        for (const id of project.courses) {
          const occs = model.derived.get(id)?.occurrences ?? [];
          const active = occs.filter((o) => ON_PLAN.has(o.state));
          if (active.length)
            latest = Math.max(latest, ...active.map((o) => o.termIndex));
        }
        readyBy = latest >= 0 ? (model.timeline[latest]?.label ?? null) : null;
      }
      return { project, readiness, have, planned, missing, readyBy };
    }).sort((a, b) => {
      const order: Readiness[] = ["ready", "soon", "later"];
      return (
        order.indexOf(a.readiness) - order.indexOf(b.readiness) ||
        // within a tier, the closest to done first
        a.missing.length - b.missing.length ||
        b.have.length - a.have.length
      );
    });
  }, [model]);

  const shown = scored.filter(
    (s) => filter === "all" || s.readiness === filter,
  );
  const counts = {
    ready: scored.filter((s) => s.readiness === "ready").length,
    soon: scored.filter((s) => s.readiness === "soon").length,
    later: scored.filter((s) => s.readiness === "later").length,
  };

  const goToCourse = (id: string) => {
    select(id);
    setMode("tree");
    setFocusCourse(id);
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      <header className="mb-3">
        <h2 className="text-sm font-bold">
          Portfolio projects · R&amp;D, medical devices
        </h2>
        <p className="mt-0.5 max-w-3xl text-xs text-ink-dim">
          Each project applies material from courses you are actually taking.
          Readiness is computed from your plan, so the list re-sorts as you
          schedule courses.
        </p>
        <p className="mt-1 max-w-3xl text-[11px] text-ink-faint">
          These project ideas are suggestions written for this app — they are
          not BYU-Idaho coursework, not assignments, and not sourced from any
          employer. The course links are real; the projects are editorial.
        </p>
      </header>

      {counts.ready === 0 && counts.soon === 0 && (
        <p className="mb-3 rounded border border-line bg-surface px-2.5 py-1.5 text-[11px] text-ink-dim">
          Nothing is fully backed by your coursework yet — that is expected this
          early. Projects move up as you plan courses; try{" "}
          <span className="text-planned">Select courses…</span> or{" "}
          <span className="text-planned">Plan bottlenecks ASAP</span> in
          Insights, then come back. The list below is sorted by how close each
          one is.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        {(
          [
            ["all", `All (${scored.length})`],
            ["ready", `Buildable now (${counts.ready})`],
            ["soon", `After planned coursework (${counts.soon})`],
            ["later", `Not yet reachable (${counts.later})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key as "all" | Readiness)}
            className={`focus-ring rounded border px-2 py-1 ${
              filter === key
                ? "border-planned bg-planned/15 text-ink"
                : "border-line text-ink-dim hover:bg-surface-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
        {shown.map(({ project, readiness, have, planned, missing, readyBy }) => {
          const sty = READINESS_STYLE[readiness];
          const isOpen = open === project.id;
          return (
            <article
              key={project.id}
              className="rounded-lg border border-line bg-surface/70 p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{project.title}</h3>
                  <p className="mt-0.5 text-xs text-ink-dim">{project.blurb}</p>
                </div>
                <span
                  className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${sty.cls}`}
                >
                  {sty.label}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1">
                {project.courses.map((id) => {
                  const c = COURSE_BY_ID.get(id)!;
                  const state = have.includes(id)
                    ? "border-completed/60 bg-completed/15 text-completed"
                    : planned.includes(id)
                      ? "border-planned/60 bg-planned/15 text-planned"
                      : "border-line text-ink-faint";
                  return (
                    <button
                      key={id}
                      onClick={() => goToCourse(id)}
                      className={`focus-ring rounded border px-1.5 py-0.5 font-mono text-[10px] hover:brightness-125 ${state}`}
                      title={`${c.title} — click to find it in the tree`}
                    >
                      {c.code}
                    </button>
                  );
                })}
              </div>

              <p className="mt-1.5 text-[11px] text-ink-faint">
                {have.length} of {project.courses.length} courses done
                {planned.length > 0 && `, ${planned.length} planned`}
                {missing.length > 0 && `, ${missing.length} not on your plan`}
                {readyBy && ` · all scheduled by ${readyBy}`}
              </p>

              <button
                onClick={() => setOpen(isOpen ? null : project.id)}
                className="focus-ring mt-2 text-[11px] text-planned hover:underline"
              >
                {isOpen ? "Hide details" : "What to build →"}
              </button>

              {isOpen && (
                <div className="mt-2 space-y-2 border-t border-line pt-2 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-ink-faint">
                      Why it lands
                    </div>
                    <p className="text-ink-dim">{project.why}</p>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-ink-faint">
                      Deliverables
                    </div>
                    <ul className="list-inside list-disc text-ink-dim">
                      {project.deliverables.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </div>
                  {project.regulatory && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-ink-faint">
                        Regulatory angle
                      </div>
                      <p className="text-ink-dim">{project.regulatory}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {project.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-faint"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {shown.length === 0 && (
        <p className="text-xs text-ink-faint">
          Nothing in this category yet — plan more coursework and check back.
        </p>
      )}
    </div>
  );
}
