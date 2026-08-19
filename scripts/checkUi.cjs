/* UI regression check — `npm run ui:check` (needs `npm run build` first).
 *
 * Drives the packaged app and asserts the two workflow fixes stay fixed. Both
 * were found by walking ten personas through the real UI, and neither is
 * visible to any engine-level test: they are about what a student can see.
 *
 *   1. after adding a program, is the requirements panel visible — or is the
 *      ⋯ menu still sitting on top of it?
 *   2. can a student see the expander that reveals a requirement's courses
 *      WITHOUT hovering, including on the big elective pools?
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { writeFileSync } = require("node:fs");

const ROOT = "C:/Users/Colby Shannon/Documents/claudeBuilds/gradPlanner";
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
  await sleep(1200);

  // 1. is the menu gone, and did the student get told what happened?
  const after = await win.webContents.executeJavaScript(`
    (() => {
      const menuStillOpen = !!document.querySelector('input[aria-label="Search programs to add"]');
      const toast = [...document.querySelectorAll('*')]
        .map((e) => (e.childElementCount === 0 ? (e.textContent || '').trim() : ''))
        .find((t) => /^Added .+requirements are on the right/.test(t)) || null;
      return { menuStillOpen, toast };
    })()
  `);

  // 2. expanders: visible without hovering, and on every pool?
  const expanders = await win.webContents.executeJavaScript(`
    (() => {
      const bs = [...document.querySelectorAll('button')]
        .filter((b) => /show the \\d+ courses in/i.test(b.getAttribute('aria-label') || ''));
      const visible = bs.filter((b) => getComputedStyle(b).display !== 'none');
      const sizes = bs.map((b) => Number((b.getAttribute('aria-label').match(/show the (\\d+)/i) || [])[1] || 0));
      return { total: bs.length, visibleWithoutHover: visible.length, biggestPool: Math.max(0, ...sizes) };
    })()
  `);

  // open the biggest pool and confirm it renders something usable
  const opened = await win.webContents.executeJavaScript(`
    (() => {
      const bs = [...document.querySelectorAll('button')]
        .filter((b) => /show the \\d+ courses in/i.test(b.getAttribute('aria-label') || ''));
      if (!bs.length) return null;
      bs.sort((a, b) => Number(b.getAttribute('aria-label').match(/show the (\\d+)/i)[1])
                      - Number(a.getAttribute('aria-label').match(/show the (\\d+)/i)[1]));
      bs[0].scrollIntoView({ block: 'center' });
      bs[0].click();
      return bs[0].getAttribute('aria-label');
    })()
  `);
  await sleep(900);
  const chips = await win.webContents.executeJavaScript(`
    (() => {
      const more = [...document.querySelectorAll('p')].map((p) => p.textContent.trim())
        .find((t) => /and \\d+ more/.test(t)) || null;
      return { moreLine: more };
    })()
  `);

  // Screenshot only when asked. Writing to an undefined path threw before
  // app.quit(), leaving the window open and the run hanging.
  if (OUT) writeFileSync(path.join(OUT, "frictions.png"), (await win.webContents.capturePage()).toPNG());
  const report = { enrolled: hit.text, ...after, expanders, opened, ...chips };
  console.log(JSON.stringify(report, null, 1));

  const failures = [];
  if (after.menuStillOpen) failures.push("the menu still covers the requirements panel after adding a program");
  if (!after.toast) failures.push("adding a program says nothing");
  if (expanders.total === 0) failures.push("no requirement can be expanded");
  if (expanders.visibleWithoutHover !== expanders.total)
    failures.push(`${expanders.total - expanders.visibleWithoutHover} expanders are hidden until hover`);
  if (expanders.biggestPool < 40)
    failures.push("large pools still have no expander");
  for (const f of failures) console.log("FAIL:", f);
  console.log(
    failures.length
      ? `\n${failures.length} UI check(s) failed\n`
      : "\nUI checks pass\n",
  );
  await sleep(300);
  process.exitCode = failures.length ? 1 : 0;
  app.quit();
})
  /**
   * Catch the promise, not a `try` inside it.
   *
   * The body is an async callback, so anything it throws surfaces as an
   * unhandled rejection rather than an uncaught exception — and in Electron's
   * main process that means a modal "A JavaScript error occurred" dialog on
   * the user's screen and a run that hangs until someone dismisses it. That is
   * exactly how this script wasted six minutes and put a dialog in front of
   * the owner. A check must never be able to do that.
   */
  .catch((err) => {
    console.log("UI check crashed:", err?.message ?? String(err));
    process.exitCode = 1;
    app.quit();
  });
