import type { DdcReport, Finding, GraphData } from "../types";

// Lightweight runtime validation. We don't pull in a schema lib for this; we
// just confirm the top-level shape so a bad file produces a clear error rather
// than a blank screen.
export function parseReport(raw: unknown): DdcReport {
  if (!raw || typeof raw !== "object") {
    throw new Error("Not a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.findings)) {
    throw new Error("Missing `findings` array — is this a `ddc --json` file?");
  }
  if (!obj.metrics || typeof obj.metrics !== "object") {
    throw new Error("Missing `metrics` object.");
  }
  if (!obj.run || typeof obj.run !== "object") {
    throw new Error("Missing `run` object.");
  }
  return raw as DdcReport;
}

const RULE_LABELS: Record<string, string> = {
  "orphan-file": "Orphan file",
  "unused-export": "Unused export",
  "never-called": "Never called",
  "could-be-local": "Could be local",
  "unused-dependency": "Unused dependency",
  "missing-dependency": "Missing dependency",
  "duplicate-block": "Duplicate block",
  "doc-drift": "Doc drift",
  "orphan-doc": "Orphan doc",
  "seems-outdated": "Seems outdated",
  "forgot-to-track": "Forgot to track",
  "untracked-local-data": "Untracked local data",
  "vulnerable-dependency": "Vulnerable dependency",
  "deprecated-dependency": "Deprecated dependency",
  "reinvented-wheel": "Reinvented wheel",
  "prefer-library": "Prefer library",
  // Cross-layer (M11) rules — surfaced via the P21 cross-layer drill-downs.
  "unused-endpoint": "Unused endpoint",
  "frontend-call-to-missing-route": "Call to missing route",
  "over-fetched-response-field": "Over-fetched response field",
  // Architecture-drift (P23) rule.
  "architecture-violation": "Architecture violation",
  // Env-var (WP7) rules.
  "dead-env-var": "Dead env var",
  "missing-env-var": "Missing env var",
};

export function ruleLabel(rule: string): string {
  return RULE_LABELS[rule] ?? rule;
}

// "Show me the code" join — resolve a finding's (repo-relative) target into the
// absolute path + highlight range the FileViewer needs. Returns null when the
// target is not a real on-disk file (e.g. a dependency-name target), when the
// target path is empty, or when we have no absolute root to join against
// (`targetRoot` empty → we can't form an absolute path, so don't try to read).
// Pure: just string joins + a kind check, no I/O.
export interface RevealTarget {
  absPath: string;
  displayPath: string; // repo-relative, for the header
  highlightStart: number | null;
  highlightEnd: number | null;
}

// Target kinds that name a real file on disk (so a span maps to source lines).
// Non-file kinds (e.g. "dependency") carry an identifier, not a path, in
// `target.path` and must not be joined/read. "data" is the env-var (WP7) kind:
// its `target.path` is the declaring/ref FILE (a `.env`/compose/source file) and
// its span is the declaration/ref line, so it reveals like any other file target.
const FILE_TARGET_KINDS = new Set(["file", "symbol", "doc", "data"]);

// POSIX join: strip a trailing slash on the root and a leading slash on the tail so
// we never double up the separator.
function posixJoin(root: string, tail: string): string {
  return `${root.replace(/\/+$/, "")}/${tail.replace(/^\/+/, "")}`;
}

// Multi-root member-prefix resolution shared by both reveal functions: split the
// repo-relative `rel` on its FIRST `/`, look the member-id up in `memberRoots`, and
// join that member's ABSOLUTE root with the remainder. Returns the resolved
// `RevealTarget` (carrying the caller's already-computed highlights) on a hit, or
// `null` when there's no member map / no `/` prefix / the prefix names no known
// member — in which case the caller FALLS THROUGH to its single-root join.
function resolveMemberPrefixed(
  rel: string,
  memberRoots: Record<string, string> | undefined,
  highlightStart: number | null,
  highlightEnd: number | null,
): RevealTarget | null {
  if (!memberRoots) return null;
  const slash = rel.indexOf("/");
  if (slash <= 0) return null;
  const memberId = rel.slice(0, slash);
  const memberRoot = memberRoots[memberId];
  if (!memberRoot) return null;
  return {
    absPath: posixJoin(memberRoot, rel.slice(slash + 1)),
    displayPath: rel,
    highlightStart,
    highlightEnd,
  };
}

export function revealForFinding(
  finding: Finding,
  targetRoot: string | undefined,
  memberRoots?: Record<string, string>,
): RevealTarget | null {
  if (!FILE_TARGET_KINDS.has(finding.target.kind)) return null;
  const rel = finding.target.path;
  if (!rel) return null;

  // Multi-root mode (WP5.3.2): the report carries a `member_roots` map and every
  // on-disk path is `"<member_id>/<rel>"`. Split on the FIRST `/`, look the member-id
  // up in the map, and join its ABSOLUTE root with the remainder. We keep the
  // prefixed path as `displayPath` so the UI header still shows which member it is.
  // Only takes this branch when the prefix actually names a known member; otherwise
  // it falls through to the single-root join (defensive for a path with no prefix).
  const hit = resolveMemberPrefixed(
    rel,
    memberRoots,
    finding.target.span ? finding.target.span.start_line : null,
    finding.target.span ? finding.target.span.end_line : null,
  );
  if (hit) return hit;
  // memberRoots absent, or present but this path has no resolvable member prefix →
  // fall through to the single-root join below (still needs a real targetRoot).

  // Single-root mode (unchanged, byte-identical): join against the one target root.
  if (!targetRoot) return null;
  return {
    absPath: posixJoin(targetRoot, rel),
    displayPath: rel,
    highlightStart: finding.target.span ? finding.target.span.start_line : null,
    highlightEnd: finding.target.span ? finding.target.span.end_line : null,
  };
}

// A clone SITE (one member of a `duplicate-block` clone class) lives in
// `evidence.graph.sites[]`, NOT in `finding.target`, so it needs its own reveal
// join. It carries a repo-relative `path` + a 1-based `start_line`/`end_line`;
// we resolve it to the absolute path + highlight range a FileViewer needs,
// applying the SAME member-prefix split as `revealForFinding` so multi-root
// reveal works (clone-site paths are member-prefixed in multi-root). Returns null
// when there is no usable path or no root to join against (browser/no roots).
// Pure: just string joins, no I/O.
interface CloneSiteReveal {
  path: string;
  start_line?: number | null;
  end_line?: number | null;
}

export function revealForCloneSite(
  site: CloneSiteReveal,
  targetRoot: string | undefined,
  memberRoots?: Record<string, string>,
): RevealTarget | null {
  const rel = site.path;
  if (!rel || rel === "(unknown)") return null;
  const highlightStart = typeof site.start_line === "number" ? site.start_line : null;
  const highlightEnd = typeof site.end_line === "number" ? site.end_line : null;

  // Multi-root: the site path is `"<member_id>/<rel>"`. Split on the FIRST `/`,
  // resolve the member's absolute root, and join the remainder. Keep the prefixed
  // path as `displayPath` so the header still shows the member. Mirrors
  // `revealForFinding`.
  const hit = resolveMemberPrefixed(rel, memberRoots, highlightStart, highlightEnd);
  if (hit) return hit;
  // No member map / no resolvable member prefix → fall through to the single-root join.

  // Single-root: join against the one target root.
  if (!targetRoot) return null;
  return {
    absPath: posixJoin(targetRoot, rel),
    displayPath: rel,
    highlightStart,
    highlightEnd,
  };
}

// Phase 2b — best-effort map a finding to a node id in the `graph`, so the
// Findings tab can deep-link into the Trace tree. The finding's own `node_id`
// does NOT share the graph's id format (graph routes are keyed by member, not
// source-file path), so we resolve structurally instead:
//   - route findings (unused-endpoint): match a `route` node by method + path
//     (from evidence.graph.method / path_normalized).
//   - file findings (orphan-file, …): match a `file` node by `target.path`.
// Returns the node id, or null when no node matches.
export function findNodeIdForFinding(
  graph: GraphData | undefined,
  finding: Finding,
): string | null {
  if (!graph) return null;
  const g = finding.evidence.graph as Record<string, unknown>;
  const method = typeof g.method === "string" ? g.method : null;
  const path =
    typeof g.path_normalized === "string"
      ? g.path_normalized
      : typeof g.path === "string"
        ? (g.path as string)
        : null;
  if (method && path) {
    const route = graph.nodes.find(
      (n) => n.kind === "route" && n.method === method && n.path === path,
    );
    if (route) return route.id;
    const call = graph.nodes.find(
      (n) => n.kind === "call" && n.method === method && n.path === path,
    );
    if (call) return call.id;
  }
  // Fall back to a file node by target path.
  const tp = finding.target.path;
  const file = graph.nodes.find((n) => n.kind === "file" && n.path === tp);
  return file ? file.id : null;
}
