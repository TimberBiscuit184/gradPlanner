import { useMemo, useRef, useState } from "react";
import { COURSES, COURSE_BY_ID, STUDENT } from "../data";
import { EMPHASES } from "../data/emphases";
import { geGroupOf } from "../engine/geGroups";
import { prereqLeaves } from "../engine/plan";
import { usePlan } from "../store";
import type { Placement } from "../types";
import { SelectCoursesButton } from "./WishlistBar";

/** Search by code ("math112x", "MATH 112X") or by title ("calculus"). */
function SearchBox() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const select = usePlan((s) => s.select);
  const setFocusCourse = usePlan((s) => s.setFocusCourse);
  const expandGroupFor = usePlan((s) => s.expandGroupFor);

  // courses with no dependency edges land in the collapsible standalone grids
  const connected = useMemo(() => {
    const set = new Set<string>();
    for (const c of COURSES) {
      const deps = [...prereqLeaves(c.prereq), ...c.coreq].filter((p) =>
        COURSE_BY_ID.has(p),
      );
      if (deps.length) set.add(c.id);
      deps.forEach((p) => set.add(p));
    }
    return set;
  }, []);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    const norm = query.replace(/\s+/g, "");
    return COURSES.filter((c) => !c.isPlaceholder)
      .filter(
        (c) =>
          c.id.toLowerCase().includes(norm) ||
          c.code.toLowerCase().replace(/\s+/g, "").includes(norm) ||
          c.title.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [q]);

  const pick = (courseId: string) => {
    const grp = geGroupOf(courseId);
    if (grp) expandGroupFor(grp.id);
    else if (!connected.has(courseId)) expandGroupFor("major-standalone");
    select(courseId);
    setFocusCourse(courseId);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="relative">
      <input
        type="search"
        value={q}
        placeholder="Search classes…"
        aria-label="Search for a class by name or code"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results.length) pick(results[0].id);
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="focus-ring w-44 rounded border border-line bg-bg px-2 py-1 text-xs text-ink placeholder:text-ink-faint"
      />
      {open && results.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border border-line bg-surface shadow-2xl">
          {results.map((c) => (
            <li key={c.id}>
              <button
                className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface-2"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c.id)}
              >
                <span className="font-mono font-semibold">{c.code}</span>
                <span className="truncate text-ink-dim">{c.title}</span>
                <span className="ml-auto shrink-0 font-mono text-ink-faint">
                  {c.credits} cr
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Destructive, so it asks first and says exactly what it will remove. */
function ResetButton() {
  const [confirming, setConfirming] = useState(false);
  const placements = usePlan((s) => s.placements);
  const wishlist = usePlan((s) => s.wishlist);
  const resetAll = usePlan((s) => s.resetAll);
  const showToast = usePlan((s) => s.showToast);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="focus-ring rounded border border-line px-2.5 py-1 text-xs text-ink-dim hover:border-danger/60 hover:text-danger"
        title="Clear your planned courses and all filters. Your transcript and registered terms are never affected."
      >
        Reset
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded border border-danger/60 bg-danger/10 px-2 py-1 text-xs">
      <span className="text-danger">
        Reset {placements.length} planned course
        {placements.length === 1 ? "" : "s"}
        {wishlist.length > 0 && ` and ${wishlist.length} selected`}?
      </span>
      <span className="text-ink-faint">Transcript is untouched.</span>
      <button
        onClick={() => {
          const n = placements.length;
          resetAll();
          setConfirming(false);
          showToast({
            text: `Reset — removed ${n} planned course${n === 1 ? "" : "s"} and cleared all filters. Your transcript and registered terms are unchanged.`,
            level: "info",
          });
        }}
        className="focus-ring rounded bg-danger px-2 py-0.5 font-medium text-white hover:brightness-110"
      >
        Yes, reset
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="focus-ring rounded border border-line px-2 py-0.5 text-ink-dim hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}

export function Header() {
  const mode = usePlan((s) => s.mode);
  const setMode = usePlan((s) => s.setMode);
  const emphasis = usePlan((s) => s.emphasis);
  const setEmphasis = usePlan((s) => s.setEmphasis);
  const placements = usePlan((s) => s.placements);
  const importPlan = usePlan((s) => s.importPlan);
  const showToast = usePlan((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob(
      [JSON.stringify({ app: "gradtree", version: 1, placements }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gradtree-plan.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        placements?: Placement[];
      };
      if (!Array.isArray(parsed.placements)) throw new Error("no placements[]");
      // normalize legacy block values (e.g. removed "full") to full-semester
      const sane = parsed.placements.map((p) => ({
        ...p,
        block: p.block === "1st" || p.block === "2nd" || p.block === "online" ? p.block : null,
      }));
      importPlan(sane);
      showToast({ text: `Imported ${parsed.placements.length} planned courses.`, level: "ok" });
    } catch (err) {
      showToast({
        text: `Import failed: ${err instanceof Error ? err.message : "invalid file"}`,
        level: "blocked",
      });
    }
  };

  return (
    <header className="z-20 flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
      <h1 className="text-sm font-bold tracking-tight">
        GradTree
        <span className="ml-2 font-normal text-ink-dim">
          {STUDENT.major.label} + {STUDENT.minor.label} · {STUDENT.student}
        </span>
      </h1>

      <div
        role="tablist"
        aria-label="Environment"
        className="ml-4 flex rounded-md border border-line bg-bg p-0.5"
      >
        {(["board", "tree", "projects"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`focus-ring rounded px-3 py-1 text-xs capitalize ${
              mode === m ? "bg-surface-2 font-semibold text-ink" : "text-ink-dim"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="ml-3">
        <SearchBox />
      </div>

      <label className="ml-2 flex items-center gap-1.5 text-[11px] text-ink-dim">
        Emphasis
        <select
          value={emphasis ?? ""}
          onChange={(e) => setEmphasis(e.target.value || null)}
          className="focus-ring rounded border border-line bg-bg px-1.5 py-1 text-xs text-ink"
          title="Highlight the courses (and their prerequisite chains) for an emphasis area — everything else dulls. Source: EE four-year plan 2026-2027."
        >
          <option value="">none</option>
          {EMPHASES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </label>

      <span
        className="ml-auto text-[11px] text-ink-faint"
        title="This planner keeps everything in memory only. Export before closing the tab."
      >
        Not saved automatically — export first.
      </span>
      <SelectCoursesButton />
      <button
        onClick={doExport}
        className="focus-ring rounded border border-line px-2.5 py-1 text-xs hover:bg-surface-2"
      >
        Export plan → JSON
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        className="focus-ring rounded border border-line px-2.5 py-1 text-xs hover:bg-surface-2"
      >
        Import
      </button>
      <ResetButton />
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void doImport(f);
          e.target.value = "";
        }}
      />
    </header>
  );
}
