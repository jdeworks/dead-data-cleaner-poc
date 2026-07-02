import { useState } from "react";
import { useViewStore } from "./stores/view-store";
import { useThemeStore } from "./stores/theme-store";
import { Sidebar } from "./components/Sidebar";
import { LandingPage } from "./views/LandingPage";
import { WhyPage } from "./views/WhyPage";
import { HowItWorksPage } from "./views/HowItWorksPage";
import { DemoPage } from "./views/DemoPage";
import { RoadmapPage } from "./views/RoadmapPage";
import { InvestorsPage } from "./views/InvestorsPage";
import { SurveyPage } from "./components/SurveyPage";

const PRODUCT = "dead-data-cleaner";

export default function App() {
  const view = useViewStore((s) => s.view);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <div className="hidden sm:flex">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 sm:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative h-full w-64" onClick={(e) => e.stopPropagation()}>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <div className="flex items-center gap-2 border-b border-line bg-canvas-alt px-3 py-2 sm:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="flex h-11 w-11 min-w-[44px] items-center justify-center rounded-md border border-line text-lg text-fg-muted"
          >
            ☰
          </button>
          <span className="text-base font-bold tracking-tight">{PRODUCT}</span>
          <button
            onClick={toggleTheme}
            aria-label="Toggle light / dark theme"
            className="ml-auto flex h-11 w-11 min-w-[44px] items-center justify-center rounded-md border border-line text-fg-muted"
          >
            {theme === "dark" ? "☾" : "☀"}
          </button>
        </div>

        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          {view === "landing" && <LandingPage />}
          {view === "why" && <WhyPage />}
          {view === "how-it-works" && <HowItWorksPage />}
          {view === "demo" && <DemoPage />}
          {view === "roadmap" && <RoadmapPage />}
          {view === "investors" && <InvestorsPage />}
          {view === "survey" && <SurveyPage />}
        </main>
      </div>
    </div>
  );
}
