import { create } from "zustand";

// View switching with no router (mirrors anvil-poc / auto-audiobook). Add detail
// views (e.g. "item") and carry the selected id in `itemId`.
// CHANGEME: tailor the view union to your page arc (PLAYBOOK §3).
export type AppView =
  | "landing"
  | "why"
  | "how-it-works"
  | "demo"
  | "roadmap"
  | "investors"
  | "survey";

interface ViewState {
  view: AppView;
  /** selected item id for any detail view reached from the demo */
  itemId: string | null;
  setView: (view: AppView) => void;
  openItem: (id: string) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  view: "landing",
  itemId: null,
  setView: (view) => set({ view }),
  openItem: (id) => set({ view: "demo", itemId: id }),
}));
