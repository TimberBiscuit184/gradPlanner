# DATA_GAPS — the honesty log

Running log of every place the app is built on data that is **(1) unsure, (2) missing, or
(3) a placeholder**, kept so the kinks can be addressed cleanly later. Updated as the build
progresses. Item IDs are stable — reference them when resolving.

Legend: 🟡 unsure · 🔴 missing · 🔵 placeholder · ⚖️ interpretation call made during the build

---

## 1. Unsure (data exists but is not trusted)

- ~~**U1** Inferred prerequisite edges — 32 courses.~~ **RESOLVED 2026-07-27**, then
  **found to be wrong and re-resolved 2026-08-06** — see **U9**.
- **U9 🔴→✅ The 2026-07-27 catalog import was itself unreliable. Fixed 2026-08-06.**
  That import read only the `preRequisites` field. The Kuali API is inconsistent: most
  course records state their rule in **`prerequisites`** (lowercase) and about a dozen
  state it entirely in **`coRequisites`**. Reading one field silently returned "no
  prerequisite" for ~20 courses; those gaps were then filled by inference and stamped
  `verified: true` with a `prereqSource`. Because `validateDrop` hard-blocks on
  `verified: true`, **wrong data was being enforced with maximum confidence** while U1
  above declared the problem solved.
  A full re-audit against the same catalog (`npm run audit`, which now reads *every*
  requisite field) corrected 62 courses. The prerequisite edits that change the plan:
  | Course | was | catalog |
  |---|---|---|
  | ECEN 380 | MATH 316 | **ECEN 250** |
  | ECEN 480 | ECEN 380 | **ECEN 250** |
  | ECEN 430 | ECEN 390 | **ECEN 250** |
  | ECEN 420 | ECEN 390 | **ECEN 350** |
  | ECEN 351 | ECEN 340 | **ECEN 350** |
  | ECEN 324 | CSE 212 + ECEN 240 | CSE 212 + **ECEN 260** |
  | ECEN 390 | MATH 316 + PH 220 | **ECEN 250** + MATH 316 |
  | ECEN 470 | ECEN 380 | (ECEN 250 or ME 305) and (MATH 316 or MATH 341) |
  | ECEN 499 | ECEN 340 + ECEN 350 | **1 of ECEN 398R / ECEN 397** + instructor auth |
  | ECEN 398R | none | **ECEN 260 + ECEN 250** |
  | ECEN 490R | ECEN 420 | none (instructor auth) |
  | ECEN 150 | coreq MATH 112X | MATH 112X is a **prerequisite** |
  | PH 220 | PH 123 | **PH 121** only, coreq (MATH 113 or MATH 215) |
  | MATH 316 | MATH 215 | MATH 214 **or** MATH 215 |
  | CSE 450 | DS 250 or CSE 310 | 4 paths (see courses.json) |
  | DS 350 | DS 250 | CSE 111 **and** DS 250 |
  | DS 250 | CSE 111 | CSE 110 **or** PH 135 **or** CSE 111 |
  | DS 460 | DS250 + (DS350 or CSE450) | + ITM 327 as a third alternative |
  | ENG 217 | none | **ENG 150** |
  | MATH 119 | none | (MATH 109 or 110X) and (CHEM 105 or DS 250 or DS 350) |

  Effect on the analysis: **ECEN 250 went from 4 direct unlocks to 9** — it is the real
  gate course — while ECEN 340, ECEN 380 and ECEN 390 unlock **nothing** (the app used
  to mark them as gates). The critical path, the ⧗ bottleneck markers and "Plan
  bottlenecks ASAP" were all steering toward the wrong courses.

  `verified: true` now means "compared field-by-field against the live catalog and
  matches", with `prereqCheckedOn` recording the date. **Re-run `npm run audit` after any
  catalog change** — it fails on drift and prints the catalog's own wording.
- **U10 🟡 Corequisites were being enforced as prerequisites.** The catalog states ~12
  rules as "completed **or concurrently enrolled** in", and the pre-audit fixture either
  dropped them or turned them into hard prereqs — so the app refused legal same-semester
  pairings: ECEN 250 + ECEN 299, ECEN 240 + CSE 111, CSE 121c + CSE 111, CHEM 106 +
  CHEM 106L, GEOL 111 + 111L, BIO 181 + 181L, BIO 221 + BIO 222, PH 220 + MATH 113,
  PH 250 + PH 220, PH 123 + MATH 112X. Each cost a semester of separation in the
  generated plan. `Course.coreq` is now the same recursive boolean expression as
  `prereq` (several corequisites are OR-shaped, e.g. PH 220's is MATH 113 *or* MATH 215),
  and `checkPrereqAt` evaluates it with before-or-equal term comparison.
- **U11 🟡 Alternatives the catalog names that this fixture deliberately does not model.**
  Recorded in `scripts/auditCatalog.ts` under `ACKNOWLEDGED`, each with a reason, so the
  audit stays a clean pass/fail signal: MATH 101 and all placement-test paths
  (ACT/SAT/ALEKS/TOEFL/IELTS/Write Class), ME 305 (ECEN 470, ME 310), PH 223 (PH 250),
  MATH 325 (DS 350), ITM 327 (DS 460), MATH 221A–D (MATH 423), ENG 106/106L/109
  (ENG 150), and the MUSIC 130/155/160/172 series (MUSIC 102, which EE majors cannot
  take at all). Each is also noted on the course record itself, so the reason shows in
  the detail panel rather than only in this file.
- ~~**U2** Offered-terms defaults — 100 courses.~~ **RESOLVED 2026-08-06 from the public
  class schedule.** Every section of all 33 relevant subjects was read for Winter 2026,
  Spring 2026 and Fall 2026 — one complete seasonal cycle, and the entire window the
  schedule exposes. 5,139 sections. **termsConfirmed went from 36 to 129 of 133.**
  Evidence in `data/schedule-2026.json`; each course carries `scheduleSource`,
  `scheduleCheckedOn` and `sectionCounts`.

  Fifteen courses had the wrong seasons. The ones that change planning:
  | Course | fixture | actual |
  |---|---|---|
  | ECEN 311 | W only | **F, W** |
  | ECEN 470 | W only | **F, W** |
  | ECEN 490R | S only | **F, W, S** |
  | ECEN 361 | F, W | **F, W, S** |
  | ME 310 | F only | **F, W, S** |
  | ECEN 430 | F, S | **S only** |
  | ECEN 100 | F, W, S | **F, S** |
  | CSE 455 | F, W, S | **F only** |
  | MATH 411 | F, W, S | **F only** |
  | MATH 423 | F, W, S | **F, S** |
  | ME 410 | F only | **S only** |
  | GEOL 404 | F, W, S | **W only** |
  | GEOL 435 | F, W, S | **F only** |
  | GEOL 112 | F, W, S | **F, W** |
  | GEINT 213 / 215 | F, W, S | **W only** |

  **The "Winter-only" claim in student.json was wrong about two of six.** ECEN 311 and
  ECEN 470 both run in Fall, so neither needs an off-track Winter. The genuine Winter-only
  set is **ECEN 351, 451, 461, 480**. Corrected there and in the Flex Track note.
- **U14 🟡 One cycle of schedule evidence, not a rotation history.** The class schedule only
  exposes three terms at a time, so a course seen in Fall alone is either Fall-only (most
  are) or on a two-year rotation that happens to look identical. This matters most for the
  single-section upper-division electives — ECEN 411, 420, 430, 451, 461, 480, ME 410,
  MATH 411 all showed exactly one section in exactly one term. Re-run the scrape when a new
  schedule posts and diff `data/schedule-2026.json`.
- **U15 🟡 Two sources disagree about online availability for 9 courses.** The scraped
  schedule found no Online-delivery section in 2026 for BYUI 101, CIVIC 150, ECEN 150,
  ECEN 398R, ECEN 420, GEOL 111, GS 100, MATH 215 and MATH 316, but BYU-Idaho's curated
  online course list advertises all nine. `online` is the union of both sources, with
  `onlineConfirmedBySchedule` / `onlineListed` recording which one backs each; the detail
  panel renders the unconfirmed ones as "online?" in amber. 45 courses are confirmed by
  both. Five had `online: true` in the fixture with no evidence from either source and
  were cleared.
- ~~**U3** GE Social Science pool.~~ **RESOLVED 2026-08-06.** The live GE - ABET program
  page (`SJT9IXB77`, 2026-2027) lists the full Social Science pool, BYUI 151 and BYUI 152
  included, and the Arts & Humanities pool including BYUI 153. ge-abet.json matches the
  catalog exactly, bucket for bucket. The only cross-year difference: 2024-2025 grouped
  Religion + Writing under a single 20-credit "Core Courses" heading where 2026-2027 has
  "Cornerstone" (14) and "Writing" (6) separately — same courses, same 27-28 total.
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
- **U12 🔴→⚖️ The EE program file was labeled with the wrong catalog year. Relabeled
  2026-08-06 (user-directed).** `ee-bs-2024.json` said `catalogYear: 2024-2025 / UG24`
  while containing the **2026-2027** program verbatim. The two really differ:
  2024-2025 has a **38-credit** core requiring **CSE 121c and the retired ECEN 101**
  outright (no Introduction bucket), no PH 150 in the Math & Science core pool (20 of 20
  credits, zero slack rather than 1), a Professional Preparation option whose first
  elective comes from a restricted 6-course subset (ECEN 351/361/420/430/461/470), and a
  flat 120-credit total instead of 109-120.
  Resolved by relabeling: the file is now `ee-bs-2026.json` / `ee-bs-2026` /
  `catalogYear: 2026-2027`, and student.json moved to UG26. The evidence supports it —
  ECEN 100 (taken Spring 2026) exists only in the newer program, and the 2024-2025 core
  requires a course that no longer runs. **Still unconfirmed against I-Plan.** If the
  audit really runs on UG24, this file must be *replaced*, not relabeled.
  Useful distinction the model now respects: **course prerequisites** always come from
  the current catalog (that is what registration enforces), while **program
  requirements** follow the declared catalog year.
- ~~**U13** Whether a retake replaces the original grade in the cumulative GPA.~~
  **RESOLVED 2026-08-06 from the official transcript. It does.** The transcript reports
  **the transcript's own attempted/GPA credits, quality points and cumulative GPA** — the
  7-credit gap is exactly the superseded ENG 150 (F, 3 cr) and MATH 112X (UW, 4 cr), and
  the two Spring 2026 retakes are annotated "Replaces a prior course". So a retake
  removes the earlier attempt from the GPA entirely; it does not merely add to it.
  BYU-Idaho's public GPA calculator disclaims retake handling and the published repeat
  policy is written about courses *repeatable for credit*, which is why this was
  unanswerable from the website alone.
  `src/engine/gpa.ts` now computes the single official figure, and `npm run verify`
  asserts all three transcript numbers — that check pins the grade scale, the retake
  rule, and every Spring 2026 grade simultaneously. If it fails, something drifted.
- **U8 🟡 CYBER 240 is not in the course fixture.** The four-year-plan PDF allows CYBER 240
  in place of ECEN 430 for the Signals & Communications emphasis; courses.json has no
  CYBER 240 entry, so the emphasis filter can only show the ECEN 430 route.
- **U6 🟡 Winter-only reachability.** student.json note: Winter-only courses (ECEN 311, 351,
  451, 461, 470, 480) are "only reachable via an off-track Winter or an online section" — but
  courses.json marks all six `online: false`. If online sections exist, the data doesn't
  show them.

## 2. Missing (no source data at all)

- **M6 🟡→✅ Enrollment gates the catalog states outside the requisite rules — captured
  2026-08-06, MODELED 2026-08-13 (Phase 4).** No longer free prose shown as undifferentiated
  info text: `src/engine/restrictions.ts` parses each gate into a `Restriction`
  (`declaredIn` / `minCredits` / `approval` / `delivery` / `note`) and checks it against the
  student — declared program codes come from the enrollment layer, earned credits from the
  transcript. A gate you clear now says **nothing at all**; a gate you fail warns.
  - **It warns, never blocks**, for the same asymmetry as machine-read prerequisites (I20):
    our picture of what you are declared in comes from a transcript we did not write.
  - **Section-scoped gates are not exclusions.** BUS 301 restricts its *campus* sections
    and opens its online sections to everyone; flattening that into "not open to you" told
    an EE student a course they can take was closed. `appliesTo: "campus"` keeps it
    informational — the bug was caught by checking the output rather than the code.
  - At catalogue scale the same parser recognises gates on **629 of 2,026 courses**:
    308 `declaredIn`, 204 `approval`, 137 `minCredits`, 13 `delivery`. 519 segments stay
    `note` — genuinely descriptive prose (practice hours, nursing sequencing), not gates.
  - Still unmodeled: whether the student is a campus or online student, so `delivery`
    gates report `unknown` rather than guessing.

  The originally captured cases, now checked automatically:
  - **BUS 301** campus/day sections require declaration in program 415/428/429/431/600/
    643/652/675/686/715/720/752 — **445 (EE) is not on that list**, so an EE major can
    only take the *online* section. It is one of two options for the GE advanced-writing
    requirement, so this is actionable. ENG 301 has no such limit.
  - **MUSIC 102** requires declaration in 203/687/690/693/795/890 → not available to EE
    at all, though it sits in the GE Arts & Humanities pool.
  - ENG 301 and BUS 301 both require **22 earned credits**.
  - ECEN 397 / 490R / 499 need instructor authorization; ECEN 398R needs an internship
    application; GEOL 111 is limited to a program list that *does* include 445.
  - BYUI 101, GE 102, GE 105 and GS 102R are campus-only; GE 103 is online-only.
  These are recorded but **not enforced** — nothing blocks a drop on them.
- **M7 🟡 Repeatable-credit courses — captured 2026-08-06, not modeled.** ECEN 398R is
  repeatable to **7 credits** (that is where the Experiential Learning 1-7 range comes
  from), ECEN 490R to 6 attempts, GS 102R to 6 credits. Stored as `repeatable` and shown
  in the detail panel, but the engine still treats every course as a single instance:
  `validateDrop` blocks only same-term duplicates, so it allows cross-term repeats of
  *non*-repeatable courses while not crediting the repeatable ones properly.

- ~~**M1** Block availability — all 136 courses.~~ **RESOLVED 2026-08-06 from the same
  scrape.** Each section's date range was compared against the published term boundaries
  (Fall 2026 runs 09/14–12/16 full, 09/14–10/27 first block, 10/28–12/16 second), so blocks
  are observed rather than assumed. **blocksConfirmed is now true for 129 of 133.**
  Only **11 courses** run in a half-semester block at all: CSE 110, CSE 111, CSE 121c,
  CSE 210, MATH 111, PEACE 101, REL 200C, REL 225C, REL 275C, BYUI 101, ART 201/202,
  HUM 201/202. Everything else is full-semester only.
  The finding that matters: **CSE 121c has NO full-semester section** — it runs first or
  second block only, and mostly online. The card now offers only the blocks a course
  actually has, and says "block:" rather than "block?" when there is no full-semester
  option. The old empty state claimed availability was unknown for every course; it now
  names how many courses offer that block.
- ~~**M1-old** The original entry, kept for the record:~~ `blocksConfirmed: false` everywhere; no
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
- ~~**M5** Grades for Spring 2026.~~ **RESOLVED 2026-08-06 from the official transcript —
  and the earlier answer was WRONG.** On 2026-07-27 all five were user-asserted as A,
  ahead of the official posting. Three of the five were not:
  | Course | asserted | actual |
  |---|---|---|
  | CSE 111 | A | A ✓ |
  | ECEN 100 | A | A ✓ |
  | ENG 150 | A | **A-** |
  | MATH 112X | A | **B+** |
  | PH 150 | A | **A-** |

  Earned credits are unaffected (12 either way), but the cumulative GPA was overstated by
  roughly 0.16. **Lesson for this log: an assertion made before the source exists is a
  gap, not a resolution.** It should have stayed open until the transcript posted.

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

- **S11 🌐 Program audit — 209 machine-read programs checked back against the catalogue.**
  2026-08-13, `npm run audit:programs`. Six checks; **165 (78.9%) clean on all six**.
  Sections, pooled courses and credit totals are at 100%; the two that are not are the
  two that matter most to a student:
  - **34 programs contained an unsatisfiable requirement** — credits demanded with no
    courses and no sub-groups, e.g. Music's "Emphasis 53-57 credits". **RESOLVED
    2026-08-13** by harvesting `specializations`: the catalogue models an emphasis as a
    program in its own right, nested under its parent with the same rule structure. **132
    specializations across 22 programs**; Music's Emphasis is now a pick-one across six
    named tracks. 26 of 34 cleared — the remaining 8 ("Technical Elective", "Elective
    Major Credits") describe their pool in prose rather than course links.
  - **15 programs reference a program we do not carry** (clusters, deliberately not
    generated). Was 97 before the five missing **General Education tracks** (GE - BACH,
    GE - AAS, GE - TEACH, GE - IDS, GE - TRF ASSOC) were generated — until then those
    programs showed an empty 39-credit General Education requirement.
  - Both conditions now **downgrade the program to `unsure`**, so the app never presents
    an incomplete reading as a confident one. Shipping after specializations: **175 `exact`, 13 `parsed`, 21 `unsure`**.
  - **A rule with no pool is unsatisfiable wherever it sits.** The hollow-bucket check
    only walked top-level buckets, so GE passed while its Breadth section held a nested
    "6 credits from nothing". Fixed both ways: the check now flattens the tree, and a
    credit clause with no courses of its own borrows the union of its siblings' pools.
    The borrowed form under-constrains ("from 2 of the Breadth areas" is a distribution
    rule the model cannot express) and keeps the catalogue sentence as a note.
  - **Generated ids are not labels.** `rule-1`/`rule-2` reached the screen because the
    label fallback gave up on pools over three courses. It now describes the rule.
  - **Audit the artifact, not a re-derivation.** The audit originally re-ran the parser
    and measured that, so it could not see anything `buildPrograms.ts` adds afterwards —
    it reported 34 empty Emphasis buckets that were already filled. It now reads the
    shipped programs.
  - **Completeness is not correctness.** All three defects were found by reading six
    programs side-by-side against the catalogue, *after* the completeness checks read
    ~100%. Each is now its own check so the reading need not be repeated. This is the
    evidence behind **I22**: one program in five is not yet safe to assert requirements
    from. Harvesting `specializations` is the next step.
- **I22 ⚖️ Program trust is stricter than course trust, on purpose.** 2026-08-13.
  `assertsRequirements()` lets only **hand-written** programs drive the ★ "required — no
  alternative" marker and the "not needed" strike-through. Machine-read programs show
  their pools, credits and progress but make no claims about what a student must do.
  The asymmetry with prerequisites is evidential, not stylistic: the prereq parser earned
  `exact` enforcement by matching 131 hand-audited courses with 86/86 accuracy on the
  entries it called `exact`, while the program parser has three programs to check against
  and reproduces one of them exactly. 195 of 204 grading themselves `exact` is the
  parser's own opinion. Revisit if a sample of programs is ever hand-audited.
  - `requiredCourseIds()` previously looped over the literal `[EE, AI_MINOR, GE_ABET]` —
    correct only because those were the only programs. It now filters on trust, so the ★
    set is byte-identical (32 courses, asserted) but principled.
  - The rail badges those programs **auto-read**, with the dropped clauses in the tooltip;
    silently missing markers would read as a bug rather than a disclosure.
- **I21 ⚖️ The whole catalogue is loaded, but the planner only sees your degree.**
  2026-08-13, Phase 5. The app now ships **2,031 courses** (136 hand-audited, unchanged,
  plus 1,895 parsed): generated trust is `exact` 573, `parsed` 811, `unsure` 75, `none` 437,
  and 616 carry structured enrollment gates. `data/courses.json` remains the audited source
  and is never generated over; `npm run merge` writes `courses-full.json`, which is what the
  app imports.
  - **Search and the picker see all 2,031; the planner sees ~136** (`src/engine/scope.ts`).
    Unscoped, the suggester recommended ENG 301 on 442 university-wide unlocks and
    "furthest out" surfaced MUSIC 462D. `directUnlocks` is scoped for the same reason.
  - **Three data bugs the merge exposed**, all fixed: case-sensitive dedupe shipped both
    `CSE121C` and `CSE121c`; CHILD 300/310 list themselves as their own prerequisite; and
    an O(N²) reverse-index build cost 1.1 s of blocking startup at this scale.
  - **The `exact` invariant was re-aimed.** With the full catalogue resolvable, the parser
    now surfaces alternatives the fixture omitted *because they were not in the fixture*
    (MATH 325, ITM 327, ME 305 — the ACKNOWLEDGED list). Rather than rewrite audited data,
    `npm run verify` now asserts the property that actually matters: **no `exact` parse is
    stricter than the human**, checked by enumerating every combination of courses-taken.
    Parser-laxer is safe; parser-stricter would refuse a legal registration.
  - Cost: bundle 635 kB → 1,534 kB (gzip 246 kB), cold start ~285 ms.
- **S10 🌐 Program-requirement harvest** (`npm run harvest:programs` →
  `data/programs-raw.json`, `npm run merge:programs` → `programs-generated.json`), first run
  **2026-08-13**. All **356** programs in the 2026-2027 catalogue, 0 failures, requirement
  HTML kept verbatim. **204 majors and minors generated** (101 + 103); clusters and
  certificates deliberately excluded.
  - **Parse confidence: 195 `exact`, 9 `parsed`, 0 naming an unknown course.** The rule
    vocabulary is closed and maps onto the existing bucket types: 624 `allOf`, 314 `nOf`,
    220 `nCredits`, 174 `programRef`, 69 `fillTo`, plus 265/80 group headers.
  - **Benched against the three hand-written programs** (`npm run bench:programs`): the
    A.I. minor reproduces exactly (3/3 buckets), EE 6/8, GE - ABET 1/4. The misses are all
    places where the hand files *augment* the catalogue — placeholder slots (P1-P4),
    REL electives stated as prose, "any foreign language course" — not misreadings. Hand
    files therefore remain authoritative and are skipped by the generator.
  - **`minGrade` is null on generated programs.** The C- bachelor rule is published
    university-wide but not restated in each program, and asserting it from outside the
    source is exactly the mistake behind **U9**.
- **S9 🌐 Catalogue-wide class-schedule scrape** (`npm run schedule` →
  `data/schedule-full.json`), first run **2026-08-13**. All **108 discipline codes** ×
  Fall/Winter/Spring 2026 — one complete cycle, the same window the 2026-08-06 hand scrape
  used. **1,862 courses seen; 335 have an online section.**
  - **Validated against the hand scrape: 128/128 exact agreement** on terms, blocks and
    online. That comparison is asserted in `npm run verify`, so a future change to the
    scraper cannot quietly diverge from the work a human checked.
  - Applied to the shipped set: **1,693 of 1,895 generated courses now have confirmed
    terms and blocks** (was 0), and 278 are known to have an online section.
  - **202 courses were never seen in the 2026 cycle.** They stay `termsConfirmed: false`
    with a note — *not* `terms: []`, which means "retired" and would block planning them.
    One cycle cannot distinguish a dead course from a two-year rotation (**U14**), and
    over-blocking is the failure this project keeps choosing to avoid (I20, M6).
  - Mechanics worth keeping: multipart POST, every hidden field echoed (including
    `___BrowserRefresh`, whose absence triggers an anti-replay page that returns 200),
    `pg0$V$lnkShowAll` to beat 20-row pagination, and a fresh search page per discipline.
- **S8 🌐 Full catalogue harvest** (`npm run harvest` → `data/catalog-raw.json`), first run
  **2026-08-13**. All **2,026** courses in the 2026-2027 Kuali catalogue, 0 failures;
  **1,540** carry requisite prose, kept verbatim. Not imported by the app — build-time
  input only, so it never enters the bundle. Resumable: a re-run fetches only what is
  missing, because recovering from one timeout should not mean re-hammering the API.
  Paired with `src/engine/prereqParse.ts`, which grades every parse **exact / parsed /
  unsure**:
  - Against the 131 hand-audited courses the parser agrees **128** times (97.7%), and the
    86 it calls `exact` are right **100%** of the time — asserted by `npm run verify`, and
    the basis for any future decision to enforce a machine-read prerequisite.
  - Catalogue-wide: `exact` 615 (39.9%), `parsed` 849 (55.1%), `unsure` 76 (4.9%).
  - **374 courses (24.3%) yield no expression at all** because their requisite text is
    entirely enrollment restrictions. Combined with ~380 "Declared in \<program\>", 137
    credit-standing gates and 136 instructor authorizations, this quantifies **M6**:
    restrictions are a bigger gap than prerequisites, and the model has no room for them.
  - Only **8 courses (0.5%)** drop a real course code, so the prerequisite graph is nearly
    complete even where the rules are not.
- **S6 🌐 BYU-Idaho public class schedule** (`student.byui.edu/ics/class_schedule`),
  scraped 2026-08-06 — the source that closed **U2** and **M1**. Anonymous public search,
  no login. It is an ASP.NET WebForms app: each query needs a fresh `__VIEWSTATE` from a
  GET, results paginate at 20 rows until the "Show All" postback, and **the requests must
  be sequential** — three concurrent workers sharing one server session returned corrupted
  results (two different subjects both reporting 416 sections). All 33 relevant subject
  codes × 3 terms. Evidence lives in `data/schedule-2026.json`.
- **S7 🌐 BYU-Idaho online course list** (`byui.edu/online-courses/online-course-list`),
  read 2026-08-06. A curated list of courses with online sections. Used as an independent
  cross-check on the `online` flag; the two sources agree on 45 courses and disagree on 9
  (see **U15**).

- **S5 📄 Official unofficial transcript** (supplied by the user 2026-08-06). Source for:
  the real Spring 2026 grades (**M5**, which the earlier assertion got wrong), the
  confirmed retake rule and the three cumulative figures now asserted in `npm run verify`
  (**U13**), term GPAs (Fall 2023 1.411, Spring 2026 3.700), advisor/classification/
  academic-status metadata, and the **SAT scores that resolve the placement-test entry
  paths** (**U11**): 2016+ SAT Math 650 clears the 640 needed for MATH 112X — which is
  how Calculus I was entered with no MATH 109/110X/111 on the transcript — and SATR
  Writing 31 clears the 23 needed for ENG 150. Stored under `_transcript` in student.json.
  Note the transcript also shows PH 121 in Fall 2026 with Repeat = **N**; the repeat flag
  is applied retroactively once grades post, so the fixture's forward-looking
  `retake: true` is still the right modeling call.

- **S4 🌐 BYU-Idaho Student Records & Registration** (byui.edu), read 2026-08-06. Source
  for the grade-point scale and non-GPA marks in `src/engine/gpa.ts`
  (`/student-records/grades/calculate-gpa`, `/student-records/grades/grading-system`),
  and for the **21-credit recommended semester maximum** — above it needs permission from
  Student Records and Registration plus a successful academic history
  (`/registration/registration-faq`). The 12-credit full-time floor is used only to label
  a term as light. Before this, no credit-load limit existed anywhere in the app, so a
  24-credit term drew no comment.
- **S3 🌐 `npm run audit` (`scripts/auditCatalog.ts`), added 2026-08-06.** Re-runnable
  comparison of every non-placeholder course against the live catalog — reads *all*
  requisite field names, checks credits and titles, writes `data/catalog-snapshot.json`,
  and exits non-zero on drift. This is what makes U9 non-repeatable. It compares the
  *set* of course codes each side names, not the and/or shape: it prints the catalog's
  wording next to every mismatch so a human resolves the structure. Current state:
  **131 of 131 courses match** (CIT 160 and ECEN 101 are retired and absent by design).
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
  another cluster (ECEN 351 — prereq **ECEN 350**, corrected 2026-08-06 from ECEN 340) was
  drawn in the leftmost column and read as entry-level. Horizontal position is now `depth × 258px` everywhere, so further right
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
- **I10 ⚖️ MATH 112X direct unlocks moved 3 → 6 → 7.** The 2026-07-27 fetch added
  MATH 113, CHEM 106 and GEOL 435; the 2026-08-06 re-audit added ECEN 150, whose catalog
  rule lists MATH 112X as a prerequisite rather than the corequisite the fixture had. The
  original spec's "3" reflected incomplete fixture data.
- **I13 ⚖️ The autoplanner now commits to ONE branch of an OR.** Both schedulers scored
  every branch by calling their own placement function, which *placed* the losing
  branches too — so wishlisting ECEN 470 scheduled MATH 214 **and** MATH 215 (plus
  MATH 113 for MATH 214's own chain) to satisfy a single "MATH 214 or MATH 215". Branches
  are now ordered by `branchCost` (unmet courses, then depth) and the first that succeeds
  wins. Latent before 2026-08-06 because the fixture had few ORs; the corrected catalog
  data has many.
- **I15 ⚖️ Corequisites cost no tree column; ORs rank by their shallowest branch.**
  `prereqDepth` used to flatten the whole expression to leaves and take the max, which
  was survivable while the fixture had few ORs and two corequisites. After the 2026-08-06
  audit it put 38 courses in the wrong column — CHEM 105 at column 5 with no prerequisite
  at all (only a five-way math *coreq*), MATH 341 at 7 instead of 1, PH 121 at 1 instead
  of 0. It now walks the expression: prereq = +1 column, coreq = +0 (same term is legal),
  AND = deepest branch, OR = shallowest, matching `criticalPath` and the autoplanner.
  **Known oddity:** ECEN 499 (Senior Project) lands in column 1, because its only catalog
  prerequisite is "ECEN 398R or ECEN 397" and ECEN 397 has none. That is the catalog's
  rule, not a bug — the real gate on a capstone is finishing the major, which no data
  source encodes. Do not invent an edge to move it.
- **I16 ⚖️ ★ "required" now means *unavoidable in practice*, not *listed in an allOf pool*.**
  The old rule only marked courses a program spells out as `allOf`, which missed most of
  what you actually cannot skip. `requiredCourseIds()` now derives it, so it stays right
  when a pool changes: **24 → 32 courses.** The four rules:
  - **exact-fit `nCredits`** — ECEN 250 + ECEN 299 is a 3+1 pool for a 4-credit
    requirement, so neither is avoidable.
  - **`nCredits` with less slack than the course is worth** — the Math & Science core pool
    holds 21 credits and needs 20, so *every course over 1 credit is forced* (CHEM 105,
    MATH 316, MATH 330, PH 121, PH 123, PH 220) and only the two 1-credit courses,
    PH 150 and CHEM 105L, are the genuine slack.
  - **a course in every viable branch of an `nOfGroups`** — MATH 112X appears in all three
    Foundational Math routes, so no route avoids it. Formally: forced when fewer than `n`
    of the viable groups let you skip it.
  - **`nOfGroups` where retirement closed the alternatives** — Introduction offers ECEN 100
    *or* CSE 121c + the retired ECEN 101, so ECEN 100 is the only surviving path.

  **Pools containing a placeholder are exempt**, because a placeholder is droppable
  repeatedly and the pool therefore has unbounded credits. Without that exemption
  Cornerstone's 6-credit REL pool reads as an exact fit and wrongly forces REL 327 and
  REL 333.
- **I20 ⚖️ Prerequisite enforcement is now graded, not binary.** `validateDrop` used to
  hard-block whenever `verified: true`, which was safe while all 136 courses had been read
  by a person and stops being safe the moment most are machine-parsed. `src/engine/trust.ts`
  grades every rule **human / exact / parsed / unsure / none**, and only the first two are
  enforced; the rest warn and allow. The reasoning is an asymmetry: a dropped **OR** branch
  makes the model *stricter* than the university and would refuse a legal registration,
  while a dropped **AND** element only makes it laxer and costs the student nothing. The
  detail panel says which courses are unenforced and how many options were not modelled.
  **No verdict changed today** — every fixture course maps to `human`, asserted in
  `npm run verify` alongside the full enforcement matrix.
- **I19 ⚖️ Enrollment is resolved from the transcript by program code, and is
  profile rather than plan.** Opening the app up to every BYU-Idaho major and minor
  (Phase 1) needed a list of *enrolled programs* where two constants used to be.
  Rather than invent a field, `declaredEnrollment()` matches the `code` already in
  `student.json` against the `code` in each program file — major **445** →
  `ee-bs-2026`, minor **292** → `ai-engineering-minor`, **GE - ABET** → `ge-abet`.
  No data was added or guessed. Two consequences worth knowing:
  - **General Education is enrolled but never evaluated as a sibling.** The set of
    nested programs is derived by walking every `programRef` bucket, so GE is
    counted once inside the major. Evaluating it twice reads ~27 credits high.
  - **`programsContaining()` stays catalogue-wide, not enrollment-filtered.** "Counts
    toward" answers a property of the catalogue, so an unenrolled minor still shows
    — which is what makes the marginal-cost question answerable at all. The rail is
    what reflects enrollment.
- **I17 ⚖️ Panel layout is not part of a plan.** The requirements rail, course detail
  and course picker became draggable, dockable windows (`src/ui/panels/`). Their geometry
  lives in its own Zustand store and its own `localStorage` key, *not* in `PlanEdits`, so
  a window move never enters the undo stack, never rides along in an exported plan file,
  and survives *Reset plan*. **Reset panel layout** is a separate action under **⋯**.
  Consequence worth knowing: edge-docked panels *reserve* layout space (the board and tree
  shrink), while corner docks and "cover everything" overlay. The close-on-click-outside
  behaviour of the picker was **removed** — correct for a transient popover, wrong for a
  panel you dock beside the board, where clicking a course in the tree would dismiss it.
  Esc still closes.
- **I18 ⚖️ The desktop build made offline a guarantee rather than an assumption.**
  `index.html` used to pull Inter and JetBrains Mono from Google Fonts. In an Electron
  window with no network that silently fell back to `system-ui`, changing every metric in
  a layout tuned at 10–11px. Fonts are now bundled via `@fontsource`, `base` is relative
  so the same build runs over `file://`, and a build-only CSP forbids anything off-origin.
  The CSP is build-only because Vite's dev server injects an inline React Refresh script
  that a strict `script-src` would block. **The web and desktop builds keep separate
  plans**, since each has its own `localStorage` origin — Export/Import moves one to the
  other.
- **I14 ⚖️ "Plan bottlenecks ASAP" and the bottleneck list now skip "not needed" courses.**
  Correcting MATH 119's prerequisites pushed MATH 110X to 4 direct unlocks, which made
  the autoplanner schedule College Algebra for a student who has already passed
  Calculus I. Both now take the `obsolete` set (DATA_GAPS I9) and exclude it.
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

## S12 — Requirements the catalogue states in prose — RESOLVED 2026-08-17

Found by `npm run sweep`, which opens every degree cold as a new student. All
other 190 programs are clean; nothing throws; the planner's 4,669 placements
all validate. These 16 share one root cause — the requirement names no courses,
so there is nothing to put in the bucket:

  - **"Language Courses" / "Language Requirement" — 7 programs** (Elementary,
    English, History, Mathematics and Spanish Education, TESOL Minor, TESOL
    Education Minor, International Studies Minor). The catalogue means *any*
    foreign language, which is exactly what the hand-written EE program models
    with a **placeholder slot**. Wiring these to that existing mechanism is the
    single highest-value fix left.
  - **Prose elective pools — 3 programs.** "Elective Major Credits" (Business
    Management 29 cr, Software Engineering 6 cr), "Technical Elective"
    (Computer Programming 2 cr).
  - **Cluster-based degrees — General Studies, Interdisciplinary Studies,
    Musical Arts.** Built from *clusters*, which are deliberately not
    generated (110 of them would bury the 205 things people pick). Their
    requirements arrive as unlabelled 30/15-credit pairs, which is also why
    `rule-N` still shows there.

`rule-N` labels survive only where the bucket has no pool AND is not a
`programRef` — i.e. exactly these hollow ones. Fixing the content fixes the
label; there is no separate labelling bug left.

### S12 outcome

All 16 resolved. The prose vocabulary turned out closed (see CLAUDE.md 8.3):
department lists, subject codes, level filters, shorthand course lists, number
suffixes, and a genuinely open-ended tail modelled as `fillTo` with the
catalogue's sentence attached. `npm run sweep` now reports **0 programs with a
problem** across 102 majors and 104 minors.

Trust distribution after: **289 `exact`, 15 `parsed`, 15 `unsure`** of 319
generated programs (110 of them clusters, excluded from the picker by type).

## S13 — What `unsure` still means (15 programs)

These do not assert ★ or "not needed", and carry the `unverified` badge. Each
has a specific unclosed gap recorded in `parseDropped`. They are usable —
pools, progress and credits all render — they simply do not make claims.

## S14 — Still worth doing

  - **Human-verify a sample.** The sweep proves no program is *broken*; it
    cannot prove a rule was read with the right *meaning*. `npm run
    audit:programs -- --sample 8` prints the catalogue beside the parse.
  - **Certificates (34) are still not generated.** Business Management's
    "two certificates" option cannot be modelled precisely until they are.
  - **`minGrade` is null on every generated program.** C- is the published
    bachelor rule but is not stated in each program's own text, so it is not
    asserted.

## S15 — Found by reading, not by checking (2026-08-17)

Both of these passed every automated check in the repo and were caught only by
laying the catalogue's words beside the rendered requirement.

  - **GE Cornerstone's REL elective drew from the four required Cornerstone
    courses**, which the catalogue's word "other" explicitly excludes. Inherited
    by nearly every program through the GE reference. Now resolves to
    `REL_ELECTIVE`; and a clause containing "other" no longer borrows its
    siblings' pool.
  - **`PHIL 201 + PHIL 202` labelled a *pick one*.** "+" claims conjunction.
    Now `or` for everything except `allOf`, asserted across all programs.

## S16 — Known limitations at ship

  - **Co-semester constraints — RESOLVED 2026-08-17.** `Bucket.sameTerm`, derived per
    enrolment from asserting programs only, warns (never blocks) when the block is split
    across terms and says nothing when it is not. Three programs carry it: Business
    Management, its Interdisciplinary Studies emphasis, and the Small Business
    Innovation minor. Verified in the packaged app, both directions.
  - **One cluster is still `unsure`** — Physical Science and Mathematics, whose
    rule is "at least 12 credits from at least 2 of the following areas", a
    distribution constraint across areas that the bucket model cannot express.
  - **`minGrade` is null on every generated program.** C- is the published
    bachelor rule but is not stated in each program's own text.
  - **Clusters and certificates are excluded from the picker by type.** One line
    in `enrollablePrograms` to reverse if students should declare them directly.

## S17 — What a human still has to do

`npm run verify:catalog -- --read N` prints a signed worksheet per program.
Fidelity is proven for all 356; **meaning has been read for a sample, not for
all 353 machine-read programs.** Before this is relied on for registration, an
advisor should work through the worksheets for the programs that matter most.
The two defects above are the evidence that this step is not ceremony.

## S18 — Same-semester constraints (resolved)

The catalogue states this in exactly three programs and one phrasing family:
"must be taken together in the same semester" / "Take the following courses
together in the same semester". Harvested by scanning every program for the
vocabulary rather than assuming, which is what showed the set was this small.

Two traps worth remembering:

  - **The constraint can live in a NOTE.** Notes carry no rule and were dropped
    wholesale, so the flag was lost on the one program that stated it most
    clearly. A note can carry a constraint without carrying a rule.
  - **A flag rendered in a `title` attribute is invisible to a text search.**
    The first verification concluded the feature was dead while the screenshot
    in front of it showed three warning triangles.

Remaining after this: the three audit rows in CLAUDE.md §9.5 and the human
meaning-review (S17), which is still the real gate before students rely on it.

## S19 — Audit rows closed (2026-08-17)

`npm run audit:programs` is **353/353 on all six checks**; trust is 340 `exact`,
13 `parsed`, **0 `unsure`**. See CLAUDE.md §11 for how each row differed.

Three constraint types are now read out of the catalogue rather than ignored:
`sameTerm` (courses sharing one semester), `allowDoubleCount: false` ("No double
counting"), and area definitions feeding the credit rule beside them.

## S20 — What is genuinely left

  - **The human meaning-review (S17).** Unchanged and still the real gate. Every
    structural check passes; that is not the same as every rule meaning what the
    catalogue meant. Two defects found by reading are the evidence.
  - **Distribution constraints are under-modelled by design.** "6 credits from 2 of
    the Breadth areas", "12 credits from at least 2 areas", "15 credits from the same
    area or one other" — the bucket model cannot express *spread across N groups*, so
    these accept any courses from the union and carry the catalogue's sentence as a
    note. Permissive by choice; a student is never wrongly refused.
  - **`minGrade` is null on every generated program.**
  - **Clusters and certificates are excluded from the picker by type.**

## S21 — Ten personas (2026-08-17)

`npm run personas` — ten degrees planned with the app's own buttons, then
validated. 10/10 clean. Four real defects came out of it, none of which any
structural check could have found, because each needs a plan to exist first:
named-option choices read as checklists, a credit cap breached through a
check-then-act gap, a requirement with no verb dropped from every teaching
degree, and search ranking a substring above the exact match. See CLAUDE.md §12.

Open workflow issues (do not break a plan, do cost the student):

  - ~~The requirement expander is hidden until hover.~~ **Fixed 2026-08-17** — always
    visible, on every pool size, with the count in the label. See CLAUDE.md §13.
  - ~~The ⋯ menu stays open after adding a program.~~ **Fixed 2026-08-17** — closes on
    enrol, with a toast pointing at the panel.
  - Plans overshoot the degree total (Nursing: 182 credits placed against a
    120-credit degree). The planner places every ★ course and its prerequisites
    without stopping at the total, so a student sees more than they need.

## S22 — UI regression check

`npm run ui:check` drives the built app and asserts both fixes hold: the menu
closes with a confirmation, every requirement expander is visible without
hovering, and large pools still offer one. Needs `npm run build` first; set
`SHOT_DIR` to also capture a screenshot.

Still open from the persona run: plans overshoot the degree total (Nursing: 182
credits placed against 120 required), because the planner places every ★ course
and its prerequisites without stopping at the total.

## S23 — The tree only drew what you had already planned (2026-08-17)

Two causes, both shipping to every student who was not an electrical engineer:

  - **The layout memo did not depend on the enrolment.** Choosing a major never
    rebuilt the graph; only planning a course did. Fixed, plus the viewport fit
    now resets with the enrolment.
  - **The tree's section headings were EE's**, hand-written. Now derived from each
    enrolled program's own requirements, following `programRef` so General Education
    is its own section.

Guarded by `npm run tree:check`, which asserts the tree fills on enrolment with
zero courses planned. See CLAUDE.md §14.

## S24 — Sprout restyle (2026-08-17)

Light theme from the Sprout website is now the default; dark is kept and
toggles from the ⋯ menu. All colour lives in `src/index.css`; there are zero
hardcoded hex values left in `src/`.

Two light-only defects found by looking at the app rather than by any test:
locked nodes faded to invisibility (opacity is a ratio against the ground, so
it is now per theme), and the "unverified prerequisite" edge — drawn for 93% of
courses — was tuned as if it were an exception.

Renamed to Sprout everywhere a user can see. **Storage keys and the preload
bridge deliberately still say `gradtree`** — renaming them would orphan saved
plans.

Still open: plans overshoot the degree total (see S21).

## S25 — Tree layout (2026-08-17)

`npm run tree:stats` measures two things per degree: prerequisite edges drawn
level with or right of their dependent ("backwards"), and edge crossings.
Across 102 degrees: **backwards 1033 → 0, crossings 44,319 → 14,683**.

The complaint was "confusing", and the cause was not crossings — Statistics has
one. It was backwards arrows from global-depth columns, and corequisite pairs
(every Nursing lecture/clinical) drawn as two arrows and ordered apart.

Known and accepted:

  - **Nursing's Core stays at 127 crossings.** 18 courses where six
    lecture/clinical pairs each depend on several predecessors; that density is
    in the degree, not the layout. The pairs are now adjacent, which is the part
    that made it unreadable.
  - **Transpose is capped at 80 nodes per cluster** — it is quadratic in edges,
    and General Studies puts 448 courses in one column. Barycentre sweeps still
    run there.
  - **General Studies is still 1,386 nodes.** A degree defined as "30 credits
    from any of 17 departments" has a genuinely enormous graph; the crossings
    dropped 38,139 → 12,718 but it remains a large picture.

## S26 — First-run walkthrough (2026-08-17)

Six skippable steps introducing the app, with major/minor selection and the
light/dark choice done inline. Shown only to a student with no programs, no
plan and no flag — an upgrading user never sees it. Guarded by
`npm run welcome:check`, which asserts it appears once, enrols from inside
itself, and never returns.

Note for anyone adding UI that gates the app: `ui:check`, `tree:check` and
`shots` all start from a cleared localStorage and had to be taught to set
`gradtree:onboarded:v1`, or they land on the walkthrough and find nothing.
