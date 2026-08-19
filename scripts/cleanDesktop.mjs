/**
 * Deletes the desktop build output, including any `dist-desktop-N` fallbacks
 * `packDesktop.mjs` had to create when the scanner was holding the last build.
 *
 * Run it once the antivirus has let go (closing GradTree and waiting a minute
 * is usually enough). Anything still locked is reported rather than swallowed —
 * a cleanup that silently leaves 300 MB behind is worse than one that says so.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^dist-desktop(-\d+)?$/.test(e.name))
  .map((e) => e.name);

if (!dirs.length) {
  console.log("Nothing to clean.");
  process.exit(0);
}

const stuck = [];
for (const d of dirs) {
  try {
    rmSync(resolve(root, d), { recursive: true, force: true });
    console.log(`removed ${d}/`);
  } catch (err) {
    stuck.push(`${d}/ — ${err.code ?? "failed"}`);
  }
}

if (stuck.length) {
  console.log(
    `\nStill locked:\n${stuck.map((s) => `  ${s}`).join("\n")}\n\n` +
      "Close GradTree if it is open. If it stays locked, real-time antivirus is\n" +
      "holding the built .exe/.asar files — exclude this project folder from\n" +
      "scanning, or try again in a few minutes.\n",
  );
  process.exit(1);
}
