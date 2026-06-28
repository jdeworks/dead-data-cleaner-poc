import type {
  Finding,
  GraphData,
  GraphNode,
  ScanInventory,
  ScanInventoryLocMetric,
} from "../types";
import {
  aggregateSeverity,
  maxSeverity,
  SEVERITY_ORDER,
  type Severity,
} from "./severity";

// A node in the project path hierarchy. NOTE: this is the PATH hierarchy, not a
// true import-dependency graph (the JSON does not yet expose import edges).
export interface TreeNode {
  name: string; // path segment
  path: string; // full path from root
  isLeaf: boolean; // a file (or non-path target) vs a directory
  findings: Finding[]; // findings on this exact node (leaf only)
  findingCount: number; // total in subtree
  loc: number; // subtree LOC (legacy: summed loc-metric finding impact). For
  // the WP04 row column use `fileLoc` (true per-file LOC from inventory).
  // WP04 (P16): true per-file LOC from `scan_inventory.files[].loc` when the
  // inventory is present; -1 == unknown (no inventory row, e.g. a non-path
  // dependency target). On a directory: subtree sum over leaves with known LOC.
  fileLoc: number;
  // `locMetric` identifies when a row's `loc` is not a meaningful source LOC
  // (e.g. PDF binary files emit `unknown`), so views can hide numeric output.
  locMetric?: ScanInventoryLocMetric;
  // WP04 (P16): per-file byte size from `scan_inventory.files[].bytes`; -1 ==
  // unknown. On a directory: subtree sum over leaves with known size.
  sizeBytes: number;
  // WP03/P12 — on-disk byte size, subtree-summed; 0 when unknown. Same source as
  // `sizeBytes` (inventory bytes) but with a 0 (not -1) unknown sentinel so the
  // treemap "size" value mode degrades to equal-area instead of negatives.
  bytes: number;
  // WP04 (P17): true iff this leaf is a hidden entry (any path segment starts
  // with "."), e.g. ".git/HEAD". On a directory: true iff EVERY descendant leaf
  // is hidden.
  hidden: boolean;
  // WP04 (P17): true iff this leaf had >=1 finding. On a directory: true iff any
  // descendant leaf had a finding. The default lean view shows only nodes with
  // findings (and non-hidden).
  hasFindings: boolean;
  severity: Severity; // worst severity in subtree
  children: TreeNode[];
}

// True iff any segment of a "/"-separated path starts with "." (a dotfile or a
// hidden directory anywhere in the path). Shared by the inventory-aware builder
// so ".git/HEAD" and "src/.env" both count as hidden.
export function isHiddenPath(path: string): boolean {
  return path.split("/").some((seg) => seg.startsWith("."));
}

// Group findings by their full target.path, preserving input order within each
// bucket. Shared by the path-tree leaf build and the import-forest severity join.
function groupByPath(findings: Finding[]): Map<string, Finding[]> {
  const byPath = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = byPath.get(f.target.path);
    if (arr) arr.push(f);
    else byPath.set(f.target.path, [f]);
  }
  return byPath;
}

function leafLoc(findings: Finding[]): number {
  return findings.reduce(
    (acc, f) => acc + (f.impact.metric === "loc" ? f.impact.value : 0),
    0,
  );
}

// Per-file metadata joined onto a leaf: true LOC + byte size from the scan
// inventory, keyed by the same relative path as a finding's `target.path`.
interface FileMeta {
  loc: number;
  bytes: number;
  locMetric?: ScanInventoryLocMetric;
}

// Build the path→{loc,bytes} map from the scan inventory. The inventory's
// `files[].path` is in the SAME relative path space as a finding's
// `target.path`, so the join is direct. Excluded files (hidden/gitignored) have
// no loc/bytes, so they are NOT included here (their leaves render with unknown
// metadata). Returns null when there is no inventory.
function fileMetaFromInventory(
  inventory: ScanInventory | undefined,
): Map<string, FileMeta> | null {
  if (!inventory) return null;
  const m = new Map<string, FileMeta>();
  for (const f of inventory.files) {
    m.set(f.path, {
      loc: f.loc,
      bytes: f.bytes,
      locMetric: f.loc_metric,
    });
  }
  return m;
}

function emptyDir(name: string, path: string): TreeNode {
  return {
    name,
    path,
    isLeaf: false,
    findings: [],
    findingCount: 0,
    loc: 0,
    fileLoc: -1,
    sizeBytes: -1,
    bytes: 0,
    hidden: false,
    hasFindings: false,
    severity: "clean",
    children: [],
  };
}

// Build a directory/file tree keyed on target.path ("/"-separated). Targets
// without a "/" (e.g. dependency names) become top-level leaves so nothing is
// lost.
//
// WP04 (P16/P17): when `inventory` is supplied, the tree becomes the FULL
// project tree — every scanned file (loc/bytes/hidden) AND every excluded file
// (.git, dotfiles, gitignored) becomes a leaf, not only files that have
// findings. Each leaf carries `fileLoc`/`sizeBytes` from the inventory and
// `hidden`/`hasFindings` flags so the UI can toggle finding-less / hidden nodes
// WITHOUT a rescan. Without `inventory` the behaviour is the legacy
// findings-only tree (fileLoc/sizeBytes are -1; loc = summed loc-metric impact).
export function buildTree(
  findings: Finding[],
  inventory?: ScanInventory,
): TreeNode {
  const root = emptyDir("", "");
  const dirIndex = new Map<string, TreeNode>([["", root]]);
  const leafIndex = new Map<string, TreeNode>();
  const meta = fileMetaFromInventory(inventory);

  function ensureDir(path: string): TreeNode {
    const existing = dirIndex.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parentPath = slash === -1 ? "" : path.slice(0, slash);
    const name = slash === -1 ? path : path.slice(slash + 1);
    const parent = ensureDir(parentPath);
    const node = emptyDir(name, path);
    parent.children.push(node);
    dirIndex.set(path, node);
    return node;
  }

  // Create (or fetch) a leaf for `path`, with no findings yet.
  function ensureLeaf(path: string): TreeNode {
    const existing = leafIndex.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parentPath = slash === -1 ? "" : path.slice(0, slash);
    const name = slash === -1 ? path : path.slice(slash + 1);
    const parent = ensureDir(parentPath);
    const fm = meta?.get(path);
    const node: TreeNode = {
      name,
      path,
      isLeaf: true,
      findings: [],
      findingCount: 0,
      loc: 0,
      fileLoc: fm ? fm.loc : -1,
      sizeBytes: fm ? fm.bytes : -1,
      bytes: fm ? fm.bytes : 0,
      hidden: isHiddenPath(path),
      hasFindings: false,
      severity: "clean",
      children: [],
      locMetric: fm?.locMetric,
    };
    parent.children.push(node);
    leafIndex.set(path, node);
    return node;
  }

  // First, when the inventory is present, seed a leaf for EVERY file the walk
  // saw (scanned) and EVERY file it excluded (.git/dotfiles/gitignored), so the
  // full tree exists before findings are attached. Without an inventory we only
  // have finding paths (legacy lean tree).
  if (inventory) {
    for (const f of inventory.files) ensureLeaf(f.path);
    for (const e of inventory.excluded) ensureLeaf(e.path);
  }

  // Attach findings to their leaves (creating the leaf if the inventory did not
  // already — e.g. a non-path dependency target, or no inventory at all).
  const byPath = groupByPath(findings);
  for (const [path, fs] of byPath) {
    const leaf = ensureLeaf(path);
    leaf.findings = fs;
    leaf.findingCount = fs.length;
    leaf.hasFindings = fs.length > 0;
    leaf.severity = aggregateSeverity(fs);
    // Legacy `loc` (subtree LOC fallback) when there is no inventory metadata.
    if (leaf.fileLoc < 0) leaf.loc = leafLoc(fs);
  }

  // For leaves that DID get inventory metadata, use the true file LOC for the
  // subtree-`loc` rollup (so a finding-less file still contributes its LOC).
  for (const leaf of leafIndex.values()) {
    if (leaf.fileLoc >= 0) leaf.loc = leaf.fileLoc;
  }

  // Roll up counts / loc / size / flags / severity bottom-up and sort children.
  function rollup(node: TreeNode): void {
    if (node.isLeaf) return;
    let count = 0;
    let loc = 0;
    let size = 0;
    let sawSize = false;
    let bytes = 0;
    let sev: Severity = "clean";
    let allHidden = node.children.length > 0;
    let anyFindings = false;
    for (const c of node.children) {
      rollup(c);
      count += c.findingCount;
      loc += c.loc;
      if (c.sizeBytes >= 0) {
        size += c.sizeBytes;
        sawSize = true;
      }
      bytes += c.bytes;
      sev = maxSeverity(sev, c.severity);
      if (!c.hidden) allHidden = false;
      if (c.hasFindings) anyFindings = true;
    }
    node.findingCount = count;
    node.loc = loc;
    node.fileLoc = loc; // a directory's "LOC" column is its subtree LOC
    node.sizeBytes = sawSize ? size : -1;
    node.bytes = bytes;
    node.severity = sev;
    node.hidden = allHidden;
    node.hasFindings = anyFindings;
    // Finding-bearing children first, then by finding count.
    node.children.sort((a, b) => b.findingCount - a.findingCount);
  }

  rollup(root);
  return root;
}

// WP04 (P17): prune a built tree to the LEAN default view — drop hidden leaves
// and finding-less leaves (and any directory that becomes empty), per the two
// toggle flags. `showHidden` keeps hidden entries; `showFindingLess` keeps
// files with no findings. Pure (returns a new tree); the full tree is retained
// so toggling never needs a rescan. A leaf survives iff:
//   (showFindingLess || it has findings) && (showHidden || it is not hidden).
export function filterTree(
  node: TreeNode,
  showHidden: boolean,
  showFindingLess: boolean,
): TreeNode {
  const children: TreeNode[] = [];
  for (const c of node.children) {
    if (c.isLeaf) {
      const keepFindings = showFindingLess || c.hasFindings;
      const keepHidden = showHidden || !c.hidden;
      if (keepFindings && keepHidden) children.push(c);
    } else {
      const sub = filterTree(c, showHidden, showFindingLess);
      // Drop a directory that has no surviving descendants.
      if (sub.children.length > 0) children.push(sub);
    }
  }
  return { ...node, children };
}

// Collapse single-child directory chains for a cleaner treemap/tree
// ("a" -> "a/b" -> "a/b/c" becomes one "a/b/c" node).
export function collapseChains(node: TreeNode): TreeNode {
  const children = node.children.map(collapseChains);
  if (
    !node.isLeaf &&
    children.length === 1 &&
    !children[0].isLeaf &&
    node.path !== ""
  ) {
    const only = children[0];
    return { ...only, name: `${node.name}/${only.name}` };
  }
  return { ...node, children };
}

// WP8 P14-nav — pure DFS for the single WORST leaf in `node`'s subtree: the leaf
// with the greatest severity (by SEVERITY_ORDER), tie-broken by findingCount (more
// findings is worse). Returns `node` itself when it is already a leaf, or `null`
// when the subtree contains no leaf at all (an empty interior node). No mutation,
// no side effects — the treemap's "show worst offender" is pure navigation.
export function worstOffender(node: TreeNode): TreeNode | null {
  if (node.isLeaf) return node;
  let best: TreeNode | null = null;
  for (const child of node.children) {
    const cand = worstOffender(child);
    if (cand === null) continue;
    if (best === null) {
      best = cand;
      continue;
    }
    const candRank = SEVERITY_ORDER.indexOf(cand.severity);
    const bestRank = SEVERITY_ORDER.indexOf(best.severity);
    if (
      candRank > bestRank ||
      (candRank === bestRank && cand.findingCount > best.findingCount)
    ) {
      best = cand;
    }
  }
  return best;
}

// ── Import dependency forest (EWP2) ─────────────────────────────────────────
// Unlike the PATH hierarchy above, this is the TRUE import-dependency graph the
// engine emits under `--graph` (file→file `imports` edges; an edge src→dst means
// "src imports dst"). We render it as an expandable forest: roots are the files
// nothing imports (top-level importers — entries/orphans), and a row's children
// are the files it imports. The graph can contain cycles, so the renderer carries
// a per-branch visited set; this builder only exposes the sorted adjacency.

export interface ImportForest {
  byId: Map<string, GraphNode>; // file nodes only, keyed by node id
  outgoing: Map<string, string[]>; // id → sorted ids of files it imports
  inDegree: Map<string, number>; // id → number of files importing it
  rootIds: string[]; // files nothing imports, sorted (entry-like first)
  severityByPath: Map<string, Severity>; // path → worst finding severity
  edgeCount: number; // total file→file import edges
}

// Sort key for a file node id: its path (stable, deterministic).
function importPathOf(byId: Map<string, GraphNode>, id: string): string {
  return byId.get(id)?.path ?? id;
}

// Build the import-dependency forest from a `--graph` emit. Pure: no mutation of
// inputs, output fully sorted so the rendered tree is deterministic. When NO file
// node is free of incoming imports (a fully-cyclic graph), we fall back to ranking
// every file by in-degree so the forest still has roots to show.
export function buildImportForest(
  graph: GraphData,
  findings: Finding[],
): ImportForest {
  const byId = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (n.kind === "file") byId.set(n.id, n);
  }

  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  let edgeCount = 0;
  for (const e of graph.edges) {
    if (e.kind !== "imports") continue;
    if (!byId.has(e.src) || !byId.has(e.dst)) continue;
    edgeCount++;
    const arr = outgoing.get(e.src) ?? [];
    arr.push(e.dst);
    outgoing.set(e.src, arr);
    inDegree.set(e.dst, (inDegree.get(e.dst) ?? 0) + 1);
  }

  // Sort each adjacency list by the imported file's path for stable rendering.
  for (const [id, arr] of outgoing) {
    arr.sort((a, b) =>
      importPathOf(byId, a).localeCompare(importPathOf(byId, b)),
    );
    outgoing.set(id, arr);
  }

  // Roots = files nothing imports (in-degree 0). Sort by out-degree desc (the
  // biggest importers first), then path. Fall back to all files ranked by
  // in-degree when the graph is fully cyclic (no zero-in-degree node).
  const outDeg = (id: string) => outgoing.get(id)?.length ?? 0;
  let rootIds = [...byId.keys()].filter((id) => (inDegree.get(id) ?? 0) === 0);
  if (rootIds.length === 0) rootIds = [...byId.keys()];
  rootIds.sort((a, b) => {
    const d = outDeg(b) - outDeg(a);
    if (d !== 0) return d;
    const i = (inDegree.get(a) ?? 0) - (inDegree.get(b) ?? 0);
    if (i !== 0) return i;
    return importPathOf(byId, a).localeCompare(importPathOf(byId, b));
  });

  // Severity join: worst finding severity per file path, for the row dot.
  const byPath = groupByPath(findings);
  const severityByPath = new Map<string, Severity>();
  for (const [path, fs] of byPath) {
    severityByPath.set(path, aggregateSeverity(fs));
  }

  return { byId, outgoing, inDegree, rootIds, severityByPath, edgeCount };
}
