import { useViewStore } from "../stores/view-store";
import { Card } from "../components/kit";

const TOOLS = ["dead-data-cleaner", "knip / ts-prune", "vulture", "cargo-udeps", "IDE / coverage"];
const ROWS: { axis: string; cells: string[] }[] = [
  { axis: "Languages", cells: ["Many, and growing", "JS / TS", "Python", "Rust", "Varies"] },
  { axis: "Sees docs, data, and config", cells: ["Yes", "No", "No", "No", "No"] },
  { axis: "Deterministic and CI-friendly", cells: ["Yes", "Yes", "Yes", "Yes", "Partial"] },
  { axis: "Visual evidence", cells: ["Yes", "No", "No", "No", "No"] },
  { axis: "Follows client to service", cells: ["Yes", "No", "No", "No", "No"] },
];

const WHY_NOW = [
  {
    t: "The problem scales with AI",
    d: "Teams already lost a large slice of their time to legacy and bad code. AI has not fixed that. It has accelerated it. The more code assistants write, the more dead code, stale docs, and abandoned plans pile up behind them.",
  },
  {
    t: "Assistants make it worse, and need the fix",
    d: "An assistant cannot see the clutter it works around. It reads outdated plans, pulls bloated docs into context, and builds on dead paths. The same map that helps a person clean up keeps an assistant on the current design.",
  },
  {
    t: "Cleanup is unglamorous and unowned",
    d: "Nobody gets assigned to delete. The tools that exist cover one language, look at code only, and answer in walls of text. So the work slips until the codebase is hard to move in.",
  },
];

export function InvestorsPage() {
  const setView = useViewStore((s) => s.setView);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
        For investors
      </p>
      <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
        The cleanup layer for an AI-written world.
      </h1>
      <p className="mb-12 max-w-2xl text-lg text-fg-muted">
        Every team now ships code faster than it can review. Assistants generate, scaffold, and copy
        at a pace no human cleanup keeps up with. dead-data-cleaner makes removing the dead weight
        safe, for the people maintaining the code and for the assistants writing more of it.
      </p>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">Why now</h2>
      <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {WHY_NOW.map((c) => (
          <Card key={c.t}>
            <h3 className="mb-1.5 font-semibold">{c.t}</h3>
            <p className="text-sm leading-relaxed text-fg-muted">{c.d}</p>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
        Where we fit
      </h2>
      <div className="mb-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-2 pr-4 font-medium text-fg-muted">&nbsp;</th>
              {TOOLS.map((t, i) => (
                <th
                  key={t}
                  className={`px-3 py-2 font-medium ${i === 0 ? "text-accent" : "text-fg-muted"}`}
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.axis} className="border-b border-line">
                <td className="py-2 pr-4 font-medium">{r.axis}</td>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    className={`px-3 py-2 ${i === 0 ? "font-semibold text-fg" : "text-fg-muted"}`}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-12 text-xs text-fg-dim">
        knip, ts-prune, vulture, and cargo-udeps are good, focused tools. Each covers one language
        and code only. The opening is the union of all of them, plus the docs and data they ignore,
        with evidence that makes deletion safe.
      </p>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
        Why it holds
      </h2>
      <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="mb-1.5 font-semibold">Breadth that compounds</h3>
          <p className="text-sm leading-relaxed text-fg-muted">
            The cross-language reference graph gets more valuable with every language and rule added.
            A competitor covering one language cannot reach across the client-to-service line.
            Catching up means rebuilding the graph, not shipping a flag.
          </p>
        </Card>
        <Card>
          <h3 className="mb-1.5 font-semibold">Trust is the moat</h3>
          <p className="text-sm leading-relaxed text-fg-muted">
            Anyone can list lines that might be unused. The hard part is making a developer confident
            enough to actually delete. The visual evidence layer is what turns a flag into an action,
            and it is the piece that is hard to copy.
          </p>
        </Card>
        <Card>
          <h3 className="mb-1.5 font-semibold">Local-first, easy to adopt</h3>
          <p className="text-sm leading-relaxed text-fg-muted">
            It runs on your machine and nothing leaves it. The optional AI layer uses your own key.
            There is nothing to procure and no data to hand over, so a single developer can start
            today.
          </p>
        </Card>
        <Card>
          <h3 className="mb-1.5 font-semibold">From one developer to a team</h3>
          <p className="text-sm leading-relaxed text-fg-muted">
            It starts as a tool a developer reaches for, then grows into team dashboards that track
            entropy and reclaimed space across every repository. The wedge is the individual; the
            expansion is the org.
          </p>
        </Card>
      </div>

      <div className="mb-10 rounded-xl border border-accent/30 bg-accent/5 p-5">
        <h3 className="mb-1.5 font-semibold">Traction so far</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
          Over 20 repositories scanned in development and more than 10,000 findings surfaced, on real
          public and private codebases. The live demo on this site runs on two of those scans, with
          reproducible output you can click through yourself.
        </p>
      </div>

      <button
        onClick={() => setView("survey")}
        className="rounded-lg bg-accent-dim px-6 py-2.5 font-medium text-accent-fg"
      >
        Get in touch
      </button>
    </div>
  );
}
