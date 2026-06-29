import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding, GraphData, ScanInventory } from "../types";
import {
  buildImportForest,
  buildTree,
  collapseChains,
  filterTree,
  type ImportForest,
  type TreeNode,
} from "../lib/tree";
// WP04 (P16): reuse WP02's column alignment + byte formatter so the (non-sorting)
// tree columns align identically to the data tables. `columnAlign` derives
// left/right purely from the column type; `formatBytes` is the shared size
// formatter (Size column + tests). The tree is a hierarchy (not a flat <table>),
// so it renders cells itself, but the WP02 Column model is the single source of
// truth for each metadata column's label + alignment — declared sortable:false.
import { columnAlign, formatBytes, type Column } from "./ui/Table";
import { SeverityDot } from "./badges";
import { useFullscreen } from "./useFullscreen";
import type { GitCommitInfo, GitRepoCommit } from "../lib/tauri";
import { isTauri, gitFileDiff, gitRecentCommits } from "../lib/tauri";
import type { GitFileDiff } from "../lib/tauri";
import { relativeAge } from "./GitHistoryPanel";
import { GitDiffView } from "./GitDiffView";
import { FileViewer } from "./FileViewer";
import { revealForCloneSite } from "../lib/report";
import { findingSeverity } from "../lib/severity";
import { inertControlProps } from "./demoInert";

// WP04 (P16): the tree's metadata columns in WP02's headless Column model.
// sortable:false on every column → the headings are NOT clickable (file-browser
// look, not a sortable table). The number columns right-align both heading and
// cell via `columnAlign`.
const TREE_COLUMNS: Column<TreeNode>[] = [
  { key: "name", label: "Name", type: "text", sortable: false },
  {
    key: "loc",
    label: "LOC",
    type: "number",
    sortable: false,
    accessor: (n) => n.fileLoc,
  },
  {
    key: "size",
    label: "Size",
    type: "number",
    sortable: false,
    accessor: (n) => n.sizeBytes,
  },
  {
    key: "findings",
    label: "Findings",
    type: "number",
    sortable: false,
    accessor: (n) => n.findingCount,
  },
];

// WP04 (P16): per-row cell text. LOC/size are "—" when unknown (no inventory row,
// e.g. a non-path dependency target). These match the overview/findings data:
// fileLoc/sizeBytes come straight from `scan_inventory.files[]`, findingCount is
// the same finding set the findings panel shows for that path.
function treeLocText(n: TreeNode): string {
  if (n.locMetric === "unknown") return "—";
  return n.fileLoc >= 0 ? n.fileLoc.toLocaleString() : "—";
}
function treeSizeText(n: TreeNode): string {
  return n.sizeBytes >= 0 ? formatBytes(n.sizeBytes) : "—";
}

function findLeafByPath(node: TreeNode | null, targetPath: string): TreeNode | null {
  if (!node) return null;
  if (node.isLeaf && node.path === targetPath) return node;
  for (const child of node.children) {
    const hit = findLeafByPath(child, targetPath);
    if (hit) return hit;
  }
  return null;
}

interface FileReveal {
  absPath: string;
  displayPath: string;
  highlightStart: number | null;
  highlightEnd: number | null;
}

function resolvePathForViewer(
  path: string,
  targetRoot: string | undefined,
  memberRoots?: Record<string, string>,
): FileReveal {
  const fallback = {
    absPath: path,
    displayPath: path,
    highlightStart: null,
    highlightEnd: null,
  };
  const withMemberRoots = revealForCloneSite({ path }, targetRoot, memberRoots);
  if (withMemberRoots) return withMemberRoots;

  if (!targetRoot) {
    return fallback;
  }
  return {
    absPath: `${targetRoot.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`,
    displayPath: path,
    highlightStart: null,
    highlightEnd: null,
  };
}

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
  onSelect,
  selectedPath,
  gitHistory,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  /** GITVIEWER: map from rel_path to most-recent commit (for last-change display). */
  gitHistory?: Map<string, GitCommitInfo>;
}) {
  const isOpen = expanded.has(node.path);
  const hasChildren = !node.isLeaf && node.children.length > 0;

  // GITVIEWER: last-change commit for leaf nodes (matched by the file's rel path).
  // `gitHistory` keys are rel paths (no leading slash), `node.path` is also rel.
  const lastCommit = node.isLeaf && gitHistory ? gitHistory.get(node.path) : undefined;
  const lastChangeTitle = lastCommit
    ? `${lastCommit.date} · ${lastCommit.author} — ${lastCommit.subject}`
    : node.path;

  return (
    <>
      <div
        className={`tree-row${selectedPath === node.path ? " selected" : ""}`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => {
          if (node.isLeaf) onSelect(node.path);
          else toggle(node.path);
        }}
      >
        <span className="twisty">
          {hasChildren ? (isOpen ? "▾" : "▸") : ""}
        </span>
        <SeverityDot severity={node.severity} />
        <span
          className={`name ${node.isLeaf ? "file-name" : "dir-name"}${
            node.hidden ? " hidden" : ""
          }`}
          title={lastChangeTitle}
        >
          {node.name || "/"}
          {node.isLeaf ? "" : "/"}
        </span>
        {/* WP04 (P16): aligned metadata columns (LOC / Size / Findings). */}
        <span className="tree-col num" title="lines of code">
          {treeLocText(node)}
        </span>
        <span className="tree-col num" title="file size">
          {treeSizeText(node)}
        </span>
        <span className="tree-col num" title="findings in subtree">
          {node.findingCount}
        </span>
        {/* GITVIEWER: last-change age label for leaf nodes */}
        {node.isLeaf && lastCommit && (
          <span
            className="tree-col git-last-change"
            title={`${lastCommit.date} · ${lastCommit.author} — ${lastCommit.subject}`}
            style={{ fontSize: 10, color: "var(--fg-dim)", minWidth: 44, textAlign: "right" }}
          >
            {relativeAge(lastCommit.date)}
          </span>
        )}
      </div>
      {hasChildren &&
        isOpen &&
        node.children.map((c) => (
          <TreeRow
            key={c.path}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            onSelect={onSelect}
            selectedPath={selectedPath}
            gitHistory={gitHistory}
          />
        ))}
    </>
  );
}

// One row of the import-dependency forest. Children are the files this file
// imports (outgoing `imports` edges). LAZY: children render only when expanded.
// CYCLE GUARD: `pathSet` carries the ids already on this branch — a file that
// imports an ancestor renders as a non-expandable "↻ cycle" leaf instead of
// recursing forever. The expand `key` encodes depth so the same file under two
// branches expands independently.
function ImportRow({
  nodeId,
  depth,
  pathSet,
  forest,
  expanded,
  toggle,
  onSelect,
  selectedPath,
}: {
  nodeId: string;
  depth: number;
  pathSet: Set<string>;
  forest: ImportForest;
  expanded: Set<string>;
  toggle: (key: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const node = forest.byId.get(nodeId);
  if (!node) return null;

  const path = node.path ?? node.id;
  const rowKey = `${depth}:${nodeId}`;
  const isOpen = expanded.has(rowKey);
  const onPath = pathSet.has(nodeId);
  const imports = forest.outgoing.get(nodeId) ?? [];
  const hasChildren = imports.length > 0 && !onPath;
  const severity = forest.severityByPath.get(path) ?? "clean";

  const childPathSet = new Set(pathSet);
  childPathSet.add(nodeId);

  return (
    <>
      <div
        className={`tree-row${selectedPath === path ? " selected" : ""}`}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        <span
          className="twisty"
          onClick={() => hasChildren && toggle(rowKey)}
          style={{ cursor: hasChildren ? "pointer" : "default" }}
        >
          {hasChildren ? (isOpen ? "▾" : "▸") : onPath && imports.length > 0 ? "↻" : ""}
        </span>
        <SeverityDot severity={severity} />
        <span
          className="name file-name"
          title={path}
          onClick={() => onSelect(path)}
        >
          {node.label ?? path}
        </span>
        {node.orphan && (
          <span className="gn-state bad" title="nothing imports this file">
            orphan
          </span>
        )}
        <span className="count" title="files this file imports">
          {imports.length}
        </span>
      </div>
      {hasChildren &&
        isOpen &&
        imports.map((cid, i) => (
          <ImportRow
            key={`${cid}:${i}`}
            nodeId={cid}
            depth={depth + 1}
            pathSet={childPathSet}
            forest={forest}
            expanded={expanded}
            toggle={toggle}
            onSelect={onSelect}
            selectedPath={selectedPath}
          />
        ))}
    </>
  );
}

export function ProjectTree({
  findings,
  graph,
  inventory,
  onSelectFile,
  selectedPath,
  onShowInGraph,
  onShowInFindings,
  gitHistory,
  scanRoot,
  targetRoot,
  memberRoots,
  scanRootForViewer,
  demoInert,
}: {
  findings: Finding[];
  graph?: GraphData;
  // WP04 (P17): the scan inventory (additive, already emitted by the engine).
  // When present, the full project tree is built (every scanned + excluded file)
  // and the show-hidden / show-finding-less toggles become available WITHOUT a
  // rescan. Absent → legacy findings-only lean tree (toggles hidden).
  inventory?: ScanInventory;
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
  /** Show the selected file in graph via emitJumpToGraph (path-based node lookup). */
  onShowInGraph?: (path: string) => void;
  /** Show the selected file in Findings (path-filter deep-link). */
  onShowInFindings?: (path: string) => void;
  /**
   * GITVIEWER: map from repo-relative file path → most-recent commit info.
   * When present, each leaf node shows a "last changed N ago" label.
   * Populated by App.tsx after scan via gitRecentCommits (NOT per-file N+1).
   */
  gitHistory?: Map<string, GitCommitInfo>;
  /**
   * GITVIEWER: scan root (absolute path). Passed through to enable the
   * "Recent commits" footer panel when set.
   */
  scanRoot?: string;
  /**
   * Path resolution for the shared FileViewer in the right detail pane.
   */
  targetRoot?: string;
  /** WP5.3.2: per-member absolute roots for multi-root scan data. */
  memberRoots?: Record<string, string>;
  /** Optional dedicated scan-root for FileViewer (typically same as App's `scanDir`). */
  scanRootForViewer?: string;
  /** Static demo: render desktop-only file actions ("Show file", "Show in
   *  Findings/Graph") as enabled-looking but inert, with an explanatory tooltip. */
  demoInert?: boolean;
}) {
  // WP04 (P17): the FULL tree (all scanned + excluded files when inventory is
  // present, else findings-only). Filtering for the lean/expanded view is a pure
  // pass over this — no rescan.
  const fullRoot = useMemo(
    () => collapseChains(buildTree(findings, inventory)),
    [findings, inventory],
  );

  // WP04 (P17): the two toggles. Default lean view = hidden entries hidden AND
  // finding-less files hidden.
  const [showHidden, setShowHidden] = useState(false);
  const [showFindingLess, setShowFindingLess] = useState(false);
  const hasInventory = !!inventory;

  // The visible tree after applying the toggles. With no inventory there is
  // nothing to reveal (the tree is already findings-only), so render fullRoot.
  const root = useMemo(
    () =>
      hasInventory
        ? filterTree(fullRoot, showHidden, showFindingLess)
        : fullRoot,
    [fullRoot, hasInventory, showHidden, showFindingLess],
  );

  const forest = useMemo(
    () => (graph ? buildImportForest(graph, findings) : null),
    [graph, findings],
  );
  // The import view is only meaningful with a `--graph` emit that carries file
  // import edges. Otherwise we silently fall back to the path hierarchy.
  const importAvailable = !!forest && forest.edgeCount > 0;

  const [mode, setMode] = useState<"files" | "imports">("files");
  // Fullscreen the tree on mobile, where the two-column workspace is cramped.
  const { fullscreen, toggleFullscreen } = useFullscreen();
  const view = mode === "imports" && importAvailable ? "imports" : "files";

  // Expand the first two levels of the path hierarchy by default.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>([""]);
    for (const c of fullRoot.children) {
      s.add(c.path);
    }
    return s;
  });

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Independent expand state for the import forest (keyed by `depth:id`).
  const [importExpanded, setImportExpanded] = useState<Set<string>>(new Set());
  const toggleImport = (key: string) =>
    setImportExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectedFile = useMemo(
    () => (selectedPath ? findLeafByPath(fullRoot, selectedPath) : null),
    [fullRoot, selectedPath],
  );
  const selectedReveal = useMemo(
    () => (selectedPath ? resolvePathForViewer(selectedPath, targetRoot, memberRoots) : null),
    [selectedPath, targetRoot, memberRoots],
  );
  const selectedFindings = useMemo(
    () =>
      selectedPath ? findings.filter((finding) => finding.target.path === selectedPath) : [],
    [findings, selectedPath],
  );
  const [showFileViewer, setShowFileViewer] = useState(false);
  useEffect(() => {
    setShowFileViewer(false);
  }, [selectedPath]);

  // GITVIEWER §3.4 — "Recent commits" collapsible footer panel (browser-guarded).
  // Collapsed by default; fetches commits only when the user opens the panel so
  // the project tree can render first content without waiting on git.
  const [recentCommits, setRecentCommits] = useState<GitRepoCommit[]>([]);
  const [recentCommitsStatus, setRecentCommitsStatus] = useState<"idle" | "loading" | "loaded">("idle");
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<{
    key: string;
    commit: GitRepoCommit;
    file: string;
    diff: GitFileDiff | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const recentRequestSeq = useRef(0);
  useEffect(() => {
    recentRequestSeq.current += 1;
    setRecentCommits([]);
    setRecentCommitsStatus("idle");
    setExpandedCommit(null);
    setCommitDiff(null);
  }, [scanRoot]);

  const loadRecentCommits = () => {
    if (!scanRoot || !isTauri() || recentCommitsStatus !== "idle") return;
    const seq = recentRequestSeq.current;
    setRecentCommitsStatus("loading");
    gitRecentCommits(scanRoot, 20)
      .then((commits) => {
        if (seq !== recentRequestSeq.current) return;
        setRecentCommits(commits);
        setRecentCommitsStatus("loaded");
      })
      .catch(() => {
        if (seq !== recentRequestSeq.current) return;
        setRecentCommits([]);
        setRecentCommitsStatus("loaded");
      });
  };

  const openCommitDiff = (commit: GitRepoCommit, file: string) => {
    if (!scanRoot) return;
    const key = `${commit.hashFull}:${file}`;
    setCommitDiff({ key, commit, file, diff: null, loading: true, error: null });
    gitFileDiff(scanRoot, commit.hashFull, file)
      .then((diff) => {
        setCommitDiff({ key, commit, file, diff, loading: false, error: null });
      })
      .catch((e) => {
        setCommitDiff({
          key,
          commit,
          file,
          diff: null,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
  };

  const hasSelectedPath = !!selectedPath;
  const selectedPathForActions = selectedPath ?? "";
  const detailScanRoot = scanRootForViewer ?? scanRoot;

  return (
    <div className={`panel${fullscreen ? " is-fullscreen" : ""}`}>
      {fullscreen && (
        <button
          type="button"
          className="ddc-fullscreen-close"
          onClick={() => toggleFullscreen()}
          aria-label="Exit fullscreen"
          title="Exit fullscreen (Esc)"
        >
          ✕
        </button>
      )}
      <div className="tree-head">
        <h2>Project tree</h2>
        <div className="tree-head-actions">
          {importAvailable && (
            <div className="seg" role="tablist" aria-label="Project tree view">
              <button
                className={`seg-btn${view === "files" ? " active" : ""}`}
                onClick={() => setMode("files")}
              >
                Files
              </button>
              <button
                className={`seg-btn${view === "imports" ? " active" : ""}`}
                onClick={() => setMode("imports")}
              >
                Import graph
              </button>
            </div>
          )}
          <button
            type="button"
            className={`tree-fullscreen-btn${fullscreen ? " active" : ""}`}
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
            title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen project tree"}
          >
            {fullscreen ? "⤢ Exit" : "⤢ Fullscreen"}
          </button>
        </div>
      </div>
      <div className="project-tree-workspace">
        <div className="project-tree-tree">
          {view === "files" ? (
            <>
              <p style={{ color: "var(--fg-dim)", fontSize: 11, marginTop: -4 }}>
                Path hierarchy — folders and files by finding severity.
                {importAvailable
                  ? " Switch to Import graph for the engine’s file→file dependency edges."
                  : " Re-scan with --graph to enable the import-dependency view."}
              </p>
              {/* WP04 (P17): show-hidden / show-finding-less toggles. Only when the
                  inventory is present (otherwise there is nothing extra to reveal —
                  the tree is already findings-only). Toggling is a pure filter over
                  the full tree → no rescan. */}
              {hasInventory && (
                <div className="tree-toggles">
                  <label>
                    <input
                      type="checkbox"
                      checked={showFindingLess}
                      onChange={(e) => setShowFindingLess(e.target.checked)}
                    />
                    Show files with no findings
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={showHidden}
                      onChange={(e) => setShowHidden(e.target.checked)}
                    />
                    Show hidden (.git, dotfiles)
                  </label>
                </div>
              )}
              <div className="tree">
                {/* WP04 (P16): non-sorting column headings (file-browser look). The
                    number columns right-align via WP02's `columnAlign`; `sortable`
                    is false on every column so headings are not clickable. */}
                <div className="tree-row tree-head-row" aria-hidden="true">
                  <span className="twisty" />
                  <span className="sev-dot-spacer" />
                  <span className="name">{TREE_COLUMNS[0].label}</span>
                  {TREE_COLUMNS.slice(1).map((c) => (
                    <span
                      key={c.key}
                      className="tree-col"
                      style={{ textAlign: columnAlign(c) }}
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
                {root.children.map((c) => (
                  <TreeRow
                    key={c.path}
                    node={c}
                    depth={0}
                    expanded={expanded}
                    toggle={toggle}
                    onSelect={onSelectFile}
                    selectedPath={selectedPath}
                    gitHistory={gitHistory}
                  />
                ))}
                {root.children.length === 0 && (
                  <p style={{ color: "var(--fg-dim)", fontSize: 11 }}>
                    No matching entries. Try the toggles above.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <p style={{ color: "var(--fg-dim)", fontSize: 11, marginTop: -4 }}>
                  Import dependency graph ({forest!.edgeCount} edge
                {forest!.edgeCount === 1 ? "" : "s"}). Roots are files nothing imports;
                expand a file to see what it imports. <code>↻</code> marks an import
                cycle back to an ancestor.
              </p>
              <div className="tree">
                {forest!.rootIds.map((rid, i) => (
                  <ImportRow
                    key={`${rid}:${i}`}
                    nodeId={rid}
                    depth={0}
                    pathSet={new Set()}
                    forest={forest!}
                    expanded={importExpanded}
                    toggle={toggleImport}
                    onSelect={onSelectFile}
                    selectedPath={selectedPath}
                  />
                ))}
              </div>
            </>
          )}
          {/* GITVIEWER: subtle scan-root footer — helps orient the user when
              gitHistory data is loaded (shows which repo the age labels refer to). */}
          {scanRoot && gitHistory && (
            <div
              className="tree-git-footer"
              style={{ fontSize: 10, color: "var(--fg-dim)", padding: "4px 8px", borderTop: "1px solid var(--border)" }}
            >
              git history loaded · {gitHistory.size} file{gitHistory.size !== 1 ? "s" : ""}
            </div>
          )}
          {/* GITVIEWER §3.4 — "Recent commits" collapsible panel. Only rendered when
              scanRoot is set and we are running under Tauri (browser-guarded). Collapsed
              by default; commits load lazily when the panel is opened. */}
          {scanRoot && isTauri() && (
            <details
              className="tree-recent-commits"
              style={{ borderTop: "1px solid var(--border)" }}
              onToggle={(e) => {
                if (e.currentTarget.open) loadRecentCommits();
              }}
            >
              <summary
                className="tree-recent-commits-summary"
                style={{ fontSize: 11, color: "var(--fg-dim)", padding: "4px 8px", cursor: "pointer", userSelect: "none" }}
              >
                Recent commits{recentCommitsStatus === "loaded" ? ` (${recentCommits.length})` : ""}
              </summary>
              {recentCommitsStatus === "loading" ? (
                <div className="git-history-loading">Loading commits...</div>
              ) : recentCommits.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--fg-dim)", padding: "4px 8px" }}>
                  {recentCommitsStatus === "loaded" ? "No commits found." : "Open to load recent commits."}
                </div>
              ) : (
                <ul
                  className="tree-recent-commits-list"
                  style={{ listStyle: "none", margin: 0, padding: "0 8px 4px" }}
                >
                  {recentCommits.map((c) => (
                    <li
                      key={c.hash}
                      className="tree-recent-commit-row"
                    >
                      <button
                        className="tree-recent-commit-button"
                        type="button"
                        aria-expanded={expandedCommit === c.hashFull}
                        onClick={() =>
                          setExpandedCommit((prev) => prev === c.hashFull ? null : c.hashFull)
                        }
                      >
                        <span className="mono">{c.hash}</span>
                        <span>{relativeAge(c.date)}</span>
                        <span>{c.author}</span>
                        <span className="tree-recent-commit-subject" title={c.subject}>
                          {c.subject}
                        </span>
                        <span className="tree-recent-commit-count">
                          {c.filesChanged} file{c.filesChanged === 1 ? "" : "s"}
                        </span>
                      </button>
                      {expandedCommit === c.hashFull && (
                        <div className="tree-recent-commit-files">
                          {c.files.length === 0 ? (
                            <div className="empty">No changed files listed.</div>
                          ) : (
                            c.files.map((file) => (
                              <div className="tree-recent-commit-file" key={`${c.hashFull}:${file}`}>
                                <button
                                  type="button"
                                  className="link-button mono"
                                  onClick={() => onSelectFile(file)}
                                  title={`Select ${file}`}
                                >
                                  {file}
                                </button>
                                <button
                                  type="button"
                                  className="gn-trace-btn"
                                  onClick={() => openCommitDiff(c, file)}
                                >
                                  View diff
                                </button>
                              </div>
                            ))
                          )}
                          {commitDiff?.commit.hashFull === c.hashFull && (
                            <div className="git-diff-container">
                              <div className="fv-header mono">{commitDiff.file}</div>
                              {commitDiff.loading && (
                                <div className="git-history-loading">Loading diff...</div>
                              )}
                              {commitDiff.error && (
                                <div className="fv-error">{commitDiff.error}</div>
                              )}
                              {commitDiff.diff && (
                                <GitDiffView
                                  unifiedDiff={commitDiff.diff.unifiedDiff}
                                  commit={{
                                    hash: c.hash,
                                    hashFull: c.hashFull,
                                    author: c.author,
                                    date: c.date,
                                    subject: c.subject,
                                    insertions: 0,
                                    deletions: 0,
                                  }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </div>

        <aside className="project-tree-detail">
          <h3 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            File detail
          </h3>
          {!hasSelectedPath && (
            <div className="project-tree-empty">Select a file to inspect findings and open the file.</div>
          )}
          {hasSelectedPath && (
            <>
              <div className="project-tree-detail-head">
                <div className="project-tree-detail-path">{selectedReveal?.displayPath}</div>
                <div className="project-tree-detail-meta">
                  {selectedFile?.path ? (
                    <>
                      <span title="lines of code">
                        LOC {treeLocText(selectedFile)}
                      </span>
                      <span title="file size">
                        Size {treeSizeText(selectedFile)}
                      </span>
                      <span title="findings in file">
                        Findings {selectedFindings.length}
                      </span>
                    </>
                  ) : (
                    <span>Metadata unavailable for this path.</span>
                  )}
                </div>
              </div>
              <div className="project-tree-actions">
                <button
                  type="button"
                  {...(demoInert
                    ? inertControlProps()
                    : { onClick: () => setShowFileViewer((s) => !s) })}
                >
                  {showFileViewer ? "Hide file" : "Show file"}
                </button>
                <button
                  type="button"
                  {...(onShowInFindings
                    ? { onClick: () => onShowInFindings(selectedPathForActions) }
                    : inertControlProps())}
                >
                  Show in Findings
                </button>
                <button
                  type="button"
                  {...(demoInert
                    ? inertControlProps()
                    : {
                        onClick: () => onShowInGraph?.(selectedPathForActions),
                        disabled: !onShowInGraph,
                      })}
                >
                  Show in Graph
                </button>
              </div>
              <div className="project-tree-file-findings">
                <div className="project-tree-findings-title">File findings</div>
                {selectedFindings.length === 0 ? (
                  <div className="project-tree-empty">No findings for this file.</div>
                ) : (
                  <ul>
                    {selectedFindings.map((finding) => (
                      <li key={finding.id} className="project-tree-finding-row">
                        <SeverityDot severity={findingSeverity(finding)} />
                        <code>{finding.rule}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {showFileViewer && selectedReveal && (
                <FileViewer
                  absPath={selectedReveal.absPath}
                  displayPath={selectedReveal.displayPath}
                  highlightStart={selectedReveal.highlightStart}
                  highlightEnd={selectedReveal.highlightEnd}
                  scanRoot={detailScanRoot}
                />
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
