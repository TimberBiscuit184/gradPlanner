// @ts-check
/**
 * The entire renderer-facing API surface.
 *
 * Deliberately tiny, and deliberately made of *named* methods — no `invoke`
 * passthrough, no Node, no filesystem. Everything here exists to back up the
 * plan to a file the user can actually see; if this ever needs to do more, add
 * another named method rather than widening the door.
 */
const { contextBridge, ipcRenderer } = require("electron");

/**
 * Read the backup before the page loads — but never at the cost of the page.
 *
 * A preload that throws fails the whole document load with `ERR_FAILED`, giving
 * a blank window with no clue why. Trading the entire app for a *backup* of the
 * plan is the wrong way round, so anything that goes wrong here degrades to
 * "no backup" and lets `localStorage` carry on as it always has.
 */
let savedPlan = null;
try {
  savedPlan = ipcRenderer.sendSync("gradtree:plan-read") ?? null;
} catch {
  savedPlan = null;
}

contextBridge.exposeInMainWorld("gradtree", {
  desktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },

  /**
   * The plan as of last quit, read from disk *before the page loads*, so the
   * store can use it on its first render instead of hydrating afterwards. Null
   * when there is no backup yet. `sendSync` is the point here, not an oversight.
   */
  savedPlan,

  /** Mirror a save to `plan.json`. Fire-and-forget: localStorage already has it. */
  savePlan: (plan) => {
    try {
      ipcRenderer.send("gradtree:plan-write", plan);
    } catch {
      /* the plan is already in localStorage; a failed mirror is not a failed save */
    }
  },

  /** Open the folder holding plan.json in Explorer. */
  revealPlan: () => ipcRenderer.invoke("gradtree:plan-reveal"),
});
