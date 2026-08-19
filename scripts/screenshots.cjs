/* Showcase screenshots — `npm run screenshots`
 *
 * Twenty light-mode captures of Sprout at different points in a student's
 * workflow, written to ./screenshots for use on the website. Run
 * `npm run build` first; `npm run screenshots` regenerates the plans and then
 * drives the built app.
 *
 * Every board here was laid out by the real planner (see makeShotPlans.ts), so
 * nothing in these images is staged — including scene 16, which is a plan with
 * a genuine mistake in it so the warning can be shown doing its job.
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { writeFileSync, mkdirSync, readFileSync } = require("node:fs");

const ROOT = path.join(__dirname, "..");
const OUT = process.env.SHOT_DIR || path.join(ROOT, "screenshots");
const SEEDS = JSON.parse(
  readFileSync(path.join(__dirname, ".shotplans.json"), "utf8"),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PLAN = null;
ipcMain.on("gradtree:plan-read", (e) => { e.returnValue = PLAN; });
ipcMain.on("gradtree:plan-write", (_e, p) => { PLAN = p; });

let n = 0;
async function shot(win, name) {
  n++;
  const file = `${String(n).padStart(2, "0")}-${name}.png`;
  try {
    writeFileSync(path.join(OUT, file), (await win.webContents.capturePage()).toPNG());
    console.log("  ", file);
  } catch (err) {
    // Evidence, never a verdict — a compositor hiccup must not end the run.
    console.log("   (failed:", file, err && err.message, ")");
  }
}

async function click(win, x, y) {
  for (const t of ["mouseDown", "mouseUp"]) {
    win.webContents.sendInputEvent({ type: t, x, y, button: "left", clickCount: 1 });
    await sleep(35);
  }
  await sleep(300);
}
async function type(win, text) {
  for (const ch of text) {
    win.webContents.sendInputEvent({ type: "char", keyCode: ch });
    await sleep(40);
  }
  await sleep(450);
}
const locate = (win, pred) => win.webContents.executeJavaScript(`
  (() => {
    const b = [...document.querySelectorAll('button,[role="tab"],input')].find((x) =>
      (${pred})(((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('placeholder') || '') + ' ' + (x.textContent || '')).replace(/\\s+/g,' ').trim()));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()
`);

/**
 * Click an element by its text, with real mouse events at its centre.
 *
 * `element.click()` on a React Flow node dispatches on the wrapper, and the
 * handler lives on a child — events do not propagate downwards, so the node
 * never registered the click and the "course selected" shot came out identical
 * to the one before it.
 */
async function clickText(win, selector, pattern) {
  const at = await win.webContents.executeJavaScript(`
    (() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((x) => ${pattern}.test((x.textContent || '').replace(/\\s+/g, ' ')));
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()
  `);
  if (at) await click(win, at.x, at.y);
  return !!at;
}

const hit = async (win, pred) => {
  const at = await locate(win, pred);
  if (at) await click(win, at.x, at.y);
  return !!at;
};

/** Load the app in a known state: light theme, given seed, onboarding done. */
async function reset(win, { seed, onboarded = true } = {}) {
  const profile = seed ? { enrolledIds: SEEDS[seed].enrolledIds } : { enrolledIds: [] };
  const plan = seed
    ? { placements: SEEDS[seed].placements, droppedRegistrations: [] }
    : { placements: [], droppedRegistrations: [] };
  PLAN = null;
  await win.webContents.executeJavaScript(`
    localStorage.clear();
    localStorage.setItem("gradtree:theme:v1", "light");
    ${onboarded ? `localStorage.setItem("gradtree:onboarded:v1", "1");` : ""}
    localStorage.setItem("gradtree:profile:v1", ${JSON.stringify(JSON.stringify(profile))});
    localStorage.setItem("gradtree:plan:v1", ${JSON.stringify(JSON.stringify(plan))});
    true;
  `);
  await new Promise((r) => { win.webContents.once("did-finish-load", r); win.webContents.reload(); });
  await sleep(2600);
}

const openTree = (win) => hit(win, `(t) => /^tree$/i.test(t)`);
const openBoard = (win) => hit(win, `(t) => /^board$/i.test(t)`);

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1600, height: 1000, show: true,
    webPreferences: { preload: path.join(ROOT, "electron/preload.cjs") },
  });
  await win.loadFile(path.join(ROOT, "dist/index.html"));
  await sleep(2200);

  console.log("\nscreenshots →", OUT);

  // ---- 1-5 · first run ---------------------------------------------------
  await reset(win, { onboarded: false });
  await shot(win, "welcome");

  await hit(win, `(t) => /^next$/i.test(t)`);
  const search = await locate(win, `(t) => /search programs/i.test(t)`);
  if (search) {
    await click(win, search.x, search.y);
    await type(win, "nurs");
  }
  await shot(win, "choose-degree-search");

  await win.webContents.executeJavaScript(`
    (() => { const b = [...document.querySelectorAll('button')].find((x) => /^\\+/.test(x.textContent || '')); if (b) b.click(); return !!b; })()
  `);
  await sleep(700);
  await shot(win, "degree-chosen");

  await hit(win, `(t) => /^next$/i.test(t)`);
  await shot(win, "tour-board");
  await hit(win, `(t) => /^next$/i.test(t)`);
  await shot(win, "tour-tree");

  // ---- 6-9 · a degree chosen, nothing planned ----------------------------
  await reset(win, { seed: undefined });
  await win.webContents.executeJavaScript(`
    localStorage.setItem("gradtree:profile:v1", JSON.stringify({ enrolledIds: ${JSON.stringify(SEEDS.nursingFull.enrolledIds)} })); true;
  `);
  await new Promise((r) => { win.webContents.once("did-finish-load", r); win.webContents.reload(); });
  await sleep(2600);
  await shot(win, "empty-board-requirements");

  // expand the biggest requirement so the course chips show
  await win.webContents.executeJavaScript(`
    (() => {
      const bs = [...document.querySelectorAll('button')]
        .filter((b) => /show the \\d+ courses in/i.test(b.getAttribute('aria-label') || ''));
      if (!bs.length) return false;
      bs.sort((a, b) => Number(b.getAttribute('aria-label').match(/show the (\\d+)/i)[1])
                      - Number(a.getAttribute('aria-label').match(/show the (\\d+)/i)[1]));
      bs[0].scrollIntoView({ block: 'center' }); bs[0].click(); return true;
    })()
  `);
  await sleep(900);
  await shot(win, "requirement-expanded");

  await openTree(win);
  await sleep(2200);
  await shot(win, "tree-nursing");

  // select a course: upstream and downstream light up
  await clickText(win, ".react-flow__node", "/NURS 322/");
  await sleep(1500);
  await shot(win, "tree-course-selected");

  // the detail panel, on the board where nothing overlaps it
  await reset(win, { seed: "nursingFull" });
  await clickText(win, "[role='button']", "/BIO 264|NURS 310|CHEM 101/");
  await sleep(1200);
  await shot(win, "course-detail");

  // ---- 11-15 · planning --------------------------------------------------
  await reset(win, { seed: "nursingPartial" });
  await shot(win, "board-part-planned");

  await hit(win, `(t) => /select courses/i.test(t)`);
  await sleep(800);
  await shot(win, "select-courses-mode");

  await reset(win, { seed: "nursingFull" });
  await shot(win, "board-full-plan");

  await hit(win, `(t) => /^insights$/i.test(t)`);
  await sleep(1200);
  await shot(win, "insights");

  // the add-to-semester picker, from the class search
  await hit(win, `(t) => /^requirements$/i.test(t)`);
  const classSearch = await locate(win, `(t) => /search for a class/i.test(t)`);
  if (classSearch) {
    await click(win, classSearch.x, classSearch.y);
    await type(win, "nurs 3");
  }
  await shot(win, "class-search");
  await win.webContents.executeJavaScript(`
    (() => { const b = [...document.querySelectorAll('button')].find((x) => /add .* to a semester/i.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return !!b; })()
  `);
  await sleep(1000);
  await shot(win, "add-to-semester");

  // ---- 16 · Sprout catching a real mistake -------------------------------
  await reset(win, { seed: "businessSplit" });
  await win.webContents.executeJavaScript(`
    (() => {
      const c = [...document.querySelectorAll('[title]')].find((e) => /same semester/i.test(e.getAttribute('title') || ''));
      if (c) c.scrollIntoView({ block: 'center', inline: 'center' });
      return !!c;
    })()
  `);
  await sleep(700);
  await shot(win, "warning-same-semester");

  // ---- 17-20 · other degrees --------------------------------------------
  await reset(win, { seed: "csFull" });
  await shot(win, "board-computer-science");
  await openTree(win);
  await sleep(2200);
  await shot(win, "tree-computer-science");

  await reset(win, { seed: "nursingFull" });
  await openTree(win);
  await sleep(2000);
  await win.webContents.executeJavaScript(`
    (() => { const n = document.querySelector('.react-flow__node'); if (n) n.scrollIntoView({ block: 'center' }); return true; })()
  `);
  await sleep(600);
  await shot(win, "tree-planned-statuses");

  await openBoard(win);
  await hit(win, `(t) => /plan actions/i.test(t)`);
  await sleep(700);
  await shot(win, "programs-menu");

  console.log(`\n${n} screenshots written\n`);
  await sleep(200);
  app.quit();
})
  .catch((err) => {
    console.log("screenshots crashed:", err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
    app.quit();
  });
