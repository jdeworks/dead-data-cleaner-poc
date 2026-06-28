const STEPS = [
  {
    t: "Scan, deterministically",
    d: "tree-sitter parses every language in your stack in a single pass and builds a reference graph of each symbol, file, doc, and data path. No model decides what is dead, so the same repository always produces the same findings.",
  },
  {
    t: "Score with evidence",
    d: "Each finding gets a confidence built from clear, inspectable factors, plus a tier that states how certain it is. You see the reasoning behind the number rather than a verdict from a black box, so it holds up in CI.",
  },
  {
    t: "Visualize so you can judge",
    d: "A treemap sized by cost and colored by severity, a dependency graph that shows the dead branches, and an evidence panel for every finding. You read the health of the whole repository at a glance.",
  },
  {
    t: "Clean safely, or let it help",
    d: "Nothing is removed unless you ask, and cleanup is deterministic and opt-in. An optional AI layer, running on your own key, can explain and triage the harder cases without ever gating the scan.",
  },
];

export function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
        From raw repo to a cleanup you can defend
      </p>
      <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">How it works</h1>
      <p className="mb-12 max-w-2xl text-lg text-fg-muted sm:mb-16">
        Four stages turn a sprawling codebase into a short, evidence-backed list of what is safe to
        remove. Deterministic at the core, visual on top.
      </p>

      <ol className="space-y-10 sm:space-y-14">
        {STEPS.map((s, i) => (
          <li key={s.t} className="flex flex-col gap-4 sm:flex-row sm:gap-7">
            <div
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-2xl font-bold text-accent"
            >
              {i + 1}
            </div>
            <div className="sm:pt-1">
              <h2 className="mb-2 text-2xl font-semibold tracking-tight">{s.t}</h2>
              <p className="max-w-2xl text-base leading-relaxed text-fg-muted">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
