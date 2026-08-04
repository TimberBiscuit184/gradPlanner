# GradTree

Client-side degree planner for one BYU-Idaho EE student (+ A.I. Engineering minor),
built from the fixture data in `data/`. No backend, no auth, no network calls —
see `BUILD_PROMPT.md` for the full spec.

## Run

```
npm install
npm run dev        # Vite dev server on http://localhost:5174
npm run build      # type-check + production build
npm run verify     # runs the BUILD_PROMPT §7 acceptance audit against the engine
```

## Layout

- **Board mode** (default) — term columns from Fall 2023 through Fall 2031.
  Real terms (Fall 23 / Spring 26 / Fall 26) are read-only history. Winter
  terms are off-track (spring–fall pattern): collapsed, droppable, info-flagged.
- **Tree mode** — every section has a clickable ▾/▸ heading. The prerequisite
  graph is split into subject clusters (Engineering & Computing core,
  Supplemental electives, Math & Science, A.I. minor, GE with prerequisites),
  each laid out on its own so related chains stay together; then "Major
  electives" (no chains) and one section per General Education group (those
  start collapsed — GE needs little planning). Clicking a course highlights
  **both directions**: violet back through everything it needs first, amber
  forward through everything it unlocks. "What breaks if I drop this?"
  recolors only the forward side. Node markers: **★** required (no
  alternative), **⧗** bottleneck, **⚠** at-risk, dotted + struck = not needed
  because another option already satisfies that requirement.
- **Search** (header) — find a class by code (`math112x`) or title
  (`calculus`); picking a result expands its section and centers the tree on it.
- **Emphasis filter** (header) — the four official emphasis areas from the
  four-year plan. Highlights an emphasis's courses *and their prerequisite
  chains*, dulling everything else.
- **Requirements rail** (right) — EE major with GE nested inside it (counted
  once), A.I. minor as a sibling. Click any bucket to lens-filter both modes;
  hover a row to expand its course pool into draggable chips. The Insights tab
  holds the marginal-minor-cost chart, critical path, bottlenecks, experiential
  fork, and skills rollup.
- **Semester rail** (bottom) — always present; expands into validity-colored
  drop zones during any drag.

- **Projects mode** — portfolio project ideas for an R&D / medical-devices
  direction, each tied to real courses and sorted by how close your plan is to
  supporting it. These are **authored suggestions, not BYU-Idaho coursework**
  (see `src/data/projects.ts`).

Drags work everywhere with the keyboard: focus a course, **Space** to lift,
**arrow keys** to move between terms, **Space** to drop, **Esc** to cancel.

**Select courses…** (header) turns on multi-select: click any courses you want,
set a per-term credit cap, and **Fill my schedule** places them in the earliest
valid terms — pulling in any missing prerequisites automatically. **Reset**
clears your planned courses and filters after a confirmation; it never touches
your transcript or registered terms.

On each planned card, **1st / 2nd** assign a half-semester block (no selection =
full semester) and **online** appears for courses that offer an online section.
The Insights tab has **Plan bottlenecks ASAP** (auto-schedules gate courses at
their earliest valid terms) and **Clear planned** to undo it.

Plans are **in-memory only** — use *Export plan → JSON* / *Import* in the
header to keep work across reloads.

## Data honesty

Every place the app runs on unsure, missing, or placeholder data is logged in
[`DATA_GAPS.md`](./DATA_GAPS.md) with stable IDs (U* unsure, M* missing,
P* placeholder, I* interpretation calls). Warnings built on inferred prereq
edges render dashed with "(unconfirmed prerequisite)"; courses with default
term lists never raise "not offered" errors; block availability is always
labeled unknown because no source data exists.
