// @ts-check
/**
 * Sprout desktop shell.
 *
 * CommonJS (`.cjs`) on purpose: package.json is `"type": "module"` for the Vite
 * app, and Electron's main process is happiest as CJS. Renaming this to `.js`
 * breaks the app with a module-scope error that reads like a bug in Electron.
 *
 * The shell does three things and nothing else — the planner is still a plain
 * client-side app that runs in a browser:
 *   1. Loads the built bundle from disk (or the dev server when one is running).
 *   2. Remembers the window's size, position and maximised state.
 *   3. Refuses to become a browser: no navigation away, no new windows, no
 *      Node in the renderer.
 */
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// Explicit, so `npm run desktop` and the packaged app share one profile rather
// than depending on package.json `name` matching `productName`.
app.setName("Sprout");

/** Set by `npm run desktop`; absent in a packaged build. */
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

/** Matches --color-bg, so there is no white flash before React paints. */
const BG = "#14161b";

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (typeof s.width === "number" && typeof s.height === "number") return s;
  } catch {
    /* first run, or a corrupt file — defaults are fine either way */
  }
  return { width: 1440, height: 900, maximized: true };
}

/**
 * Saved on close rather than on every move: a resize storm would otherwise
 * write the file dozens of times a second.
 */
function writeState(win) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ ...b, maximized: win.isMaximized() }),
    );
  } catch {
    /* a layout is not worth crashing a quit over */
  }
}

/* --------------------------------------------------------------- the plan */

/**
 * A plain-JSON copy of the plan, beside the app's own data.
 *
 * The app saves through `localStorage`, which does persist here — that was
 * measured, not assumed. But in a desktop app `localStorage` lives inside an
 * opaque Chromium LevelDB in the profile directory: you cannot open it, copy
 * it, or back it up, and anything that resets the profile takes four years of
 * degree planning with it.
 *
 * So every save is mirrored to `plan.json`, and startup falls back to it when
 * `localStorage` comes up empty. Whichever one survives, the plan survives.
 * `localStorage` stays the source of truth in the renderer so the web and
 * desktop builds keep the exact same save path — this is a safety net under it,
 * not a second mechanism to keep in sync.
 */
const planPath = () => path.join(app.getPath("userData"), "plan.json");

function readPlanFile() {
  try {
    const raw = fs.readFileSync(planPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null; // absent on first run, and unreadable is the same as absent
  }
}

function writePlanFile(plan) {
  try {
    // Write-then-rename, so a crash mid-write cannot leave a truncated plan
    // where a good one used to be.
    const tmp = `${planPath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(plan, null, 2), "utf8");
    fs.renameSync(tmp, planPath());
  } catch {
    /* the renderer still has localStorage; a failed mirror is not fatal */
  }
}

// Synchronous on purpose: the renderer reads this before React mounts, so the
// store can be seeded on its very first render rather than hydrating late.
ipcMain.on("gradtree:plan-read", (e) => {
  e.returnValue = readPlanFile();
});
ipcMain.on("gradtree:plan-write", (_e, plan) => {
  if (plan && typeof plan === "object") writePlanFile(plan);
});
ipcMain.handle("gradtree:plan-reveal", () => {
  // Show the folder even before the first save has created the file.
  if (fs.existsSync(planPath())) shell.showItemInFolder(planPath());
  else void shell.openPath(app.getPath("userData"));
});

function createWindow() {
  const state = readState();

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    // The app is desktop-only and assumes a 1024px-wide workspace; below that
    // the board columns collapse into each other.
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: BG,
    // Hidden titlebar with the native window buttons drawn as an overlay: the
    // app header becomes the title bar (see `.is-desktop .app-header` in
    // index.css), and we still get real, correct minimise/maximise/close.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#1c1f26", // --color-surface
      symbolColor: "#a2a8b3", // --color-ink-dim
      height: 34,
    },
    // Don't show a half-painted window while React mounts.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (state.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.on("close", () => writeState(win));

  // A planner should never turn into a browser. Anything that tries to leave
  // the app opens in the user's real browser instead, where they can see the
  // address bar.
  const openExternally = (url) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  };
  win.webContents.setWindowOpenHandler(({ url }) => openExternally(url));
  win.webContents.on("will-navigate", (e, url) => {
    const here = DEV_URL ?? "file://";
    if (url.startsWith(here)) return;
    e.preventDefault();
    openExternally(url);
  });

  // No application menu, so no menu bar flashing above the custom title bar —
  // but reload and devtools are the two things you always want back.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const key = (input.key || "").toLowerCase();
    if (key === "f12" || (input.control && input.shift && key === "i")) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    } else if (input.control && key === "r") {
      win.webContents.reload();
      e.preventDefault();
    }
  });

  if (DEV_URL) loadDevServer(win);
  else void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  return win;
}

/**
 * Wait for the Vite dev server by *retrying the load*, not by probing the port.
 *
 * `npm run desktop` used to gate Electron behind `wait-on tcp:…`. On this
 * machine that probe never resolves even when the port is plainly serving HTTP,
 * so the window simply never opened and all you saw was Vite printing a
 * localhost URL — which looks exactly like "it just opened a web page".
 *
 * Retrying the load has no probe to disagree with and no race to lose: the
 * window appears immediately in the app's own background colour, and fills in
 * the moment the server answers. If it never does, say so instead of retrying
 * forever behind a blank window.
 */
function loadDevServer(win) {
  const RETRY_MS = 400;
  const GIVE_UP_AFTER = 75; // ~30 seconds
  let tries = 0;

  const attempt = () => {
    win.loadURL(DEV_URL).catch(() => {
      /* did-fail-load handles it */
    });
  };

  win.webContents.on("did-fail-load", (_e, _code, _desc, url, isMainFrame) => {
    if (!isMainFrame || win.isDestroyed()) return;
    if (url && !url.startsWith(DEV_URL)) return;
    if (++tries > GIVE_UP_AFTER) {
      dialog.showErrorBox(
        "Sprout",
        `The dev server at ${DEV_URL} never answered.\n\n` +
          "Start it yourself with `npm run dev`, or skip it entirely and run " +
          "the built app with `npm run desktop:preview`.",
      );
      return;
    }
    setTimeout(attempt, RETRY_MS);
  });

  attempt();
}

// One window only. A second instance just focuses the first — two copies of the
// planner would fight over the same localStorage plan.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    // No window but still holding the lock means an orphaned instance — a
    // crashed or force-killed run. Without this branch the user double-clicks
    // Sprout, the second copy quits against the lock, and *nothing happens*,
    // with no window and no error. Recover by opening one instead.
    if (!win) {
      createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  Menu.setApplicationMenu(null);

  void app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
