"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const theme = useTheme();
  return (
    <button className="themeToggle" type="button" onClick={theme.toggle} aria-label={`Switch to ${theme.resolved === "dark" ? "light" : "dark"} mode`}>
      {theme.resolved === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
