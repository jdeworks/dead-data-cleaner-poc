import { Card } from "../components/kit";

const REASONS = [
  {
    t: "Follow the data from front to back",
    d: "A value leaves a frontend call and lands in a backend route. dead-data-cleaner traces that path across folders and languages and flags the breaks: a call to a route that no longer exists, a response field nobody reads, a shape that changed on one side only. A single-language tool cannot see across that line.",
  },
  {
    t: "Catch documentation that lies",
    d: "Docs drift away from the code they describe. A README that points at a deleted module, a guide for an API that has since changed, a comment that stopped being true months ago. The tool compares your docs against the real symbols and shows you exactly where they no longer agree.",
  },
  {
    t: "Give the assistant the map it is missing",
    d: "An AI coding assistant cannot see the clutter it is stepping around. It does not know which helper is dead, which file is a leftover, or which plan was abandoned. This builds that map, so you and your assistant both work from what the code actually is today.",
  },
  {
    t: "Stop paying for prompt bloat",
    d: "Giant, outdated markdown files get pulled into context on every request. They burn tokens, slow answers, and feed the model stale instructions. The tool finds the oversized and orphaned docs that are quietly inflating your prompts.",
  },
  {
    t: "Old plans are worse than no plans",
    d: "A feature gets designed in a markdown plan, then reworked, but the first version stays in the repo. Next time an assistant reads it, it builds against a design that was already dropped. Clearing those stale plans keeps the model and the team pointed at the current one.",
  },
  {
    t: "Find the duplication you forgot about",
    d: "Copy-pasted blocks spread across files and slowly drift apart. The tool groups the clones, ranks them by how much they cost, and shows you where the same logic is living in five places at once.",
  },
];

export function WhyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
        Why dead-data-cleaner
      </p>
      <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
        Writing code was never the hard part. Keeping track of it was.
      </h1>
      <p className="mb-12 max-w-2xl text-lg text-fg-muted">
        AI assistants have made that harder, not easier. They produce code, docs, and config faster
        than any team can review or remove. The pile grows quietly, and most of it stays invisible
        until it is everywhere. Here is where the tool earns its place.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {REASONS.map((r) => (
          <Card key={r.t}>
            <h3 className="mb-1.5 font-semibold">{r.t}</h3>
            <p className="text-sm leading-relaxed text-fg-muted">{r.d}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-accent/30 bg-accent/5 p-5">
        <h3 className="mb-1.5 font-semibold">And in the end, delete with confidence</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
          Without proof that something is truly dead, the safe choice is always to leave it. So it
          stays, forever. Every finding here shows why it was flagged and how sure the tool is, so
          removing it becomes a decision you can defend instead of a guess.
        </p>
      </div>
    </div>
  );
}
