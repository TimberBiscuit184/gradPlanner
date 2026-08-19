/* Does the tree appear when you choose a degree? — `npm run tree:check`
 *
 * The bug this guards: `layoutGraph` reads the enrolment from module state,
 * but the memo that calls it did not list the enrolment as a dependency. A new
 * student picked a major and the tree stayed empty, then grew a branch at a
 * time as they planned — because planning was the only thing that invalidated
 * the memo.
 *
 * So the check is: blank app → count tree nodes → pick a major → count again,
 * WITHOUT planning anything.
 *
 * Needs `npm run build` first. Set SHOT_DIR to also capture a screenshot.
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { writeFileSync } = require("node:fs");

const ROOT = path.join(__dirname, "..");
const OUT = process.env.SHOT_DIR;
const MAJOR = process.env.MAJOR || "Nursing";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PLAN = null;
ipcMain.on("gradtree:plan-read", (e) => { e.returnValue = PLAN; });
ipcMain.on("gradtree:plan-write", (_e, p) => { PLAN = p; });

async function click(win, x, y) {
  for (const type of ["mouseDown", "mouseUp"]) {
    win.webContents.sendInputEvent({ type, x, y, button: "left", clickCount: 1 });
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
const countNodes = (win) => win.webContents.executeJavaScript(`
  document.querySelectorAll('.react-flow__node').length
`);

app.whenReady().then(async () => {
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

  // Switch to the Tree before enrolling, so the memo has already run once on
  // an empty scope — which is precisely the state that used to get stuck.
  const treeTab = await locate(win, `(t) => /^tree$/i.test(t)`);
  if (treeTab && !treeTab.hidden) await click(win, treeTab.x, treeTab.y);
  await sleep(1200);
  const before = await countNodes(win);

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
      return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2), text: b.textContent.trim() }; })()
  `);
  await click(win, hit.x, hit.y);
  await sleep(2500);

  const after = await countNodes(win);
  const placements = await win.webContents.executeJavaScript(`
    JSON.parse(localStorage.getItem('gradtree:plan:v1') || '{"placements":[]}').placements.length
  `);

  if (OUT) writeFileSync(path.join(OUT, "tree.png"), (await win.webContents.capturePage()).toPNG());

  const failures = [];
  if (after < 20)
    failures.push(`only ${after} tree nodes after choosing ${hit.text} — the tree did not populate`);
  if (after <= before)
    failures.push(`tree did not grow on enrolment (${before} → ${after})`);
  if (placements > 0)
    failures.push(`${placements} courses were planned — this check must not plan anything`);

  console.log(JSON.stringify({
    major: hit.text,
    treeNodesBeforeEnrolling: before,
    treeNodesAfterEnrolling: after,
    coursesPlanned: placements,
  }, null, 1));
  for (const f of failures) console.log("FAIL:", f);
  console.log(failures.length ? `\n${failures.length} tree check(s) failed\n` : "\nTree check passes\n");

  await sleep(300);
  process.exitCode = failures.length ? 1 : 0;
  app.quit();
})
  .catch((err) => {
    console.log("tree check crashed:", err?.message ?? String(err));
    process.exitCode = 1;
    app.quit();
  });
