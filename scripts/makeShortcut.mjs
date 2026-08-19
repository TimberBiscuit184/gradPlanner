/**
 * Creates a double-clickable Sprout shortcut on the Windows desktop.
 *
 * Why not just ship the packaged `.exe`? Because on this machine the antivirus
 * eats it. `npm run desktop:build` completes, and then Bitdefender quarantines
 * `Sprout.exe`, both installers and ~100 DLLs — a false positive on freshly
 * built, unsigned Electron binaries. What survives untouched is
 * `node_modules/electron/dist/electron.exe`, which is the *same* Electron that
 * would have been renamed to `Sprout.exe` during packaging.
 *
 * So the shortcut runs that directly against this project. Same app, same
 * window, same icon — it just never creates a new executable for a scanner to
 * object to. `electron.exe` is a GUI binary, so there is no console window.
 *
 * Trade-off worth knowing: this launches the **built** app from `dist/`, so run
 * `npm run build` after changing the source. It also needs the project folder
 * and `node_modules` to stay where they are — it is a shortcut, not an install.
 *
 *   npm run shortcut
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "node_modules", "electron", "dist", "electron.exe");
const icon = join(root, "build", "icon.ico");

if (process.platform !== "win32") {
  console.error("This shortcut helper is Windows-only.");
  process.exit(1);
}
if (!existsSync(exe)) {
  console.error(
    `Electron is missing at:\n  ${exe}\n\n` +
      "Run `npm run desktop:fix` to download it, then try again.",
  );
  process.exit(1);
}
if (!existsSync(join(root, "dist", "index.html"))) {
  console.error(
    "No build found in dist/. Run `npm run build` first — the shortcut opens\n" +
      "the built app, not the dev server.",
  );
  process.exit(1);
}

// Single-quoted PowerShell strings: double any apostrophe in a path.
const ps = (s) => s.replace(/'/g, "''");

const script = `
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut((Join-Path $desktop 'Sprout.lnk'))
$lnk.TargetPath = '${ps(exe)}'
$lnk.Arguments = '"${ps(root)}"'
$lnk.WorkingDirectory = '${ps(root)}'
$lnk.IconLocation = '${ps(icon)},0'
$lnk.Description = 'Sprout - BYU-Idaho degree planner'
$lnk.Save()
Write-Output (Join-Path $desktop 'Sprout.lnk')
`;

const res = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-NonInteractive", "-Command", script],
  { encoding: "utf8" },
);

if (res.status !== 0) {
  console.error(res.stderr || "Failed to create the shortcut.");
  process.exit(res.status ?? 1);
}

console.log(`\nShortcut created:\n  ${res.stdout.trim()}\n`);
console.log("Double-click it to open Sprout. Drag it anywhere you like —");
console.log("it keeps working as long as this project folder stays put.\n");
