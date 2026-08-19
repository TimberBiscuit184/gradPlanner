/* First-run walkthrough — `npm run welcome:check` (needs `npm run build`).
 *
 * Three things have to hold, and the third is the one that would annoy people:
 *   1. a brand-new student sees it
 *   2. picking a major inside it actually enrols them
 *   3. it never comes back
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { writeFileSync } = require("node:fs");

const ROOT = path.join(__dirname, "..");
const OUT = process.env.SHOT_DIR;
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
const find = (win, pred) => win.webContents.executeJavaScript(`
  (() => {
    const b = [...document.querySelectorAll('button,input')].find((x) =>
      (${pred})(((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('placeholder') || '') + ' ' + (x.textContent || '')).replace(/\\s+/g,' ').trim()));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()
`);
/**
 * A screenshot is evidence, never a verdict. `capturePage()` threw
 * `UnknownVizError` on the first run of this check — a compositor hiccup — and
 * took the whole run down with it, reporting a crash for a walkthrough that
 * was working.
 */
async function shot(win, name) {
  if (!OUT) return;
  try {
    writeFileSync(path.join(OUT, name), (await win.webContents.capturePage()).toPNG());
  } catch (err) {
    console.log("  (screenshot", name, "failed:", err && err.message, ")");
  }
}

const dialogOpen = (win) => win.webContents.executeJavaScript(
  `!!document.querySelector('[aria-label="Welcome to Sprout"]')`,
);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1600, height: 1000, show: true,
    webPreferences: { preload: path.join(ROOT, "electron/preload.cjs") },
  });
  await win.loadFile(path.join(ROOT, "dist/index.html"));
  await sleep(2000);
  await win.webContents.executeJavaScript("localStorage.clear(); true;");
  PLAN = null;
  await new Promise((r) => { win.webContents.once("did-finish-load", r); win.webContents.reload(); });
  await sleep(2500);

  const failures = [];
  const shownOnFirstRun = await dialogOpen(win);
  if (!shownOnFirstRun) failures.push("a new student never saw the walkthrough");
  await shot(win, "welcome-1.png");

  // Step 1 → the programs step
  const next = await find(win, `(t) => /^next$/i.test(t)`);
  if (next) await click(win, next.x, next.y);
  await sleep(600);

  const search = await find(win, `(t) => /search programs/i.test(t)`);
  if (!search) failures.push("the programs step has no search box");
  else {
    await click(win, search.x, search.y);
    await type(win, "Nursing");
    const hit = await win.webContents.executeJavaScript(`
      (() => { const b = [...document.querySelectorAll('button')].find((x) => /^\\+/.test(x.textContent || ''));
        if (!b) return null; const r = b.getBoundingClientRect();
        return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; })()
    `);
    if (!hit) failures.push("searching inside the walkthrough returned nothing");
    else await click(win, hit.x, hit.y);
  }
  await sleep(800);
  await shot(win, "welcome-2.png");

  const enrolled = await win.webContents.executeJavaScript(
    `JSON.parse(localStorage.getItem('gradtree:profile:v1') || '{"enrolledIds":[]}').enrolledIds.length`,
  );
  if (!enrolled) failures.push("picking a major in the walkthrough did not enrol the student");

  // Skip out, then reload — it must not come back.
  const skip = await find(win, `(t) => /^skip$/i.test(t)`);
  if (!skip) failures.push("no Skip control");
  else await click(win, skip.x, skip.y);
  await sleep(600);
  if (await dialogOpen(win)) failures.push("Skip did not close the walkthrough");

  await new Promise((r) => { win.webContents.once("did-finish-load", r); win.webContents.reload(); });
  await sleep(2500);
  if (await dialogOpen(win)) failures.push("the walkthrough came back on the next launch");
  await shot(win, "welcome-3.png");

  console.log(JSON.stringify({ shownOnFirstRun, enrolledFromWalkthrough: enrolled }, null, 1));
  for (const f of failures) console.log("FAIL:", f);
  console.log(failures.length ? `\n${failures.length} check(s) failed\n` : "\nWalkthrough checks pass\n");
  await sleep(200);
  process.exitCode = failures.length ? 1 : 0;
  app.quit();
})
  .catch((err) => {
    console.log("welcome check crashed:", err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
    app.quit();
  });
