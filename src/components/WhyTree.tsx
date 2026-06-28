import { useMemo, useState } from "react";
import type { Finding, GraphData, OriginRow } from "../types";
import { derivedConfidence } from "../lib/severity";
import { findNodeIdForFinding } from "../lib/report";

// B-VIZ2 — the interactive "why tree" for ONE finding.
//
// The owner's standing directive: visualize EVERYTHING ddc does with traceable
// why-chains. The EvidencePanel already renders the why-chain as flat sections
// (reason, score math, per-rule TraceDetail, raw graph). This turns that SAME
// data into an explorable TREE: the finding sits at the root and its supporting
// evidence hangs off it as expandable branches — verdict, confidence breakdown
// (base_prior × multipliers → derived), the evidence.graph blob (walked
// generically), the target location, the matching origin-flow chain, and the
// whole-stack graph node. Leaf nodes deep-link (reveal-to-graph / reveal-to-file
// via the callbacks the EvidencePanel already wires).
//
// GENERIC over evidence shapes: different rules carry different `evidence.graph`
// shapes (an open JSON blob). We render what's present and gracefully omit what
// isn't — no rule is hard-coded. A handful of well-known graph keys get nicer
// treatment (clone `sites`, `inbound_edges`, …) but everything else still renders
// via a generic JSON-value walk, so a brand-new rule's evidence shows up too.
//
// Pure frontend over EXISTING report data. No new analysis. Deterministic node
// ordering (insertion order for branches, key-sorted for generic object walks).

// ── the tree node model ─────────────────────────────────────────────────────
// Each node has a stable `key` (its address in the tree — used for expand state),
// a `label` (left), an optional `value` (right, monospace), an optional `tone`
// (ok/bad/warn for the dot), an optional `link` (makes it a deep-link leaf), and
// optional `children` (a branch). A branch with `children: []` renders as an
// (empty) leaf; `undefined` children means a plain leaf.

type WhyTone = "ok" | "bad" | "warn" | "muted";

interface WhyLink {
  /** "graph" → focus this node in the whole-stack Trace tree (onTraceInGraph).
   *  "file" → reveal the finding's file/span (handled by the parent panel). */
  kind: "graph" | "file";
  /** The graph node id (for kind="graph"). */
  nodeId?: string;
  /** A human label for the link affordance. */
  hint: string;
}

interface WhyNode {
  key: string;
  label: string;
  value?: string;
  tone?: WhyTone;
  /** When set, the node is a deep-link leaf. */
  link?: WhyLink;
  children?: WhyNode[];
  /** Default-expanded when first shown (root branches that matter). */
  open?: boolean;
}

// ── generic value formatting ────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** A short scalar rendering for the right-hand value column. */
function scalarValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return "";
}

/** Walk an arbitrary JSON value (from the untyped `evidence.graph`) into why-tree
 *  nodes. Scalars become labelled leaves; arrays become a branch with one child
 *  per element; objects become a branch with one child per key (KEY-SORTED for
 *  determinism). `keyPrefix` keeps node keys unique + stable across the tree.
 *  Depth-guarded so a pathological/cyclic blob can't recurse forever. */
function walkJson(
  label: string,
  value: unknown,
  keyPrefix: string,
  depth = 0,
): WhyNode {
  const key = keyPrefix;
  if (depth >= 6) {
    return { key, label, value: "…" };
  }
  if (Array.isArray(value)) {
    return {
      key,
      label,
      value: `${value.length} item${value.length === 1 ? "" : "s"}`,
      children: value.map((el, i) =>
        walkJson(`[${i}]`, el, `${key}.${i}`, depth + 1),
      ),
    };
  }
  if (isObj(value)) {
    const keys = Object.keys(value).sort();
    return {
      key,
      label,
      value: `{${keys.length}}`,
      children: keys.map((k) =>
        walkJson(k, value[k], `${key}.${k}`, depth + 1),
      ),
    };
  }
  return { key, label, value: scalarValue(value), tone: scalarTone(label, value) };
}

/** Tiny heuristic colour for a generic scalar — `true`/non-zero on a positive
 *  field reads "ok", a 0/false reads neutral. Kept conservative: we only tint a
 *  few obviously-directional keys; everything else stays muted. */
function scalarTone(label: string, v: unknown): WhyTone | undefined {
  const l = label.toLowerCase();
  if (typeof v === "boolean") {
    if (l.includes("orphan") || l.includes("unused") || l.includes("missing")) {
      return v ? "bad" : "ok";
    }
    if (l.includes("reachable") || l.includes("declared") || l.includes("complete")) {
      return v ? "ok" : "warn";
    }
  }
  if (typeof v === "number" && (l.includes("importer") || l.includes("caller") || l.includes("inbound"))) {
    return v === 0 ? "bad" : "ok";
  }
  return undefined;
}

// Graph keys that carry a list of FILE PATHS (or path-ish strings) we surface as
// their own branch with a friendly label. Order here is the deterministic render
// order of the "Evidence" sub-branches. Everything NOT in this set still renders
// via the generic walk under "more evidence".
const KNOWN_LIST_KEYS: { key: string; label: string }[] = [
  { key: "inbound_edges", label: "files that import this" },
  { key: "entries_seeded", label: "entry points searched" },
  { key: "linked_services", label: "linked services" },
  { key: "declared_fields", label: "declared response fields" },
  { key: "read_fields", label: "fields actually read" },
  { key: "snake_keys", label: "snake_case wire keys" },
  { key: "camel_keys", label: "camelCase wire keys" },
  { key: "corroborating_signals", label: "corroborating signals" },
];

const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Pull the clone `sites[]` (duplicate-block) into leaves — each a path:line that
 *  could deep-link. Returns null when there are no sites. */
function siteNodes(g: Record<string, unknown>, keyPrefix: string): WhyNode[] | null {
  const sites = Array.isArray(g.sites) ? g.sites : null;
  if (!sites || sites.length === 0) return null;
  return sites.map((s, i) => {
    const o = isObj(s) ? s : {};
    const path = asStr(o.path) ?? asStr(o.file) ?? `site ${i + 1}`;
    const line = typeof o.start_line === "number" ? o.start_line : typeof o.line === "number" ? o.line : null;
    return {
      key: `${keyPrefix}.site.${i}`,
      label: `site ${i + 1}`,
      value: line !== null ? `${path}:${line}` : path,
    } satisfies WhyNode;
  });
}

// ── tree builder: a finding → its why-tree ──────────────────────────────────

/** Build the full why-tree for a finding. Pure; the caller supplies the graph (to
 *  resolve a whole-stack node deep-link) and the origin rows (to attach an
 *  origin-flow chain when this finding's route matches one). */
export function buildWhyTree(
  finding: Finding,
  graph: GraphData | undefined,
  origins: OriginRow[] | undefined,
): WhyNode {
  const { evidence, target } = finding;
  const g = (evidence.graph ?? {}) as Record<string, unknown>;
  const derived = derivedConfidence(finding);

  const branches: WhyNode[] = [];

  // 1) Verdict — the rule + its classification chips. The plain-language reason
  //    is shown verbatim by the EvidencePanel right above the tree, so we don't
  //    repeat it here (it would just be the same sentence twice); the tree adds
  //    the structured classification the flat reason line doesn't carry.
  branches.push({
    key: "verdict",
    label: "Verdict",
    value: finding.rule,
    open: true,
    tone: "bad",
    children: [
      { key: "verdict.severity", label: "severity", value: finding.severity ?? "—" },
      { key: "verdict.gating", label: "gating", value: finding.gating },
      { key: "verdict.tier", label: "determinism", value: finding.determinism_tier },
    ],
  });

  // 2) Confidence — base_prior × multipliers → derived. Each multiplier is a leaf
  //    showing its factor + the engine's detail; a factor < 1 reads "warn" (it
  //    DEMOTED confidence — the honest hedge), > 1 reads "bad" (it raised it).
  const confChildren: WhyNode[] = [
    {
      key: "conf.base",
      label: "base prior",
      value: evidence.base_prior.toFixed(3),
    },
  ];
  evidence.multipliers.forEach((m, i) => {
    confChildren.push({
      key: `conf.mult.${i}`,
      label: m.name,
      value: `×${m.factor.toFixed(3)}`,
      tone: m.factor < 1 ? "warn" : m.factor > 1 ? "bad" : "muted",
      children: m.detail ? [{ key: `conf.mult.${i}.d`, label: "detail", value: m.detail }] : undefined,
    });
  });
  confChildren.push({
    key: "conf.result",
    label: "= derived confidence",
    value: `${derived}%`,
    tone: "ok",
  });
  branches.push({
    key: "confidence",
    label: "Confidence",
    value: `${finding.confidence}%`,
    open: true,
    children: confChildren,
  });

  // 3) Evidence (the graph blob) — known list keys get friendly branches first
  //    (deterministic order), clone sites get site leaves, and everything else
  //    falls through to a generic key-sorted JSON walk under "more evidence". A
  //    finding with an EMPTY graph still gets the branch (rendered empty) so the
  //    tree shape is predictable.
  const evidenceChildren: WhyNode[] = [];
  const consumed = new Set<string>();

  const sites = siteNodes(g, "ev.sites");
  if (sites) {
    consumed.add("sites");
    evidenceChildren.push({
      key: "ev.sites",
      label: "clone sites",
      value: `${sites.length}`,
      tone: "bad",
      children: sites,
    });
  }

  for (const { key, label } of KNOWN_LIST_KEYS) {
    const v = g[key];
    if (Array.isArray(v)) {
      consumed.add(key);
      const items = v.filter((x): x is string => typeof x === "string");
      evidenceChildren.push({
        key: `ev.${key}`,
        label,
        value: `${items.length}`,
        tone: items.length === 0 ? "warn" : undefined,
        children: items.map((s, i) => ({
          key: `ev.${key}.${i}`,
          label: `· ${i + 1}`,
          value: s,
        })),
      });
    }
  }

  // Remaining graph keys → generic walk (scalars + nested), key-sorted.
  const restKeys = Object.keys(g).filter((k) => !consumed.has(k)).sort();
  const scalars = restKeys.filter((k) => {
    const v = g[k];
    return v === null || ["string", "number", "boolean"].includes(typeof v);
  });
  const nested = restKeys.filter((k) => !scalars.includes(k));
  for (const k of scalars) {
    evidenceChildren.push(walkJson(k, g[k], `ev.${k}`));
  }
  if (nested.length > 0) {
    evidenceChildren.push({
      key: "ev.more",
      label: "more evidence",
      value: `${nested.length}`,
      children: nested.map((k) => walkJson(k, g[k], `ev.more.${k}`)),
    });
  }

  branches.push({
    key: "evidence",
    label: "Evidence",
    value: evidenceChildren.length > 0 ? `${evidenceChildren.length}` : "none",
    open: evidenceChildren.length > 0,
    children: evidenceChildren,
  });

  // 4) Target — where it lives. A leaf that deep-links to the file (the parent
  //    panel already has a FileViewer for the target; this is the explicit "go
  //    there" affordance inside the tree).
  const spanTxt = target.span
    ? `:${target.span.start_line}${
        target.span.end_line !== target.span.start_line ? `-${target.span.end_line}` : ""
      }`
    : "";
  branches.push({
    key: "target",
    label: "Target",
    value: `${target.path}${spanTxt}`,
    children: [
      { key: "target.kind", label: "kind", value: target.kind },
      { key: "target.node", label: "node id", value: target.node_id },
      {
        key: "target.impact",
        label: "impact",
        value: `${finding.impact.value} ${finding.impact.metric}`,
      },
      ...(target.span
        ? [
            {
              key: "target.reveal",
              label: "show in source",
              value: `${target.path}${spanTxt}`,
              link: { kind: "file" as const, hint: "reveal file" },
            },
          ]
        : []),
    ],
  });

  // 5) Whole-stack node — when this finding maps to a node in the `--graph`
  //    reachability graph, offer a deep-link into the node-centric Trace tree
  //    (the existing TraceTree). Reuses findNodeIdForFinding (the same resolver
  //    the "Trace in graph →" button uses).
  const nodeId = graph ? findNodeIdForFinding(graph, finding) : null;
  if (nodeId) {
    branches.push({
      key: "graphnode",
      label: "Whole-stack graph",
      value: "reachability node",
      children: [
        {
          key: "graphnode.link",
          label: "open in Trace tree",
          value: nodeId,
          link: { kind: "graph", nodeId, hint: "trace in graph" },
        },
      ],
    });
  }

  // 6) Origin flow — for cross-layer findings whose route matches an origin row,
  //    attach the rename/over-fetch chain (frontend field → wire name → backend
  //    field → model, on a route). Generic over which findings carry a route:
  //    we join on (method, path) read out of the evidence graph.
  const originChain = matchOriginRows(g, origins);
  if (originChain.length > 0) {
    branches.push({
      key: "origins",
      label: "Origin flow",
      value: `${originChain.length} field${originChain.length === 1 ? "" : "s"}`,
      children: originChain.map((o, i) => ({
        key: `origins.${i}`,
        label: o.frontend_name,
        value: o.renamed
          ? `${o.frontend_name} ⇽ ${o.wire_name} (${o.model}.${o.backend_field})`
          : `${o.frontend_name} (${o.model}.${o.backend_field})`,
        tone: o.renamed ? "warn" : "ok",
        children: [
          { key: `origins.${i}.route`, label: "route", value: `${o.route_method} ${o.route_path}` },
          { key: `origins.${i}.svc`, label: "service", value: o.service },
          ...(o.path ? [{ key: `origins.${i}.path`, label: "read path", value: o.path }] : []),
        ],
      })),
    });
  }

  return {
    key: "root",
    label: ruleHeadline(finding),
    value: `conf ${finding.confidence}%`,
    open: true,
    tone: "bad",
    children: branches,
  };
}

/** A short root headline: the rule + the target's basename. */
function ruleHeadline(finding: Finding): string {
  const path = finding.target.path;
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return `${finding.rule} — ${base || path}`;
}

/** Join the finding's (method, path) to the report's origin rows (same key the
 *  whole-stack graph uses). Returns the matching rows (deterministic: the engine
 *  pre-sorts `origins`), or []. */
function matchOriginRows(
  g: Record<string, unknown>,
  origins: OriginRow[] | undefined,
): OriginRow[] {
  if (!origins || origins.length === 0) return [];
  const method = asStr(g.method);
  const path = asStr(g.path_normalized) ?? asStr(g.path);
  if (!method || !path) return [];
  return origins.filter(
    (o) => o.route_method === method && o.route_path === path,
  );
}

// ── rendering ───────────────────────────────────────────────────────────────

function ToneDot({ tone }: { tone?: WhyTone }) {
  if (!tone) return null;
  return <span className={`why-dot why-${tone}`} aria-hidden="true" />;
}

function WhyRow({
  node,
  depth,
  expanded,
  toggle,
  onLink,
}: {
  node: WhyNode;
  depth: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
  onLink?: (link: WhyLink) => void;
}) {
  const hasChildren = !!node.children && node.children.length > 0;
  const isOpen = expanded.has(node.key);
  const isLink = !!node.link && !!onLink;

  return (
    <>
      <div
        className={`why-row${isLink ? " why-link" : ""}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        data-testid={`why-row-${node.key}`}
        onClick={() => {
          if (isLink) onLink!(node.link!);
          else if (hasChildren) toggle(node.key);
        }}
        role={isLink ? "button" : undefined}
        title={isLink ? node.link!.hint : undefined}
      >
        <span
          className="why-twisty"
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation();
              toggle(node.key);
            }
          }}
        >
          {hasChildren ? (isOpen ? "▾" : "▸") : ""}
        </span>
        <ToneDot tone={node.tone} />
        <span className="why-label">{node.label}</span>
        {node.value !== undefined && node.value !== "" && (
          <span className="why-value mono">{node.value}</span>
        )}
        {isLink && <span className="why-link-arrow">→</span>}
      </div>
      {hasChildren && isOpen && (
        <>
          {node.children!.map((c) => (
            <WhyRow
              key={c.key}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              onLink={onLink}
            />
          ))}
        </>
      )}
    </>
  );
}

/** Collect the keys that should start expanded (any node with `open: true`,
 *  recursively). Deterministic. */
function initiallyOpen(node: WhyNode, acc: Set<string>): Set<string> {
  if (node.open) acc.add(node.key);
  for (const c of node.children ?? []) initiallyOpen(c, acc);
  return acc;
}

export function WhyTree({
  finding,
  graph,
  origins,
  onTraceInGraph,
  onRevealFile,
}: {
  finding: Finding;
  graph?: GraphData;
  origins?: OriginRow[];
  /** Deep-link a whole-stack graph node into the Trace tree tab. */
  onTraceInGraph?: (nodeId: string) => void;
  /** Reveal the finding's target file/span (the EvidencePanel scrolls its
   *  FileViewer; we just signal the intent). Optional. */
  onRevealFile?: () => void;
}) {
  const root = useMemo(
    () => buildWhyTree(finding, graph, origins),
    [finding, graph, origins],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initiallyOpen(root, new Set([root.key])),
  );

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onLink = (link: WhyLink) => {
    if (link.kind === "graph" && link.nodeId && onTraceInGraph) {
      onTraceInGraph(link.nodeId);
    } else if (link.kind === "file" && onRevealFile) {
      onRevealFile();
    }
  };

  return (
    <div className="why-tree" data-testid="why-tree">
      <WhyRow
        node={root}
        depth={0}
        expanded={expanded}
        toggle={toggle}
        onLink={onLink}
      />
    </div>
  );
}
