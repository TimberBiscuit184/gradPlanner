import { useDraggable } from "@dnd-kit/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { COURSES, COURSE_BY_ID } from "../data";
import { validateDrop, type DropVerdict } from "../engine/plan";
import { requiredCourseIds } from "../engine/requirements";
import { useModel } from "../model";
import { CourseDetailBody, PrereqText } from "./CourseDetail";
import { FloatingPanel } from "./panels/FloatingPanel";
import { PANEL_IDS } from "./panels/panelStore";
import { usePlan } from "../store";
import type { BlockChoice, Course, PrereqNode, TimelineTerm } from "../types";
import { STATUS_STYLE } from "./status";

const SEASON_NAME = { F: "Fall", W: "Winter", S: "Spring" } as const;

/** Statuses meaning "you already have this" — offered last, and labelled. */
const ALREADY_HAVE = new Set([
  "completed",
  "in-progress",
  "registered",
  "planned",
]);

/** Is this course offered in this term's season? Unconfirmed data never blocks. */
function offeredIn(c: Course, term: TimelineTerm): boolean {
  if (!c.termsConfirmed) return true;
  return c.terms.includes(term.season);
}

/**
 * The half-semester / online choices a course actually offers, from the scraped
 * schedule. `null` is the full-semester placement. A course with no
 * full-semester section (CSE 121c) does not get a "full" chip at all.
 */
function choicesFor(c: Course): { label: string; block: BlockChoice }[] {
  const out: { label: string; block: BlockChoice }[] = [];
  const hasBlockData = c.blocksConfirmed && c.blocks;
  if (!hasBlockData || c.blocks!.includes("full"))
    out.push({ label: "full", block: null });
  if (hasBlockData && c.blocks!.includes("1st"))
    out.push({ label: "1st", block: "1st" });
  if (hasBlockData && c.blocks!.includes("2nd"))
    out.push({ label: "2nd", block: "2nd" });
  if (c.online) out.push({ label: "online", block: "online" });
  return out;
}

/** One clickable chip per placement option. Blocked drops are disabled, not hidden. */
function ChipRow({
  course,
  termId,
  verdict,
}: {
  course: Course;
  termId: string;
  verdict: DropVerdict;
}) {
  const add = usePlan((s) => s.addPlacementWithBlock);
  const showToast = usePlan((s) => s.showToast);
  const closePicker = usePlan((s) => s.closePicker);
  const choices = choicesFor(course);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {choices.map((ch) => (
        <button
          key={ch.label}
          disabled={!verdict.allowed}
          onClick={(e) => {
            e.stopPropagation();
            add(course.id, termId, ch.block);
            showToast({
              text:
                `${course.code} → ${termId}` +
                (ch.block ? ` (${ch.label})` : "") +
                (verdict.reason ? ` · ${verdict.reason}` : ""),
              level: verdict.level === "warning" ? "warning" : "ok",
              unconfirmed: verdict.unconfirmed,
            });
            closePicker();
          }}
          title={
            verdict.allowed
              ? ch.block === "online"
                ? `Add ${course.code} as the online section`
                : ch.block
                  ? `Add ${course.code} to the ${ch.label} half-semester block`
                  : `Add ${course.code} for the full semester`
              : (verdict.reason ?? "Cannot be added here")
          }
          className={`focus-ring rounded px-1.5 py-0.5 text-[10px] leading-4 ${
            !verdict.allowed
              ? "cursor-not-allowed bg-surface-2 text-ink-faint/40"
              : ch.block === "online"
                ? "bg-inprogress/15 text-inprogress hover:bg-inprogress/30"
                : "bg-surface-2 text-ink-dim hover:bg-planned/30 hover:text-ink"
          }`}
        >
          {ch.label}
        </button>
      ))}
    </div>
  );
}

/** A course row: status, code, title, credits, then its placement chips. */
function CourseRow({
  course,
  termId,
  onSelect,
  onHover,
}: {
  course: Course;
  termId: string;
  onSelect: () => void;
  onHover: (courseId: string | null, anchor: DOMRect | null) => void;
}) {
  const { model, obsolete, bottlenecks } = useModel();
  const d = model.derived.get(course.id)!;
  const required = !obsolete.has(course.id) && requiredCourseIds().has(course.id);
  const bottleneck = !obsolete.has(course.id)
    ? bottlenecks.find((b) => b.courseId === course.id)
    : undefined;
  const verdict = useMemo(
    () => validateDrop(course.id, termId, model),
    [course.id, termId, model],
  );
  const sty = STATUS_STYLE[d.status];
  const notNeeded = obsolete.has(course.id);
  // Legal to add, but you already have it — retaking is a deliberate act, so
  // say so rather than presenting it like a fresh option.
  const already = ALREADY_HAVE.has(d.status);

  /**
   * Rows are draggable straight onto a semester — the chips place the course in
   * *this* term, but dragging lets you aim at any of them without reopening the
   * picker for each one. Blocked courses are not draggable: offering a drag that
   * can only ever be refused is worse than not offering it.
   */
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pick-${course.id}`,
    data: { kind: "course", courseId: course.id },
    disabled: !verdict.allowed,
  });

  return (
    <li
      className={`flex items-center gap-2 border-b border-line/50 px-2 py-1.5 ${
        verdict.allowed && !already ? "hover:bg-surface-2" : "opacity-55"
      } ${isDragging ? "opacity-40" : ""}`}
      onMouseEnter={(e) =>
        onHover(course.id, e.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => onHover(null, null)}
    >
      <button
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={onSelect}
        className={`focus-ring flex min-w-0 flex-1 items-center gap-2 text-left ${
          verdict.allowed ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        title={
          verdict.allowed
            ? `Drag ${course.code} onto any semester, or click to open it`
            : `Open ${course.code} — prerequisites, terms, sections`
        }
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sty.dot}`} />
        {/* Same two markers the tree uses, so the guidance reads identically
            wherever you meet a course. Fixed width keeps the codes aligned. */}
        <span className="w-6 shrink-0 text-[10px] leading-none">
          {required && (
            <span
              className="text-danger"
              title="Required — no alternative satisfies this requirement."
              aria-label="required"
            >
              ★
            </span>
          )}
          {bottleneck && (
            <span
              className="text-warn"
              title={`Bottleneck: ${bottleneck.reasons.join("; ")}`}
              aria-label="bottleneck"
            >
              ⧗
            </span>
          )}
        </span>
        <span
          className={`w-20 shrink-0 font-mono text-xs font-semibold ${
            notNeeded ? "line-through text-ink-faint" : ""
          }`}
        >
          {course.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-dim">
          {notNeeded ? (
            <span className="italic text-ink-faint">
              not needed — option satisfied
            </span>
          ) : (
            course.title
          )}
        </span>
        {/* A gate course is the single most useful thing to plan early. */}
        {!notNeeded && d.directUnlocks.length >= 4 && (
          <span
            className="shrink-0 rounded bg-surface-2 px-1 font-mono text-[10px] text-available"
            title={`Unlocks ${d.directUnlocks.length} courses directly: ${d.directUnlocks.join(", ")}`}
          >
            ↑{d.directUnlocks.length}
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] text-ink-faint">
          {course.credits}cr
        </span>
      </button>
      {!verdict.allowed ? (
        <span
          className="shrink-0 text-[10px] text-danger/80"
          title={verdict.reason ?? ""}
        >
          blocked
        </span>
      ) : already ? (
        <span
          className={`shrink-0 text-[10px] ${sty.text}`}
          title={`You already have ${course.code} ${d.status === "completed" ? "completed" : d.status}. Adding it again would be a retake.`}
        >
          {d.status}
        </span>
      ) : (
        <ChipRow course={course} termId={termId} verdict={verdict} />
      )}
    </li>
  );
}

/** Flat list of the course ids a requisite expression mentions, in order. */
function leaves(node: PrereqNode, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    if (!out.includes(node)) out.push(node);
    return out;
  }
  for (const k of "and" in node ? node.and : node.or) leaves(k, out);
  return out;
}

/**
 * What you need before this course, shown on hover.
 *
 * The picker is where you decide what to take, and "can I actually take this?"
 * was previously a click away in the detail view. The expression alone is not
 * enough either — reading "(ECEN 100 or CSE 121c)" still leaves you working out
 * which of them you have. So every requisite is also listed with a tick or a
 * cross against your own record.
 */
function PrereqTip({
  courseId,
  anchor,
}: {
  courseId: string;
  anchor: DOMRect;
}) {
  const { model } = useModel();
  const course = COURSE_BY_ID.get(courseId);
  if (!course) return null;

  const pre = leaves(course.prereq);
  const co = leaves(course.coreq);
  const missing = pre.filter(
    (id) => !ALREADY_HAVE.has(model.derived.get(id)?.status ?? "locked"),
  );

  const W = 268;
  // Prefer the right of the row; flip when the panel is docked right instead.
  const left =
    anchor.right + 10 + W < window.innerWidth
      ? anchor.right + 10
      : Math.max(8, anchor.left - W - 10);
  const top = Math.min(anchor.top, Math.max(8, window.innerHeight - 190));

  const Chip = ({ id }: { id: string }) => {
    const c = COURSE_BY_ID.get(id);
    const status = model.derived.get(id)?.status ?? "locked";
    const have = ALREADY_HAVE.has(status);
    return (
      <span
        className={`rounded px-1 py-0.5 font-mono text-[10px] ${
          have ? "bg-completed/15 text-completed" : "bg-surface-2 text-ink-dim"
        }`}
        title={`${c?.code ?? id} — ${status}`}
      >
        {have ? "✓" : "○"} {c?.code ?? id}
      </span>
    );
  };

  return (
    <div
      role="tooltip"
      style={{ position: "fixed", left, top, width: W }}
      className="pointer-events-none z-50 rounded-md border border-line bg-surface p-2 text-[11px] shadow-2xl"
    >
      <div className="mb-1 font-mono text-xs font-semibold">{course.code}</div>

      <div className="text-ink-faint">Prereq</div>
      {course.prereq == null ? (
        <div className="text-ink-dim">none — nothing has to come first</div>
      ) : (
        <>
          <div className="text-ink-dim">
            <PrereqText node={course.prereq} />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {pre.map((id) => (
              <Chip key={id} id={id} />
            ))}
          </div>
        </>
      )}

      {course.coreq != null && (
        <>
          <div className="mt-1.5 text-ink-faint">
            Coreq <span className="text-ink-faint/70">— same semester is fine</span>
          </div>
          <div className="text-ink-dim">
            <PrereqText node={course.coreq} />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {co.map((id) => (
              <Chip key={id} id={id} />
            ))}
          </div>
        </>
      )}

      {course.prereq != null && (
        <div
          className={`mt-1.5 border-t border-line pt-1 ${
            missing.length ? "text-warn" : "text-completed"
          }`}
        >
          {missing.length
            ? `Still needed: ${missing
                .map((id) => COURSE_BY_ID.get(id)?.code ?? id)
                .join(", ")}`
            : "Everything it needs is done or on your board."}
        </div>
      )}
      {!course.verified && (
        <div className="mt-1 text-warn">Prerequisite unconfirmed.</div>
      )}
    </div>
  );
}

/** Course mode: one row per future term the course is offered in. */
function TermRow({ course, term }: { course: Course; term: TimelineTerm }) {
  const { model } = useModel();
  const verdict = useMemo(
    () => validateDrop(course.id, term.id, model),
    [course.id, term.id, model],
  );
  return (
    <li
      className={`flex items-center gap-2 border-b border-line/50 px-2 py-1.5 ${
        verdict.allowed ? "hover:bg-surface-2" : "opacity-55"
      }`}
    >
      <span className="w-24 shrink-0 text-xs font-medium">{term.label}</span>
      {term.flex && (
        <span className="shrink-0 rounded bg-flex/20 px-1 text-[9px] uppercase text-flex">
          flex
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[10px] text-ink-faint">
        {verdict.allowed ? (verdict.reason ?? "") : verdict.reason}
      </span>
      {verdict.allowed ? (
        <ChipRow course={course} termId={term.id} verdict={verdict} />
      ) : (
        <span className="shrink-0 text-[10px] text-danger/80">blocked</span>
      )}
    </li>
  );
}

export function CoursePicker() {
  const picker = usePlan((s) => s.picker);
  const closePicker = usePlan((s) => s.closePicker);
  const select = usePlan((s) => s.select);
  const { model } = useModel();
  const [q, setQ] = useState("");
  const [onlyGuided, setOnlyGuided] = useState(false);
  /**
   * Course opened for a closer look *inside* the panel. Keeping it local means
   * the list, its search text and the requirement filter all survive — you back
   * out to exactly where you were.
   */
  const [detailId, setDetailId] = useState<string | null>(null);
  /** Row the pointer is over, and where it sits, for the requisite tooltip. */
  const [tip, setTip] = useState<{ courseId: string; anchor: DOMRect } | null>(
    null,
  );
  const dragging = usePlan((s) => s.dragging);
  const lensPool = usePlan((s) => s.lensPool);
  const lensLabel = usePlan((s) => s.lensLabel);
  const setLens = usePlan((s) => s.setLens);
  const inputRef = useRef<HTMLInputElement>(null);

  const { bottlenecks, obsolete } = useModel();
  const bottleneckIds = useMemo(
    () => new Set(bottlenecks.map((b) => b.courseId)),
    [bottlenecks],
  );
  const term = picker?.termId ? model.termById.get(picker.termId) : null;
  const course = picker?.courseId ? COURSE_BY_ID.get(picker.courseId) : null;
  const courseRequired =
    !!course && !obsolete.has(course.id) && requiredCourseIds().has(course.id);
  const courseBottleneck =
    course && !obsolete.has(course.id)
      ? bottlenecks.find((b) => b.courseId === course.id)
      : undefined;

  useEffect(() => {
    setQ("");
    setDetailId(null);
    setTip(null);
    if (picker) inputRef.current?.focus();
  }, [picker]);

  /**
   * Escape backs out of the detail view first, then closes the panel.
   *
   * There is deliberately no close-on-click-outside any more. That was right
   * for a transient popover, but this is a panel you can dock and keep open
   * beside the board — dismissing it because you clicked a course in the tree
   * would make it unusable for the one job it exists to do.
   */
  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailId) setDetailId(null);
      else closePicker();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picker, closePicker, detailId]);

  /** Term mode: everything offered that season, valid drops first. */
  const rows = useMemo(() => {
    if (!term) return [];
    const query = q.trim().toLowerCase();
    const norm = query.replace(/\s+/g, "");
    const matches = (c: Course) =>
      c.id.toLowerCase().includes(norm) ||
      c.code.toLowerCase().replace(/\s+/g, "").includes(norm) ||
      c.title.toLowerCase().includes(query);

    return COURSES.filter(
      (c) =>
        offeredIn(c, term) ||
        // A retired course is normally hidden, but silently omitting it looks
        // like a bug when you go looking for one. Search surfaces it, blocked,
        // with the reason attached.
        (query.length > 0 && matches(c)),
    )
      .filter((c) => !query || matches(c))
      .filter(
        (c) =>
          !onlyGuided ||
          (!obsolete.has(c.id) &&
            (requiredCourseIds().has(c.id) || bottleneckIds.has(c.id))),
      )
      // Clicking a requirement in the rail narrows this list to that pool.
      .filter((c) => !lensPool || lensPool.includes(c.id))
      .map((c) => {
        const v = validateDrop(c.id, term.id, model);
        const status = model.derived.get(c.id)?.status ?? "locked";
        // Fresh and addable first, then things you already have, then blocked.
        const rank = !v.allowed ? 2 : ALREADY_HAVE.has(status) ? 1 : 0;
        return { c, v, rank };
      })
      .sort((a, b) => a.rank - b.rank || a.c.code.localeCompare(b.c.code));
  }, [term, q, model, onlyGuided, obsolete, bottleneckIds, lensPool]);

  const termsForCourse = useMemo(() => {
    if (!course) return [];
    return model.timeline.filter((t) => !t.real && offeredIn(course, t));
  }, [course, model]);

  if (!picker || (!term && !course)) return null;

  const addable = rows.filter((r) => r.rank === 0).length;

  // Detail view: replaces the list *inside the same panel*, so backing out
  // restores the search text, the requirement filter and the scroll position
  // you left behind — and so the panel does not jump somewhere else on screen
  // when you drill into a course.
  const detailCourse = detailId ? COURSE_BY_ID.get(detailId) : null;
  const showDetail = !!(detailCourse && term);
  const detailVerdict =
    showDetail && term ? validateDrop(detailCourse!.id, term.id, model) : null;
  const detailStatus = showDetail
    ? (model.derived.get(detailCourse!.id)?.status ?? "locked")
    : null;

  const markers = (
    <>
      {courseRequired && (
        <span
          className="text-xs text-danger"
          title="Required — no alternative satisfies this requirement."
        >
          ★
        </span>
      )}
      {courseBottleneck && (
        <span
          className="text-xs text-warn"
          title={`Bottleneck: ${courseBottleneck.reasons.join("; ")}`}
        >
          ⧗
        </span>
      )}
    </>
  );

  return (
    <>
    <FloatingPanel
      id={PANEL_IDS.picker}
      // Left by default on purpose: the requirements rail defaults to the
      // right, and the two are meant to be read together — pick a requirement
      // there, see what satisfies it here.
      initial={{ dock: "left", fw: 0.27, fh: 0.7, x: 12, y: 12, w: 416, h: 560 }}
      label={
        showDetail
          ? `${detailCourse!.code} — details`
          : term
            ? `Add a course to ${term.label}`
            : `Where to take ${course!.code}`
      }
      headerLeft={
        showDetail ? (
          <button
            onClick={() => setDetailId(null)}
            className="focus-ring mt-0.5 shrink-0 rounded border border-line px-1.5 text-xs text-ink-dim hover:text-ink"
            title="Back to the course list (Esc)"
            aria-label="Back to the course list"
          >
            ←
          </button>
        ) : undefined
      }
      title={
        showDetail ? (
          <span className="font-mono">{detailCourse!.code}</span>
        ) : (
          <span className="flex items-center gap-1.5">
            {term ? `Add to ${term.label}` : `Where to take ${course!.code}`}
            {course && markers}
          </span>
        )
      }
      subtitle={
        showDetail
          ? detailCourse!.title
          : term
            ? `${addable} of ${rows.length} ${
                lensPool
                  ? "in this requirement"
                  : `courses offered in ${SEASON_NAME[term.season]}`
              } are open to you now`
            : course!.termsConfirmed
              ? `Offered in ${course!.terms.map((s) => SEASON_NAME[s]).join(", ")}`
              : "Offered terms unconfirmed — check the class schedule"
      }
      onClose={closePicker}
      toolbar={
        showDetail ? undefined : (
          <>
            {term && lensPool && (
              <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-planned/10 px-3 py-1.5 text-[11px]">
                <span className="shrink-0 text-ink-dim">Requirement:</span>
                <span className="min-w-0 flex-1 truncate font-medium text-planned">
                  {lensLabel ?? "selected"}
                </span>
                <button
                  onClick={() => setLens(null, null)}
                  className="focus-ring shrink-0 rounded border border-line px-1.5 text-ink-dim hover:text-ink"
                  title="Show every course offered this term again"
                >
                  clear
                </button>
              </div>
            )}
            {term && (
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
                <input
                  ref={inputRef}
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search these courses…"
                  aria-label="Search courses offered this term"
                  className="focus-ring min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-xs text-ink placeholder:text-ink-faint"
                />
                <button
                  onClick={() => setOnlyGuided((v) => !v)}
                  aria-pressed={onlyGuided}
                  title="Show only courses the degree requires with no alternative, or that gate other courses"
                  className={`focus-ring shrink-0 rounded border px-2 py-1 text-[11px] ${
                    onlyGuided
                      ? "border-planned bg-planned/20 text-ink"
                      : "border-line text-ink-dim hover:text-ink"
                  }`}
                >
                  <span className="text-danger">★</span>
                  <span className="ml-0.5 text-warn">⧗</span>
                  <span className="ml-1">only</span>
                </button>
              </div>
            )}
            {/* One course, so its description belongs right here rather than
                behind another click. */}
            {course && (
              <div className="max-h-56 shrink-0 overflow-y-auto border-b border-line px-3 py-2">
                <CourseDetailBody courseId={course.id} />
              </div>
            )}
          </>
        )
      }
      footer={
        showDetail ? (
          // The whole point of opening this from a term: put the course there.
          <div className="shrink-0 border-t border-line px-3 py-2">
            <div className="mb-1 text-[11px] text-ink-dim">
              Add to <span className="font-medium text-ink">{term!.label}</span>
            </div>
            {!detailVerdict!.allowed ? (
              <div className="rounded border border-danger/50 bg-danger/10 px-2 py-1 text-[11px] text-danger">
                {detailVerdict!.reason ?? "Cannot be added to this term."}
              </div>
            ) : (
              <>
                <ChipRow
                  course={detailCourse!}
                  termId={term!.id}
                  verdict={detailVerdict!}
                />
                {ALREADY_HAVE.has(detailStatus!) && (
                  <div className="mt-1 text-[10px] text-ink-faint">
                    You already have this {detailStatus} — adding it again is a
                    retake.
                  </div>
                )}
                {detailVerdict!.reason && (
                  <div className="mt-1 text-[10px] text-warn">
                    {detailVerdict!.reason}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="shrink-0 space-y-1 border-t border-line px-3 py-1.5 text-[10px] leading-tight text-ink-faint">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span>
                <span className="text-danger">★</span> required — no alternative
              </span>
              <span>
                <span className="text-warn">⧗</span> bottleneck
              </span>
              <span>
                <span className="font-mono text-available">↑n</span> gates n
                courses
              </span>
            </div>
            <div>
              Chips are the sections that actually run:{" "}
              <span className="font-mono">full</span> semester,{" "}
              <span className="font-mono">1st</span>/
              <span className="font-mono">2nd</span> half-semester block, or{" "}
              <span className="font-mono">online</span>. Click one to place the
              course.
            </div>
          </div>
        )
      }
    >
      {showDetail ? (
        <div className="px-3 py-2">
          <CourseDetailBody courseId={detailCourse!.id} />
        </div>
      ) : (
        <ul>
          {term &&
            rows.map(({ c }) => (
              <CourseRow
                key={c.id}
                course={c}
                termId={term.id}
                onHover={(courseId, anchor) =>
                  setTip(courseId && anchor ? { courseId, anchor } : null)
                }
                onSelect={() => {
                  // Open in place — the list, its search and the filter all stay.
                  setDetailId(c.id);
                  select(c.id);
                  setTip(null);
                }}
              />
            ))}
          {course &&
            termsForCourse.map((t) => (
              <TermRow key={t.id} course={course} term={t} />
            ))}
          {term && rows.length === 0 && (
            <li className="px-3 py-4 text-center text-[11px] text-ink-faint">
              Nothing matches “{q}”.
            </li>
          )}
          {course && termsForCourse.length === 0 && (
            <li className="px-3 py-4 text-center text-[11px] text-ink-faint">
              {course.terms.length === 0
                ? `${course.code} is retired — it is not offered in any future term.`
                : "No future term on the timeline offers this course."}
            </li>
          )}
        </ul>
      )}
    </FloatingPanel>
    {/* Rendered as a sibling of the panel, not inside it: the panel's
        backdrop-blur would become the containing block for a fixed-position
        child and the tooltip would land in the wrong place. Hidden mid-drag so
        it never chases the cursor. */}
    {tip && !dragging && (
      <PrereqTip courseId={tip.courseId} anchor={tip.anchor} />
    )}
    </>
  );
}
