import { create } from "zustand";

type Theme = "light" | "dark";

// CHANGEME: namespace the localStorage key to your product.
const STORAGE_KEY = "dead-data-cleaner-poc-theme";

function initial(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return "dark"; // dark default — match the product
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle("light", theme === "light");
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const theme = initial();
  apply(theme);
  return {
    theme,
    toggle: () => {
      const next: Theme = get().theme === "dark" ? "light" : "dark";
      apply(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      set({ theme: next });
    },
  };
});
