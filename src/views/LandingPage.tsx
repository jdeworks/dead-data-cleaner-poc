import { useViewStore } from "../stores/view-store";
import { Card } from "../components/kit";

const STATS = [
  { n: "10,000+", label: "findings surfaced in development" },
  { n: "20+", label: "repositories scanned" },
  { n: "28+", label: "deterministic rule types" },
  { n: "100%", label: "local, nothing leaves your machine" },
];

export function LandingPage() {
  const setView = useViewStore((s) => s.setView);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
        Proof of concept · static demo · no backend
      </p>
      <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
        Keep your codebase lean, clean, and understandable.
      </h1>
      <p className="mb-8 max-w-2xl text-lg text-fg-muted">
        dead-data-cleaner scans your project, the code and the data, and shows you the dead weight:
        unused symbols, orphaned files, stale docs, duplicated blocks, dangling config. It runs
        deterministically by default, adds AI help only when you ask, and shows its reasoning so you
        can trust what it flags before you delete anything.
      </p>

      <div className="mb-10 flex flex-wrap gap-3">
        <button
          onClick={() => setView("demo")}
          className="rounded-lg bg-accent-dim px-6 py-2.5 font-medium text-accent-fg"
        >
          Explore real findings
        </button>
        <button
          onClick={() => setView("how-it-works")}
          className="rounded-lg border border-line px-6 py-2.5 font-medium text-fg-muted hover:text-fg"
        >
          How it works
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {STATS.map((s) => (
          <Card key={s.label}>
            <div className="text-3xl font-bold tabular-nums">{s.n}</div>
            <div className="text-sm text-fg-muted">{s.label}</div>
          </Card>
        ))}
      </div>
      <p className="mt-3 text-xs text-fg-dim">
        Numbers from our own development across many real repositories. The live demo below runs on
        ripgrep, tmux, and one of our own small harnesses.
      </p>

      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <h3 className="mb-1 font-semibold">It sees the data, not only the code</h3>
          <p className="text-sm text-fg-muted">
            Orphaned docs, dead config keys, duplicated blocks, untracked artifacts. The clutter that
            code-only tools never look at.
          </p>
        </Card>
        <Card>
          <h3 className="mb-1 font-semibold">Deterministic at the core</h3>
          <p className="text-sm text-fg-muted">
            The same repository always produces the same findings. No model decides what is dead, so
            results are reproducible, CI-friendly, and fully offline. AI is an optional layer on top.
          </p>
        </Card>
        <Card>
          <h3 className="mb-1 font-semibold">Evidence you can read</h3>
          <p className="text-sm text-fg-muted">
            Every finding carries a confidence score built from clear, inspectable factors, laid out
            on a treemap and a graph you can take in at a glance.
          </p>
        </Card>
      </div>
    </div>
  );
}
