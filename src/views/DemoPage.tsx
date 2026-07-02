import { DemoViewer } from "../components/DemoViewer";

// The interactive demo — the real ddc viewer over baked findings, read-only.
// General sections only (treemap, findings + evidence, project tree, summary);
// advanced views are screenshots on the Roadmap page.
export function DemoPage() {
  return (
    <div className="demo-surface flex h-full flex-col">
      <div className="border-b border-line px-4 pt-4">
        <h1 className="text-xl font-bold tracking-tight">Live demo</h1>
        <p className="mb-3 max-w-2xl text-sm text-fg-muted">
          This is the actual dead-data-cleaner viewer, running read-only on real{" "}
          <code>ddc&nbsp;--json</code> output from the repositories below. Nothing is live or sent
          anywhere. The findings are baked straight into the page.
        </p>
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <DemoViewer />
      </div>
    </div>
  );
}
