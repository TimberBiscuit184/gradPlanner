import { useMemo, useState } from "react";
import { enrollablePrograms, evaluatedPrograms } from "../engine/programs";
import { rankPrograms } from "../engine/programSearch";
import { useProfile } from "../profileStore";
import { applyTheme, storedTheme, type Theme } from "./theme";

/**
 * First-run walkthrough.
 *
 * The app opens on an empty board with no explanation, and the one thing a new
 * student must do — pick a degree — was three clicks deep inside a ⋯ menu.
 * Everything else in Sprout follows from that choice: the requirements panel,
 * the prerequisite tree and every suggestion are all scoped to the programs
 * you are enrolled in, so until one is chosen the app has almost nothing to
 * show and no way to say so.
 *
 * This runs once, is skippable from every step, and does the setup inline
 * rather than pointing at where the setup lives.
 */

const KEY = "gradtree:onboarded:v1";

function markSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* storage disabled — the walkthrough simply shows again next time */
  }
}

/**
 * Show it to a genuinely new student only.
 *
 * Not just "has this flag been set": someone upgrading from a build that
 * predates the walkthrough already has programs and a plan, and greeting them
 * with an introduction to an app they have been using would be worse than not
 * having one.
 */
export function shouldWelcome(enrolledCount: number, placementCount: number): boolean {
  if (enrolledCount > 0 || placementCount > 0) return false;
  try {
    return localStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

interface StepDef {
  id: string;
  title: string;
  body: React.ReactNode;
}

function ProgramStep() {
  const enrolledIds = useProfile((s) => s.enrolledIds);
  const enroll = useProfile((s) => s.enroll);
  const unenroll = useProfile((s) => s.unenroll);
  const [q, setQ] = useState("");

  const enrolled = evaluatedPrograms(enrolledIds);
  const available = enrollablePrograms(enrolledIds);
  const matches = useMemo(() => rankPrograms(available, q), [available, q]);
  const hasMajor = enrolled.some((p) => p.type === "major");

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${available.length} majors and minors…`}
        aria-label="Search programs"
        className="focus-ring w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
      />

      {matches.length > 0 && (
        <ul className="max-h-52 overflow-y-auto rounded-md border border-line">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  enroll(p.id);
                  setQ("");
                }}
                className="focus-ring flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
              >
                <span className="shrink-0 text-brand">+</span>
                <span className="min-w-0 flex-1 truncate">{p.label}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">
                  {p.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length > 1 && matches.length === 0 && (
        <p className="text-xs text-ink-faint">Nothing matches “{q.trim()}”.</p>
      )}

      {enrolled.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {enrolled.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 py-1 pl-3 pr-1.5 text-xs text-ink"
            >
              <span className="text-[9px] uppercase tracking-wide text-brand-strong">
                {p.type}
              </span>
              {p.label}
              <button
                onClick={() => unenroll(p.id)}
                className="focus-ring rounded-full px-1 text-ink-faint hover:text-ink"
                aria-label={`Remove ${p.label}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-faint">
        {hasMajor
          ? "Add a minor too if you have one — or carry on, you can change this any time under ⋯ → Programs."
          : "Pick your major. A minor is optional, and everything here can be changed later."}
      </p>
    </div>
  );
}

function ThemeStep() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme());
  const choose = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {(["light", "dark"] as const).map((t) => (
          <button
            key={t}
            onClick={() => choose(t)}
            className={`focus-ring flex-1 rounded-md border px-3 py-2 text-sm capitalize ${
              theme === t
                ? "border-brand bg-brand/10 text-ink"
                : "border-line text-ink-dim hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-faint">
        You can switch at any time under ⋯ → {theme === "dark" ? "Light" : "Dark"}{" "}
        theme.
      </p>
    </div>
  );
}

export function Welcome({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const enrolledIds = useProfile((s) => s.enrolledIds);

  const steps: StepDef[] = [
    {
      id: "intro",
      title: "Plan your whole degree, not just next semester",
      body: (
        <div className="flex flex-col gap-2 text-sm text-ink-dim">
          <p>
            Sprout reads BYU-Idaho’s course catalogue — every major, minor and
            prerequisite — and lays your degree out as something you can move
            around.
          </p>
          <p>
            It knows which semesters each class actually runs in, what it needs
            first, and what it unlocks. Two minutes here and the rest is
            dragging.
          </p>
        </div>
      ),
    },
    {
      id: "programs",
      title: "What are you studying?",
      body: <ProgramStep />,
    },
    {
      id: "board",
      title: "The Board is your semesters",
      body: (
        <div className="flex flex-col gap-2 text-sm text-ink-dim">
          <p>
            One column per semester, from now to graduation. Drag a class into a
            term and Sprout checks it: prerequisites met, actually offered that
            semester, credit load sane.
          </p>
          <p>
            It <span className="text-ink">warns</span> rather than refuses. A
            half-built plan is a normal thing to have, so nothing stops you
            putting a course down — it just tells you what is wrong with it.
          </p>
        </div>
      ),
    },
    {
      id: "tree",
      title: "The Tree is what comes before what",
      body: (
        <div className="flex flex-col gap-2 text-sm text-ink-dim">
          <p>
            Every class in your degree and the chains between them. Arrows run
            left to right: anything to the left has to happen first.
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-available" /> ready to take
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-ink-faint" /> locked
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-planned" /> planned
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-completed" /> done
            </span>
          </p>
          <p>
            Click any class to see what it needs and what it unlocks. ★ marks a
            course with no alternative.
          </p>
        </div>
      ),
    },
    {
      id: "requirements",
      title: "Degree progress, and how much to trust it",
      body: (
        <div className="flex flex-col gap-2 text-sm text-ink-dim">
          <p>
            The panel on the right is your degree, requirement by requirement,
            filling in as you plan. Open any row to see exactly which classes
            count for it.
          </p>
          <p>
            Requirements marked{" "}
            <span className="rounded bg-surface-2 px-1 text-[10px] uppercase tracking-wide text-ink-faint">
              auto-read
            </span>{" "}
            were read from the catalogue automatically. They are accurate as far
            as we can check, and they are still not your advisor.{" "}
            <span className="text-ink">
              Confirm with an advisor before you register.
            </span>
          </p>
        </div>
      ),
    },
    {
      id: "theme",
      title: "One last thing",
      body: <ThemeStep />,
    },
  ];

  const last = step === steps.length - 1;
  const current = steps[step];
  const onProgramStep = current.id === "programs";
  const hasMajor = enrolledIds.length > 0;

  const finish = () => {
    markSeen();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Sprout"
      onKeyDown={(e) => {
        if (e.key === "Escape") finish();
      }}
    >
      <div className="flex w-full max-w-xl flex-col gap-5 rounded-xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <h1 className="font-display text-xl font-bold text-brand-strong">
            Sprout
          </h1>
          <button
            onClick={finish}
            className="focus-ring ml-auto shrink-0 text-xs text-ink-faint hover:text-ink"
          >
            Skip
          </button>
        </div>

        <div className="flex min-h-[13rem] flex-col gap-3">
          <h2 className="font-display text-lg font-semibold text-ink">
            {current.title}
          </h2>
          {current.body}
        </div>

        <div className="flex items-center gap-3">
          <ol className="flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((s, i) => (
              <li
                key={s.id}
                className={`h-1.5 w-6 rounded-full ${
                  i === step ? "bg-brand" : i < step ? "bg-brand/40" : "bg-line"
                }`}
              />
            ))}
          </ol>

          <div className="ml-auto flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="focus-ring rounded-md px-3 py-1.5 text-sm text-ink-dim hover:text-ink"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (last ? finish() : setStep((s) => s + 1))}
              className="focus-ring rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-surface hover:bg-brand-strong"
            >
              {last
                ? "Start planning"
                : onProgramStep && !hasMajor
                  ? "Skip for now"
                  : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
