export type Theme = "system" | "light" | "dark";
const KEY = "handoff.theme";

export function getTheme(): Theme {
  try {
    return (localStorage.getItem(KEY) as Theme) || "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  window.dispatchEvent(new CustomEvent("handoff:theme", { detail: theme }));
}

export function isDark() {
  return document.documentElement.classList.contains("dark");
}
