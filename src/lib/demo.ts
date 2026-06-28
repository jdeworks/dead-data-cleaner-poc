// Loaders for the baked demo fixtures under public/demo/. Everything the SPA renders
// comes from here — there is no backend and no /api call anywhere. Each *-findings.json
// is genuine `ddc <repo> --json` output, directly consumable by parseReport().

/** Base for baked assets: Vite's BASE_URL (the Pages subpath) + "demo/". */
function getBase(): string {
  const base = import.meta.env?.BASE_URL ?? "/";
  return base.replace(/\/$/, "") + "/demo/";
}

/** Resolve a path under public/demo/ to a base-path-aware URL. */
export function demoAssetUrl(relativePath: string): string {
  return getBase() + relativePath.replace(/^\/+/, "");
}

export async function fetchJson<T>(relativePath: string): Promise<T> {
  const res = await fetch(demoAssetUrl(relativePath));
  if (!res.ok) throw new Error(`demo fixture not found: ${relativePath}`);
  return (await res.json()) as T;
}

// ── Stats (real aggregates, generated from the two public-repo scans) ──
export interface DemoStats {
  generatedWith: string;
  product: { languages: number; rule_types: string; determinism: string };
  totals: { repos: number; findings: number; files: number; loc: number; rule_types: number };
  repos: {
    name: string;
    language: string;
    kind: string;
    findings: number;
    files: number;
    loc: number;
    duplication_ratio: number;
    graph_nodes: number;
    rules: Record<string, number>;
  }[];
}

let _stats: Promise<DemoStats> | null = null;
export function loadStats(): Promise<DemoStats> {
  return (_stats ??= fetchJson<DemoStats>("stats.json"));
}

// ── Demo fixtures (the repo switcher) ──
export interface DemoFixture {
  id: string;
  label: string;
  language: string;
  /** the one-line story this fixture tells */
  story: string;
  file: string;
}

export const FIXTURES: DemoFixture[] = [
  {
    id: "ripgrep",
    label: "ripgrep",
    language: "Rust · public",
    story: "A real public Rust CLI: dead subtrees, orphaned docs and 25% duplication.",
    file: "ripgrep-findings.json",
  },
  {
    id: "tmux-poc",
    label: "tmux-poc",
    language: "Python · ours",
    story: "Our own AI-agent harness — the exact kind of project ddc is built to keep clean.",
    file: "tmux-poc-findings.json",
  },
];

const _reports = new Map<string, Promise<unknown>>();
/** Load a fixture's raw ddc report JSON (cached). Pass to parseReport(). */
export function loadFixtureRaw(id: string): Promise<unknown> {
  const fx = FIXTURES.find((f) => f.id === id) ?? FIXTURES[0];
  let p = _reports.get(fx.id);
  if (!p) {
    p = fetchJson<unknown>(fx.file);
    _reports.set(fx.id, p);
  }
  return p;
}
