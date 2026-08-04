# GradTree — working notes for Claude Code

Client-side degree planner for one BYU-Idaho electrical-engineering student
(EE B.S. + A.I. Engineering minor). Everything runs against static fixture data
in `data/`. No backend, no auth, no network calls at runtime.

`BUILD_PROMPT.md` is the original spec. `DATA_GAPS.md` is the honesty log and is
**not optional reading** — see below.

## Commands

```bash
npm install     # first run on a new machine
npm run dev     # Vite dev server on http://localhost:5174
npm run verify  # 35-check acceptance audit against the engine — run after ANY engine change
npm run build   # tsc -b + production build
```

`npm run verify` is the real test suite. It asserts concrete numbers from the
fixture data (credit totals, unlock counts, drop legality, autoplanner output).
If you change anything in `src/engine/`, run it before saying the work is done.

## Architecture

- `data/` — the fixture JSON (courses, transcript, three programs). **Never
  written at runtime.** Root-level copies of the same JSON are the user's
  originals; `data/` holds the app's copies. Keep them in sync when editing.
- `src/engine/` — pure logic, no React:
  - `plan.ts` — course state, retakes, prereq/coreq evaluation, drop validation,
    prerequisite depth, ancestor/descendant walks
  - `requirements.ts` — the 7 rule types, program composition, "not needed"
    option pruning
  - `autoplan.ts` — bottleneck scheduler and wishlist auto-fill
  - `insights.ts`, `clusters.ts`, `geGroups.ts`, `terms.ts`, `grades.ts`
- `src/ui/` — React. `Board` (semester columns), `Tree` (@xyflow/react graph),
  `Projects`, `RequirementsRail`, `InsightPanel`.
- `src/store.ts` — Zustand. **In-memory only.**

## Constraints that are easy to break

- **No `localStorage` / `sessionStorage`.** The target sandbox throws on them.
  Persistence is Export/Import JSON only, and the UI says so.
- **General Education is nested inside the EE major** via a `programRef` bucket,
  not a sibling program. Evaluate it once or the plan reads ~27 credits high.
- **Never invent course data.** If something is missing, surface the gap in the
  UI and log it in `DATA_GAPS.md`. The whole value of this tool is that its
  warnings are trustworthy.
- **Confidence flags must stay visible**: `termsConfirmed: false` (100 courses)
  must never raise a "not offered this term" error — show the neutral notice
  instead. Block availability is unknown for all 136 courses.
- Desktop only (min-width 1024px). Don't add mobile layouts.

## React Flow gotchas (hard-won)

- Nodes carry explicit `width`/`height`; the layout is computed with dagre, so
  React Flow never needs to measure the DOM.
- The viewport is **controlled** (`viewport` + `onViewportChange`). Centering is
  our own math, not `fitView`/`setCenter`.
- A controlled `nodes` prop **must** also pass `onNodesChange`, or the edge
  layer renders empty.
- Nodes with `selectable: false` get `pointer-events: none` — clickable label
  nodes need `style: { pointerEvents: "all" }`.
- Tree x-position is global prerequisite depth × 258px, not dagre's rank.

## Data conventions

- `src/data/projects.ts` is **authored editorial content**, not sourced data.
  Course ids in it are real and verified by `npm run verify`.
- Prerequisites were fetched from the live BYU-Idaho Kuali catalog API
  (2026-07-27) and carry `prereqSource`. No `verified: false` edges remain.
- When you resolve or add a data gap, update `DATA_GAPS.md` with its stable id
  (U*/M*/P*/I*/S*). The user relies on that log.
