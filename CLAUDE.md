# GradTree — working notes for Claude Code

Client-side degree planner for one BYU-Idaho electrical-engineering student
(EE B.S. + A.I. Engineering minor). Everything runs against static fixture data
in `data/`. No backend, no auth, no network calls at runtime. It ships two ways
from one codebase: a web app, and an Electron desktop app.

`BUILD_PROMPT.md` is the original spec. `DATA_GAPS.md` is the honesty log and is
**not optional reading** — see below.

---

## 0. The target is the desktop app

**Build and verify everything against the Electron desktop app.** That is how
the user actually runs GradTree; the browser build still works and should keep
working, but it is no longer the thing being designed for. In practice:

- Verify in a real Electron window (§1), not a browser tab. A hidden tab does
  not even run layout.
- When a change could differ between the two, the desktop behaviour is the one
  that has to be right.
- Don't add anything that only makes sense in a browser tab, and don't drop
  something the desktop needs because the web build doesn't.

**How updates reach the user.** There are two paths and they behave differently:

| launched via | picks up changes when |
| --- | --- |
| `GradTree.lnk` on the desktop (`npm run shortcut`) | **immediately after `npm run build`** — it runs Electron against this folder's `dist/` |
| installed copy (`GradTree Setup …exe`) | only after re-running `npm run desktop:build` **and reinstalling** — it is a frozen copy |

So the shortcut is the live one. After changing source, `npm run build` (or
`npm run shortcut`, which builds and refreshes the shortcut) is all it takes.
Repackage only when the user wants a new installer.

---

## 0.1 What this is actually for

Read this section before changing anything. Most of the design decisions below
look arbitrary until you know the goal, and several of them have already been
"simplified" back into bugs.

The user stated the purpose in their own words:

> to be able to see the courses that are going to take the longest to unlock and
> to start planning those first. to be able to see the earliest available
> semester to take it and what prerequisites need to be taken and when should be
> available for every single class

So the tool exists to answer three questions, for **every** course:

1. **How far out is it?** — not "is it unlocked", but how many semesters of
   chained prerequisites stand between now and being able to take it.
2. **What has to happen first, and when?** — the specific chain, with a term
   against each link.
3. **What should I start now?** — the deepest chains, because those are the ones
   that will still be blocking a year from today.

`src/engine/reach.ts` is the answer to all three. The insight panel's
**"Furthest out — start these chains first"** and the per-course **"Soonest you
could take it"** block are its two consumers.

Two things follow from this that are easy to get wrong:

- **`status` is not distance.** `available`/`locked` say whether prerequisites
  are *on the board*, not *when*. See the constraint below; this exact confusion
  is what prompted the whole `reach.ts` work.
- **A warning is only worth showing if it is trustworthy.** The user relies on
  this to register for real classes. Every number is sourced, every unverified
  claim is visibly marked, and `DATA_GAPS.md` is the log. Never invent data to
  fill a hole — surface the hole.

---

## 1. Commands

```bash
npm install         # first run on a new machine
npm run dev         # Vite dev server on http://localhost:5174
npm run verify      # 166-check acceptance audit against the engine — run after ANY engine change
npm run audit       # re-compare every course against the live BYU-Idaho catalog (network)
npm run build       # tsc -b + production build
npm run desktop     # dev server on 5175 + Electron window, hot reload
npm run desktop:preview  # build, then run the real app from dist/
npm run desktop:build    # build + package → dist-desktop/ (installer + portable .exe)
npm run shortcut         # build + put a double-clickable GradTree shortcut on the desktop
npm run desktop:clean    # delete the desktop build output, incl. -2/-3 fallbacks
npm run desktop:fix      # re-download the Electron binary if a fresh install skipped it
npm run schedule    # scrape offered terms/blocks/online for ALL disciplines (network, sequential, resumable)
npm run harvest:programs # fetch all 356 program requirement structures (network, resumable)
npm run merge:programs   # parse them into majors/minors → data/programs-generated.json
npm run bench:programs   # score the program parser against the hand-written programs
npm run audit:programs   # six completeness checks over every generated program
npm run audit:programs -- --sample 6   # …plus side-by-side catalogue vs parse, for reading
npm run merge       # audited courses + harvest + schedule → data/courses-full.json (what the app loads)
npm run harvest     # fetch EVERY course in the live catalogue → data/catalog-raw.json (network, resumable)
npm run bench       # score the prereq parser against the 131 hand-verified courses
npm run coverage    # parser confidence across the whole catalogue, + unmodelled prose ranked
npm run icon        # regenerate build/icon.ico from scripts/makeIcon.ts
```

`npm run verify` is the real test suite. It asserts concrete numbers from the
fixture data (credit totals, unlock counts, drop legality, autoplanner output,
reach chains). If you change anything in `src/engine/`, run it before saying the
work is done.

`npm run audit` is the *data* test suite. It reads every requisite field the
Kuali API uses and fails on any drift from `data/courses.json`. Run it before
trusting a prerequisite, and after any catalog-year change.

### Verifying UI changes

The engine has tests; the UI does not. What works well instead: run the real
Electron window headlessly, drive it with `webContents.sendInputEvent`, and read
back geometry with `executeJavaScript` + `capturePage`. That is how the panel
drag/snap behaviour was verified — including the pointer-capture bug in §6, which
no amount of reading the code would have found. A throwaway harness in a temp
directory is enough; it does not belong in the repo.

Note that an inactive/hidden browser tab does **not** run layout — `document.hidden`
is true, `ResizeObserver` never fires, and computed styles go stale. Measurements
taken there are not evidence.

---

## 2. Architecture

- `data/` — the fixture JSON (courses, transcript, three programs). **Never
  written at runtime.** Root-level copies of the same JSON are the user's
  originals; `data/` holds the app's copies. Keep them in sync when editing.
- `src/engine/` — pure logic, no React:
  - `plan.ts` — course state, retakes, prereq/coreq evaluation, drop validation,
    prerequisite depth, ancestor/descendant walks. `earliestLegalTerm` answers
    the question an at-risk badge raises: it walks future terms for the first
    legal drop, and when none exists returns the missing prerequisites (or
    `retired`) rather than an empty result. It deliberately does **not**
    re-optimise — prerequisites are assumed to stay put, so the number reports
    the current plan's consequence.
  - `reach.ts` — **the module §0.1 is about.** How many terms out every course is
    when its chain is planned *optimally*, plus the chain that sets the date.
    `deepestFirst()` ranks what to start now. Note the **two-pass** structure:
    indices are resolved for every course as a root *before* any path is walked,
    because the caches are only written for root calls and a dependency reached
    first would otherwise render with no term ("✓?"). There is a regression
    assertion for exactly that.
  - `requirements.ts` — the 7 rule types, program composition, "not needed"
    option pruning, and `requiredCourseIds()` (the ★ set).
  - `autoplan.ts` — bottleneck scheduler and wishlist auto-fill.
  - `suggest.ts` — "what to take next term". Picks the term (`nextTermToPlan`:
    earliest editable, non-real, under full-time; winters skipped until a flex
    term is actually used), then ranks **only legal drops** — critical path >
    gates > scarcity > required — and greedy-fills to a credit target. Every pick
    carries its own `reasons`, so the advice can be argued with; keep it that way
    rather than returning a bare list.
  - `gpa.ts` — cumulative GPA on BYU-Idaho's published grade points, the forward
    projection, and the 21-credit term-load thresholds. Every number in it is
    sourced (DATA_GAPS S4); it computes GPA two ways because the retake rule is
    unpublished (U13), and the projection carries that duality through. A retake
    adds credits to the every-attempt denominator but *replaces* the original on
    the most-recent basis — that asymmetry is the whole point, so don't collapse
    the two bases into one number.
  - `restrictions.ts` — **the gates the catalogue states outside its requisite
    rules** (Phase 4): `declaredIn`, `minCredits`, `approval`, `delivery`,
    `note`. 24% of catalogue courses state one of these and no prerequisite at
    all, so reporting "no prerequisite" was hiding real gates — MUSIC 102 is
    closed to Electrical Engineering and planning it used to say nothing.
    Checked against the student (program codes from the enrollment layer,
    earned credits from the transcript) and **warns, never blocks**, for the
    same asymmetry as `trust.ts`. Two things to preserve:
    - **A gate you clear says nothing.** Restrictions only surface when they
      are unmet, actionable, or unknowable. Before, every one rendered as info
      text whether or not it applied to you.
    - **Section-scoped gates are not exclusions.** `appliesTo: "campus"` exists
      because BUS 301 limits its campus sections by program while its online
      sections are open to all; reading it flat told an EE student a course
      they can take was closed to them.
  - `trust.ts` — **how much the app is willing to bet on a prerequisite**
    (Phase 3). `trustOf(course)` grades it `human | exact | parsed | unsure |
    none`; `enforcesPrereq(trust)` decides whether `validateDrop` may *block*.
    Only `human` and `exact` are enforced. The reason is an asymmetry, not
    caution: a dropped **OR** branch makes us stricter than the university, so
    we would refuse a registration it allows — while a dropped **AND** element
    only makes us laxer, and the student loses nothing finding out at
    registration. Being wrongly refused by your own planner is the failure that
    makes the tool worth less than no tool.
  - `prereqParse.ts` — **catalogue prose → `PrereqNode`, with a confidence
    grade** (Phase 2). Kuali emits a flat `•` list where a small closed set of
    phrases are *headers* declaring a combinator; nesting is inferred because
    indentation is not preserved. Three things it must keep doing:
    - **A header with no items of its own is a container.** "Complete 1 of the
      following" followed by four "Take the following course(s)" groups means
      `(A AND B) OR (C AND D) …`. Reading it flat turned CSE 450's four routes
      into one impossible conjunction — *and reported `exact` while doing it*.
    - **Phrasing decides coreq-ness, not the field name.** "Completed or
      concurrently enrolled" is the signal; enforcing a coreq as a prereq is U10.
    - **`resolve()` returns an id, not a boolean.** Catalogue prose says
      `CSE121C`; the fixture id is `CSE121c`. Case-sensitive matching silently
      dropped a live branch from two ECEN courses.
  - `storage.ts` — the localStorage probe, plan (de)serialization, and the
    generic `loadJson`/`saveJson` used for panel layout. **The only module in the
    codebase that touches `localStorage`.**
  - `insights.ts`, `clusters.ts`, `geGroups.ts`, `terms.ts`, `grades.ts`.
- `src/ui/` — React. `Board` (semester columns), `Tree` (@xyflow/react graph),
  `Projects`, `RequirementsRail`, `InsightPanel`, `CoursePicker`, `CourseDetail`.
  - `CoursePicker` has two modes off one `picker` store field: `{termId}` lists
    the courses a semester offers, `{courseId}` lists the terms a course runs in.
    Both render the same block/online chips, which come from the scraped
    `blocks`/`online` data — never offer a chip for a section that doesn't run.
    Its in-panel detail view reuses `CourseDetailBody`, exported from
    `CourseDetail.tsx`, so the floating panel and the picker can't drift apart.
    The floating `CourseDetail` hides itself while the picker is open — the same
    body would otherwise render twice in two overlapping panels. The picker's
    `detailId` is deliberately local state: keeping it out of the store is what
    lets backing out restore the search text and filter.
- `src/ui/panels/` — the window manager (see §6):
  - `snap.ts` — pure geometry: zones, boxes, insets, corner radii, handles.
  - `panelStore.ts` — a Zustand store **separate from the plan**, persisted
    separately.
  - `FloatingPanel.tsx` — `PanelHost` (the layer + snap preview),
    `usePanelInsets`, and the `FloatingPanel` chrome itself.
- `electron/` — the desktop shell (see §7). CJS on purpose.
- `src/engine/programs.ts` — **the enrollment layer** (Phase 1 of opening the
  app to every BYU-Idaho program). A registry (`PROGRAMS` in `src/data`) plus a
  list of enrolled ids replaces the two module constants everything used to be
  wired to. Three things it guarantees:
  - `NESTED_PROGRAM_IDS` is **derived** by walking every `programRef` bucket, so
    General Education is evaluated inside its host and never as a sibling. A new
    program that nests something gets the same protection for free.
  - `declaredEnrollment()` resolves `student.json`'s declared programs to
    catalogue entries **by the `code` they already carry** — no new fields, no
    guesses (major 445 → `ee-bs-2026`, minor 292 → `ai-engineering-minor`).
  - Unknown ids are dropped, never thrown on. A saved profile is untrusted input
    and a renamed program should cost a rail section, not the app.
- `src/profileStore.ts` — enrolled program ids, persisted under
  `gradtree:profile:v1`. **Profile, not plan**: changing your major is not
  undoable, does not ride along in an exported plan, and survives *Reset plan* —
  the same rule panel layout follows.
- `src/store.ts` — Zustand. Undo/redo history + autosave subscription.

---

## 3. Why each feature exists

The intent behind the work, in the order it was built. This is the section that
saves you from "simplifying" something back into the bug it was built to fix.

| Feature | The problem it solves |
| --- | --- |
| `npm run audit` + `verified`/`prereqCheckedOn` | ~20 prerequisites were silently wrong for ten days because one catalog field was read instead of six (U9). Prerequisites are now machine-compared to the live catalog, and `validateDrop` only hard-blocks on a `verified: true` course. |
| Schedule scrape (`terms`, `blocks`, `online`, `sectionCounts`) | "Which semesters does this run?" was a guess for 100 courses. Now it is scraped evidence for 129 of 133, including 1st/2nd half-semester blocks and online sections (U2, M1). This is what makes the picker's chips honest. |
| `requiredCourseIds()` derived, not listed | ★ used to mean "in an `allOf`". The user asked for "anything you must take in practice" — exact-fit pools, pools with less slack than the course is worth, courses in every branch of an `nOfGroups`, options stranded by a retirement (I16). |
| `reach.ts` + "Soonest you could take it" | §0. `status` could not answer "how far out", and the user was reading `available` as "ready now". |
| "Furthest out — start these chains first" | The direct answer to "see the courses that take the longest to unlock and start those first". |
| `suggest.ts` + the suggested-path highlight | "What should I put in Spring, given Fall is registered and Winter is planned." Optimises for unblocking, which the user explicitly endorsed. The +50 gate bonus exists because a short critical chain otherwise outranked ECEN 250, which gates nine courses. |
| At-risk in red (`--color-risk`) | `warn` and `available` are one hue apart, so an at-risk *available* node looked healthy. Motion now means "ready to take"; colour means "something is wrong". |
| Course picker (term mode & course mode) | Adding a course used to mean finding it in the tree and dragging. Now: click a semester → search what it offers → click a block/online chip. Clicking a requirement filters the list to that pool. |
| ★/⧗/↑n markers in the picker | The same guidance the tree gives, at the moment of decision rather than only when browsing. |
| In-panel detail with back + add-to-term | Opening a course used to close the list and lose the search. |
| Focus modes (`focus:*`) + required-only | "Show me only what's left / only what's required / only bottlenecks", with the prerequisite chains behind them, pruned of anything already done or not needed. |
| GPA + projection | Two bases, because BYU-Idaho does not publish its retake rule (U13). Truncated, not rounded. |
| Persistence, undo, term-overload warning | A refresh used to destroy the plan. |
| Thin header + `⋯` overflow, wheel-scrolls, click-to-arm drag, weighted edges | Tree ergonomics: panning kept grabbing course cards, the wheel zoomed when the user wanted to scroll, and drawing every edge at equal weight buried the real chains. |
| Dockable panels (§6) | Three overlays in three hard-coded corners, each covering the work. Now the user decides where each lives, and docked panels give the board room instead of hiding it. |
| Desktop app (§7) | The user asked for it. Also makes the offline guarantee real: fonts and assets are bundled, and a CSP forbids anything else. |

---

## 4. Constraints that are easy to break

- **`available` vs `locked` is about planning, not time.** `isSatisfiable` is
  optimistic and ignores ordering entirely: **available** = every prerequisite
  has *some* counting occurrence somewhere on the timeline (including one
  registered for a later term); **locked** = at least one has none. Neither says
  how far out a course is, so never use the pair to answer "what should I start
  first" — that is `reach.ts`. Two functions answer "when": `earliestLegalTerm`
  (prerequisites stay where they are — the consequence of the current plan) and
  `computeReach` (re-plans the chain optimally — the best case). They are
  different questions; keep both.
- **`localStorage` is feature-detected, never assumed.** The original sandbox
  threw on it, so everything goes through `src/engine/storage.ts`, which probes
  with a real write once and degrades silently to in-memory. Nothing there throws
  into React. Don't reintroduce a bare `localStorage.` call, and don't go back to
  banning it — a refresh used to destroy the user's whole plan.
- **Every mutation of the plan goes through `withHistory`** in `store.ts`, or
  undo silently skips it. A "plan" is `PlanEdits` — `placements` **and**
  `droppedRegistrations` — and both share one undo stack and one autosave
  subscription, so a new action cannot forget either.
- **The rail renders `bundle.programs`, not two named fields.** `ModelBundle`
  carries `programs: ProgramView[]` (program + eval + rows), majors first. There
  is no `eeEval`/`minorEval` any more — a student with two minors or none
  renders correctly without touching the UI. When you add a program-shaped
  feature, map over that array.
- **Still hard-coded to EE, and knowingly so:** `insights.ts`, `clusters.ts`,
  `autoplan.ts`, `geGroups.ts` and `src/data/emphases.ts` import `EE` /
  `AI_MINOR` directly. They are editorial or EE-specific analysis, and
  generalising them is a later phase. What Phase 1 *did* do is guard them: the
  "What the A.I. minor actually costs" panel hides itself when the minor is not
  enrolled, rather than showing numbers computed against a degree you are not
  doing. Any new EE-specific panel needs the same guard.
- **Panel layout is not part of the plan.** It lives in its own store and its own
  storage key so it never enters the undo stack (Ctrl+Z takes back a course, not
  a window move), never rides along in an exported plan, and survives
  `Reset plan`. Keep it out of `PlanEdits`.
- **Only completed terms are read-only.** A registered term stays editable
  (`isEditableTerm`), because you can still add and drop during registration.
  Dropping a registration records `termId:courseId` in `droppedRegistrations` and
  `buildPlan` filters that transcript entry out — **`student.json` is never
  written**. The filter also refuses to apply to a completed term, so a stale or
  forged key can never erase history.
- **General Education is nested inside the EE major** via a `programRef` bucket,
  not a sibling program. Evaluate it once or the plan reads ~27 credits high.
- **`requiredCourseIds()` is derived, not a list.** See §3 and DATA_GAPS **I16**.
  Pools containing a placeholder are exempt (unbounded credits). Don't hard-code
  the set.
- **Never invent course data.** If something is missing, surface the gap in the UI
  and log it in `DATA_GAPS.md`. The whole value of this tool is that its warnings
  are trustworthy.
- **The catalog API uses inconsistent field names.** Requisite rules live in
  `prerequisites` (lowercase, most courses), `preRequisites`, `coRequisites`,
  `corequisites`, `courseRequirements`, or `courseRequirementText` — varying per
  record. Reading one field is how ~20 prerequisites were silently wrong from
  2026-07-27 to 2026-08-06 (DATA_GAPS **U9**). Always go through
  `scripts/auditCatalog.ts`, never a one-off fetch.
- **Enforcement is graded, and only a complete reading earns a block.**
  `validateDrop` no longer keys off `verified`; it asks `enforcesPrereq(trustOf(c))`.
  `human` (a person compared it against the catalogue) and `exact` (the parser
  understood every token) block; `parsed` and `unsure` **warn and allow**. Do
  not "tighten" this — the whole point is that a machine-read rule must never
  refuse a registration the university would permit. The enforcement matrix is
  asserted in `npm run verify`, and was checked end to end by marking a course
  `parsed` and confirming the same drop flipped from *blocked* to *warning*.
- **`verified: true` still means "compared against the live catalog and
  matches"**, with `prereqCheckedOn` as the date. It is not a vibe. It now feeds
  `trustOf` rather than being read directly, and all 136 fixture courses map to
  `human`, so Phase 3 changed the policy without changing a single verdict.
- **`coreq` is a boolean expression, not a list** — same `PrereqNode` shape as
  `prereq`, because several catalog corequisites are OR-shaped. Use
  `dependencyIds(course)` when you want the flat set of both. Corequisites compare
  before-**or-equal** on term index; prerequisites compare strictly before.
- **An OR means pick one.** When scheduling, commit to a single branch — scoring
  branches by calling the placement function places the losers too (**I13**).
- **Course prerequisites come from the current catalog; program requirements
  follow the student's declared catalog year.** Different sources; conflating them
  produced **U12**.
- **Confidence flags must stay visible**: `termsConfirmed: false` must never raise
  a "not offered this term" error — show the neutral notice instead. Only 4
  courses are still unconfirmed; terms and blocks are real data for the other 129
  (**U2**, **M1**).
- **Retired courses carry `terms: []`, not `termsConfirmed: false`.** ECEN 101 and
  CIT 160 will never run again, so an empty season list blocks every drop and
  keeps the autoplanner off them. "Unconfirmed" would wrongly mean "we don't
  know" — we do know. A retired course the student already *passed* still
  resolves as settled, not unreachable; don't write a test that assumes otherwise.
- **A refusal must say why.** When CIT 160 vanished from the picker with no
  explanation and the reason rendered as `offered: )`, that was the actual bug —
  not the retirement. Search surfaces retired courses, blocked, with the reason
  attached.
- Desktop only (min-width 1024px). Don't add mobile layouts.

---

## 5. React Flow gotchas (hard-won)

- Nodes carry explicit `width`/`height`; the layout is computed with dagre, so
  React Flow never needs to measure the DOM.
- The viewport is **controlled** (`viewport` + `onViewportChange`). Centering is
  our own math, not `fitView`/`setCenter`.
- A controlled `nodes` prop **must** also pass `onNodesChange`, or the edge layer
  renders empty. (If the edge layer looks empty in a *hidden* tab, that is the
  §1 layout-freeze artifact, not this bug. It was chased once already.)
- Nodes with `selectable: false` get `pointer-events: none` — clickable label
  nodes need `style: { pointerEvents: "all" }`.
- Tree x-position is global prerequisite depth × 258px, not dagre's rank.
- `prereqDepth` walks the expression; it must **not** use `dependencyIds`. A
  prerequisite costs a column, a **corequisite costs none** (same term is legal),
  AND takes the deepest branch, **OR takes the shallowest**. Flattening to leaves
  and taking the max put CHEM 105 — which has no prerequisite at all, only a math
  coreq — in column 5.
- Tree edges are weighted, not uniform. Half the prerequisite edges are OR
  alternatives and half cross clusters (longest span ~2,600px), so drawing them
  all at equal ink buried the real chains. `edgeStyle` sets
  required/alternative/coreq × same-cluster/cross-cluster. Selecting a node
  restores its neighbourhood via `styledEdges`. **Backwards-pointing edges are
  expected and are always OR alternatives** — a course is positioned by its
  cheapest path, so an alternative route can arrive from further right (ECEN 398R
  → ECEN 499). Never "fix" that by reverting depth to max-over-leaves; see **I15**.
- **An unarmed tree card pans the canvas — and that is indistinguishable from a
  failed drag.** This was reported as "the tree lets me drag classes but not
  drop them". The drop mechanism is fine; verified end to end with synthetic
  mouse input: armed → drag to the rail → placed, toast and all. Drag an
  *unarmed* card and React Flow pans instead, the card moves with the canvas,
  and releasing does nothing. Both halves are working as designed and they look
  identical. Don't "fix" it by removing click-to-arm (that reintroduces the
  original bug — panning kept picking courses up). The affordances are the
  answer: the armed card carries a "drag to a term" badge and a grab cursor, and
  `SemesterRail` lights up the moment a card is armed in tree mode, because the
  rail is the only valid target and it otherwise gives no sign of itself until a
  drag is already under way.
- **Zoom is ours, not React Flow's.** RF exposes no zoom-speed prop, so a native
  `wheel` listener on the wrapper handles ctrl/⌘ + wheel: registered
  `{ passive: false, capture: true }` because React's synthetic wheel handler is
  passive (preventDefault would be ignored) and capture beats RF's own handler on
  the inner pane. `ZOOM_SENSITIVITY` is the only knob.
- **One focus set, two consumers.** `useFocusSet` backs both the tree and the
  board — there used to be two near-identical implementations that could drift. Its
  ancestor walk **prunes**: never highlight a "not needed" option, and under
  `focus:unfinished` stop at anything already completed/registered/planned, or the
  mode stops meaning "what's left".
- **At-risk is red (`--color-risk`), not another amber.** `node-at-risk` forces a
  steady red halo and kills the pulse: **motion means "ready to take", colour
  means "something is wrong"**. Distinct from `danger`, which marks a course
  actually failed.
- Tree cards are **click-to-arm, then drag**: `useDraggable` is `disabled` unless
  the node is `selectedCourse`, and unarmed nodes drop `nopan` and skip
  `stopPropagation` so the pointer falls through to React Flow's panning.
  Listeners on every node meant panning the canvas kept grabbing courses.

---

## 6. Panels (`src/ui/panels/`)

Three overlays became one dockable window manager. The requirements rail, the
course detail and the add-course picker are all `FloatingPanel`s now.

**The model.** Each panel has one `PanelGeom`: a `dock` plus dock size fractions
(`fw`/`fh`) plus a free-float rectangle (`x/y/w/h`). The float rectangle is kept
while docked on purpose — undocking returns a panel to the size you last gave it.

- **Edge docks (left/right/top/bottom) reserve space.** `usePanelInsets()` feeds
  margins to `<main>`, so the board and tree shrink to fit. A rail you have to
  keep moving out of the way is worse than no rail.
- **Corner docks and `full` overlay.** A quarter-panel is a glance; "maximise"
  means "cover everything for a moment".
- **Dropping in open space leaves the panel where you dropped it.** `zoneFor`
  returning `null` is a real answer, not a fallback.

**Gotchas:**

- **Do not use `setPointerCapture` for the drag.** It looked tidier and it does
  not work here: only the first `pointermove` after capture arrives, so a dragged
  panel jumps once and then freezes under the cursor. `beginGesture()` uses
  `window` listeners instead. That also survives the panel re-rendering into a
  different branch mid-drag, which the picker does every time you open a course.
- **Every gesture works from a snapshot taken at pointer-down.** Nothing else
  mutates geometry mid-drag, so a snapshot is simpler than chasing the latest
  render and immune to stale-closure bugs.
- **The snap preview and the drop must share `boxFor`.** They do. Don't
  re-derive the preview rectangle anywhere else or it will start lying.
- **`PanelHost` measures with `ResizeObserver` *and* a window `resize` listener
  *and* a one-second interval catch-up.** ResizeObserver alone is not enough: it
  does not fire in a background tab, and in dev Vite injects the stylesheet after
  the first layout, so the first measurement can land on an unstyled zero-height
  box. Panels render `null` until the layer has a real size.
- **Every term has *two* drop zones, and they must not share an id.** The board
  column registers `col:<termId>` and the rail chip `rail:<termId>`, each
  carrying `{ termId }` in `data`; `DndRoot` reads the term from `data` and
  never parses it back out of an id. They previously both registered
  `term:<termId>` — dnd-kit keys droppables by id, so which of the two survived
  was an implementation detail. It happened to work, which is worse than
  failing: keep the ids unique.
- **Dropping into a semester box already works from every source** — picker
  rows, requirements-rail chips, tree cards and board cards — and dnd-kit's
  auto-scroll carries the board horizontally when you hold a drag near its edge
  (measured: `scrollLeft` 0 → 2933 of 3284, drop still landed). If a report says
  otherwise, check which build is running before changing any of this: an
  *installed* copy is frozen at the version it was packaged from.
- **Picker rows are draggable, and blocked ones deliberately are not.**
  `useDraggable` is `disabled` unless `validateDrop` allows it — offering a drag
  that could only ever be refused is worse than not offering one. The chips
  still place into *this* term; dragging is for aiming at a different one
  without reopening the picker.
- **The requisite tooltip renders as a sibling of the panel, not inside it.**
  The panel has `backdrop-blur`, and a `backdrop-filter` makes an element the
  containing block for `position: fixed` descendants — a tooltip nested inside
  would silently anchor to the panel instead of the viewport. It also hides
  itself mid-drag so it doesn't chase the cursor.
- **The picker is one panel with two bodies, not two panels.** Same `id`, so
  drilling into a course cannot make the window jump somewhere else.
- **There is no close-on-click-outside any more.** Right for a transient popover,
  wrong for a panel you dock beside the board — clicking a course in the tree
  would dismiss it. Escape still closes (and backs out of the detail view first).
- Header z-index is 40, panels 20–25, toast 50. Panels must stay under the
  header, or its search dropdown renders behind a top-docked panel.
- `Reset panel layout` lives in the `⋯` menu. Panels can be dragged somewhere
  awkward; that is the way back.

---

## 7. Desktop shell (`electron/`)

One codebase, two targets. Nothing in `src/` knows it is in Electron except one
class name.

- `electron/main.cjs` and `preload.cjs` are **CommonJS on purpose** — package.json
  is `"type": "module"` for Vite. Renaming them to `.js` fails with a module-scope
  error that reads like an Electron bug.
- **The app header is the window title bar.** `titleBarStyle: "hidden"` +
  `titleBarOverlay` keeps the real minimise/maximise/close buttons; the header
  gets `-webkit-app-region: drag`, and every interactive child opts back out. The
  gap reserved for the buttons comes from the Window Controls Overlay
  `env(titlebar-area-*)` variables, with a `100vw` fallback that makes the gap
  zero in a browser.
- **`.is-desktop` on `<html>` is the entire web-vs-desktop switch**, set in
  `main.tsx` from `window.gradtree?.desktop` before the first paint. There is no
  second code path.
- **The preload exposes almost nothing** — a boolean, a platform string, versions.
  No Node, no `ipcRenderer`, no filesystem. If a real channel is ever needed, add
  one named method, not a generic `invoke`.
- **It refuses to become a browser**: `contextIsolation`, `sandbox`, no
  `nodeIntegration`; `will-navigate` and `setWindowOpenHandler` send anything
  external to the OS browser instead.
- **Offline is a guarantee, not a hope.** Fonts are bundled via `@fontsource`
  (the old Google Fonts `<link>` silently fell back to system-ui offline, which
  changed every metric in a layout tuned at 10–11px), `base: "./"` makes the build
  work over `file://`, and a build-only CSP (`csp()` in `vite.config.ts`) forbids
  anything off-origin. The CSP is build-only because Vite's dev server injects an
  inline React Refresh script that a strict `script-src` blocks.
- Window size, position and maximised state persist to `userData/window-state.json`,
  written on close rather than on every move.
- **`npm run desktop` does not use `wait-on`, on purpose.** It used to gate
  Electron behind `wait-on tcp:127.0.0.1:5174`; on this machine that probe never
  resolves even when the port is plainly serving HTTP, so the window never
  opened and all the user saw was Vite printing a localhost URL — which looks
  exactly like "it just opened a web page". `loadDevServer()` in `main.cjs`
  retries `loadURL` every 400ms instead, gives up after ~30s with a dialog that
  names the two ways forward, and has no probe to disagree with. **Don't
  reintroduce a readiness check.**
- **The desktop dev server is port 5175 with `strictPort`, not 5174.** 5174 is
  plain `npm run dev`, which is allowed to drift to another port when it is
  taken. The desktop script must not drift: Vite silently moving to 5175 while
  Electron watched 5174 is the other half of the same "no window" bug. If 5175
  is busy, Vite now fails loudly and says so — that is the intended behaviour.
- **A fresh `npm install` does not download the Electron binary unless
  `allowScripts` says it may.** This repo gates install scripts, so
  `electron@43.4.0` is listed there. If `node_modules/electron/dist` is missing
  and every desktop script dies with "Electron failed to install correctly", run
  `npm run desktop:fix`.
- **On this machine the antivirus deletes the packaged app, so the shipped way
  to launch it is `npm run shortcut`.** Bitdefender (which is why Defender
  reports itself disabled) quarantines freshly built, unsigned Electron
  binaries: `npm run desktop:build` reports success, and moments later
  `GradTree.exe`, both installers and ~100 DLLs are gone — 8 files survive out
  of thousands, and the user sees "it still doesn't open". Nothing is wrong with
  the build; there is no longer an executable on disk.

  `scripts/makeShortcut.mjs` sidesteps it entirely by pointing a desktop
  shortcut at `node_modules/electron/dist/electron.exe` with the project as its
  argument — the *same* Electron that packaging would have renamed to
  `GradTree.exe`, except it already exists and has never been flagged. Same app,
  same icon, no console window (electron.exe is a GUI binary). It runs the built
  `dist/`, so `npm run build` after source changes; `npm run shortcut` does both.

  Packaging is still correct and worth keeping — it will produce working
  installers the moment the project folder is excluded from scanning. **Adding
  that exclusion is the user's call, not something to automate.**
- **Packaging goes through `scripts/packDesktop.mjs`, not `electron-builder`
  directly, for the same reason.** Bitdefender also keeps a handle on
  `app.asar` and the built `.exe`s after writing them. No process lists them as loaded modules, so it looks like
  nothing is holding them — but the *next* build dies with
  `EBUSY: resource busy or locked, unlink .../resources/app.asar` before it can
  clear the previous output. A build into a **fresh** directory always works;
  only rebuilds over an existing one fail.

  So `packDesktop.mjs` tries to clear `dist-desktop/`, and when it can't, builds
  into `dist-desktop-2`, `-3`, … and says why. `npm run desktop:clean` removes
  them all once the scanner lets go, and reports anything still stuck rather
  than silently leaving hundreds of MB behind. The permanent fix is a scanner
  exclusion for this folder.

  It invokes `node node_modules/electron-builder/cli.js` rather than the `.cmd`
  shim with `shell: true` — that path contains a space, and shell mode
  concatenates arguments instead of escaping them.
- **The plan is saved twice on the desktop, and that is deliberate.**
  `localStorage` *does* persist under `file://` in Electron — measured across a
  restart, not assumed — but it lives inside an opaque Chromium LevelDB in the
  profile directory: not openable, not copyable, not backupable, and gone if
  anything resets the profile. So `saveEdits()` also mirrors every save to
  `plan.json` in `userData`, and `loadEdits()` falls back to it when
  `localStorage` comes up empty.

  Three rules keep the two copies honest:
  - `localStorage` stays the **source of truth** in the renderer, so the web and
    desktop builds share one save path. The file is a safety net beneath it, not
    a second mechanism to keep in sync.
  - The fallback only fires when `localStorage` has **nothing**, so a real plan
    can never be clobbered by a stale backup.
  - Both directions **seed the other on load** — a plan read from `localStorage`
    is mirrored to the file, and one recovered from the file is written back to
    `localStorage`. Autosave only fires on a *change*, so without this an
    untouched plan would sit with exactly one copy, which is the one moment the
    guarantee needs to hold.

  Verified end to end: plan a course → restart → clear `localStorage` entirely →
  restart → the plan is back, and the requirement totals move with it.
- **A preload that throws kills the whole page.** `savedPlan` is read with
  `ipcRenderer.sendSync` at preload scope so the store has it on the first
  render. Unguarded, a missing handler failed the document load with
  `ERR_FAILED` and a blank window with no clue why. It is wrapped in try/catch
  and degrades to "no backup" — trading the entire app for a *backup* of the
  plan is the wrong way round. Keep it wrapped.
- **`app.setName("GradTree")` is set explicitly in `main.cjs`** so
  `npm run desktop` and the packaged app share one profile instead of relying on
  package.json `name` happening to match `productName`.
- `build/icon.ico` is generated by `scripts/makeIcon.ts` (`npm run icon`) — a
  hand-rolled PNG/ICO encoder, so the repo carries no binary nobody can
  regenerate. The icon is the five-node prerequisite graph in the app's own
  status colours.

---

## 7.5 The catalogue pipeline (Phase 2)

`npm run harvest` → `data/catalog-raw.json` (2,026 courses, requisite prose
verbatim). **That file is never imported by the app** — nothing in
`src/data/index.ts` references it, so it stays out of the 635 kB bundle. It is
build-time input.

Two scripts measure the parser, and they answer different questions:

| | question | current answer |
| --- | --- | --- |
| `npm run bench` | when it speaks, is it right? | **128/131** agree with the human (97.7%); the 86 it calls `exact` are **100%** right |
| `npm run coverage` | how often can it speak at all? | `exact` 615 (39.9%) · `parsed` 849 (55.1%) · `unsure` 76 (4.9%) of the 1,540 courses carrying requisites |

**The load-bearing invariant is "no `exact` parse disagrees with the human."**
That is asserted in `npm run verify`, and it is the claim Phase 3's trust model
will enforce prerequisites on. The headline agreement rate is the less
interesting number; a parser that is sometimes wrong but *knows* when is far
more useful than one with a better average and no self-awareness.

All three current disagreements are deliberate fixture divergences, not parser
bugs, and all three are flagged `parsed` because something was dropped: CIT 160
and ECEN 101 are retired in the catalogue but kept as live options for this
transcript (U7), and MATH 112X stores no edge on purpose (I9).

**What the catalogue contains that the model has no room for**, ranked by
`npm run coverage` — this is Phase 3's real backlog, not a parser deficiency:

- **~380 "Declared in \<program code\>"** — enrollment restrictions. This is
  DATA_GAPS **M6**, now quantified: restrictions are far more common than
  missing prerequisites.
- **137 "Earned at least this many credits"** — standing requirements.
- **136 "Instructor authorization"**, 65 "Internship application authorization".
- **374 courses (24.3%) produce no expression at all** — their entire requisite
  text is restrictions, not prerequisites. Treating those as "no prerequisite"
  is correct for the graph and wrong for the student.

Only **8 courses (0.5%)** drop a real course code, so the prerequisite *graph*
is close to complete even where the *rules* are not.

---

## 7.6 The full catalogue is live (Phase 5)

The app loads **`data/courses-full.json`** — 136 hand-audited courses plus 1,895
parsed from the harvest. **`data/courses.json` is still the audited source and is
never generated over**; `npm run merge` reads it and writes the merged file. A
hand-audited entry is never overwritten: those carry scraped offered-terms,
blocks, online availability, section counts and skills that the catalogue API
does not have.

**Two sets, deliberately.** `src/engine/scope.ts` decides which:

- **Search and the picker see all 2,031.** Looking a course up is never wrong.
- **The planner sees ~136.** Suggestions, the auto-planner, the "furthest out"
  ranking, the tree, and the `directUnlocks` badge run on courses that could
  count toward an enrolled program, plus their prerequisite closure, plus
  anything on the transcript or already placed.

Skipping that split is not a style choice — it is the difference between working
and broken, and `npm run verify` caught it immediately. Unscoped, "what should I
take next term" recommended **ENG 301** (442 unlocks university-wide) and
"furthest out" surfaced **MUSIC 462D**. Both were working exactly as written.

**Things that will bite you here:**

- **Never build a reverse index with `COURSES.map(c => COURSES.filter(…))`.**
  That O(N²) shape cost 21 ms at 136 courses and **1,106 ms at 2,031** — a
  second of blocking work before React could render. `reverseIndex()` in
  `plan.ts` does it in one pass; measured 49 ms.
- **Dedupe course ids case-INSENSITIVELY.** The catalogue says `CSE121C`, the
  fixture says `CSE121c`; a case-sensitive check shipped both, and nothing
  referenced the duplicate.
- **A course is not its own prerequisite.** CHILD 300 and CHILD 310 name
  themselves; as an edge that puts a course left of itself and makes
  `prereqDepth` inconsistent. `buildCourses.ts` drops self-references and
  records the drop, so the entry grades `parsed` rather than `exact`.
- **`terms: []` means retired.** Generated courses use
  `terms: ["F","W","S"] + termsConfirmed: false` — "we do not know", which never
  blocks. Writing `[]` would silently retire 1,895 courses.
- **Cost of shipping it:** bundle 635 kB → **1,534 kB** (gzip 183 → 246 kB),
  cold start ~285 ms. Acceptable for a desktop app; revisit if the web build
  ever matters more.

**The `exact` invariant changed shape.** It used to be "an `exact` parse never
disagrees with the human". With the full catalogue loaded the parser can resolve
alternatives the fixture deliberately omitted (MATH 325, ITM 327, ME 305 — the
ACKNOWLEDGED list), so it now produces *more complete* expressions than the
hand-written entries. The invariant is now stronger and better targeted:

> **no `exact` parse is STRICTER than the human.**

Checked exactly, not by proxy: for each disagreement, enumerate every
combination of courses-taken and look for one that satisfies the human's rule
but not the parser's. That is precisely the case where GradTree would refuse a
registration the catalogue permits. Zero, and it must stay zero.

---

## 7.7 The schedule scraper (`npm run schedule`)

The catalogue API says what a course *is*; only the class schedule says when it
runs. This reads all 108 disciplines × Fall/Winter/Spring 2026 and writes
`data/schedule-full.json`, which `npm run merge` folds into the shipped courses.

**Everything about this script is shaped by how the site misbehaves:**

- **Strictly sequential.** Concurrency corrupts results — identical section
  counts for unrelated subjects, ECEN capped at 20 (DATA_GAPS S6). One request
  at a time, 300 ms apart. Do not "speed it up".
- **`multipart/form-data`.** The form declares that enctype. A URL-encoded POST
  is silently ignored and you get the portal home page back with HTTP 200.
- **Echo every hidden field, including `___BrowserRefresh`.** Omit it and
  Jenzabar's anti-replay guard answers *"you attempted to navigate using your
  browser's Back or Refresh button"* — again as a 200, so it reads as an empty
  result rather than an error. This cost the most time to find.
- **20 rows per page.** `pg0$V$lnkShowAll` lifts it, and needs the viewstate
  from the *results* page, not the search page.
- **Re-fetch the search page per discipline.** A results-page viewstate is
  scoped to its own search; reusing it across disciplines is how you get
  someone else's rows.

**Why it is trustworthy:** it reproduces the 2026-08-06 hand-checked scrape on
**128 of 128** courses — terms, blocks and online, exactly. That comparison is a
permanent assertion in `npm run verify`, not a one-off check.

**A course the scrape never saw is `termsConfirmed: false`, never `terms: []`.**
`terms: []` means "retired, will never run" and blocks planning outright; one
cycle of evidence cannot tell a dead course from a two-year rotation
(DATA_GAPS U14). 202 generated courses are in that state and carry a note
saying so.

---

## 7.8 The shipped record is blank (and must stay that way)

`data/student.json` ships **empty** — no name, no transcript, no declared
programs — so anyone who opens the app starts on program selection. It is
bundled into the `.exe`, so **it must never contain personal data.**

- **`data/student.mine.json`** holds a real record. It is read by
  `npm run verify` and by nothing in `src/`, so it cannot reach the bundle.
  To use your own record in the app, copy a filled-in file over
  `student.json` and rebuild — and remember that doing so puts it in the `.exe`.
- **The engine takes a student as a parameter.** `buildPlan`, `cumulativeGpa`
  and `projectGpa` all default to the shipped record and accept another. That
  is what lets the suite assert concrete transcript numbers while the app ships
  clean; it is also what "support any student" always needed.
- **Scope follows the *chosen* enrollment, not the declared one.**
  `setActiveEnrollment()` in `scope.ts` is set by `computeBundle` before every
  build. Before the record went blank, `relevantCourseIds()` defaulted to the
  transcript's declarations and happened to be right. With a blank record that
  default is empty — so without this, picking a major would leave the tree
  empty. Don't remove it.
- **Editorial content is scoped to the program it was written for.**
  `src/data/projects.ts` is authored for electrical engineering — analog front
  ends, embedded firmware, signal integrity — so `PROJECTS_PROGRAM_IDS` names
  the programs it applies to and the Projects tab hides itself for everyone
  else. Widening the audience means writing projects for them, not adding an id
  to that list. `Projects.tsx` refuses a second time, because `mode` is
  persisted state and can arrive from an older profile.
- **Both empty states are deliberate.** The rail says "Start here" and the tree
  says "No programs picked yet"; a blank canvas reads as a broken app rather
  than an empty one.

When verifying a build is clean, grep `dist/` for the name, advisor, GPA and
grades — not just the name.

---

## 7.11 Auditing programs (`npm run audit:programs`)

`bench:programs` scores the parser against three hand-written programs — too
small a sample to say anything about the other 209. This asks a different,
*checkable* question of every one: **did the parse lose anything, and can a
student act on the result?**

Six checks, comparing each generated program back against the catalogue HTML it
came from. Current state:

| check | result |
| --- | --- |
| sections → buckets | 209/209 |
| every linked course pooled | 209/209 |
| every clause consumed | 208/209 |
| credit totals captured | 209/209 |
| **no unsatisfiable bucket** | **200/209** |
| **program references resolved** | **196/209** |
| clean on all six | **187 (89.5%)** |

**Completeness is not correctness.** The first four checks were all at ~100%
while three real defects sat underneath them, and each was found by *reading*
six programs side by side (`-- --sample 6`), not by the checks:

- **Hollow requirements — since fixed.** Music's "Emphasis — 53 to 57 credits"
  parsed into a bucket with no courses and no groups: `0/53 cr` forever with
  nothing to click. The options live in a `specializations` field the harvest
  did not read. **The catalogue models an emphasis as a program in its own
  right**, nested under its parent with the same rule structure, so harvesting
  them turns that bucket into a real `nOfGroups(1)` — Music now offers Jazz
  Studies, Organ, Piano, String, Vocal and Woodwind/Brass/Percussion. 132
  specializations across 22 programs; 26 of the 34 hollow buckets cleared. The
  8 that remain ("Technical Elective", "Elective Major Credits") describe their
  pool in prose rather than links.
- **Internal ids leaked into the UI.** Opening Music showed requirements
  labelled `rule-1`, `rule-2`, `rule-3` — `programParse` names unlabelled
  sibling clauses `rule-N`, and `fallbackLabel` gave up on any pool over three
  courses and fell through to the id. It now describes the rule instead:
  "Choose 1 of 18", "6 credits from 57 courses", "3 credits of electives".
  Every generated program with more than one clause under a heading was
  affected, not just Music.
- **A credit clause with no courses of its own.** GE's Breadth section ends
  "Take at least 6 credit(s) from 2 of the Breadth areas" — a real requirement
  whose pool is the three areas listed above it. Parsed literally it was 6
  credits from nothing. Such a clause now borrows the union of its siblings'
  pools and keeps the catalogue sentence as its note. This deliberately
  under-constrains — "from 2 of the areas" is a distribution rule the bucket
  model cannot express — because refusing to count credits a student genuinely
  earned is the worse failure.
- **Unresolved `programRef`.** 97 programs point at a General Education track
  through a reference; only GE - ABET existed, so the rest showed an empty
  39-credit requirement. Fixed by generating the other five GE tracks —
  `NESTED_PROGRAM_IDS` keeps them out of the picker automatically. 15 programs
  still reference clusters, which are deliberately not generated.
- **Duplicate pool entries** from overlapping options.

Each of those became a check, so the reading does not have to be repeated.

**The audit feeds the grade.** `buildPrograms.ts` downgrades a program to
`unsure` when it has an unsatisfiable bucket or an unresolved reference — the
parse was not *wrong*, it was incomplete, and grading it `exact` because every
clause was consumed would be the parser marking its own homework. Shipping
distribution: **175 `exact`, 13 `parsed`, 21 `unsure`** (was 156/12/41 before
specializations were harvested).

**The unsatisfiable check walks nested groups.** It used to look only at
top-level buckets, so General Education passed while its Breadth section
carried a nested "6 credits from nothing" — which the app rendered as `0/6 cr`
with a shortfall warning and nothing to click. A requirement is unsatisfiable
wherever it sits in the tree. Tightening it moved the score from 201 to 200,
which is the number being honest rather than the number getting worse.

**Audit the artifact, not a re-derivation.** This script used to re-run the
parser and measure *that*, so it never saw anything `buildPrograms.ts` adds
afterwards and kept reporting 34 filled buckets as empty. It now reads the
shipped programs. Auditing a re-parse is how you get a green report on a broken
build — or a red one on a fixed build, which is what happened here.

**This is still the evidence for keeping `assertsRequirements` at `human`.**
One program in ten has a requirement a student cannot satisfy or a reference
that goes nowhere. The remaining work is the 13 programs referencing clusters
(deliberately not generated) and the 8 prose-described elective pools.

---

## 7.10 Program trust — and why it is stricter than course trust

`trustOfProgram()` grades a program `human | exact | parsed | unsure`;
`assertsRequirements()` decides whether the app may make *claims* about it.
**Only `human` qualifies**, and that asymmetry with `enforcesPrereq` is
deliberate:

| | evidence | `exact` allowed to assert? |
| --- | --- | --- |
| prerequisites | 131 hand-audited courses; the 86 graded `exact` were right **86/86** | **yes** |
| programs | 3 hand-written programs; **1 of 3** reproduced exactly | **no** |

195 of 204 programs grade themselves `exact`. That is the parser's own opinion,
not a verified one, and there is no corpus to check it against — so it does not
buy the same authority. If someone hand-audits a sample of programs the way the
courses were audited, revisit this; until then it stays at `human`.

**What is withheld, and what is not.** Progress bars, credit counts and course
pools are shown for every program — those describe the catalogue. The two
things suppressed are the ones that tell a student what they *must* do:

- **★ "required — no alternative"** (`requiredCourseIds`). This used to loop
  over the literal list `[EE, AI_MINOR, GE_ABET]`, which was correct only
  because those were the only programs. It now filters by trust, so the ★ set
  is unchanged — asserted — while being principled rather than accidental.
- **"not needed"** (`obsoleteCourseIds`). Striking a course out from an
  unverified reading could hide something the student needs. Machine-read
  programs still contribute their *active* pools, so they can never cause a
  course to be marked obsolete either.

The rail shows an **`auto-read`** badge on those programs, whose tooltip names
what was dropped. Absent markers with no explanation would just look like bugs.

---

## 7.9 Every major and minor (Phase 6)

`PROGRAMS` now carries **207**: the three hand-written files plus **204 parsed
from the catalogue** (101 majors, 103 minors). Before this, a student who was
not an electrical engineer opened the program picker to a single choice.

- **Hand-written programs always win.** `buildPrograms.ts` skips their *codes*,
  so there is never a generated duplicate for the same degree with a different
  opinion. Those three carry decisions a parser cannot make: placeholder slots
  for "any foreign language course", REL electives stated as prose, and the
  nested General Education reference.
- **Only majors and minors are generated.** The catalogue also has 110
  clusters and 34 certificates; shipping those would bury the 185 things people
  actually pick.
- **`minGrade` is left `null` on generated programs.** C- is the published
  bachelor rule but it is not stated in each program's own text, and asserting
  it from outside the source is how DATA_GAPS U9 happened.
- **The picker is a search box, not a list.** 204 buttons in a dropdown is not
  a picker.

**Parser fidelity:** 195 of 204 grade `exact`, 9 `parsed`, and **none name a
course the app does not carry** — the course harvest is complete, so program
pools resolve fully. Benched against the hand-written three, it reproduces the
A.I. minor exactly (3/3 buckets) and EE 6/8. The two EE misses and GE's three
are all places where the hand file *augments* the catalogue with placeholders,
not places where the parser misread it — which is why those files stay
authoritative rather than being regenerated.

**One bug worth remembering:** a heredoc turned `` into a literal backspace
byte (0x08) inside `/^option/i`, so option detection silently matched
nothing and every choice bucket collapsed to `allOfGroups`. The regex *looked*
right in every editor. If a parser inexplicably matches nothing, check the
bytes.

---

## 8. Data conventions

- `src/data/projects.ts` is **authored editorial content**, not sourced data.
  Course ids in it are real and verified by `npm run verify`.
- Prerequisites and corequisites were re-audited against the live BYU-Idaho Kuali
  catalog on **2026-08-06** (62 courses corrected) and carry `prereqSource` +
  `prereqCheckedOn`. `data/catalog-snapshot.json` is the raw catalog text that
  audit saw — diff it to see what the university changed.
- The EE program file is `data/programs/ee-bs-2026.json` (id `ee-bs-2026`). It was
  previously named/labeled 2024-2025 while holding 2026-2027 rules; the label was
  corrected, **not** the contents. See its `_catalogYearNote` — if I-Plan says
  UG24, the file needs replacing rather than relabeling (**U12**).
- Offered terms, half-semester blocks and online availability came from the
  **public class schedule**, scraped 2026-08-06 (`data/schedule-2026.json`).
  Re-scraping is manual and fiddly: ASP.NET viewstate per request, "Show All" to
  beat 20-row pagination, and **strictly sequential requests** — concurrency
  silently corrupts the results, producing identical section counts for unrelated
  subjects (**S6**).
- Deliberate omissions (retired alternatives, placement-test paths, courses
  outside the fixture) live in `ACKNOWLEDGED` in `scripts/auditCatalog.ts`, each
  with a reason, so the audit stays a clean pass/fail.
- When you resolve or add a data gap, update `DATA_GAPS.md` with its stable id
  (U\*/M\*/P\*/I\*/S\*). The user relies on that log.

---

## 9. Lessons that cost real time

Each of these was a wrong turn, not a hypothetical.

- **An assertion made before the source exists is a gap, not a resolution.**
  DATA_GAPS M5 recorded Spring 2026 as straight A's. The official transcript said
  A, A, A−, B+, A−. Nothing had lied; the entry had simply been written before
  there was anything to write it from.
- **Concurrency corrupted the schedule scrape.** CHEM and BYUI both came back with
  416 sections, ECEN capped at 20 instead of 32. The server keys on a per-request
  viewstate; parallel requests interleave. Sequential, in chunks.
- **Push back once, then look for the real bug.** When the user said CIT 160
  retakes were blocked, the retirement was correct — but the course was vanishing
  from the picker with no explanation and the refusal string rendered as
  `offered: )`. The complaint was right even though the premise wasn't.
- **Caches written only for root calls are not caches.** `reach.ts` rendered
  "DS 250 ✓?" because the path walk read entries that only existed for courses
  resolved as roots. Two passes fixed it; the sweep assertion is what keeps it
  fixed.
- **Verify in something that actually renders.** A "missing edges" bug in the tree
  was chased through speculative edits before turning out to be a hidden-tab
  artifact. It was present at HEAD too.
- **Pointer capture is not a drag implementation.** See §6.

---

## 10. Still open

Flagged to the user; not tasks, but know they exist before you trust the data.

- **U12** — confirm the declared catalog year in I-Plan. If it says UG24, the EE
  program file needs replacing, not relabeling.
- **U14** — the schedule scrape is one cycle of evidence, not a rotation history.
  A course that ran in 2026 is not guaranteed to run in 2028.
- **U15** — two sources disagree about online availability for 9 courses. The UI
  marks these `online?` rather than picking a winner.
- **M6 / M7** — enrollment gates stated outside the requisite rules, and
  repeatable-credit limits. Both are recorded in the data and **not enforced** by
  the engine.
- 4 courses still have `termsConfirmed: false` — never seen in the 2026 schedule.

### 7.12 `npm run sweep` — every degree, opened cold

The audit asks whether the *parse* lost anything. This asks the question a
student would: **pick this degree and does the app work?** It runs the real
engine over the shipped data for all 102 majors and 104 minors with an empty
plan, then asks each major's own required courses to be scheduled and
re-validates every placement the planner made.

    Swept 102 majors + 104 minors as a blank-slate student
    majors scheduled: 102, placements made: 4669
    combinations tested: 150, threw: 0
    programs with at least one problem: 16

Nothing throws. No major+minor combination throws. **The planner made 4,669
placements and its own validator rejects none of them.**

Two lessons, both from the harness being wrong before the code was:

- **Validate a placement against the board *without* it.** Checking each
  placement against a model that already contained it made the validator
  reject all 4,659 as duplicates.
- **Never sort term ids as strings.** `2027F < 2027S < 2027W` alphabetically is
  Fall, Spring, Winter — backwards. That one line reported 216 prerequisite
  violations across 85 programs in a plan that was correctly ordered. A test
  harness that is wrong in the pessimistic direction costs more than no test,
  because it sends you hunting a bug that does not exist.

The 16 remaining programs all fail for the same reason in the end: a
requirement the catalogue states in prose rather than course links. See
DATA_GAPS S12.

## 8. Shipping to the school (2026-08-17)

The owner set the target: **this goes to BYU-Idaho students of every major, and
a nursing student's experience should match what the electrical engineer got.**
Three consequences, all of them structural rather than cosmetic.

### 8.1 Machine-read programs now enforce

`assertsRequirements` was `human` only. That was the right call while the
evidence was three hand-written programs; it is the wrong call for a build
going to the student body, because it makes the app fully functional for
exactly one degree and decorative for the other 205.

`exact` and `parsed` now assert. **`unsure` still does not** — that grade is
assigned when the build *knows* the reading is incomplete, and starring a
course as unavoidable on a parse we have already flagged is how a student drops
a class they needed.

The badge went two-tier to match: `auto-read` (neutral, provenance) for
asserting machine-read programs, `unverified` (warning) for `unsure`.

### 8.2 ★ required is per-student, not per-catalogue

Turning enforcement on exposed a bug the old policy had been hiding.
`requiredCourseIds()` walked **every** asserting program and cached the result
globally. With three hand-written programs and a student enrolled in all three,
that was invisibly correct. The moment 300 programs began asserting, the same
line marked **941 courses across the whole university as unavoidable — for
everyone, whatever they had picked**.

It now walks the student's own enrolment, follows `programRef` so nested
General Education still counts, and caches per enrolment. This is the clearest
example yet of a policy hiding a bug: the conservative setting was not just
cautious, it was concealing.

### 8.3 Requirements the catalogue writes in prose

`npm run sweep` found 16 programs with a requirement no student could satisfy.
Every one of them named its courses in a sentence rather than linking them, and
the vocabulary is closed — the same lesson as the prerequisite prose:

| Catalogue wording | Resolved as |
|---|---|
| "from a foreign language course" | `FOREIGN_LANG` placeholder slot |
| "from the following subject code(s): AGRON, APS, BIO…" | every course in those departments |
| "from any 300- or 400-level CSE, ECEN or WDD course" | department + level filter |
| "MUSIC 312, 313, 314, 315" | shorthand list, department stated once |
| "any Internship (course ending in 298, 398, or 498)" | course-number suffix |
| "one Concentration" / "a secondary area of study" | `fillTo` + the catalogue's own sentence |

The last row matters most: those are **open-ended by design**, decided between
a student and an advisor. Modelling them as `fillTo` with the wording attached
is honest; leaving them as an impossible `0/18` was not.

110 clusters are now generated as a `cluster` program type — carried so
Interdisciplinary Studies' references resolve, excluded from the picker by type
so they do not bury the 205 real choices.

### 8.4 Where it stands

    Swept 102 majors + 104 minors as a blank-slate student
    majors scheduled: 102, placements made: 4670
    combinations tested: 150, threw: 0
    programs with at least one problem: 0

Zero unsatisfiable requirements, zero unreadable labels, zero phantom courses,
zero throws, and every planner placement passes the planner's own validator.

### 8.5 `` in a shell heredoc is a backspace byte

This bit the project for the **third** time. `` written through a heredoc
reaches the file as 0x08, so `/[A-Z]{2,7}/` becomes
`/<BS>[A-Z]{2,7}<BS>/` and silently never matches. It cost two debugging
detours here after costing one earlier on `/^option/i`.

The tell is a regex that is obviously correct, tests correct in isolation, and
returns nothing in place. `cat -A` shows it as `^H`. Scan with:

```bash
python -c "import io,glob; [print(f) for f in glob.glob('src/**/*.ts',recursive=True)+glob.glob('scripts/*.ts') if b'' in io.open(f,'rb').read()]"
```

Write regexes with the Edit tool, not through a heredoc.

## 9. Step 5 — read against the live catalogue (2026-08-17)

`npm run verify:catalog` goes back to byui.kuali.co and asks two questions that
nothing else in this repo can ask. Every other check compares the app to its own
harvest, which cannot notice that the harvest itself is wrong.

### 9.1 Fidelity — machine-decidable, and decided

    Checking 356 of 356 programs against the live catalogue
    identical  356

Not a sample. Every program in the catalogue still says exactly what was
harvested, compared on meaning rather than markup (Kuali re-serialises
whitespace between requests, so a byte diff cries wolf).

### 9.2 Meaning — not machine-decidable, and not pretended otherwise

The script prints the catalogue's sentence beside what a student will actually
see, and stops there. **Reading those worksheets found two real defects that
every automated check had passed.**

**GE Cornerstone pointed the REL elective at the wrong courses.** The catalogue
says "take these four REL courses AND at least 6 credits from any *other* REL
courses". The sibling-borrow heuristic filled that second rule with the same
four courses the first already requires — the courses "other" excludes. General
Education is referenced by nearly every program, so this was wrong almost
everywhere at once. Fixed two ways: the clause now resolves to the
`REL_ELECTIVE` placeholder, and **a clause containing "other" never borrows its
siblings' pool** — that word is the tell.

**A choice was labelled as a conjunction.** `PHIL 201 + PHIL 202` on a *pick
one* rule reads as "take both". Only `allOf` may use "+"; everything else says
"or". Pinned by an assertion that walks every program, because checking one
label would pass while the rule stayed wrong everywhere else.

Neither was findable by self-comparison. Both were found by reading.

### 9.3 The worksheet must render what ships

The first version printed `b.label ?? "(unnamed)"` — but the app labels those
groups from the rule. A reviewer signing off on a rendering students never see
is worse than no review: it manufactures confidence about the wrong artifact.
It now renders through `evaluateProgram`/`railRows`, the same path as the UI,
and never truncates the catalogue text.

### 9.4 Certificates, and a counter that was lying

13 programs were held at `unsure` for "referenced program(s) not carried".
Generating the 34 certificates did not clear them — because the reference
counter only looked at *top-level* buckets, and Agribusiness holds its sixteen
references as groups under one bucket. It saw one, concluded fifteen were
missing, and downgraded thirteen programs for a shortfall that did not exist.
The same top-level-only mistake as the original hollow check, for the third
time in this codebase. **When a check walks a tree, walk the whole tree.**

### 9.5 Where it ends

| | |
|---|---|
| trust | **337 `exact`, 15 `parsed`, 1 `unsure`** (was 156/12/41) |
| program references resolved | **353/353 (100%)** |
| audit clean on all six | **349/353 (98.9%)** |
| live-catalogue fidelity | **356/356** |
| sweep — majors and minors with any problem | **0** |
| planner placements rejected by its own validator | **0 of 4,683** |
| assertions | **220 passing** |

The single `unsure` program is a cluster whose rule spans two areas at once
("at least 12 credits from at least 2 of the following areas"). It is graded
honestly and therefore does not assert — the trust model working, not a defect.

## 10. Courses that must share a semester (2026-08-17)

The last gap that could actively mislead a student. Three programs state it:

> NOTE: The following courses must be taken together in the same semester:
> BUS 300, BUS 302, MKT 301

Business Management, its Interdisciplinary Studies emphasis, and the Small
Business Innovation minor. **Requiring the three courses was never the missing
part.** Nothing stopped a student spreading them across three semesters and
ending with a plan that looks complete, satisfies every requirement GradTree
checks, and cannot be registered.

### 10.1 The model

`Bucket.sameTerm` — every course in this bucket's pool shares one term.
`sameTermGroups()` derives the sets from the student's own enrolment, following
`programRef` and skipping programs that do not assert: a constraint read out of
a program already flagged as incompletely understood is not one to enforce.

### 10.2 Warn, never block

`validateDrop` returns `warning`, not `blocked`, and the card carries a flag.
A student builds a plan one course at a time, so a split block is a normal
intermediate state — the app's job is to say so, not to refuse the drop. The
message names the partners and the problem:

    BUS 302 must be taken in the same semester as BUS 300, MKT 301
    — currently in a different term.

Placing all three together produces silence. A warning that fires on a correct
plan is noise, and noise is how warnings stop being read; there is an assertion
for the silence as well as for the warning.

### 10.3 Two ways this nearly shipped broken

**The constraint lives in a NOTE, and notes were being dropped.** Business
Management states it in a clause of its own — `NOTE: …` — with the courses in
the next clause. Notes carry no rule, so the parser discarded it and the one
program that most needed the constraint was the only one without it, while the
two lesser programs that phrase it inline worked fine. A note can carry a
*constraint* even when it carries no rule.

**The verification looked for the wrong thing.** The first check searched
visible page text for "same semester", found nothing, and looked like proof the
feature was dead. The flag renders in the card's `title` attribute. The
screenshot had shown three red-bordered cards with warning triangles the whole
time — the check was wrong, not the code. Read what the component actually
renders before concluding a feature does not work.

### 10.4 A clause can be consumed as a constraint

The audit counted a clause as accounted-for if it became a rule, was dropped, or
was a note. The same-term clause is none of those — it sets a flag on the bucket
that follows — so Small Business Innovation sat permanently one clause short for
a clause that was fully understood. `constraints` is now a fourth way to consume
a clause: **350/353 clean (99.2%)**.

## 11. The last three audit rows (2026-08-17)

    clean on all six checks: 353  (100.0%)
      sections → buckets           353/353
      every linked course pooled   353/353
      every clause consumed        353/353
      credit totals captured       353/353
      no unsatisfiable bucket      353/353
      program references resolved  353/353

Trust: **340 `exact`, 13 `parsed`, 0 `unsure`.**

Each row turned out to be a different kind of thing, which is the useful part.

### 11.1 "No double counting" is a constraint, not an unreadable clause

Computer Engineering states it twice as a clause of its own. It names no
courses and no quantity, so it produced no rule and was not a note either — two
clauses the audit could never account for. `Bucket.allowDoubleCount` already
modelled it; nothing was reading it out of the catalogue.

It attaches to the rule it qualifies, which sits **after** it in Computer
Programming and **before** it in Computer Engineering. Assuming one direction
accounted for the clause in one program and lost it in the other.

### 11.2 "Grand Total Credits" is not a section total

Interdisciplinary Studies has five sections and six "Total Credits" strings,
the sixth being the degree's own total. The check therefore demanded six
section totals from five sections and could never pass. The audit was wrong,
not the parse.

### 11.3 An area definition is not a requirement

The Physical Science and Mathematics cluster reads "Take at least 12 credit(s)
from at least 2 of the following areas:" and then defines six areas — "Take any
Chemistry class numbered 105 or higher". Each area resolves a pool but states
no quantity, so it comes back `ok: false` and was dropped before the
sibling-borrow could see it. The sibling pool is now built from **every**
clause, not only the ones that became rules.

Two details worth keeping:

- **"Electrical Engineering" prefix-matches ENG — English.** Spelled-out
  department names get a small alias table, and prefix matching is allowed only
  for a single word. A confident wrong answer is worth a lookup table to avoid.
- **Widening the capture to two words broke the one-word case.** "…credits from
  Mathematics courses numbered 112" captured "FROM MATHEMATICS", a two-word
  phrase, therefore ineligible for prefix matching, therefore no pool — a rule
  that had been working. Leading words are now stripped.

### 11.4 "other" is not the exclusion idiom; "any other" is

Blocking the sibling-borrow whenever a clause said "other" was too crude. GE
Cornerstone's "at least 6 credits from **any other** REL courses" genuinely
excludes its siblings. General Studies' "15 credits from the same area or 15
credits from **one other** area" does not — the union of the areas is exactly
the right pool. The blanket rule silently deleted six real 15-credit
requirements from that degree, because a rule that resolves to nothing is then
pruned as noise. Two mechanisms, each defensible alone, combining to lose a
requirement.

### 11.5 A vacuity guard that fired for the right reason

`verify.ts` asserted `hollow.length > 0` — a guard so that "every program with
an unsatisfiable requirement is graded unsure" could not pass by having nothing
to check. It failed once the last unsatisfiable requirement was fixed. The
guard has become the stronger claim it was protecting: **no program ships a
requirement a student cannot satisfy.** The grading rule stays, guarding
anything that reappears.

## 12. Ten students (2026-08-17) — `npm run personas`

Ten people, ten degrees, one plan each, built with the app's own buttons and
then taken apart: every placement re-validated against the board as it was
built, prerequisites, term offerings, the credit cap, same-semester blocks, and
whether the plan actually moves the degree along.

**First run: 5/10. Final: 10/10.** Everything in between was real.

### 12.1 A choice between *named* options was read as a checklist

Agribusiness's "Component Options — Complete 1 of the following" lists fifteen
choices by name: "Economics Minor", "Animal Reproduction Cluster". The parser
only recognised blocks headed with the literal word "Option", so none matched,
the section fell through to the every-clause path, and a pick-one became an
all-of. **Caleb's plan was 272 credits for a 120-credit degree.**

Any header that is not `AND` now opens an option block, and the header's own
words become the group's label — so the student reads "Economics Minor" rather
than "Option 1". Caleb's plan: 159 credits.

### 12.2 The planner overfilled terms it had already measured

`ensure()` read the term's credit load, then called `coreqIndex()` — which can
itself place courses into that same term — then pushed its own course without
looking again. A check-then-act gap with the planner's own recursion running
through the middle. Nursing got a 19-credit semester under a 16-credit cap.
Both placement loops now re-read the load after corequisites resolve.

### 12.3 A requirement with no verb

General Education for Teacher Preparation lists "Any Foreign Language Course
(4)" — a bare noun phrase. The prose resolver filled the slot, but no quantity
pattern matched, so it fell to the drop pile: **every teaching degree's General
Education had quietly lost its language requirement.** The credit figure is the
trailing "(4)".

### 12.4 Search ranked a substring above the exact match

Typing "Chemistry" put **Biochemistry** first — the exact degree the student
asked for sat second, under a different one. Someone skimming picks the first
row. Matches are now ranked: exact, then starts-with, then word-boundary, then
substring; majors before minors, shorter labels first.

### 12.5 Stray whitespace in ten program names and sixty-one course titles

"Exercise and Rehabilitation Sciences ", "Investments  Minor". It shows in the
picker and breaks exact-match search. Normalised at the source in both build
scripts rather than at each display site.

### 12.6 Three times the harness was wrong, not the app

Worth recording, because each one looked like a bug for a while:

- **Business courses on a nursing board.** Clearing `localStorage` between runs
  left the app restoring the previous persona's plan from the desktop backup —
  which is the backup working as designed. The harness had to clear both.
- **"No Plan bottlenecks ASAP button for this major."** The ⋯ menu stays open
  after you add a program and covers the panel, so the click hit the overlay.
  The button exists and works; it placed 49 courses for Nursing in one click.
  (The menu staying open is still real friction.)
- **"The planner overfills to 18 credits."** That was 2023F — eighteen credits
  the student actually took, years before this app existed. The assertion was
  measuring history the planner does not control.

### 12.7 Workflow, measured

| | |
|---|---|
| clicks to enrol in a major | **3** (⋯ → Programs → result) plus typing |
| clicks from blank app to a full plan | **6** |
| courses placed by one button | 20–49 depending on degree |
| requirement expander | **hidden until hover** — see below |

Two frictions worth fixing next, neither of which breaks a plan:

- **The ▸ expander that reveals the courses inside a requirement is
  `hidden group-hover:block`.** A student cannot see it until the pointer is
  already on the right row, so "what counts for this requirement?" is
  effectively undiscoverable.
- **The ⋯ menu does not close after adding a program**, covering the panel that
  just filled with the student's requirements.

## 13. The two frictions, fixed — `npm run ui:check`

Both came out of walking ten personas through the real UI, and neither is
visible to any engine-level test: they are about what a student can *see*.

### 13.1 The requirement expander

`hidden group-hover:block` meant the control that reveals which courses satisfy
a requirement only appeared once the pointer was already on the right row — the
answer to the most common question in the app was undiscoverable. It was also
gated on `pool.length < 40`, which removed it entirely from the large elective
pools where the question matters most: GE's Breadth requirement offered no way
to see a single option.

Now always visible, on every pool, with the count in the label ("Show the 81
courses in General Education"). Pools are rendered up to 60 chips and then
summarised — "…and 21 more — search by code to find them" — because rendering
500 chips stalls the panel while rendering none was the old bug.

### 13.2 The ⋯ menu covering the panel it had just filled

The program picker lives in the ⋯ dropdown, which sits directly over the
requirements panel. Adding your degree filled the panel *behind* the menu that
was hiding it, so the student had to click away before anything appeared to
happen. The menu now closes on enrol, and a toast carries the confirmation the
open menu used to provide: "Added Nursing - Pre Licensure. Your requirements
are on the right."

### 13.3 A check must never be able to hang the machine it checks

`checkUi.cjs` is an Electron driver, and two mistakes in it put a modal
**"A JavaScript error occurred in the main process"** dialog on the owner's
screen and hung a run for six minutes:

- an unguarded `path.join(OUT, …)` when `SHOT_DIR` was unset;
- a string I wrote through a shell heredoc that ended up with **literal
  newlines inside double quotes** — a syntax error, and the actual cause.

Both are fixed, and the promise is caught rather than the body wrapped: the
driver body is an `async` callback, so what it throws is an *unhandled
rejection*, and a `try` in the wrong scope would not have caught it. Run
`node --check scripts/checkUi.cjs` before running Electron on it — a syntax
error in main-process code costs a dialog, not a stack trace.

Same lesson as `` becoming a backspace byte: **stop writing code through
shell heredocs.** Use the editor.

## 14. The tree was empty for everyone but one student — `npm run tree:check`

Reported by the owner: "the tree doesn't pull up when I start anew, it only
creates branches as I plan." Two separate causes, and the app had been shipping
both to every non-EE student.

### 14.1 A memo that could not see the enrolment

`layoutGraph()` takes its course set from `relevantCourseIds()`, which reads
module state set from the student's programs. The memo that calls it listed
only `[collapsed, placedIds]`.

So: a new student opens the tree — scope is three placeholders, effectively
empty — picks a major, and **nothing happens**, because neither dependency
changed. The graph then appears to *grow* one branch at a time, since planning
a course changes `placedIds`, and that was the only thing that could invalidate
the memo. The tree looked like a record of what you had done rather than a map
of what you could do, which is the opposite of the tool's purpose.

The memo now depends on the enrolment, and the one-shot viewport fit resets
with it — a fit computed against an empty canvas leaves the new graph off
screen, which looks identical to the bug it replaced.

Nursing goes from **0 to 118 nodes** on choosing the major, with nothing
planned. EE 123, Music 392, Construction Management 118.

### 14.2 The section headings belonged to one degree

`clusters.ts` held six hand-written groups taken from the electrical
engineering major. A nursing student saw

    ENGINEERING & COMPUTING CORE
    The main chain — ECEN and CSE courses every EE takes

printed above their biology courses, and anything EE's pools did not contain
fell into "Other".

The clusters are now derived from each enrolled program's own top-level
requirements — which is exactly what EE's hand-written clusters were, its own
buckets — and follow `programRef`, so General Education gets its own section
instead of a third of the tree landing in "Other". Each heading names the
degree it came from, because a major and a minor can both call a requirement
"Core". Nursing now reads **Prerequisite Courses** and **Core**; EE still reads
its own.

### 14.3 The check

`npm run tree:check` drives the built app, counts tree nodes, enrols in a
major, and counts again — asserting the tree populated **without planning
anything**. That last clause is the whole point: the old behaviour would pass
any check that let itself plan a course first.

## 15. Sprout — the restyle (2026-08-17)

`Sprout Website.html` (2.8 MB, built with Claude Design) is the style source.
The app was **not** regenerated from it: every visual decision in this codebase
already lived in one `@theme` block, and there were exactly six hardcoded hex
colours in all of `src/`. Handing 40 components, a React Flow canvas and 229
assertions to a design tool to change colours that live in one file would have
traded working interaction code for a palette.

### 15.1 What was taken from the site

| | |
|---|---|
| Display | Bricolage Grotesque — wordmark only |
| Body | Public Sans |
| Mono | JetBrains Mono — already what both used |
| Paper | `#f7f5ef` `#fffdf8` `#f2efe5` |
| Lines | `#e2ded2` |
| Ink | `#1a1a17` `#55524a` `#77746a` |
| Brand | `#3d7a1c` `#2f6b1d` `#57a32b` |

The site's 39 `@font-face` blocks point at opaque asset ids, so the files could
not be lifted out of the HTML — the faces come from npm instead, which also
keeps the offline guarantee the desktop build depends on.

### 15.2 Two palettes, one set of names

Light is the default; dark is kept and toggles from the ⋯ menu, persisted, and
applied before React mounts so the app never paints the wrong palette for a
frame. **Status hues are different values in each theme.** The dark set was
tuned against `#14161b`; `#fbbf24` amber on warm paper is nearly invisible, so
the light set steps several stops darker. Same meaning, different value — which
is the whole reason these are tokens rather than a filter over one palette.

### 15.3 What the light build broke, and why

Both were invisible until the app was actually looked at, which is why the
restyle started by capturing a baseline of four screens.

- **A tree of ghosts.** Locked nodes used `opacity-25`. A card at 25% over
  near-black still reads; over warm paper it is gone. Fading is a contrast
  ratio *against the ground*, so it cannot be one number — `--dim-locked`,
  `--dim-obsolete` and `--dim-muted` are now per theme.
- **The whole canvas went tan.** The "unverified prerequisite" edge is drawn
  for **1,895 of 2,031 courses** — it is the ordinary case, not a warning.
  Giving it a strong amber on light made every edge shout. It now recedes on
  paper exactly as the dim brown did on black.

### 15.4 The rename, and the part of it not to do

Product name, window title, installer, shortcut and every user-facing string
are Sprout. **`gradtree:*` localStorage keys and `window.gradtree` were left
alone**: renaming a storage key silently orphans every plan already saved on a
student's machine, and the preload bridge name is an internal contract nobody
ever sees. Rebranding is not worth data loss.

The old `GradTree.lnk` still sits on the desktop pointing at the previous
build — delete it; `Sprout.lnk` is the current one.

### 15.5 Checks

`npm run shots -- <label>` captures board, tree, detail and menu, so any future
restyle is a before/after rather than a memory. `THEME=dark` captures the other
palette. Everything else still passes: 229 assertions, sweep clean, personas
10/10, `ui:check` and `tree:check` pass.

## 16. Tree layout — `npm run tree:stats` (2026-08-17)

"The stats and nursing ones are so confusing." Measuring that turned out to be
the whole job, because the obvious culprit was not the culprit.

    102 degrees
      backwards edges  1033 → 0     (100% fewer)
      crossings       44319 → 14683  (67% fewer)

### 16.1 It was not crossings

Statistics has **one** crossing. Nursing's crossings barely moved (127 → 127).
Chasing crossings would have produced a nicer number and changed nothing a
student sees. Two other things were wrong:

**Backwards arrows.** Columns came from `prereqDepth`, a global measure over
the whole catalogue, which does not have to increase along the edges *this*
tree draws — so a prerequisite could land level with, or right of, the course
that needs it. Fourteen such edges in each of Statistics and Nursing; 1,033
across all degrees. A crossing is noise the eye steps over; an arrow pointing
the wrong way states something untrue about which course comes first. Columns
are now a longest path over the prerequisite edges actually present.

**Corequisites drawn as two arrows, ordered apart.** BIO 221 lists BIO 222 and
BIO 222 lists BIO 221, so the graph carried both directions between two nodes
in the same column, and nothing kept them adjacent. Nursing pairs every lecture
with its clinical — 322/322C, 323/323C, 410/410C, 433/433C, 490/490C — and all
five pairs were scattered down the column with lines reaching across. They now
share a row key and land side by side, which is most of what made that block a
hairball.

### 16.2 Correctness first, then readability — per cluster

Longest-path columns are not free: pushing courses further right puts more
edges between the same pair of columns. In Nursing's Core the old columns
*already* had zero backwards edges, so the new ones bought nothing there and
cost 30 crossings — a real regression traded for a fix that block did not need.

`layoutColumns` now builds both candidates per cluster and keeps whichever has
fewer backwards edges, breaking ties on crossings. Nursing's Core keeps its
original columns; the clusters that actually had backwards edges get the new
ones.

The row ordering also gained the two passes it was missing: sweeps in both
directions rather than one forward pass, and the standard transpose refinement
(swap adjacent rows while it removes crossings). Transpose re-counts every
crossing per candidate swap, which is quadratic in edges — fine on a 20-course
cluster, unusable on General Studies' 448-course column, so it is capped at 80
nodes and the sweeps carry the rest.

### 16.3 Reading the warning

The first version of the report flagged any increase at all and listed 31
degrees, which said nothing: every one had traded 3–27 backwards edges for one
to three extra crossings. It now warns only on more backwards edges, or
crossings up by a visible margin with nothing gained.

### 16.4 Flex Track has its own colour

`flex track` borrowed `registered` — a *course status* — which was both a
violet clash against the warm palette and a meaning collision. It has its own
`--color-flex` in the brand green now. Flex is a property of a term, never of a
course, so it cannot be confused with `completed`.

## 17. First-run walkthrough — `npm run welcome:check` (2026-08-17)

The app opened on an empty board with no explanation, and the one thing a new
student has to do — pick a degree — was three clicks deep inside a ⋯ menu.
Everything in Sprout is scoped to the enrolled programs: the requirements
panel, the prerequisite tree, every suggestion. Until a degree is chosen the
app has almost nothing to show and no way to say so.

Six steps, skippable from every one of them:

1. what Sprout is
2. **your major and minor, chosen inline** — not a pointer to where the setting
   lives
3. the Board, and that it warns rather than refuses
4. the Tree, with the status legend
5. the requirements panel, including what `auto-read` means and that it is not
   an advisor
6. light or dark

### 17.1 Who sees it

Not simply "has the flag been set". Someone upgrading from a build that
predates the walkthrough already has programs and a plan, and greeting them
with an introduction to an app they have been using for months is worse than
having no introduction at all. `shouldWelcome()` requires an empty enrolment
*and* an empty plan *and* no flag.

The decision is taken once, on mount, and deliberately not re-evaluated: the
second step asks you to pick a major, and a live subscription would close the
walkthrough out from under the person still using it.

### 17.2 One ranking, two pickers

The ⋯ menu and the walkthrough both search programs, and both now call
`rankPrograms`. Two places where a student picks a degree must not disagree
about which match is best — that is how "Chemistry" put Biochemistry first.

### 17.3 Adding it broke every other driver

`ui:check`, `tree:check` and `shots` all clear localStorage and expect a blank
app. A modal walkthrough now covers that blank app, so all three landed on the
introduction and found none of the controls they were looking for — `ui:check`
crashed reading `.x` of null. They now set `gradtree:onboarded:v1` alongside
clearing storage.

Worth remembering: a first-run experience is invisible to everyone who already
ran the app, including every test harness. Adding one silently invalidates the
setup step of every driver that starts from scratch.

### 17.4 A screenshot is evidence, never a verdict

`capturePage()` threw `UnknownVizError` — a compositor hiccup — and took the
whole run down with it, reporting a crash for a walkthrough that was working.
Screenshots in the checks are now wrapped and failures are logged, not fatal.

## 18. Showcase screenshots — `npm run screenshots` (2026-08-17)

Twenty-one light-mode captures in `screenshots/`, for the website. Run
`npm run build` first; the script regenerates its plans and then drives the
built app.

The boards are not posed. `scripts/makeShotPlans.ts` runs the real planner and
writes the placements the driver seeds, so every course in every image sits
where Sprout put it. Scene 17 is deliberately a plan with a genuine mistake —
Business Management's IBC block split across three terms — so the same-semester
warning can be shown catching something rather than described.

Two things worth keeping in mind if these are ever re-shot:

- **`element.click()` does not work on a React Flow node.** It dispatches on the
  wrapper while the handler sits on a child, and events do not propagate
  downwards — the node never registers it. The first run produced two identical
  images because of this. Use real mouse events at the element's centre.
- **The screenshot itself must never be able to fail the run.** `capturePage()`
  throws `UnknownVizError` occasionally; here it is caught and logged so one
  bad frame does not cost the other twenty.

`screenshots/README.md` indexes every image.
