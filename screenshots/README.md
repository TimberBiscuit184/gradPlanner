# Sprout screenshots

Twenty-one light-mode captures for the website, 1600×1000, regenerate with:

```bash
npm run build && npm run screenshots
```

Every board here was laid out by the app's own planner (`scripts/makeShotPlans.ts`)
rather than posed by hand, so what the images show is what Sprout actually does —
including **17**, which is a plan with a real mistake in it so the warning can be
seen doing its job.

## First run

| | |
|---|---|
| `01-welcome` | The opening screen — what Sprout is |
| `02-choose-degree-search` | Searching 189 programs from inside the walkthrough |
| `03-degree-chosen` | Nursing picked, shown as a chip |
| `04-tour-board` | "The Board is your semesters" |
| `05-tour-tree` | "The Tree is what comes before what", with the status legend |

## A degree chosen, nothing planned yet

| | |
|---|---|
| `06-empty-board-requirements` | Empty board, requirements panel already filled in |
| `07-requirement-expanded` | A requirement opened to show which courses count |
| `08-tree-nursing` | The whole Nursing prerequisite tree, before planning anything |
| `09-tree-course-selected` | A course selected: what it needs and what it unlocks |

## Planning

| | |
|---|---|
| `10-course-detail` | Course detail — prerequisites, terms, sections, where the data came from |
| `11-board-part-planned` | A part-built plan, the normal state |
| `12-select-courses-mode` | "Select courses…" picking mode |
| `13-board-full-plan` | A full four-year plan |
| `14-insights` | Suggestions for next term, ranked by what delays graduation |
| `15-class-search` | Searching the whole catalogue by code or title |
| `16-add-to-semester` | Choosing the term and block for a class |

## Catching a mistake

| | |
|---|---|
| `17-warning-same-semester` | BUS 300 / MKT 301 / BUS 302 split across terms — the catalogue requires them together, and all three are flagged |

## Other degrees

| | |
|---|---|
| `18-board-computer-science` | Computer Science + Mathematics minor |
| `19-tree-computer-science` | The Computer Science tree |
| `20-tree-planned-statuses` | Tree with a plan behind it — planned, available and locked side by side |
| `21-programs-menu` | Changing your major or minor later |

## Notes for the site

- All light theme. `THEME=dark npm run shots -- <label>` captures the dark
  palette if a comparison is ever wanted.
- The window is 1600×1000, so these crop cleanly to 16:10 or 16:9.
- Nothing here contains a real student's record — the shipped transcript is
  blank and every plan was generated.
