// Emphasis areas — transcribed from the official "B.S. Electrical Engineering
// Suggested Four-Year Plan / Course List, for those starting in 2026-2027" PDF
// (data/ee-four-year-completion-plan-2026-2027.pdf), supplied 2026-07-27.
// Each emphasis = 3 supplemental electives + 2 core courses per the PDF grid.

export interface Emphasis {
  id: string;
  label: string;
  supplemental: string[];
  core: string[];
  note?: string;
}

export const EMPHASES: Emphasis[] = [
  {
    id: "power",
    label: "Power & Energy Systems",
    supplemental: ["ECEN311", "ECEN411", "ECEN470"],
    core: ["ECEN350", "ECEN390"],
  },
  {
    id: "signals",
    label: "Signals & Communications",
    supplemental: ["ECEN420", "ECEN480", "ECEN430"],
    core: ["ECEN380", "ECEN390"],
    note: "The PDF allows CYBER 240 in place of ECEN 430 — CYBER 240 is not in the course fixture (see DATA_GAPS U8).",
  },
  {
    id: "rf-semi",
    label: "R.F. Microelectronics & Semiconductors",
    supplemental: ["ECEN351", "ECEN430", "ECEN451"],
    core: ["ECEN340", "ECEN350"],
  },
  {
    id: "controls",
    label: "Control Systems & Automation",
    supplemental: ["ECEN470", "ME310", "ME410"],
    core: ["ECEN340", "ECEN380"],
  },
];
