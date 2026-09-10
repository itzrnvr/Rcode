/*
 * PURPOSE: Theme engine — applies Theme settings as CSS variables on :root
 *
 * Called once in App.tsx. Whenever the theme changes (from settings),
 * the CSS variables update and the entire app re-themes instantly.
 *
 * Also handles:
 * - Translucent sidebar: toggles a class on :root
 * - Contrast: adds contrast-{level} class for border/muted adjustments
 */

import { useEffect } from "react";

import type { Theme } from "../types";

export function useTheme(theme: Theme): void {
  useEffect(() => {
    const root = document.documentElement;

    // Color tokens
    root.style.setProperty("--color-accent", theme.accent);
    root.style.setProperty("--color-bg", theme.background);
    root.style.setProperty("--color-fg", theme.foreground);
    root.style.setProperty("--color-surface", theme.surface);
    root.style.setProperty("--color-sidebar", theme.sidebar);
    root.style.setProperty("--color-border", theme.border);
    root.style.setProperty("--color-muted", theme.muted);
    root.style.setProperty("--color-success", theme.success);
    root.style.setProperty("--color-warning", theme.warning);
    root.style.setProperty("--color-danger", theme.danger);
    root.style.setProperty("--color-bg-secondary", theme.surface);
    root.style.setProperty("--color-bg-tertiary", theme.border);
    // Prebuilt primitives consume shadcn token names. Keep them in lockstep with
    // the authoritative Rcode palette so model/menu surfaces stay dark in every theme.
    root.style.setProperty("--background", theme.background);
    root.style.setProperty("--foreground", theme.foreground);
    root.style.setProperty("--card", theme.surface);
    root.style.setProperty("--card-foreground", theme.foreground);
    root.style.setProperty("--popover", theme.surface);
    root.style.setProperty("--popover-foreground", theme.foreground);
    root.style.setProperty("--primary", theme.accent);
    root.style.setProperty("--primary-foreground", theme.background);
    root.style.setProperty("--secondary", theme.surface);
    root.style.setProperty("--secondary-foreground", theme.foreground);
    root.style.setProperty("--muted", theme.surface);
    root.style.setProperty("--muted-foreground", theme.muted);
    root.style.setProperty("--accent", theme.surface);
    root.style.setProperty("--accent-foreground", theme.foreground);
    root.style.setProperty("--destructive", theme.danger);
    root.style.setProperty("--destructive-foreground", theme.background);
    root.style.setProperty("--border", theme.border);
    root.style.setProperty("--input", theme.border);
    root.style.setProperty("--ring", theme.accent);

    // Typography
    root.style.setProperty("--font-ui", theme.uiFont);
    root.style.setProperty("--font-code", theme.codeFont);
    root.style.setProperty("--font-scale", String(theme.fontSizeScale));
    document.documentElement.style.fontSize = `${Math.round(theme.fontSizeScale * 16)}px`;

    // Geometry
    root.style.setProperty("--radius", `${theme.radius}px`);
    root.style.setProperty("--radius-sm", `${Math.max(4, theme.radius - 6)}px`);
    root.style.setProperty("--radius-lg", `${theme.radius + 6}px`);

    // Dark / light
    root.dataset.theme = theme.preset;
    root.dataset.mode = theme.darkMode ? "dark" : "light";

    root.dataset.translucent = theme.translucentSidebar ? "true" : "false";

    root.classList.remove("contrast-low", "contrast-high");
    if (theme.contrast !== "medium") {
      root.classList.add(`contrast-${theme.contrast}`);
    }
  }, [theme]);
}
