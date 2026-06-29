import { useEffect, useState } from "react";
import { FIXTURES, loadFixtureRaw } from "../lib/demo";
import { parseReport } from "../lib/report";
import type { DdcReport } from "../types";
import { MetricsHeader } from "./MetricsHeader";
import { Treemap } from "./Treemap";
import { FindingsPanel } from "./FindingsPanel";
import { DuplicationView } from "./DuplicationView";
import { ProjectTree } from "./ProjectTree";
import { Panel } from "./ui";
import { inertControlProps } from "./demoInert";

// The live, read-only viewer: real ddc components (treemap, findings + evidence,
// project tree, summary) fed a baked `ddc --json` fixture. No Tauri, no backend —
// every desktop-only path takes its browser fallback automatically (lib/tauri self-stubs).

type DemoView = "summary" | "treemap" | "findings" | "duplication" | "tree";

const VIEWS: { id: DemoView; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "treemap", label: "Treemap" },
  { id: "findings", label: "Findings" },
  { id: "duplication", label: "Duplication" },
  { id: "tree", label: "Project tree" },
];

// Advanced views the full app ships but that aren't wired into this static demo.
// Rendered as inert "preview-only" tabs whose tooltip points at the marketing
// site's screenshot gallery ("Road ahead" page) so it reads as "the tool does
// more — see screenshots", not as broken tabs.
const PREVIEW_VIEWS: string[] = [
  "Cross-layer",
  "Dependency graph",
  "Architecture",
  "Doc health",
  "Origin flow",
];
const PREVIEW_TOOLTIP = "See this on the Road ahead page";

export function DemoViewer() {
  const [fixtureId, setFixtureId] = useState(FIXTURES[0].id);
  const [report, setReport] = useState<DdcReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DemoView>("treemap");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Mobile: the repo switcher + view tabs are only needed to switch, yet they ate
  // most of a phone screen. Collapse them behind a compact bar (open on demand);
  // on desktop (sm+) they're always shown via `sm:block` and this flag is moot.
  const [controlsOpen, setControlsOpen] = useState(false);
  const currentViewLabel = VIEWS.find((v) => v.id === view)?.label ?? view;
  // Picking a view on mobile collapses the controls so the content gets the screen.
  const selectView = (id: DemoView) => {
    setView(id);
    setControlsOpen(false);
  };

  useEffect(() => {
    let live = true;
    setReport(null);
    setError(null);
    setSelectedPath(null);
    loadFixtureRaw(fixtureId)
      .then((raw) => {
        if (!live) return;
        setReport(parseReport(raw));
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [fixtureId]);

  const fixture = FIXTURES.find((f) => f.id === fixtureId)!;

  return (
    <div className="flex h-full flex-col">
      {/* Mobile-only collapse toggle — shows the current repo + view and expands the
          switcher/tabs on demand. Hidden on sm+ where the controls are always shown. */}
      <button
        type="button"
        className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-sm sm:hidden"
        onClick={() => setControlsOpen((o) => !o)}
        aria-expanded={controlsOpen}
        aria-controls="demo-controls"
      >
        <span className="min-w-0 truncate">
          <span className="text-fg-muted">{fixture.label}</span>
          <span className="text-fg-dim"> · </span>
          <span className="font-medium">{currentViewLabel}</span>
        </span>
        <span className="shrink-0 text-fg-muted">
          {controlsOpen ? "Hide ▴" : "Switch repo / view ▾"}
        </span>
      </button>

      {/* Collapsible controls: collapsed by default on mobile, always shown on sm+. */}
      <div id="demo-controls" className={controlsOpen ? "" : "hidden sm:block"}>
        {/* Repo switcher */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Scanned repo
          </span>
          {FIXTURES.map((f) => (
            <button
              key={f.id}
              onClick={() => setFixtureId(f.id)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                f.id === fixtureId
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line text-fg-muted hover:border-fg-muted"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70">{f.language}</span>
            </button>
          ))}
        </div>
        <p className="border-b border-line px-4 py-2 text-sm text-fg-muted">{fixture.story}</p>

        {/* View tabs — the 4 working tabs, then a divider and inert "preview-only"
            tabs that advertise the full app's advanced views (screenshots live on
            the marketing "Road ahead" page). The inert preview tabs are non-functional
            advertising, so they're hidden on mobile to save vertical space. */}
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => selectView(v.id)}
              className={view === v.id ? "active" : ""}
            >
              {v.label}
            </button>
          ))}

          <span className="hidden sm:contents">
            <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
            <span className="mr-1 text-xs font-medium text-fg-muted">In full tool:</span>
            {PREVIEW_VIEWS.map((label) => (
              <button
                key={label}
                type="button"
                {...inertControlProps(PREVIEW_TOOLTIP)}
                className="cursor-default opacity-50 hover:opacity-75"
                style={{ borderStyle: "dashed" }}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && (
          <div className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-error-fg">
            Could not load fixture: {error}
          </div>
        )}
        {!error && !report && (
          <div className="flex items-center justify-center py-20 text-sm text-fg-muted">
            Loading {fixture.label}…
          </div>
        )}
        {report && (
          <div className="h-full">
            {view === "summary" && (
              <MetricsHeader
                metrics={report.metrics}
                run={report.run}
                findings={report.findings}
              />
            )}
            {view === "treemap" && (
              <Panel title="Files by severity. Click a cell to see its findings">
                <div style={{ height: "60vh" }}>
                  <Treemap
                    findings={report.findings}
                    scanInventory={report.scan_inventory}
                    hasGraph={!!report.graph}
                    selectedPath={selectedPath}
                    onSelectFile={(p) => {
                      setSelectedPath(p);
                      setView("findings");
                    }}
                    demoInert
                  />
                </div>
              </Panel>
            )}
            {view === "findings" && (
              // `demo-fill` gives the panel a bounded, definite height so its own
              // `.findings-table-wrap` is the sole, fully-visible scroller (the
              // vendored `max-height: calc(100vh - 320px)` is tuned for the full
              // app's chrome and runs the table off-screen in this embedding — see
              // index.css). Mirrors the fixed-height wrapper the Treemap view uses.
              <div className="demo-fill">
                <FindingsPanel
                  findings={report.findings}
                  pathFilter={selectedPath}
                  onClearPathFilter={() => setSelectedPath(null)}
                  graph={report.graph}
                  origins={report.origins}
                  targetRoot={report.run.target_root}
                  memberRoots={report.member_roots}
                  onOpenDuplication={() => setView("duplication")}
                  demoInert
                />
              </div>
            )}
            {view === "duplication" && (
              <DuplicationView
                findings={report.findings}
                metrics={report.metrics}
                targetRoot={report.run.target_root}
                memberRoots={report.member_roots}
              />
            )}
            {view === "tree" && (
              <ProjectTree
                findings={report.findings}
                inventory={report.scan_inventory}
                graph={report.graph}
                targetRoot={report.run.target_root}
                memberRoots={report.member_roots}
                selectedPath={selectedPath}
                onSelectFile={setSelectedPath}
                onShowInFindings={(p) => {
                  setSelectedPath(p);
                  setView("findings");
                }}
                demoInert
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
