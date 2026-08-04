# Build: GradTree

A degree-planning web app for one BYU-Idaho electrical engineering student. It replaces the
university's I-Plan Grad Planner, which is server-round-trip slow and cannot show what a
course leads to.

Everything runs client-side against fixture data in `data/`. No backend, no auth, no network.

---

## 0. Ship order

Build in this order. If you run out of room, stop at a clean boundary — a working Phase 2 is
worth more than four half-features.

| Phase | Scope | Done when |
|---|---|---|
| **1** | Data layer, prereq evaluator, requirement engine | The audit numbers in §7 come out right |
| **2** | Skill tree with node states + downstream highlight | Tree renders, click shows subtree |
| **3** | Semester board, drag-and-drop, live credits, warnings | Invalid drop is blocked with a reason |
| **4** | Requirement lens, insight panel | Bucket click filters tree |

---

## 1. Data

```
data/
  courses.json                              136 courses
  student.json                              real transcript + registration
  programs/ee-bs-2024.json                  EE major (catalog UG24)
  programs/ai-engineering-minor-2026.json   AI minor
  programs/ge-abet.json                     General Education (27-28 cr)
```

Import these as static JSON. Do not fetch them. Do not modify them at runtime.

### Prerequisite expressions

```ts
type PrereqNode =
  | string                              // course id
  | { and: PrereqNode[] }
  | { or:  PrereqNode[] }
  | null                                // no prerequisite
```

### Requirement rules

Every bucket has exactly one `rule`. Buckets nest via `groups` (never any other key).

| `rule.type` | Meaning |
|---|---|
| `allOf` | every course in `pool` |
| `nOf` | any `n` courses from `pool` |
| `nCredits` | any combination from `pool` totalling `n` credits |
| `allOfGroups` | every child in `groups` must be satisfied |
| `nOfGroups` | any `n` children in `groups` |
| `fillTo` | any university course, until total plan credits reach `n` |
| `programRef` | satisfied by completing another program entirely (see below) |

### Program composition

Three programs load, not two. `student.json` declares `major`, `minor`, and
`generalEducation`; resolve each to its file in `programs/`.

They are **not** siblings. The EE major's `gen-ed` bucket has
`rule: { type: "programRef", programId: "ge-abet" }` — General Education is *nested inside*
the major, and its 27–28 credits are counted once, by evaluating the `ge-abet` program.
Do not also treat `ge-abet` as a top-level program with its own credit total, or GE gets
double counted and the plan reads ~27 credits too high.

The AI minor **is** a sibling: its own progress bar, its own total, and courses freely
double count against the major per `doubleCountsWith`.

`credits` and `totalCredits` are **always** `{ min: number, max: number }`.

Two fields need special handling:

- **`sharedPoolId`** — this bucket draws from another bucket's pool. The only instance is
  Experiential Learning Option 2, which shares the `supplemental` pool with
  `allowDoubleCount: false`. A course used for one cannot count for the other.
- **`isPlaceholder: true`** on a course — a generic slot, not a real course.
  `GE_PLACEHOLDER` is the only one. Placeholder cards can be dropped on the board multiple
  times, have no prerequisites, and never trigger warnings.

---

## 2. Definitions

These are the semantics. Get them wrong and every warning in the app is wrong.

### Course state

Derived from `student.json`, in this precedence order:

1. **`completed`** — a term entry with `state: "completed"` **and** a grade of C- or better
   (`minGrade` on the program). Grade order: `A+ A A- B+ B B- C+ C C-` pass; `D+ D D- F UW` fail.
2. **`failed`** — attempted, grade below the threshold. Earns no credit, satisfies nothing.
3. **`in-progress`** — currently enrolled, grade not yet posted.
4. **`registered`** — enrolled for a future term.
5. **`planned`** — placed on the board by the user, not registered.
6. **`available`** — not planned, but prerequisites are satisfiable by the current term.
7. **`locked`** — not planned, prerequisites not satisfiable.

### Prerequisite satisfaction

A prereq for a course in term *T* is satisfied when the prereq course sits in a term
**strictly before** *T* and is in state `completed`, `in-progress`, `registered`, or `planned`.
Optimistic by design — this is a planning tool, and treating an in-progress course as a
future failure makes the app useless.

A **corequisite** is satisfied when the coreq course sits in a term **before or equal to** *T*.

### Retakes

A course can appear in multiple terms. Rules:

- Credits count **once**, from the attempt with the highest passing grade.
- An entry with `countsForCredit: false` contributes 0 credits but still occupies a schedule slot.
- A failed attempt followed by a later attempt: the later attempt determines state.
- Applies to PH 121, MATH 112X, and ENG 150 in the fixture data. All three must render correctly.

### Node states (the visual vocabulary)

| State | Trigger | Treatment |
|---|---|---|
| `locked` | prereqs unsatisfiable | 40% opacity, no border emphasis |
| `available` | prereqs satisfiable, not planned | rim glow, slow pulse |
| `planned` | on the board | solid fill, shows term chip |
| `in-progress` | currently enrolled | solid fill, distinct hue from planned |
| `completed` | earned, C- or better | solid fill, check mark |
| `at-risk` | see below | 2px border, warning hue |

**`at-risk` fires when any of:**
- the course is placed in a term where `terms` says it is not offered
- a prerequisite is unsatisfied or in a later term
- the course is Winter-only and the student's `track` excludes Winter
- a completed attempt is below `minGrade` and no retake is planned

### Unlock count

**Direct children only** — courses whose prereq expression names this course. Displayed on
the node. Compute transitive descendants separately for the downstream-highlight interaction,
but never put the transitive number on a node; MATH 112X reads 28 transitively and 3 directly,
and 28 is meaningless as a node label.

### Two confidence flags — both must surface in the UI

**`verified: false`** (32 courses) — the prerequisite edge is inferred, not read from a
source. Render any warning derived from such an edge with a **dashed** border and the tooltip
suffix "(unconfirmed prerequisite)". Never suppress it, never present it as certain.

**`blocksConfirmed: false`** (all 136 courses) — `blocks` is `null` everywhere. No source for
first-block / second-block availability has been transcribed. **Build the block UI, but drive
it from data that is currently empty**: render the half-height block rows in each term, allow a
course to be assigned `1st` / `2nd` / `full` manually by the user, and show
"block availability unknown — check the class schedule" on every card. Do not invent block data
and do not skip the feature; it is one of the reasons this app exists.

**`termsConfirmed: false`** (100 courses) — the `terms` array is a default of `["F","W","S"]`,
not a source reading. The app must **not** raise a "not offered this term" error for these
courses. Instead show a small neutral notice on the card and in the course detail panel:

> Offered terms unconfirmed — check the class schedule before registering.

This is the difference between a tool that is wrong and a tool that admits what it does not
know. A confident false negative here ("this course isn't offered in Fall") would send the
user to the wrong semester. Get it right.

Courses carrying `prereqSource` cite where their edge came from. Show it in the detail panel.

---

## 3. Term generation

`student.json` supplies three real terms. Generate the rest.

- Term ids are `{YEAR}{F|W|S}`. Order within a year: **Winter → Spring → Fall**.
- Generate from `2026F` through `2031F` inclusive.
- The student's `track.pattern` is `spring-fall`. Winter terms render **dimmed and collapsed**
  with an "off-track" label. They are droppable, but any course dropped there raises an
  `at-risk` info-level flag rather than an error.
- Real terms from `student.json` are **read-only**. Their cards cannot be moved or removed.
  This is history, not a plan.

---

## 4. Layout

Two environments, one route, toggled by a segmented control in the header.

**Board mode (default).** Flat, dense, high contrast on a dark neutral background. No glow,
no gradients. Left: term columns with course cards and per-term credit totals. Right: the
requirements rail, resizable, collapsible, with a focus toggle that expands it to a half-screen
split. This is the mode the user lives in.

**Tree mode.** Full-screen graph on a dark background. Atmospheric, glowing `available` nodes,
dimmed `locked` nodes. This is the mode the user explores in.

**Semester rail.** Persistent across both modes, along the bottom. Collapsed by default,
showing term chips with live credit counts (`Fall 26 · 14 cr`). On drag start it expands into
drop zones, each colored by whether *this specific course* is valid in *that specific term*.
Validity is evaluated before the drop, not after.

---

## 5. Interaction

**Drag-and-drop: use `dnd-kit`, not React Flow's built-in node dragging.** React Flow nodes
drag within their own canvas and cannot cross into the semester rail. Wrap both the tree and
the board in a single `DndContext` so one drag gesture works everywhere. React Flow is for
layout and rendering only — set `nodesDraggable={false}`.

**Every drag must be keyboard-operable.** `dnd-kit`'s keyboard sensor plus visible focus rings.
Space to lift, arrows to move, space to drop, escape to cancel.

**Requirement lens.** Clicking a bucket in the requirements rail sets a filter. In tree mode
everything outside that bucket's pool drops to 15% opacity. In board mode, cards outside the
pool desaturate. The bucket's progress counter updates live while a course is mid-drag.

**Downstream highlight.** Clicking a tree node highlights its full transitive descendant set
and dims everything else. A "what breaks if I drop this?" button re-renders that same subtree
in the warning hue.

---

## 6. Insight panel

This is what the official planner cannot do, so it is not optional. A panel in the
requirements rail computing, live:

1. **Marginal cost of the minor.** Credits in the AI minor not already required by the EE
   major, accounting for `doubleCountsWith`. Expected: **8 credits** — DS 250 (2), DS 460 (3),
   CSE 455 (3) — of which DS 250 is already registered for Fall 2026. The other seven minor
   courses (CSE 110/111/210/212, MATH 112X, MATH 341, CSE 450) are EE requirements already.
   Render this as a two-colour dependency chart, not a number.
2. **Critical path.** The longest prerequisite chain that is not yet complete, with the
   earliest term it can finish given the track. Render as a horizontal strip.
3. **Bottlenecks.** Any unplanned course where `terms.length === 1`, or whose direct-unlock
   count is 4 or more. Flag inline on the node and list here.
4. **Career mapping — build the shell, not the content.** 28 of 136 courses carry a `skills`
   array; the rest are empty. Render a skills panel on the course detail view and a
   "skills you'll have by term N" rollup, both driven by that field, degrading gracefully to
   "not yet tagged." Do **not** call the O*NET or CareerOneStop APIs, invent occupation
   mappings, or hard-code job titles — that data is not in the fixture set and a fabricated
   course-to-career mapping is worse than none. The join is course → skill → occupation;
   only the first hop exists today.
5. **Slack.** For each `nCredits` bucket, `poolCredits − requiredCredits`. Math & Science
   core is 21 in a 20-credit requirement, so it reports 1 — surface that number, it is
   invisible in the catalog.
6. **Experiential fork.** Internship = 4 supplemental electives. No internship = ECEN 397 +
   6 supplemental electives. Show both totals against the 9 electives reachable on a
   spring/fall track.

---

## 7. Acceptance criteria

Testable. These numbers come from the fixture data.

- [ ] `student.json` loads with **4 completed courses, 11 earned credits**
      (CIT 160, ECON 150, PH 121, REL 333 — ENG 150 F and MATH 112X UW are excluded)
- [ ] Spring 2026 shows **5 courses, 12 credits, in-progress**
- [ ] Fall 2026 shows **6 courses**, **11 credits counting toward the degree**
      (PH 121 is a retake with `countsForCredit: false`)
- [ ] Core Engineering shows **3 of 12** touched: CSE 111, ECEN 150, ECEN 240
- [ ] MATH 112X node shows **unlock count 3**, not 28
- [ ] ECEN 470 renders `at-risk` — Winter-only against a spring/fall track
- [ ] Dragging ECEN 350 into any term before ECEN 250 is refused, with the reason shown
- [ ] Dragging ECEN 240 anywhere shows a **dashed** warning border (`verified: false`)
- [ ] BIO 180 shows the "offered terms unconfirmed" notice and raises **no** term error
- [ ] CSE 450 resolves its `or` prerequisite: satisfied by DS 250 **or** CSE 310, not both
- [ ] EE total renders as the range **109–120**, not a single number
- [ ] Every drag completable by keyboard alone
- [ ] Terms from `student.json` cannot be edited
- [ ] Total plan credits do **not** double count GE (the `programRef` path is taken once)
- [ ] Every course card shows the block-availability notice; no card claims a block it has no data for

---

## 8. Stack

React 18 + TypeScript + Vite + Tailwind. `@xyflow/react` with `dagre` for tree layout.
`dnd-kit` for all dragging. Zustand for state.

**Persistence:** in-memory only. Do not use `localStorage` or `sessionStorage` — they are
unavailable in the target sandbox and will throw. Provide an **Export plan → JSON** button and
an **Import** file input so work survives a reload. Say so in the UI: "Plans are not saved
automatically — export before closing."

---

## 9. Non-goals

Do not build: user accounts, a second major, course search against a live catalog, mobile
layouts below 1024px (desktop only), PDF export, or anything that writes to `data/`.

Do not invent course data. If something is missing, render it as a placeholder and surface the
gap in the UI rather than filling it with a plausible guess — the entire value of this tool is
that its warnings are trustworthy.
