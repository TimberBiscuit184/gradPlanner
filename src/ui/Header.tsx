import { useEffect, useMemo, useRef, useState } from "react";
import { COURSES, COURSE_BY_ID, STUDENT } from "../data";
import { EMPHASES } from "../data/emphases";
import { projectsApplyTo } from "../data/projects";
import { geGroupOf } from "../engine/geGroups";
import { dependencyIds } from "../engine/plan";
import {
  DEFAULT_ENROLLED_IDS,
  enrollablePrograms,
  evaluatedPrograms,
} from "../engine/programs";
import { rankPrograms } from "../engine/programSearch";
import { storageAvailable } from "../engine/storage";
import { useProfile } from "../profileStore";
import { usePanels } from "./panels/panelStore";
import { FOCUS_OPTIONS, useFocusSet } from "./useFocusSet";
import { usePlan } from "../store";
import { applyTheme, storedTheme, type Theme } from "./theme";
import type { Placement } from "../types";
import { SelectCoursesButton } from "./WishlistBar";

/** Search by code ("math112x", "MATH 112X") or by title ("calculus"). */
function SearchBox() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const select = usePlan((s) => s.select);
  const setFocusCourse = usePlan((s) => s.setFocusCourse);
  const expandGroupFor = usePlan((s) => s.expandGroupFor);
  const openPicker = usePlan((s) => s.openPicker);

  // courses with no dependency edges land in the collapsible standalone grids
  const connected = useMemo(() => {
    const set = new Set<string>();
    for (const c of COURSES) {
      const deps = dependencyIds(c).filter((p) => COURSE_BY_ID.has(p));
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
            <li key={c.id} className="flex items-stretch hover:bg-surface-2">
              <button
                className="flex min-w-0 flex-1 items-baseline gap-2 px-2 py-1.5 text-left text-xs"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c.id)}
              >
                <span className="font-mono font-semibold">{c.code}</span>
                <span className="truncate text-ink-dim">{c.title}</span>
                <span className="ml-auto shrink-0 font-mono text-ink-faint">
                  {c.credits} cr
                </span>
              </button>
              {/* Same picker the board's term header opens, scoped to one course:
                  which terms it runs in, and the blocks each of them offers. */}
              <button
                className="focus-ring shrink-0 border-l border-line px-2 text-xs text-ink-dim hover:bg-planned/25 hover:text-ink"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  openPicker({ courseId: c.id });
                  setOpen(false);
                  setQ("");
                }}
                title={`Add ${c.code} to a semester — pick the term and the block`}
                aria-label={`Add ${c.code} to a semester`}
              >
                ＋
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Which programs the student is doing.
 *
 * Enrollment drives every requirement in the app, so it lives with the other
 * once-a-session actions rather than in the toolbar. It is profile, not plan:
 * changing it is not undoable and survives *Reset plan*.
 */
function ProgramsSection({ onEnrolled }: { onEnrolled?: () => void }) {
  const enrolledIds = useProfile((s) => s.enrolledIds);
  const enroll = useProfile((s) => s.enroll);
  const unenroll = useProfile((s) => s.unenroll);
  const resetEnrollment = useProfile((s) => s.resetEnrollment);
  const showToast = usePlan((s) => s.showToast);

  const [q, setQ] = useState("");
  const enrolled = evaluatedPrograms(enrolledIds);
  const available = enrollablePrograms(enrolledIds);
  // Same ranking as the first-run walkthrough — two places a student picks a
  // degree must not disagree about what the best match is.
  const matches = useMemo(() => rankPrograms(available, q), [q, available]);
  const declaredChanged =
    enrolledIds.length !== DEFAULT_ENROLLED_IDS.length ||
    enrolledIds.some((id) => !DEFAULT_ENROLLED_IDS.includes(id));

  return (
    <div className="px-2 py-1">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">
          Programs
        </span>
        {declaredChanged && (
          <button
            onClick={resetEnrollment}
            className="focus-ring ml-auto text-[10px] text-ink-faint hover:text-ink"
            title="Go back to the major and minor your transcript declares"
          >
            reset
          </button>
        )}
      </div>

      <ul className="mt-1 space-y-0.5">
        {enrolled.map((p) => (
          <li key={p.id} className="flex items-center gap-1.5 text-[11px]">
            <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px] uppercase text-ink-faint">
              {p.type === "major" ? "major" : p.type === "minor" ? "minor" : p.type}
            </span>
            <span className="min-w-0 flex-1 truncate" title={p.label}>
              {p.label}
            </span>
            <button
              onClick={() => unenroll(p.id)}
              className="focus-ring shrink-0 text-ink-faint hover:text-danger"
              aria-label={`Remove ${p.label}`}
              title={`Stop counting ${p.label}. Your planned courses stay put.`}
            >
              ✕
            </button>
          </li>
        ))}
        {enrolled.length === 0 && (
          <li className="text-[11px] text-warn">
            None — requirements are empty until you add one.
          </li>
        )}
      </ul>

      {/* 204 programs cannot be a list of buttons. Search first, and only ever
          show a handful of results — the point is to find your degree, not to
          browse the university. */}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Add a major or minor… (${available.length})`}
        aria-label="Search programs to add"
        className="focus-ring mt-1.5 w-full rounded border border-line bg-bg px-1.5 py-1 text-[11px] text-ink placeholder:text-ink-faint"
      />
      {matches.length > 0 && (
        <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
          {matches.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                /* Close the menu on the way out.

                   The picker lives in the ⋯ dropdown, which sits directly over
                   the requirements panel — so adding your degree filled the
                   panel behind a menu that hid it, and the student had to
                   click away to see anything happen. The toast carries the
                   confirmation the open menu used to provide. */
                enroll(p.id);
                setQ("");
                showToast({
                  text: `Added ${p.label}. Your requirements are on the right.`,
                  level: "ok",
                });
                onEnrolled?.();
              }}
              className="focus-ring flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-ink-dim hover:bg-surface-2 hover:text-ink"
            >
              <span className="shrink-0 text-planned">+</span>
              <span className="min-w-0 flex-1 truncate" title={p.label}>
                {p.label}
              </span>
              <span className="shrink-0 text-[9px] uppercase text-ink-faint">
                {p.type === "major" ? "major" : "minor"}
              </span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length > 1 && matches.length === 0 && (
        <p className="mt-1 text-[10px] text-ink-faint">
          Nothing matches “{q.trim()}”.
        </p>
      )}
    </div>
  );
}

/**
 * Session-level actions live behind "⋯" so the bar keeps only what gets used
 * constantly (mode, search, emphasis, multi-select). Export/Import/Reset are
 * once-a-session actions and the unsaved-work warning is a dot, not a sentence.
 */
function OverflowMenu({
  onExport,
  onImport,
}: {
  onExport: () => void;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => storedTheme());
  const placements = usePlan((s) => s.placements);
  const wishlist = usePlan((s) => s.wishlist);
  const resetAll = usePlan((s) => s.resetAll);
  const showToast = usePlan((s) => s.showToast);
  const resetLayout = usePanels((s) => s.resetLayout);
  const wrapRef = useRef<HTMLDivElement>(null);

  // On the desktop every save is also mirrored to plan.json, so the plan
  // outlives even a wiped browser profile — there is nothing to warn about.
  const desktop = !!window.gradtree?.desktop;
  const persists = storageAvailable() || desktop;
  // The amber dot means "work that only exists here" — pointless when
  // something is persisting it for you.
  const unsaved = placements.length > 0 && !persists;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface-2";

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Plan actions"
        title={
          unsaved
            ? `${placements.length} planned course${placements.length === 1 ? "" : "s"} — this browser blocks local storage, so export to keep them.`
            : "Plan actions: export, import, reset"
        }
        className={`focus-ring relative rounded border px-2 py-0.5 text-sm leading-5 ${
          open ? "border-line bg-surface-2 text-ink" : "border-line text-ink-dim hover:text-ink"
        }`}
      >
        ⋯
        {unsaved && (
          <span
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-warn"
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-line bg-surface p-1 shadow-2xl"
        >
          <div className="flex items-start gap-1.5 px-2 py-1.5 text-[11px] text-ink-dim">
            <span className={unsaved ? "text-warn" : "text-ink-faint"}>●</span>
            <span>
              {desktop
                ? `${placements.length} planned course${placements.length === 1 ? "" : "s"}, saved automatically as you work — to this app and to plan.json, so a reset can't take them.`
                : persists
                ? `${placements.length} planned course${placements.length === 1 ? "" : "s"}, saved in this browser. Export for a copy you can move or keep.`
                : unsaved
                  ? `${placements.length} planned course${placements.length === 1 ? "" : "s"} in memory only — this browser blocks local storage, so export to keep them across reloads.`
                  : "Nothing planned yet. This browser blocks local storage, so plans live in memory only."}
            </span>
          </div>
          <div className="my-1 border-t border-line" />

          <button
            role="menuitem"
            className={item}
            onClick={() => {
              onExport();
              setOpen(false);
            }}
          >
            Export plan → JSON
          </button>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              onImport();
              setOpen(false);
            }}
          >
            Import plan…
          </button>
          {desktop && (
            <button
              role="menuitem"
              className={item}
              onClick={() => {
                void window.gradtree?.revealPlan();
                setOpen(false);
              }}
              title="Open the folder holding plan.json — the automatic backup of everything you have planned"
            >
              Show saved plan file
            </button>
          )}

          <div className="my-1 border-t border-line" />

          <ProgramsSection onEnrolled={() => setOpen(false)} />

          <div className="my-1 border-t border-line" />

          {/* Layout is not part of the plan, so it resets separately and never
              enters the undo stack. Panels can be dragged off to somewhere
              awkward; this is the way back. */}
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              resetLayout();
              setOpen(false);
              showToast({
                text: "Panel layout reset — requirements right, detail bottom-left.",
                level: "info",
              });
            }}
            title="Put the requirements, detail and add-course panels back where they started"
          >
            Reset panel layout
          </button>

          <button
            className="focus-ring w-full px-3 py-1.5 text-left text-xs text-ink-dim hover:bg-surface-2 hover:text-ink"
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              applyTheme(next);
            }}
            title="Switch between the light and dark palettes"
          >
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>

          <div className="my-1 border-t border-line" />

          {!confirming ? (
            <button
              role="menuitem"
              className={`${item} text-ink-dim hover:text-danger`}
              onClick={() => setConfirming(true)}
            >
              Reset plan…
            </button>
          ) : (
            <div className="rounded border border-danger/60 bg-danger/10 p-2 text-[11px]">
              <div className="text-danger">
                Reset {placements.length} planned course
                {placements.length === 1 ? "" : "s"}
                {wishlist.length > 0 && ` and ${wishlist.length} selected`}?
              </div>
              <div className="mt-0.5 text-ink-faint">
                Your transcript and registered terms are untouched.
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => {
                    const n = placements.length;
                    resetAll();
                    setConfirming(false);
                    setOpen(false);
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Undo/redo for placement changes. Ctrl/⌘+Z and Ctrl/⌘+Shift+Z also work. */
function UndoRedo() {
  const undo = usePlan((s) => s.undo);
  const redo = usePlan((s) => s.redo);
  const canUndo = usePlan((s) => s.past.length > 0);
  const canRedo = usePlan((s) => s.future.length > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      // Don't hijack undo inside the search box or the credit-cap input.
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const btn =
    "focus-ring rounded border border-line px-1.5 py-0.5 text-xs leading-5 disabled:opacity-30";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={undo}
        disabled={!canUndo}
        className={btn}
        aria-label="Undo"
        title="Undo the last change to your plan (Ctrl/⌘+Z)"
      >
        ↶
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        className={btn}
        aria-label="Redo"
        title="Redo (Ctrl/⌘+Shift+Z)"
      >
        ↷
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
  const focusSet = useFocusSet();
  const enrolledIds = useProfile((s) => s.enrolledIds);

  /**
   * Projects are editorial content written for electrical engineering. Hiding
   * the tab is the honest move for everyone else — an empty or irrelevant tab
   * is worse than no tab.
   */
  const showProjects = projectsApplyTo(enrolledIds);
  const modes = (
    showProjects ? (["board", "tree", "projects"] as const) : (["board", "tree"] as const)
  ) as readonly ("board" | "tree" | "projects")[];

  // Unenrolling while looking at Projects would otherwise strand you on a tab
  // that no longer exists.
  useEffect(() => {
    if (!showProjects && mode === "projects") setMode("board");
  }, [showProjects, mode, setMode]);

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
    <header className="app-header z-40 flex items-center gap-2 border-b border-line bg-surface px-2.5 py-1">
      <h1
        // Bricolage Grotesque, the website's display face. The wordmark is the
        // one place it earns its keep — everything else in a planner this dense
        // is better in Public Sans.
        className="shrink-0 font-display text-sm font-bold tracking-tight text-brand-strong"
        title={
          // A blank record has no declarations and no name — say what the app
          // is instead of rendering "undefined + undefined · ".
          [STUDENT.major?.label, STUDENT.minor?.label]
            .filter(Boolean)
            .join(" + ") ||
          "Degree planner — pick your programs under ⋯"
        }
      >
        Sprout
      </h1>

      <div
        role="tablist"
        aria-label="Environment"
        className="ml-1 flex shrink-0 rounded border border-line bg-bg p-0.5"
      >
        {modes.map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`focus-ring rounded px-2.5 py-0.5 text-xs capitalize ${
              mode === m ? "bg-surface-2 font-semibold text-ink" : "text-ink-dim"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <SearchBox />

      <label className="flex shrink-0 items-center gap-1 text-[11px] text-ink-dim">
        Focus
        <select
          value={emphasis ?? ""}
          onChange={(e) => setEmphasis(e.target.value || null)}
          className={`focus-ring rounded border bg-bg px-1 py-0.5 text-xs ${
            emphasis ? "border-planned text-ink" : "border-line text-ink"
          }`}
          title={
            FOCUS_OPTIONS.find((f) => f.id === emphasis)?.hint ??
            "Highlight a set of courses and their prerequisite chains — everything else dulls."
          }
        >
          <option value="">none</option>
          <optgroup label="What to take">
            {FOCUS_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Emphasis area (four-year plan)">
            {EMPHASES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </optgroup>
        </select>
        {/* Board mode dims everything under "Still to plan" — correctly, since
            nothing already scheduled is outstanding. Without a count that
            reads as a broken filter rather than an answer. */}
        {focusSet && (
          <span
            className="rounded bg-planned/20 px-1 font-mono text-[10px] text-planned"
            title={`${focusSet.size} courses match this focus, counting the prerequisite chains behind them. Courses not yet on your board only appear in the tree.`}
          >
            {focusSet.size}
          </span>
        )}
      </label>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <UndoRedo />
        <SelectCoursesButton />
        <OverflowMenu
          onExport={doExport}
          onImport={() => fileRef.current?.click()}
        />
      </div>
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
