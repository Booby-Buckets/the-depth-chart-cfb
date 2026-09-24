"use client";

import { useSyncExternalStore } from "react";

// The theme lives on <html data-theme> (set before paint by the layout's inline script), so
// the button subscribes to that attribute instead of keeping its own copy.
function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const getTheme = () => document.documentElement.getAttribute("data-theme");
const getServerTheme = () => null; // unknown on the server: render an empty button, fill in after hydration

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  function toggle() {
    const next = getTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("tdc_theme", next); } catch {}
  }

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Toggle light and dark theme" aria-pressed={theme ? theme === "dark" : undefined}>
      {theme === null ? "" : theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
