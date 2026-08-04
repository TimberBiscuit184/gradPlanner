import type { CourseStatus } from "../types";

/** Board-mode (flat) styling per status. */
export const STATUS_STYLE: Record<
  CourseStatus,
  { label: string; dot: string; card: string; text: string }
> = {
  completed: {
    label: "Completed",
    dot: "bg-completed",
    card: "bg-completed/15 border-completed/50",
    text: "text-completed",
  },
  "in-progress": {
    label: "In progress",
    dot: "bg-inprogress",
    card: "bg-inprogress/15 border-inprogress/50",
    text: "text-inprogress",
  },
  registered: {
    label: "Registered",
    dot: "bg-registered",
    card: "bg-registered/15 border-registered/50",
    text: "text-registered",
  },
  planned: {
    label: "Planned",
    dot: "bg-planned",
    card: "bg-planned/15 border-planned/55",
    text: "text-planned",
  },
  available: {
    label: "Available",
    dot: "bg-available",
    card: "bg-surface border-available/40",
    text: "text-available",
  },
  locked: {
    label: "Locked",
    dot: "bg-ink-faint",
    card: "bg-surface border-line opacity-40",
    text: "text-ink-faint",
  },
  failed: {
    label: "Failed",
    dot: "bg-danger",
    card: "bg-danger/10 border-danger/50",
    text: "text-danger",
  },
};

export const BLOCK_LABELS = ["1st", "2nd"] as const;
