/**
 * Packages the desktop app, working around a locked output directory.
 *
 * Why this exists: real-time antivirus (Bitdefender, on this machine) keeps a
 * handle on `app.asar` and the built `.exe`s for a while after they are
 * written. No process shows them as loaded modules, so it looks like nothing is
 * holding them — but the next `electron-builder` run dies with
 * `EBUSY: resource busy or locked, unlink .../resources/app.asar` before it can
 * clear the previous build. The first build into a *fresh* directory always
 * works; only rebuilds over an existing one fail.
 *
 * So: try to clear the output directory, and if it is locked, build into the
 * next free one instead of failing. A stale directory is a few hundred MB of
 * litter you can delete later; a build that refuses to run is a wall.
 *
 * The permanent fix is a scanner exclusion for this folder — printed below when
 * the fallback kicks in, rather than buried in a doc nobody reads mid-failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "dist-desktop";
/** Enough attempts to survive a long scan; past this something else is wrong. */
const MAX_FALLBACKS = 20;

/** True if the directory is gone (or was never there) when we return. */
function clear(dir) {
  try {
    rmSync(resolve(root, dir), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function pickOutputDir() {
  if (clear(BASE)) return { dir: BASE, locked: false };
  for (let n = 2; n <= MAX_FALLBACKS; n++) {
    const candidate = `${BASE}-${n}`;
    if (!existsSync(resolve(root, candidate))) return { dir: candidate, locked: true };
    if (clear(candidate)) return { dir: candidate, locked: true };
  }
  return null;
}

const picked = pickOutputDir();
if (!picked) {
  console.error(
    `\nEvery output directory from ${BASE} to ${BASE}-${MAX_FALLBACKS} is locked.\n` +
      "Close GradTree if it is running, then delete them by hand.\n",
  );
  process.exit(1);
}

const { dir, locked } = picked;
if (locked) {
  console.log(
    `\n  ${BASE}/ is locked by a background process — almost always real-time\n` +
      `  antivirus holding the last build's app.asar. Building into ${dir}/ instead.\n` +
      `  Delete the stale folder later, or exclude this project from your\n` +
      "  antivirus's real-time scanning to stop it happening at all.\n",
  );
}

// Run the CLI's entry point with this Node rather than shelling out to the
// `.cmd` shim: `shell: true` concatenates arguments instead of escaping them,
// and the output directory is a path that can contain spaces.
const cli = resolve(root, "node_modules", "electron-builder", "cli.js");
const res = spawnSync(
  process.execPath,
  [cli, "--win", `--config.directories.output=${dir}`],
  { cwd: root, stdio: "inherit" },
);
if (res.status !== 0) process.exit(res.status ?? 1);

const out = resolve(root, dir);
const exes = readdirSync(out)
  .filter((f) => f.endsWith(".exe"))
  .map((f) => `  ${dir}/${f}  (${(statSync(join(out, f)).size / 1e6).toFixed(0)} MB)`);
console.log(`\nBuilt:\n${exes.join("\n")}\n`);
