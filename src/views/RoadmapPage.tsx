import { useEffect, useState } from "react";
import { demoAssetUrl, fetchJson } from "../lib/demo";
import { Card } from "../components/kit";

// Road ahead — already built vs where it's headed, plus an advanced-features
// screenshot gallery (the views we *show* but don't hand over interactively).

const BUILT = [
  "A deterministic engine that is reproducible, CI-friendly, and fully offline",
  "28+ rule types covering dead subtrees, orphan files, unused and missing dependencies, duplication, and doc drift",
  "Many languages parsed in a single pass, with more added regularly",
  "Coverage beyond code: orphaned docs, dead config, and untracked data",
  "Confidence scores built from clear factors, each with a certainty tier",
  "Cross-layer analysis that follows calls between a client and its service across folders",
  "Incremental re-analysis that re-runs only the part that changed, in milliseconds",
  "Git signals (churn, last touched, authorship) that feed the stale-code rules",
  "An optional AI layer, on your own key, that explains and triages without gating the scan",
  "A cross-platform desktop app plus a headless CLI with a JSON findings feed",
];

const AHEAD = [
  {
    t: "More languages",
    d: "New language support lands regularly as the parser set grows, so more of your stack gets the full reference graph.",
  },
  {
    t: "Profiling sets",
    d: "Save and share rule sets that tune the scan or exclude parts of a repository, so each project gets the checks that fit it.",
  },
  {
    t: "Standard exports",
    d: "SARIF and other CI-native formats straight from the findings feed.",
  },
  {
    t: "Team dashboards",
    d: "Track entropy and reclaimed space over time across all of your repositories.",
  },
];

interface Shot {
  file: string;
  caption: string;
  group?: string;
}

export function RoadmapPage() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<Shot[]>("screenshots/index.json")
      .then(setShots)
      .catch(() => setShots([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Road ahead</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Already built
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BUILT.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 text-success-fg">✓</span>
              <span className="text-fg-muted">{b}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Advanced features
        </h2>
        <p className="mb-3 max-w-2xl text-sm text-fg-dim">
          The deeper views: cross-layer, architecture drift, the dependency graph, duplication, doc
          health, and origin flow. Shown here as screenshots, while the live demo stays on the
          general views.
        </p>
        {shots.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {shots.map((s) => (
              <figure key={s.file}>
                <img
                  src={demoAssetUrl(`screenshots/${s.file}`)}
                  alt={s.caption}
                  onClick={() => setZoom(demoAssetUrl(`screenshots/${s.file}`))}
                  className="w-full cursor-zoom-in rounded-lg border border-line"
                />
                <figcaption className="mt-1 text-xs text-fg-muted">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <Card>
            <p className="max-w-2xl text-sm text-fg-dim">
              Screenshot gallery coming, captured from the real desktop app.
            </p>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Where it's headed
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {AHEAD.map((a) => (
            <Card key={a.t}>
              <h3 className="mb-1 font-semibold">{a.t}</h3>
              <p className="text-sm text-fg-muted">{a.d}</p>
            </Card>
          ))}
        </div>
      </section>

      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setZoom(null)}
        >
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
