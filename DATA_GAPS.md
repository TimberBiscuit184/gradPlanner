# DATA_GAPS — the honesty log

Running log of every place the app is built on data that is **(1) unsure, (2) missing, or
(3) a placeholder**, kept so the kinks can be addressed cleanly later. Updated as the build
progresses. Item IDs are stable — reference them when resolving.

Legend: 🟡 unsure · 🔴 missing · 🔵 placeholder · ⚖️ interpretation call made during the build

---

## 1. Unsure (data exists but is not trusted)

- ~~**U1** Inferred prerequisite edges — 32 courses.~~ **RESOLVED 2026-07-27:** all 33
  unverified edges were replaced with the real rules from the live BYU-Idaho 2026-2027
  catalog (see **S2**). **Zero `verified: false` courses remain**, so no dashed
  "(unconfirmed prerequisite)" warnings are left in the app. Two were materially wrong:
  - **ECEN 240** had an inferred `CSE 111` prereq; the catalog lists **no prerequisite**.
  - **ECEN 260** was `CSE 121c AND ECEN 240`; it is really
    `(CSE 121c OR ECEN 100) AND ECEN 240 AND CSE 111`.
- **U2 🟡 Offered-terms defaults — 100 courses.** `termsConfirmed: false` with a default
  `["F","W","S"]`. The app never raises "not offered this term" for these; it shows the
  neutral "offered terms unconfirmed" notice instead. Only 36 courses have confirmed terms.
  **This is now the single largest data gap** — the catalog API exposes prerequisites but
  not term availability, which lives in the class schedule.
- **U3 🟡→✅ GE Social Science pool — largely verified 2026-07-27.** The supplied four-year
  completion plan PDF lists the Social Science options and confirms CIVIC150 / ECON150 /
  ECON151 (ECON 150, completed C+, counts). Remaining wrinkle: ge-abet.json also contains
  BYUI151 and BYUI152, which the PDF's list does not mention — likely catalog-only options,
  but unverified.
- **U4 🟡 Double-count set for the AI minor is advisor-unconfirmed.** The minor JSON's
  `doubleCountsWith._note` says only CSE 111, CSE 210, and MATH 112X were literally flagged
  DOUBLE COUNTED in I-Plan; the rest of the list is extrapolated. This determines the true
  marginal cost of the minor.
- **U5 🟡 Marginal-cost figure disagrees between sources.** BUILD_PROMPT §6 expects
  **8 credits** (DS 250 + DS 460 + CSE 455); ai-minor JSON `marginalCredits` estimates
  **11–12** ("confidence: low") because it treats MATH 341 as net-new. The build follows the
  prompt's 8: MATH 341 sits in the EE Math & Science elective pool, so it double counts —
  but only if the student actually uses it for that EE slot. The insight panel states this
  condition rather than hiding it.
- ~~**U7** CSE 111 in progress with no CSE 110 on the transcript.~~ **RESOLVED 2026-07-27:**
  user confirmed CIT 160 is an accepted alternative prerequisite for CSE 111. courses.json
  updated (`prereq: CSE110 or CIT160`, with `prereqSource`). Note the four-year-plan PDF also
  documents a CSE 110 test-out path after ECEN 100 — CSE 110 itself (A.I. minor Core A) is
  still unsatisfied unless that test-out is used.
- **U8 🟡 CYBER 240 is not in the course fixture.** The four-year-plan PDF allows CYBER 240
  in place of ECEN 430 for the Signals & Communications emphasis; courses.json has no
  CYBER 240 entry, so the emphasis filter can only show the ECEN 430 route.
- **U6 🟡 Winter-only reachability.** student.json note: Winter-only courses (ECEN 311, 351,
  451, 461, 470, 480) are "only reachable via an off-track Winter or an online section" — but
  courses.json marks all six `online: false`. If online sections exist, the data doesn't
  show them.

## 2. Missing (no source data at all)

- **M1 🔴 Block availability — all 136 courses.** `blocksConfirmed: false` everywhere; no
  first-block/second-block data was ever transcribed. The block UI exists but is driven by
  manual user assignment only; every card carries "block availability unknown — check the
  class schedule." *Discrepancy vs. prompt:* the prompt says `blocks` is `null` everywhere,
  but 7 courses (BYUI101, CSE 110/111/121c/210/212, GS102R) carry `["full","1st","2nd"]`.
  Since all are unconfirmed, the app ignores these values.
  *2026-07-27:* the explicit "full" button was removed (no selection = full semester) and
  an **online** toggle was added for the 72 courses with `online: true`. Note `online` is a
  course-level flag with no per-term confirmation — an online section may not exist every
  semester.
- **M2 🔴 Course → career mapping.** Only the first hop (course → skill) exists, on 28 of
  136 courses. The skills panel degrades to "not yet tagged" for the rest; no occupation
  data is invented.
  *2026-07-28:* the **Projects tab** (`src/data/projects.ts`, 12 entries) is the closest
  thing to a career bridge, and it is **authored content, not sourced data** — written for
  a stated R&D / medical-devices direction. Every `courses` reference is a real course id
  (checked by `npm run verify`), and readiness is computed from the live plan, but the
  project ideas, hiring rationale, and regulatory notes are editorial and carry an
  on-screen disclaimer. They are not BYU-Idaho coursework and imply no employer
  endorsement. If the career direction changes, this file is the only thing to rewrite.
- **M3 🔴 `data/schema/course.schema.json`.** courses.json's `$schema` points to a file
  that was never supplied. Harmless (nothing validates against it), but noted.
- **M4 🔴 Winter/Fall 2024–2025 history.** The transcript jumps from Fall 2023 to
  Spring 2026. Presumably a gap (mission/break) — the app renders no terms between, but if
  any credits were earned elsewhere in that window, they are not in the data.
- ~~**M5** Grades for Spring 2026.~~ **RESOLVED 2026-07-27 (user-asserted):** all five
  Spring 2026 courses recorded as A per the user, three days ahead of the official
  2026-07-30 posting. student.json updated (`_note` marks the assertion). Cross-check the
  transcript once grades officially post.

## 3. Placeholders

- **P1 🔵 `GE_PLACEHOLDER`** (3 cr) — generic GE slot; droppable multiple times, no
  prereqs, never warns.
- **P2 🔵 `REL_ELECTIVE`** (2 cr) — "any other REL course" for Cornerstone electives.
  *Discrepancy vs. prompt:* BUILD_PROMPT §1 claims GE_PLACEHOLDER is the only placeholder;
  the data has three. All are treated by the same placeholder rules.
- **P3 🔵 `FOREIGN_LANG`** (4 cr) — the Arts & Humanities language option.
- **P4 🔵 BIO/GEOL/CHEM science-elective stubs.** Most ms-elective pool courses are marked
  "Stub. Credits from the catalog requirements page; terms offered NOT confirmed."

## 3.5 New sources

- **S2 🌐 BYU-Idaho live catalog API** (`byui.kuali.co/api/v1/catalog/...`, catalog id
  `68dc4d77c3ad086d83653f48`), queried 2026-07-27. Source for **33 real prerequisite
  rules** that replaced every inferred edge. Courses updated: BIO 180/180L/181/181L/221/
  222/240/264/264L, CHEM 106/106L, GEOL 111/111L/112/404/435, MATH 109/110X/111/113/214/
  411/423, PH 150/250, CSE 280/310/455, ECEN 240/260/311, ME 310, MATH 330. Each carries
  `prereqSource`. Re-runnable if the catalog changes.
  - **Placement-test prereqs are outside the fixture model**: MATH 109/110X/111 really
    depend on MATH 101 or an ACT/SAT/ALEKS score, so they are stored with no edge and a
    note. Same for the CHEM 106 ALEKS≥70 waiver.
  - Retired courses referenced by catalog rules but absent from the fixture (CS 101,
    CS 124, CS 165, CS 241, ME 305, MATH 221A–D) are recorded in notes only.
- **S1 📄 `data/ee-four-year-completion-plan-2026-2027.pdf`** (added 2026-07-27, from the
  user). Source for: the four **emphasis areas** (Power & Energy Systems; Signals &
  Communications; R.F. Microelectronics & Semiconductors; Control Systems & Automation)
  now in `src/data/emphases.ts`; GE Social Science pool confirmation (U3); the CSE 110
  test-out note; internship guidance ("can be during an on-track or off-track semester").

## 4. Interpretation calls made during the build

- **I1 ⚖️ REL 333 grade D counts as completed.** BUILD_PROMPT §2 says D fails — but §7
  requires REL 333 among the 4 completed courses (11 credits). Resolution: the C- threshold
  is `minGrade` **per program**; ge-abet's `minGrade` is `null`, so GE courses pass on any
  credit-earning grade. EE major courses still require C-.
- **I2 ⚖️ `state: "withdrawn"` (MATH 112X, UW, Fall 2023)** is not in the prompt's state
  list. Treated as a failed attempt: no credit, satisfies nothing, superseded by the
  Spring 2026 retake.
- **I3 ⚖️ CIT 160 and GS102R match no requirement bucket** in any of the three programs
  (GS102R ≠ GS100). Both count only toward the 120-credit `fillTo` bucket (Unspecified
  Electives). If GS102R is actually meant to satisfy First Semester GE, the data doesn't
  say so.
- **I4 ⚖️ 2026F is both a real (registered, read-only) term and inside the generated range**
  2026F–2031F. The real term wins; generation starts at 2027W.
- **I12 ⚖️ Tree columns come from *global* prerequisite depth (0–6), not per-cluster rank.**
  Dagre ranked only within each cluster, so an advanced elective whose prerequisite lived in
  another cluster (ECEN 351, prereq ECEN 340) was drawn in the leftmost column and read as
  entry-level. Horizontal position is now `depth × 258px` everywhere, so further right
  always means more prerequisites deep; vertical order within a column uses a barycenter
  pass to keep the connecting lines short.
- **I11 ⚖️ Tree layout is clustered by requirement area, not one global graph.** A single
  dagre run interleaved unrelated chains — ENG 150 sat ~520px from ENG 301 purely because
  both landed at crowded ranks. Each cluster (core / supplemental / math-science / minor /
  GE) now gets its own dagre pass. Cross-cluster prerequisite edges still render and are
  simply longer; the only ones are GEOL 404/435 → BUS 301/ENG 301 and GEOL 435 → MATH 112X.
- **I9 ⚖️ "Not needed" pruning.** When an `nOfGroups` quota is already met, the unchosen
  option branches are struck through in the rail and dotted-out in the tree. Current set:
  **MATH 109, MATH 110X, MATH 111** (Foundational Math options 2 and 3, moot now that
  Calculus I is complete) and **CSE 121c, ECEN 101** (Introduction option 2 — ECEN 101 is
  retired anyway). A course is only pruned if no *other* live bucket still needs it and it
  is not already on your plan.
- **I10 ⚖️ MATH 112X direct unlocks moved 3 → 6** once real catalog prereqs landed
  (MATH 113, CHEM 106, GEOL 435 also depend on it). The original spec's "3" reflected the
  incomplete fixture data.
- **I7 ⚖️ Winter = "Flex Track", fully editable (user-directed 2026-07-27).** Overrides the
  original spec's off-track treatment: winter terms are normal drop targets, the
  winter-only at-risk warning is downgraded to an info note ("schedule it in a Flex Track
  semester"), and the critical path may route through winters. ECEN 470 is therefore no
  longer rendered at-risk.
- **I8 ⚖️ "Plan bottlenecks ASAP" scope.** Places gate courses (4+ direct unlocks) plus up
  to three single-term supplemental electives at their earliest valid terms (16 cr/term
  cap), with prereq chains. The fourth supplemental slot is deliberately left for CSE 450,
  which the A.I. minor requires and which double-counts. It does not place all eleven
  single-term courses — most are electives the degree doesn't need.
- **I6 ⚖️ MATH 112X transitive descendants compute to 26, not the prompt's 28.** The
  downstream walk follows prereq + coreq edges over the 136-course fixture. The prompt's 28
  was illustrative (its point — never label a node with the transitive number — is honored);
  if 28 is authoritative, two dependency edges are missing from courses.json.
- **I5 ⚖️ "Available" state** = every prereq is completed, in-progress, registered, or
  planned somewhere on the timeline (optimistic, per §2). "Locked" = at least one prereq
  chain has no such placement.
