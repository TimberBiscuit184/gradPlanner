# GradTree

Client-side degree planner for BYU-Idaho. It opens with **no personal data**:
pick your major and minor under **⋯ → Programs** and the requirements,
prerequisite tree and suggestions follow from that. All 2,031 catalogue courses
are searchable from the start, with the terms and half-semester blocks each one
actually runs in.

Built from the fixture data in `data/`. No backend, no auth, no network calls —
see `BUILD_PROMPT.md` for the full spec.

## Run

As a web app:

```
npm install
npm run dev        # Vite dev server on http://localhost:5174
npm run build      # type-check + production build
npm run verify     # runs the BUILD_PROMPT §7 acceptance audit against the engine
npm run audit      # re-checks every course against the live BYU-Idaho catalog
```

As a desktop app (Windows):

```
npm run desktop         # dev server + app window, hot reload
npm run desktop:preview # build, then run the real app from dist/
npm run desktop:build   # installer + portable .exe into dist-desktop/
npm run desktop:clean   # delete the build output when you are done with it
```

Same codebase either way — see **Desktop app** below.

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
  **Every course you have not already finished or scheduled** carries
  **"Soonest you could take it"** in its description — the first term it could
  possibly occupy if you planned its whole prerequisite chain as early as the
  schedule allows — together with **that chain and when each link has to land**:

  > **ECEN 411** — Fall 2028, 5 terms out
  > ECEN 150 ✓F26 → ECEN 250 W27 → ECEN 311 F27 → ECEN 411 F28

  This is the thing `available`/`locked` cannot tell you. **Available** only
  means every prerequisite sits *somewhere* on your timeline — CSE 450 reads
  available purely because DS 250 is registered for Fall — and **locked** only
  means some prerequisite is not planned at all. Neither says how deep a course
  is. ECEN 470 and ECEN 351 are both locked; one is two terms out, the other
  three. If none works it names what to plan first
  instead ("plan ECEN 250, MATH 316, MATH 341 first"), and for a retired course
  it says *never*. It reports the consequence of the plan as it stands rather
  than re-optimising it, so moving a prerequisite earlier moves this with it.
  The panel is **red when the course is at risk and neutral when it is merely
  locked** — a locked course is waiting its turn, not broken.
  **Available** nodes glow amber and pulse; **at-risk** nodes glow red and hold
  still. Colour carries the problem, motion carries the opportunity — so a
  course that is both still reads as at-risk rather than disappearing into the
  amber.
  Columns are prerequisite depth: further right always means more layers deep.
  A prerequisite costs a column, a **corequisite does not** — a course that may
  be taken alongside its dependency draws beside it, not after it.
  Edges are weighted by how much they matter: **solid** = a prerequisite you
  can't avoid, **dashed** = one of several routes in (CSE 450 has four), **teal
  dotted** = corequisite, and anything crossing between sections is drawn faint
  so it doesn't bury the chain you're reading. Clicking a course restores its
  own edges to full strength. Only 53 of 123 edges draw at full weight by
  default.
  The **wheel scrolls** the canvas; **ctrl/⌘ + wheel** (or pinch) zooms, at
  about 1.49× per notch — roughly three times React Flow's default, tunable via
  `ZOOM_SENSITIVITY` in `Tree.tsx`. Zoom is anchored on the pointer.
- **Search** (header) — find a class by code (`math112x`) or title
  (`calculus`); picking a result expands its section and centers the tree on it.
- **Focus filter** (header) — dims everything outside a chosen set, in both the
  tree and the board, always pulling in prerequisite chains so nothing floats
  with its foundation greyed out. Three "what to take" modes — **★ Required
  only** (unavoidable courses, per the derived rule below), **⧗ Bottlenecks
  only**, and **◦ Still to plan** (required work not yet completed, registered
  or on the board) — plus the four emphasis areas. A count beside the dropdown
  says how many courses matched: under *Still to plan* the board legitimately
  goes dark, because nothing already scheduled is outstanding, and the count
  tells you the rest are waiting in the tree. "Not needed" options are never
  highlighted.
- **Emphasis areas** — the four official ones from the
  four-year plan. Highlights an emphasis's courses *and their prerequisite
  chains*, dulling everything else.
- **Requirements rail** (docked right by default, movable — see **Panels**) — EE major with GE nested inside it (counted
  once), A.I. minor as a sibling. Click any bucket to lens-filter both modes;
  hover a row to expand its course pool into draggable chips. The Insights tab
  holds the marginal-minor-cost chart, critical path, bottlenecks, experiential
  fork, and skills rollup.
- **Semester rail** (bottom) — always present; expands into validity-colored
  drop zones during any drag.

- **Projects mode** (Electrical Engineering only — the write-ups assume ECEN/CSE
  coursework, so the tab is hidden for other programs) — portfolio project ideas for an R&D / medical-devices
  direction, each tied to real courses and sorted by how close your plan is to
  supporting it. These are **authored suggestions, not BYU-Idaho coursework**
  (see `src/data/projects.ts`).

In **tree mode a course is click-to-arm**: the first click selects it and lights
up its connections, and only then can you drag it to a semester. Dragging
anywhere else — including from an unselected course — pans the canvas, so you
can move around the graph without picking classes up by accident. Board cards
drag immediately, as before.

Once a card is armed it carries a **drag to a term** badge and the semester rail
at the bottom lights up — that rail is the only place a dragged course can land
in tree mode. Dragging a card you have *not* armed pans the canvas instead,
which looks similar but drops nothing; that is the trade for being able to move
around the graph without picking courses up by accident.

Drags work everywhere with the keyboard: focus a course, **Enter** to select
(tree only), **Space** to lift, **arrow keys** to move between terms, **Space**
to drop, **Esc** to cancel.

**Click a semester heading on the board** to open the course picker: everything
offered that season, searchable, sorted so what you can actually take now comes
first, then courses you already have, then ones still blocked (with the reason).
Each row ends in chips for the sections that genuinely run — **full**, **1st**,
**2nd**, **online** — and clicking one places the course in that term with that
choice in a single undoable step. A course with no full-semester section, like
CSE 121c, simply has no `full` chip.

**Hover any row to see what it needs first** — the prerequisite and corequisite
expressions, with every course in them ticked or circled against your own
record. ECEN 240 reads `((CSE 121c or ECEN 100) and CSE 111)` with ECEN 100 and
CSE 111 green and CSE 121c open, so you can tell at a glance which branch you
are already on, without opening anything.

**Rows are also draggable.** The chips place a course in the term you opened the
picker from; dragging a row lets you drop it on any other semester — a board
column or the rail at the bottom — without reopening the picker for each one.
Courses that can't legally go anywhere aren't draggable at all.

Rows carry the same guidance markers as the tree: **★** unavoidable, **⧗**
bottleneck, and **↑n** for a gate course that unlocks n others (ECEN 250 shows
**★⧗ ↑9**). The **★⧗ only** button filters to just those — in Spring that
narrows 118 courses to 30. Courses struck as "not needed" are never marked.

★ means *no way around it*, not merely *listed as required*: it covers exact-fit
credit pools, pools with less slack than the course is worth, courses that appear
in every branch of a choice, and options left standing by a retirement. See
DATA_GAPS **I16**.

**A registered term is editable.** Only *completed* terms are read-only — you
can still add and drop during registration, so Fall 2026 has the same **+**
header and its cards carry a **✕** to drop them. Dropping frees the course to be
planned elsewhere and is fully undoable; `student.json` is never written, so
your transcript is untouched either way. Completed courses have no ✕ at all, and
a forged drop key for one is ignored by the engine.

**Retired courses say so.** CIT 160 and ECEN 101 no longer run — absent from
both the 2026-2027 catalog and every 2026 class-schedule term — so they carry no
offered season and nothing can be planned into them. They used to vanish from
the picker entirely, which looked like a bug; searching now surfaces them as
**blocked** with the reason and the replacement ("CSE 110 is the current
equivalent"). Your completed CIT 160 credit still counts as the CSE 111
prerequisite.

**Clicking a course opens its description inside the panel** rather than closing
it: prerequisites, offered terms, blocks, section counts, restrictions and
warnings, with **←** to go back and an **Add to *term*** footer carrying the
same chips. Backing out restores the list exactly as you left it — search text,
requirement filter and all. **Esc** backs out one level, then closes. In course
mode the description sits inline above the term list, since there is only one
course to describe.

The picker opens docked on the **left** by default, so the requirements rail on
the right stays visible — both can be moved anywhere (see **Panels**). **Click any requirement in the rail and the picker narrows to that
pool** — "Math and Science Courses" turns 118 offerings into the 28 that count
toward it, with ★ showing which 7 you cannot skip and which are free choices. A
banner names the active requirement, and *clear* returns to the full list.

The **＋** on any header-search result opens the same picker the other way
round: one course, every future term it runs in, with the same chips and the
same validity checks. Read-only history terms have no picker.

**Select courses…** (header) turns on multi-select: click any courses you want,
set a per-term credit cap, and **Fill my schedule** places them in the earliest
valid terms — pulling in any missing prerequisites automatically.

**Which programs you're doing** is editable under **⋯ → Programs**: remove a
minor, add it back, or reset to what your transcript declares. The requirements
rail renders one section per enrolled program, so dropping the minor simply
leaves the major — and the minor-specific insights hide themselves rather than
reporting numbers for a degree you are not doing. General Education is never
listed separately because it is counted inside the major. Enrollment is part of
your profile, not your plan: it is not undoable and survives *Reset plan*.

The header is a single thin bar holding only what you touch constantly: mode,
search, emphasis, and multi-select. Session actions live behind **⋯** —
*Export plan → JSON*, *Import plan…*, and *Reset plan…* (which clears planned
courses and filters after a confirmation, and never touches your transcript or
registered terms). The **⋯** carries an amber dot whenever you have unsaved
planned courses.

On each planned card, **1st / 2nd** assign a half-semester block (no selection =
full semester) and **online** appears for courses that offer an online section.
The Insights tab has **Plan bottlenecks ASAP** (auto-schedules gate courses at
their earliest valid terms) and **Clear planned** to undo it.

Plans **save to your browser automatically** and come back on reload. Storage is
feature-detected: if the browser blocks it, the app degrades to in-memory and
the **⋯** button carries an amber dot telling you to export. *Export plan →
JSON* / *Import plan…* under **⋯** still give you a portable copy.

**↶ / ↷** in the header undo and redo any change to your plan — drops, moves,
removals, block assignments, auto-fill, and Reset — up to 50 steps.
**Ctrl/⌘+Z** and **Ctrl/⌘+Shift+Z** work too. History is per-session; it does
not survive a reload, but your plan does.

A term over BYU-Idaho's **21-credit recommended maximum** is flagged amber on
the board column and the semester rail, with a note that it needs Student
Records approval. Terms under 12 credits are dimmed as below full-time.

The Insights tab opens with **"Suggested for &lt;term&gt;"** — what to take next
and why. It picks the earliest term you still need to plan (skipping registered
terms, and skipping Flex Track winters until you actually use one), then fills
it toward 15 credits from courses that would be a **legal drop there**, so
prerequisites and offered seasons are respected before anything is proposed.

Ranking, highest first: **on the critical path** (delaying it delays
graduation), **gates other courses** (weighted by direct unlocks, with a bonus
at the same 4-unlock threshold the bottleneck list uses), **scarce** (offered
one season a year, so missing it costs a full cycle), then **required**. Every
pick shows its own reason, so the advice is auditable rather than a black box —
"ECEN 250 · unlocks 9 courses", "CSE 455 · on the critical path · offered only
in Fall". A second pass adds corequisites that only become legal alongside a
pick, which is how ECEN 299 follows ECEN 250.

**Plan all N into &lt;term&gt;** places the set in one undoable step,
**Highlight these** dims everything else in the tree and board, and **Browse**
opens the full picker for that term. Fill a term and the suggestion advances to
the next one on its own.

Below that is your **cumulative GPA**, computed on BYU-Idaho's
published grade points (A 4.0, A- 3.7, B+ 3.4, C+ 2.4 — not the generic 3.3/2.3
scale; UW counts as 0.0, W/I/T/P are excluded) and their retake rule: a retake
**removes** the superseded attempt from your GPA credits. `npm run verify`
asserts the result against a real transcript's own figures — quality points,
GPA credits and cumulative GPA — so the grade scale, the retake rule and every
recorded grade are pinned by one check. That transcript lives in
`data/student.mine.json`, which the app never imports; the shipped record is
blank.

Below that, **"If I average …"** projects that figure forward over everything
you have registered or planned, so it moves as you plan. Upcoming retakes are
called out, since they count double: the new grade adds points *and* the old
one leaves the denominator. The projection assumes a single flat grade across
every remaining course — a sensitivity check, not a forecast.

## Panels

The requirements rail, the course description and the add-course picker are
**movable windows**. Drag any panel by its title bar; as you near an edge a
translucent target appears showing exactly where it will land, and releasing
snaps it there — left, right, top, bottom, any corner, or the top centre to
cover the whole workspace. Release in open space and it simply stays where you
dropped it.

**Docking to an edge gives the panel room rather than taking it from you**: the
board and tree shrink to fit, so a docked rail and a docked picker leave the
board visible between them instead of burying it. Corner snaps and *cover
everything* float on top instead — a quarter-panel is a glance, not a
workspace.

Drag any inner edge to resize — the same handle works docked or floating, and
undocking returns a panel to the size you last gave it. The **⛶** button in
each title bar opens a 3×3 position grid if you would rather click than drag,
double-clicking the title bar toggles between docked and floating, and clicking
a panel brings it to the front. Layout is remembered between sessions;
**Reset panel layout** under **⋯** puts everything back.

Layout is deliberately *not* part of your plan: moving a window never enters the
undo stack, never rides along in an exported plan file, and survives *Reset
plan*.

The picker no longer closes when you click outside it — dock it beside the
board and it stays there while you work. **Esc** still closes it (and backs out
of a course description first).

## Desktop app

The simplest way in — a desktop icon you double-click:

```
npm run shortcut
```

That builds the app and puts **GradTree** on your desktop, with its own icon and
no console window. Drag it wherever you like; it keeps working as long as this
project folder stays put. Because it runs the built app, re-run `npm run
shortcut` after changing the source.

### Installers

`npm run desktop:build` produces two things in `dist-desktop/`:

- **GradTree Setup 0.1.0.exe** — an installer. Run it once and GradTree lands in
  your Start menu with its own icon, like any other program.
- **GradTree 0.1.0.exe** — portable. Double-click it and the app opens; nothing
  is installed, and you can keep it on a USB stick.

Neither needs Node, a terminal, or a dev server. `npm run desktop` is for
working *on* the app (hot reload, dev server on port 5175);
`npm run desktop:preview` runs the real thing without packaging it.

**A warning about antivirus.** Freshly built, unsigned Electron apps are a
common false positive. On this machine Bitdefender quarantines them: the build
reports success and then `GradTree.exe` and both installers quietly disappear,
which looks exactly like "the app won't open". If that happens, either restore
them from your antivirus's quarantine and exclude this project folder from
real-time scanning, or just use `npm run shortcut`, which never creates a new
executable for a scanner to object to.

If the build says `dist-desktop/` is locked and it is using `dist-desktop-2/`
instead, that is the same scanner still holding the last build's files — the new
folder is a complete build. `npm run desktop:clean` clears the leftovers once it
lets go.

The desktop build is the same app with a native window around it:

- The header **is** the title bar — drag it to move the window, with the real
  Windows minimise/maximise/close buttons drawn at the right.
- Window size, position and maximised state come back where you left them.
- **It works with no network at all.** Fonts are bundled rather than fetched, no
  asset loads from a CDN, and a content-security policy enforces it. Any link
  that would leave the app opens in your normal browser instead.
- **Everything saves as you work, automatically.** There is no save button and
  nothing to remember: every course you place, move or drop is written the
  instant you do it, and it is all there when you reopen the app.
- It is saved in **two places at once**. Alongside the app's own storage, a plain
  `plan.json` is kept next to it — so even if the app's storage is ever reset,
  your plan comes back from the file. **⋯ → Show saved plan file** opens the
  folder if you want to copy or back it up yourself.
- The desktop and browser versions keep **separate** plans, since each has its
  own storage. *Export plan → JSON* moves one to the other.

## Data honesty

Every place the app runs on unsure, missing, or placeholder data is logged in
[`DATA_GAPS.md`](./DATA_GAPS.md) with stable IDs (U* unsure, M* missing,
P* placeholder, I* interpretation calls). Warnings built on inferred prereq
edges render dashed with "(unconfirmed prerequisite)"; courses with default
term lists never raise "not offered" errors; block availability is always
labeled unknown because no source data exists.

**Offered terms, half-semester blocks and online availability** are real data as
of 2026-08-06, scraped from the public class schedule across Winter, Spring and
Fall 2026 — one full seasonal cycle, 5,139 sections. 129 of 133 courses have
confirmed terms and blocks (up from 36 and 0). Fifteen courses had the wrong
seasons; notably **ECEN 311 and ECEN 470 are not Winter-only** as the fixture
claimed, so neither forces an off-track Winter, and **CSE 121c has no
full-semester section** at all. The four courses the schedule never listed keep
the neutral "unconfirmed" notice rather than a guess.

Prerequisites and corequisites were re-audited against the live BYU-Idaho
catalog on **2026-08-06**, correcting 62 courses — the earlier import had read
only one of the six field names the API uses for requisite rules, and the gaps
had been filled by inference (DATA_GAPS **U9**/**U10**). `npm run audit` now
re-runs that comparison against every field and fails on drift; it currently
reports 131 of 131 courses matching. Each course carries `prereqCheckedOn`, and
the detail panel shows enrollment restrictions the catalog states outside the
requisite rules — including that **EE majors can only take BUS 301 online**.
