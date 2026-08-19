/**
 * Light or dark, chosen by the student and remembered.
 *
 * The Sprout site is warm paper, so light is the default and what the app
 * looks like out of the box. Dark stays because a dense planning board at 11px
 * is genuinely easier at night, and dropping a working theme to match a
 * marketing page would be a trade, not an improvement.
 *
 * Applied to `<html data-theme>`, which is the only thing `index.css` keys on —
 * no component knows which theme is running.
 */
export type Theme = "light" | "dark";

const KEY = "gradtree:theme:v1";

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* private mode, or storage disabled — fall through to the default */
  }
  return "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the choice just will not persist; the app still works */
  }
}
