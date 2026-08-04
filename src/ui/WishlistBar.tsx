import { useState } from "react";
import { COURSE_BY_ID } from "../data";
import { planWishlist } from "../engine/autoplan";
import { useModel } from "../model";
import { usePlan } from "../store";

const ALREADY = new Set(["completed", "in-progress", "registered", "planned"]);

/**
 * "Pick the classes I want, then fill my schedule." Shown while picking mode is
 * on; clicking any course node or card toggles it into the wishlist.
 */
export function SelectCoursesButton() {
  const picking = usePlan((s) => s.picking);
  const setPicking = usePlan((s) => s.setPicking);
  const wishCount = usePlan((s) => s.wishlist.length);
  return (
    <button
      onClick={() => setPicking(!picking)}
      className={`focus-ring rounded border px-2.5 py-1 text-xs ${
        picking
          ? "border-planned bg-planned/20 text-ink"
          : "border-line hover:bg-surface-2"
      }`}
      title="Select several courses, then have them scheduled into the earliest terms that work."
    >
      {picking ? `Selecting (${wishCount})` : "Select courses…"}
    </button>
  );
}

export function WishlistBar() {
  const { model } = useModel();
  const wishlist = usePlan((s) => s.wishlist);
  const setPicking = usePlan((s) => s.setPicking);
  const toggleWish = usePlan((s) => s.toggleWish);
  const clearWishlist = usePlan((s) => s.clearWishlist);
  const addPlacements = usePlan((s) => s.addPlacements);
  const showToast = usePlan((s) => s.showToast);
  const [maxCredits, setMaxCredits] = useState(15);

  const pending = wishlist.filter(
    (id) => !ALREADY.has(model.derived.get(id)?.status ?? ""),
  );
  const credits = pending.reduce(
    (s, id) => s + (COURSE_BY_ID.get(id)?.credits ?? 0),
    0,
  );

  const fill = () => {
    if (!pending.length) {
      showToast({
        text: "Nothing selected yet — click courses in the tree or board to add them.",
        level: "info",
      });
      return;
    }
    const result = planWishlist(model, pending, { maxCredits });
    if (!result.additions.length) {
      showToast({
        text: `Could not schedule those: ${result.notes.join(" · ") || "no valid terms found."}`,
        level: "blocked",
      });
      return;
    }
    addPlacements(result.additions);
    clearWishlist();
    setPicking(false);
    const summary = result.additions
      .map((a) => `${COURSE_BY_ID.get(a.courseId)?.code ?? a.courseId} → ${a.termId}`)
      .join(", ");
    showToast({
      text:
        `Scheduled ${result.additions.length}: ${summary}` +
        (result.pulledIn.length
          ? ` · also added prerequisites ${result.pulledIn.map((id) => COURSE_BY_ID.get(id)?.code ?? id).join(", ")}`
          : "") +
        (result.notes.length ? ` · ${result.notes.join(" · ")}` : ""),
      level: "ok",
    });
  };

  return (
    <div className="z-30 flex items-center gap-2 border-b border-planned/40 bg-planned/10 px-3 py-1.5 text-xs">
      <span className="font-medium text-planned">Selecting courses</span>
      <span className="text-ink-dim">
        Click any course to add or remove it.
      </span>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {pending.map((id) => {
          const c = COURSE_BY_ID.get(id)!;
          return (
            <button
              key={id}
              onClick={() => toggleWish(id)}
              className="focus-ring flex items-center gap-1 rounded border border-planned/60 bg-planned/20 px-1.5 py-0.5 font-mono text-[10px]"
              title={`${c.title} — click to remove`}
            >
              {c.code} <span className="text-ink-faint">✕</span>
            </button>
          );
        })}
        {pending.length === 0 && (
          <span className="text-ink-faint">nothing selected yet</span>
        )}
      </div>

      <label className="flex shrink-0 items-center gap-1 text-ink-dim">
        Max credits/term
        <input
          type="number"
          min={3}
          max={20}
          value={maxCredits}
          onChange={(e) => setMaxCredits(Number(e.target.value) || 15)}
          className="focus-ring w-12 rounded border border-line bg-bg px-1 py-0.5 text-center text-ink"
        />
      </label>
      <span className="shrink-0 font-mono text-ink-dim">{credits} cr</span>

      <button
        onClick={fill}
        disabled={pending.length === 0}
        className="focus-ring shrink-0 rounded border border-planned bg-planned/25 px-2 py-0.5 font-medium text-ink disabled:opacity-40"
      >
        Fill my schedule
      </button>
      <button
        onClick={() => {
          clearWishlist();
          setPicking(false);
        }}
        className="focus-ring shrink-0 rounded border border-line px-2 py-0.5 text-ink-dim hover:text-ink"
      >
        Done
      </button>
    </div>
  );
}
