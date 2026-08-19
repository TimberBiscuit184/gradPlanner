import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, storedTheme } from "./ui/theme";

/**
 * One class, set before the first paint, is the whole web-vs-desktop switch.
 * Everything the desktop shell changes — the header doubling as a draggable
 * title bar, the gap reserved for the native window buttons — hangs off
 * `.is-desktop` in index.css, so the browser build is untouched and there is no
 * second code path to keep in sync.
 */
if (window.gradtree?.desktop) {
  document.documentElement.classList.add("is-desktop");
}

/**
 * Set the theme before React mounts. Doing it in a component would paint the
 * default palette for a frame first, which reads as a flash of the wrong
 * colour every time the app opens.
 */
applyTheme(storedTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
