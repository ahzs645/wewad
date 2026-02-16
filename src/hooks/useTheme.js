import { useEffect, useState } from "react";

export function useTheme() {
  const [themePreference, setThemePreference] = useState(() => {
    try { return localStorage.getItem("wewad-theme") || "system"; }
    catch { return "system"; }
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      let resolved;
      if (themePreference === "light" || themePreference === "dark") {
        resolved = themePreference;
      } else {
        resolved = mediaQuery.matches ? "dark" : "light";
      }
      document.documentElement.dataset.theme = resolved;
    };
    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    try { localStorage.setItem("wewad-theme", themePreference); } catch {}
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [themePreference]);

  return { themePreference, setThemePreference };
}
