import { useViewStore, type AppView } from "../stores/view-store";
import { useThemeStore } from "../stores/theme-store";

const PRODUCT = "dead-data-cleaner";

const NAV: { label: string; view: AppView }[] = [
  { label: "Overview", view: "landing" },
  { label: "Why ddc", view: "why" },
  { label: "How it works", view: "how-it-works" },
  { label: "Live demo", view: "demo" },
  { label: "Road ahead", view: "roadmap" },
  { label: "For investors", view: "investors" },
  { label: "Feedback", view: "survey" },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-canvas-alt">
      <div className="flex items-start justify-between border-b border-line px-4 py-4">
        <button
          onClick={() => {
            setView("landing");
            onNavigate?.();
          }}
          className="text-left"
        >
          <span className="block text-base font-bold tracking-tight">{PRODUCT}</span>
          <span className="mt-0.5 block text-xs text-fg-dim">dead code &amp; data, visualized</span>
        </button>
        <button
          onClick={toggle}
          aria-label="Toggle light / dark theme"
          title="Toggle theme"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-fg-muted transition-colors hover:text-fg"
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
      </div>

      <nav className="flex-1 overflow-auto p-3" aria-label="Pages">
        {NAV.map((item) => (
          <button
            key={item.view}
            onClick={() => {
              setView(item.view);
              onNavigate?.();
            }}
            className={`mb-1 flex min-h-[44px] w-full items-center rounded-md px-3 text-left text-sm transition-colors ${
              item.view === view
                ? "bg-canvas font-medium text-fg"
                : "text-fg-muted hover:bg-canvas hover:text-fg"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="border-t border-line p-3 text-xs text-fg-muted">
        <p className="mb-1">Static demo · no backend</p>
        <p>Proof of Concept</p>
      </div>
    </aside>
  );
}
