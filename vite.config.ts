import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Lock the built page down to its own bundle.
 *
 * Build-only, because Vite's dev server injects an inline React Refresh script
 * that a strict `script-src` blocks. `style-src 'unsafe-inline'` is needed for
 * the `style` attributes React writes (panel geometry, progress bars); nothing
 * here loosens script execution.
 */
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    "connect-src 'self'",
  ].join("; ");
  return {
    name: "gradtree-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
  };
}

export default defineConfig({
  // Relative asset URLs so the same build works from a web server *and* from
  // the file:// URL the desktop shell loads.
  base: "./",
  plugins: [react(), tailwindcss(), csp()],
  server: {
    // `npm run desktop` sets VITE_PORT and points Electron at the same number.
    // `strictPort` is on only in that case, on purpose: if the port is taken,
    // plain `npm run dev` should politely move to 5175, but the desktop script
    // must fail loudly instead — a server that silently lands on a different
    // port than the window is looking at is the whole reason the desktop app
    // appeared to "just open localhost".
    port: Number(process.env.VITE_PORT ?? 5174),
    strictPort: process.env.VITE_PORT !== undefined,
  },
});
