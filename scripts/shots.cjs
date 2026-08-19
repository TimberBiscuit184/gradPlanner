/* Capture the app's main surfaces — `npm run shots -- <label>`
 *
 * A restyle is judged by looking, so it needs a before and an after of the
 * same four screens. Writes <label>-board.png, -tree.png, -detail.png and
 * -menu.png into SHOT_DIR (default ./shots).
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { writeFileSync, mkdirSync } = require("node:fs");

const ROOT = path.join(__dirname, "..");
const LABEL = process.argv[2] || process.env.LABEL || "shot";
const OUT = process.env.SHOT_DIR || path.join(ROOT, "shots");
const MAJOR = process.env.MAJOR || "Nursing";
const THEME = process.env.THEME || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PLAN = null;
ipcMain.on("gradtree:plan-read", (e) => { e.returnValue = PLAN; });
ipcMain.on("gradtree:plan-write", (_e, p) => { PLAN = p; });

async function click(win, x, y) {
  for (const t of ["mouseDown", "mouseUp"]) {
    win.webContents.sendInputEvent({ type: t, x, y, button: "left", clickCount: 1 });
    await sleep(35);
  }
  await sleep(250);
}
async function type(win, text) {
  for (const ch of text) {
    win.webContents.sendInputEvent({ type: "char", keyCode: ch });
    await sleep(35);
  }
  await sleep(400);
}
const locate = (win, pred) => win.webContents.executeJavaScript(`
  (() => {
    const b = [...document.querySelectorAll('button,[role="tab"],input')].find((x) =>
      (${pred})(((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('placeholder') || '') + ' ' + (x.textContent || '')).replace(/\\s+/g,' ').trim()));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return { hidden: true };
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()
`);
async function shot(win, name) {
  writeFileSync(path.join(OUT, `${LABEL}-${name}.png`), (await win.webContents.capturePage()).toPNG());
  console.log("  ", `${LABEL}-${name}.png`);
}

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1600, height: 1000, show: true,
    webPreferences: { preload: path.join(ROOT, "electron/preload.cjs") },
  });
  await win.loadFile(path.join(ROOT, "dist/index.html"));
  await sleep(2000);
  // Mark onboarding as seen. The first-run walkthrough is modal, so without
    // this every driver that expects a blank app lands on the introduction and
    // finds none of the controls it is looking for.
  await win.webContents.executeJavaScript("localStorage.clear(); localStorage.setItem('gradtree:onboarded:v1', '1'); true;");
  PLAN = null;
  await new Promise((r) => { win.webContents.once("did-finish-load", r); win.webContents.reload(); });
  await sleep(2500);
  if (THEME)
    await win.webContents.executeJavaScript(
      `document.documentElement.setAttribute("data-theme", ${JSON.stringify(THEME)}); true;`,
    );

  // enrol so the surfaces have real content in them
  const menu = await locate(win, `(t) => /plan actions/i.test(t)`);
  await click(win, menu.x, menu.y);
  const tab = await locate(win, `(t) => /^programs\\b/i.test(t)`);
  if (tab && !tab.hidden) await click(win, tab.x, tab.y);
  const box = await locate(win, `(t) => /search programs to add/i.test(t)`);
  await click(win, box.x, box.y);
  await type(win, MAJOR);
  const hit = await win.webContents.executeJavaScript(`
    (() => { const b = [...document.querySelectorAll('button')].find((x) => /^\\+/.test(x.textContent || ''));
      if (!b) return null; const r = b.getBoundingClientRect();
      return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; })()
  `);
  if (hit) await click(win, hit.x, hit.y);
  await sleep(1500);

  console.log(`\n${LABEL}:`);
  await shot(win, "board");

  const treeTab = await locate(win, `(t) => /^tree$/i.test(t)`);
  if (treeTab && !treeTab.hidden) { await click(win, treeTab.x, treeTab.y); await sleep(2000); }
  await shot(win, "tree");

  // a course detail popover, where the type scale is smallest
  await win.webContents.executeJavaScript(`
    (() => { const n = document.querySelector('.react-flow__node'); if (n) n.click(); return !!n; })()
  `);
  await sleep(1200);
  await shot(win, "detail");

  const menu2 = await locate(win, `(t) => /plan actions/i.test(t)`);
  if (menu2 && !menu2.hidden) { await click(win, menu2.x, menu2.y); await sleep(600); }
  await shot(win, "menu");

  await sleep(200);
  app.quit();
})
  .catch((err) => {
    console.log("shots crashed:", err?.message ?? String(err));
    process.exitCode = 1;
    app.quit();
  });
