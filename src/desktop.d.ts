/**
 * What `electron/preload.cjs` puts on `window`. Optional on purpose — the app
 * still runs as a plain web page, so every read has to cope with it being
 * undefined.
 */
interface SproutDesktop {
  desktop: true;
  platform: string;
  versions: { electron: string; chrome: string };
  /** The plan file's contents, read before the page loaded. Null on first run. */
  savedPlan: unknown;
  /** Mirror a save to disk. */
  savePlan: (plan: unknown) => void;
  /** Reveal plan.json in the OS file manager. */
  revealPlan: () => Promise<void>;
}

interface Window {
  /**
   * The global stays `gradtree` even though the product is now Sprout: it is
   * the contract between preload.cjs and the renderer, and both `gradtree:*`
   * localStorage keys and the on-disk plan.json use the same name. Renaming it
   * would orphan every plan already saved on a student's machine to rebrand
   * something no user ever sees.
   */
  gradtree?: SproutDesktop;
}
