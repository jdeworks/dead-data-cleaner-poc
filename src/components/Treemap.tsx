import { useEffect, useMemo, useState } from "react";
import {
  hierarchy,
  treemap,
  treemapSquarify,
  type HierarchyRectangularNode,
} from "d3-hierarchy";
import type { Finding, ScanInventory } from "../types";
import {
  buildTree,
  collapseChains,
  worstOffender,
  type TreeNode,
} from "../lib/tree";
import { ruleLabel } from "../lib/report";
import { isTauri } from "../lib/tauri";
import { excludeFolderFlow } from "../lib/exclude";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { useFullscreen } from "./useFullscreen";
import { DEMO_INERT_TITLE } from "./demoInert";
import { Table, formatBytes, type Column } from "./ui";
import { normalizePath } from "../lib/paths";
import {
  type ValueMode,
  nodeValue,
  treemapCellColor,
  severityLegend,
  labelColorFor,
  fitLabelForCell,
  TREEMAP_LABEL_FONTS,
  TREEMAP_VALUE_FONTS,
  planFit,
  MIN_NEST_AREA,
  MIN_TILE_AREA,
} from "../lib/treemap";
import type { ScanDelta } from "../lib/delta";

// (A) Folder/file (nested, folder structure) — likely the new default.
// (B) Finding-group-by — original behavior (the cause of duplicate `app` boxes).
// (C) List — the shared WP02 Table.
export type ViewMode = "folder" | "findings" | "list";
export type TreemapValueMode = ValueMode;

const WIDTH = 1000;
const HEIGHT = 540;

// Sentinel path for the synthetic "…" overflow tile (T4). Clicking it zooms into
// the parent exactly like clicking the folder it lives in.
const OVERFLOW_PATH = "__ddc_overflow__";
const LABEL_X = 4;
const ZOOM_GLYPH_X_OFFSET = 11;

interface TipState {
  x: number;
  y: number;
  node: TreeNode;
}

interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
}

function topRule(findings: Finding[]): string | null {
  if (findings.length === 0) return null;
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  let best = "";
  let bestN = -1;
  for (const [r, n] of counts)
    if (n > bestN) {
      best = r;
      bestN = n;
    }
  return ruleLabel(best);
}

// scan_inventory.files[] → path→bytes map (T3/P12). The engine already emits a
// per-file `bytes` additively; we just join it onto the path tree. Absent
// inventory → empty map → size mode degrades to equal-area, no crash.
function bytesByPathFrom(inv?: ScanInventory): Map<string, number> | undefined {
  if (!inv) return undefined;
  const m = new Map<string, number>();
  for (const f of inv.files) m.set(f.path, f.bytes);
  return m;
}

function buildIndex(root: TreeNode): Map<string, TreeNode> {
  const index = new Map<string, TreeNode>();
  (function walk(n: TreeNode) {
    index.set(n.path, n);
    for (const c of n.children) walk(c);
  })(root);
  return index;
}

function buildParentIndex(root: TreeNode): Map<string, TreeNode> {
  const parents = new Map<string, TreeNode>();
  (function walk(n: TreeNode) {
    for (const c of n.children) {
      parents.set(c.path, n);
      walk(c);
    }
  })(root);
  return parents;
}

// ── T4 — recursive nested layout ─────────────────────────────────────────────
// One placed cell: the laid-out rect plus the TreeNode and whether it is the
// synthetic "…" overflow tile. Depth drives the nested header inset so children
// render INSIDE a folder, below its label strip.
interface PlacedCell {
  node: TreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  isOverflow: boolean;
  /** The node to zoom into when this cell is clicked as a "zoom" target. For a
   *  real folder it is the folder; for "…" it is the folder whose children
   *  overflowed (so "…" zooms exactly like the folder). */
  zoomTarget: string;
}

const HEADER_H = 16; // label strip height reserved at the top of a nested folder

// Recursively place `node`'s children into [x,y,w,h], reserving a header strip,
// folding non-fitting children into a single "…" tile, and recursing into any
// child cell still big enough to nest (MIN_NEST_AREA). Pure: returns the flat
// list of placed cells in render order (parents before children).
function placeChildren(
  node: TreeNode,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  mode: ValueMode,
  out: PlacedCell[],
): void {
  const innerY = y + (depth > 0 ? HEADER_H : 0);
  const innerH = h - (depth > 0 ? HEADER_H : 0);
  if (innerH <= 2 || w <= 2 || node.children.length === 0) return;

  const boxArea = w * innerH;
  const plan = planFit(node.children, (c) => nodeValue(c, mode), boxArea);

  // The set we actually lay out: shown children + (optional) one overflow node.
  const overflowNode: TreeNode | null =
    plan.overflow.length > 0
      ? {
          name: `… ${plan.overflow.length} more`,
          path: OVERFLOW_PATH,
          isLeaf: false,
          findings: [],
          findingCount: plan.overflow.reduce((s, c) => s + c.findingCount, 0),
          loc: plan.overflow.reduce((s, c) => s + c.loc, 0),
          fileLoc: plan.overflow.reduce((s, c) => s + c.loc, 0),
          sizeBytes: plan.overflow.reduce((s, c) => s + c.bytes, 0),
          bytes: plan.overflow.reduce((s, c) => s + c.bytes, 0),
          hidden: false,
          hasFindings: plan.overflow.some((c) => c.hasFindings),
          severity: plan.overflow.reduce<TreeNode["severity"]>(
            (acc, c) =>
              SEVERITY_RANK(c.severity) > SEVERITY_RANK(acc) ? c.severity : acc,
            "clean",
          ),
          children: plan.overflow,
        }
      : null;

  const laidNodes = overflowNode ? [...plan.shown, overflowNode] : plan.shown;
  if (laidNodes.length === 0) return;

  // Give the "…" overflow tile a GUARANTEED minimum area so it stays clickable
  // even when the children it folds are collectively tiny. We floor its layout
  // value at the value that maps to ~2× MIN_TILE_AREA of the box, computed from
  // the shown children's value-per-pixel.
  const shownValue = plan.shown.reduce((s, c) => s + nodeValue(c, mode), 0);
  const valuePerArea = shownValue > 0 ? shownValue / boxArea : 1;
  const overflowFloorValue = valuePerArea * MIN_TILE_AREA * 2;

  const synthetic: TreeNode = { ...node, children: laidNodes };
  const h1 = hierarchy<TreeNode>(synthetic, (d) => {
    if (d === synthetic) return d.children;
    return null;
  }).sum((d) => {
    if (d === synthetic) return 0;
    if (d.path === OVERFLOW_PATH)
      return Math.max(nodeValue(d, mode), overflowFloorValue);
    return nodeValue(d, mode);
  });
  const laid = treemap<TreeNode>()
    .tile(treemapSquarify)
    .size([w, innerH])
    .paddingInner(2)
    .round(true)(h1);

  for (const tile of (laid.children ??
    []) as HierarchyRectangularNode<TreeNode>[]) {
    const cw = tile.x1 - tile.x0;
    const ch = tile.y1 - tile.y0;
    const cx = x + tile.x0;
    const cy = innerY + tile.y0;
    const cd = tile.data;
    const isOverflow = cd.path === OVERFLOW_PATH;
    out.push({
      node: cd,
      x: cx,
      y: cy,
      w: cw,
      h: ch,
      depth: depth + 1,
      isOverflow,
      zoomTarget: isOverflow ? node.path : cd.path,
    });
    // Recurse into real folders that are still large enough to nest.
    if (!cd.isLeaf && !isOverflow && cw * ch >= MIN_NEST_AREA) {
      placeChildren(cd, cx, cy, cw, ch, depth + 1, mode, out);
    }
  }
}

const SEV_ORDER = ["clean", "low", "medium", "high", "blocking"];
function SEVERITY_RANK(s: TreeNode["severity"]): number {
  return SEV_ORDER.indexOf(s);
}

// WP17 (T3) — build lookup sets from ScanDelta for fast O(1) path checks.
// Returns sets of file paths that have new or resolved findings.
function buildDeltaPathSets(delta: ScanDelta | undefined, currentFindings: Finding[]): {
  newPaths: Set<string>;
  resolvedPaths: Set<string>;
} {
  if (!delta || delta.rulesetMismatch) {
    return { newPaths: new Set(), resolvedPaths: new Set() };
  }
  // New paths: paths of findings whose id is in delta.added.
  const newPaths = new Set<string>();
  for (const f of currentFindings) {
    if (delta.added.has(f.id)) newPaths.add(f.target.path);
  }
  // Resolved paths: paths from resolved findings (from the previous scan).
  const resolvedPaths = new Set<string>(delta.resolved.map((f) => f.target.path));
  return { newPaths, resolvedPaths };
}

export function Treemap({
  findings,
  onSelectFile,
  selectedPath,
  scanDir,
  scanInventory,
  delta,
  hasGraph,
  onShowInGraph,
  valueMode: valueModeProp,
  viewMode: viewModeProp,
  rootPath: rootPathProp,
  onValueModeChange,
  onViewModeChange,
  onRootPathChange,
  demoInert,
}: {
  findings: Finding[];
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
  scanDir?: string;
  /** WP03/P12 — scan inventory supplies per-file byte sizes for the "size"
   *  value mode. Optional; absent in a browser/file-drop without inventory. */
  scanInventory?: ScanInventory;
  /** WP17 (T3) — optional scan delta for tinting new/resolved tiles. */
  delta?: ScanDelta;
  /** WP16 (T3): whether the Graph tab is available (report.graph present). */
  hasGraph?: boolean;
  /** WP16 (T3): jump to a specific path in the Graph tab. */
  onShowInGraph?: (path: string) => void;
  /** WP52-T4: lifted Treemap view state (for report-aware persistence). */
  valueMode?: ValueMode;
  /** WP52-T4: lifted Treemap view mode. */
  viewMode?: ViewMode;
  /** WP52-T4: lifted Treemap root folder path. */
  rootPath?: string;
  /** Controlled setters for persisted state mode. */
  onValueModeChange?: (valueMode: ValueMode) => void;
  onViewModeChange?: (viewMode: ViewMode) => void;
  onRootPathChange?: (rootPath: string) => void;
  /** Static demo: render desktop-only actions (e.g. "Exclude this folder") as
   *  enabled-looking but inert, with an explanatory tooltip. */
  demoInert?: boolean;
}) {
  const [valueModeLocal, setValueModeLocal] = useState<ValueMode>("findings");
  const [viewModeLocal, setViewModeLocal] = useState<ViewMode>("folder");
  const [rootPathLocal, setRootPathLocal] = useState<string>("");
  const [tip, setTip] = useState<TipState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [exclMsg, setExclMsg] = useState<
    { tone: "ok" | "bad"; text: string } | null
  >(null);
  const [noFindingsPath, setNoFindingsPath] = useState<string | null>(null);
  // Mobile usability (P-zoom): treemap cells get tiny on a phone. `zoom` scales the
  // SVG inside a scrollable viewport (pan by dragging/scrolling); `fullscreen` lifts
  // the whole treemap into a fixed overlay so it gets the entire screen.
  const [zoom, setZoom] = useState(1);
  // Esc-to-close + body-scroll-lock live in the shared hook (also used by ProjectTree).
  const { fullscreen, setFullscreen, toggleFullscreen } = useFullscreen();
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  const zoomBy = (d: number) =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + d) * 10) / 10)));

  const selectedPathNorm = selectedPath ? normalizePath(selectedPath) : "";

  const valueMode = valueModeProp ?? valueModeLocal;
  const viewMode = viewModeProp ?? viewModeLocal;
  const rootPath = rootPathProp ?? rootPathLocal;

  const setValueMode = (next: ValueMode) => {
    if (onValueModeChange) onValueModeChange(next);
    else setValueModeLocal(next);
  };
  const setViewMode = (next: ViewMode) => {
    if (onViewModeChange) onViewModeChange(next);
    else setViewModeLocal(next);
  };
  const setRootPath = (next: string) => {
    if (onRootPathChange) onRootPathChange(next);
    else setRootPathLocal(next);
  };

  const bytesByPath = useMemo(
    () => bytesByPathFrom(scanInventory),
    [scanInventory],
  );

  // WP17 (T3) — precompute delta path sets (O(N) once, O(1) per tile lookup).
  const { newPaths, resolvedPaths } = useMemo(
    () => buildDeltaPathSets(delta, findings),
    [delta, findings],
  );

  // WP03×WP04 merge: buildTree now takes the scan inventory (the unified per-file
  // loc/bytes + full-tree source). Passing it gives every leaf real `bytes` for
  // the size value mode AND surfaces the full folder/file structure folder-mode
  // wants. `bytesByPath` is kept only as the "byte data present?" affordance flag.
  const rootNode = useMemo(
    () => collapseChains(buildTree(findings, scanInventory)),
    [findings, scanInventory],
  );

  const index = useMemo(() => buildIndex(rootNode), [rootNode]);
  const parentIndex = useMemo(() => buildParentIndex(rootNode), [rootNode]);

  // If a persisted rootPath points to a directory not present in the current
  // findings tree, normalize it to root. This keeps report-scope persisted state
  // from one report leaking into another.
  useEffect(() => {
    if (rootPath !== "" && !index.has(rootPath)) setRootPath("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, index]);

  

  const currentNode = index.get(rootPath) ?? rootNode;

  const crumbs = useMemo(() => {
    const chain: TreeNode[] = [];
    let n: TreeNode | undefined = currentNode;
    while (n) {
      chain.unshift(n);
      n = parentIndex.get(n.path);
    }
    return chain;
  }, [currentNode, parentIndex]);

  // ── (B) Finding-group-by: one flat level per finding RULE (original-ish) ──
  // Groups findings by their rule (ignoring folders) — this is what produced
  // the duplicate `app` boxes; kept but clearly labelled.
  const groupTiles = useMemo(() => {
    if (viewMode !== "findings") return [];
    const byRule = new Map<string, Finding[]>();
    for (const f of findings) {
      const arr = byRule.get(f.rule);
      if (arr) arr.push(f);
      else byRule.set(f.rule, [f]);
    }
    const groups: TreeNode[] = [];
    for (const [rule, fs] of byRule) {
      groups.push({
        name: ruleLabel(rule),
        path: `rule:${rule}`,
        isLeaf: true, // a group tile is terminal in this view
        findings: fs,
        findingCount: fs.length,
        loc: fs.reduce(
          (s, f) => s + (f.impact.metric === "loc" ? f.impact.value : 0),
          0,
        ),
        fileLoc: -1,
        sizeBytes: -1,
        bytes: 0,
        hidden: false,
        hasFindings: fs.length > 0,
        severity: fs.reduce<TreeNode["severity"]>(
          (acc, f) =>
            SEVERITY_RANK(
              f.gating === "ci-blocking" ? "blocking" : "medium",
            ) > SEVERITY_RANK(acc)
              ? f.gating === "ci-blocking"
                ? "blocking"
                : "medium"
              : acc,
          "clean",
        ),
        children: [],
      });
    }
    const synthetic: TreeNode = { ...rootNode, children: groups };
    const h1 = hierarchy<TreeNode>(synthetic, (d) =>
      d === synthetic ? d.children : null,
    ).sum((d) => (d === synthetic ? 0 : nodeValue(d, valueMode)));
    const laid = treemap<TreeNode>()
      .tile(treemapSquarify)
      .size([WIDTH, HEIGHT])
      .paddingInner(1)
      .round(true)(h1);
    return (laid.children ?? []) as HierarchyRectangularNode<TreeNode>[];
  }, [viewMode, findings, valueMode, rootNode]);

  // ── (A) Folder mode: the recursive nested layout (T4) ──
  const cells = useMemo(() => {
    if (viewMode !== "folder") return [];
    const out: PlacedCell[] = [];
    placeChildren(currentNode, 0, 0, WIDTH, HEIGHT, 0, valueMode, out);
    return out;
  }, [viewMode, currentNode, valueMode]);

  // ── (C) List rows: every leaf under currentNode, flattened ──
  const listRows = useMemo(() => {
    const rows: TreeNode[] = [];
    (function walk(n: TreeNode) {
      if (n.isLeaf) rows.push(n);
      for (const c of n.children) walk(c);
    })(currentNode);
    return rows;
  }, [currentNode]);

  const canExclude = isTauri() && !!scanDir;

  async function onExclude(node: TreeNode) {
    if (!scanDir) return;
    setExclMsg(null);
    const res = await excludeFolderFlow(scanDir, node.path);
    if (res.status === "written") {
      setExclMsg({
        tone: "ok",
        text: `Excluded "${node.path}" — wrote ${res.path}`,
      });
    } else if (res.status === "error") {
      setExclMsg({ tone: "bad", text: res.message });
    }
  }

  function selectPath(path: string, displayLabel: string) {
    const normalized = normalizePath(path);
    if (!normalized) {
      setNoFindingsPath(displayLabel || "selected item");
      return;
    }
    setNoFindingsPath(null);
    onSelectFile(normalized);
  }

  function selectLeafOrShowMessage(node: TreeNode) {
    if (!node.findingCount) {
      setNoFindingsPath(node.path || "selected item");
      return;
    }
    selectPath(node.path, node.path);
  }

  function selectFindingPath(n: TreeNode, label: string) {
    const next = n.findings[0]?.target.path;
    if (!next) {
      setNoFindingsPath(label);
      return;
    }
    selectPath(next, label);
  }

  function clearSelectionMessage() {
    setNoFindingsPath(null);
  }

  function showWorst(node: TreeNode) {
    const leaf = worstOffender(node);
    if (!leaf) return;
    const parent = parentIndex.get(leaf.path);
    setRootPath(parent ? parent.path : "");
    selectLeafOrShowMessage(leaf);
  }

  function menuItems(node: TreeNode): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (node.isLeaf) {
      items.push({
        label: "Open in Findings",
        onClick: () => selectLeafOrShowMessage(node),
      });
      // T3: "Show in Graph" — only when graph tab is available.
      if (hasGraph && onShowInGraph) {
        items.push({
          label: "Show in Graph",
          onClick: () => onShowInGraph(node.path),
        });
      }
    } else {
      items.push({
        label: "Zoom into folder",
        onClick: () => {
          clearSelectionMessage();
          setRootPath(node.path);
        },
      });
    }
    items.push({ label: "Show worst offender", onClick: () => showWorst(node) });
    if (!node.isLeaf) {
      // Static demo: keep the action visible & enabled-looking but inert (it
      // writes an exclude file via Tauri, which the browser demo can't do).
      if (demoInert) {
        items.push({
          label: "Exclude this folder from analysis…",
          inert: true,
          title: DEMO_INERT_TITLE,
          onClick: () => {},
        });
      } else {
        items.push({
          label: "Exclude this folder from analysis…",
          disabled: !canExclude,
          onClick: () => void onExclude(node),
        });
      }
    }
    return items;
  }

  // Click semantics (T5/P13): folders + "…" ZOOM; leaves NAVIGATE to findings.
  function activate(cell: PlacedCell) {
    clearSelectionMessage();
    if (cell.isOverflow) {
      setRootPath(cell.zoomTarget);
    } else if (cell.node.isLeaf) {
      selectLeafOrShowMessage(cell.node);
    } else {
      setRootPath(cell.node.path);
    }
  }

  function valueLabel(n: TreeNode): string {
    if (valueMode === "size") return formatBytes(n.bytes);
    if (valueMode === "loc") {
      if (n.locMetric === "unknown") return "—";
      return `${n.loc} LOC`;
    }
    return `${n.findingCount} finding${n.findingCount === 1 ? "" : "s"}`;
  }

  const hasInventory = !!scanInventory;
  const locModeHint = hasInventory
    ? "LOC uses scanned file line-counts when available; non-line files render as —."
    : "LOC uses finding-impact LOC totals when scan_inventory is not present.";

  const LIST_COLUMNS: Column<TreeNode>[] = useMemo(
    () => [
      { key: "path", label: "File", type: "text", cellClassName: "path-cell", filterable: true },
      { key: "findingCount", label: "Findings", type: "number" },
      {
        key: "loc",
        label: "LOC",
        type: "number",
        formatter: (_v, row) => (row.locMetric === "unknown" ? "—" : row.loc.toLocaleString()),
      },
      {
        key: "bytes",
        label: "Size",
        type: "number",
        formatter: (v) => formatBytes(v as number),
      },
      {
        key: "severity",
        label: "Severity",
        type: "text",
        formatter: (v) => String(v),
      },
    ],
    [],
  );

  return (
    <div className={`treemap-wrap${fullscreen ? " is-fullscreen" : ""}`}>
      <div className="treemap-controls">
        <span style={{ color: "var(--fg-muted)" }}>Size by</span>
        <button
          className={valueMode === "findings" ? "active" : ""}
          onClick={() => {
            clearSelectionMessage();
            setValueMode("findings");
          }}
        >
          Findings
        </button>
        <button
          className={valueMode === "loc" ? "active" : ""}
          title={locModeHint}
          onClick={() => {
            clearSelectionMessage();
            setValueMode("loc");
          }}
        >
          LOC
        </button>
        <button
          className={valueMode === "size" ? "active" : ""}
          onClick={() => {
            clearSelectionMessage();
            setValueMode("size");
          }}
          title={bytesByPath ? undefined : "No byte sizes in this report"}
        >
          Size
        </button>

        <span style={{ width: 12 }} />
        <span style={{ color: "var(--fg-muted)" }}>View</span>
        <button
          className={viewMode === "folder" ? "active" : ""}
          onClick={() => {
            clearSelectionMessage();
            setViewMode("folder");
          }}
          title="Group by folder structure (nested)"
        >
          Folders
        </button>
        <button
          className={viewMode === "findings" ? "active" : ""}
          onClick={() => {
            clearSelectionMessage();
            setViewMode("findings");
          }}
          title="Group by finding type (ignores folders)"
        >
          By finding type
        </button>
        <button
          className={viewMode === "list" ? "active" : ""}
          onClick={() => {
            clearSelectionMessage();
            setViewMode("list");
          }}
          title="Plain sortable list"
        >
          List
        </button>

        {viewMode !== "list" && (
          <>
            <span style={{ width: 12 }} />
            <span className="treemap-zoom" role="group" aria-label="Zoom treemap">
              <button
                onClick={() => zoomBy(-0.5)}
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
                title="Zoom out"
              >
                −
              </button>
              <span className="treemap-zoom-val">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => zoomBy(0.5)}
                disabled={zoom >= ZOOM_MAX}
                aria-label="Zoom in"
                title="Zoom in"
              >
                +
              </button>
              {zoom !== 1 && (
                <button onClick={() => setZoom(1)} aria-label="Reset zoom" title="Reset zoom">
                  Reset
                </button>
              )}
            </span>
            <button
              className={fullscreen ? "active" : ""}
              onClick={toggleFullscreen}
              aria-pressed={fullscreen}
              title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen treemap"}
            >
              {fullscreen ? "⤢ Exit" : "⤢ Fullscreen"}
            </button>
          </>
        )}

        <div style={{ flex: 1 }} />
        <Legend />
      </div>

      {(viewMode === "folder" || viewMode === "list") && (
        <div className="treemap-crumbs" aria-label="treemap breadcrumb">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            const label = c.path === "" ? "root" : c.name;
            return (
              <span key={c.path || "__root__"}>
                {i > 0 && <span className="sep">›</span>}
                <button
                  type="button"
                  className={"crumb" + (last ? " current" : "")}
                  onClick={() => {
                    clearSelectionMessage();
                    setRootPath(c.path);
                  }}
                  disabled={last}
                >
                  {label}
                </button>
              </span>
            );
          })}
          {crumbs.length > 1 && (
            <button
              type="button"
              className="crumb up"
              title="Up one level"
              onClick={() => {
                const parent = parentIndex.get(currentNode.path);
                clearSelectionMessage();
                setRootPath(parent ? parent.path : "");
              }}
            >
              ↑ up
            </button>
          )}
        </div>
      )}

      {exclMsg && (
        <div className={`treemap-excl-msg ${exclMsg.tone}`}>{exclMsg.text}</div>
      )}

      {viewMode === "findings" && (
        <div className="treemap-mode-note">
          Grouped by finding type — folders are ignored, so the same path can
          appear under multiple groups.
        </div>
      )}

      {noFindingsPath && (
        <div style={{ color: "var(--fg-muted)", marginBottom: 8 }}>
          No findings for <span className="mono">{normalizePath(noFindingsPath)}</span>
        </div>
      )}

      {viewMode === "list" ? (
        <Table
          columns={LIST_COLUMNS}
          rows={listRows}
          rowKey={(r) => r.path}
          defaultSort={{ key: "findingCount", dir: "desc" }}
          globalFilter
          globalFilterPlaceholder="Filter files…"
          onRowClick={(r) => {
            if (!r.findingCount) {
              setNoFindingsPath(r.path || "selected item");
              return;
            }
            selectPath(r.path, r.path);
          }}
          isRowSelected={(r) => normalizePath(r.path) === selectedPathNorm}
          emptyMessage="No files"
        />
      ) : (
        <div
          className="treemap-svg-scroll"
          data-zoomed={zoom > 1 ? "true" : undefined}
        >
        {/* Sizing wrapper: zoom drives the WIDTH and the aspect-ratio derives the
            matching HEIGHT, so the SVG genuinely grows in both dimensions (and the
            scroll container pans) instead of being letterboxed at a fixed height. */}
        <div
          className="treemap-svg-inner"
          style={{ width: `${zoom * 100}%`, aspectRatio: `${WIDTH} / ${HEIGHT}` }}
        >
        <svg
          className="treemap"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="File treemap by severity"
        >
          {viewMode === "folder"
            ? cells.map((cell) => {
                // WP17 (T3) — compute per-cell delta state for leaf tiles only.
                // Folders are not tinted (their children carry the delta; tinting
                // a folder would hide all its children's individual states).
                const ds: "new" | "resolved" | null =
                  !cell.isOverflow && cell.node.isLeaf
                    ? newPaths.has(cell.node.path)
                      ? "new"
                      : resolvedPaths.has(cell.node.path)
                      ? "resolved"
                      : null
                    : null;
                return (
                  <TreemapCell
                    key={`${cell.node.path}@${Math.round(cell.x)},${Math.round(cell.y)}`}
                    cell={cell}
                    valueMode={valueMode}
                    selectedPath={selectedPathNorm}
                    valueLabel={valueLabel}
                    onActivate={() => activate(cell)}
                    onTip={(x, y) => setTip({ x, y, node: cell.node })}
                    onTipOut={() => setTip(null)}
                    onMenu={(x, y) => {
                      setTip(null);
                      clearSelectionMessage();
                      if (!cell.isOverflow) setMenu({ x, y, node: cell.node });
                    }}
                    deltaState={ds}
                  />
                );
              })
            : groupTiles.map((tile) => {
                const n = tile.data;
                const w = tile.x1 - tile.x0;
                const h = tile.y1 - tile.y0;
                const bg = treemapCellColor(n);
                const label = fitLabelForCell(n.name, w, h, {
                  fonts: TREEMAP_LABEL_FONTS,
                });
                return (
                  <g
                    key={n.path}
                    transform={`translate(${tile.x0},${tile.y0})`}
                    onMouseMove={(e) =>
                      setTip({ x: e.clientX, y: e.clientY, node: n })
                    }
                    onMouseLeave={() => setTip(null)}
                    onClick={() => selectFindingPath(n, n.name)}
                  >
                    <rect
                      width={w}
                      height={h}
                      fill={bg}
                      stroke="var(--bg)"
                      strokeWidth={1}
                      rx={2}
                    />
                    {label.text && (
                      <text
                        x={LABEL_X}
                        y={Math.min(h - 3, Math.max(label.fontPx + 2, 9))}
                        style={{
                          fill: labelColorFor(bg),
                          fontSize: `${label.fontPx}px`,
                        }}
                      >
                        {label.text}
                      </text>
                    )}
                  </g>
                );
              })}
        </svg>
        </div>
        </div>
      )}

      {fullscreen && (
        <button
          type="button"
          className="ddc-fullscreen-close"
          onClick={() => setFullscreen(false)}
          aria-label="Exit fullscreen"
          title="Exit fullscreen (Esc)"
        >
          ✕
        </button>
      )}

      {tip && (
        <div
          className="tooltip"
          style={{
            left: Math.min(tip.x + 14, window.innerWidth - 330),
            top: tip.y + 14,
          }}
        >
          <div className="path">{tip.node.path || "root"}</div>
          <div className="meta">
            {tip.node.findingCount} finding
            {tip.node.findingCount === 1 ? "" : "s"}
            {tip.node.locMetric === "unknown"
              ? " · LOC unavailable"
              : tip.node.loc > 0
              ? ` · ${tip.node.loc} LOC`
              : ""}
            {tip.node.bytes > 0 ? ` · ${formatBytes(tip.node.bytes)}` : ""}
            {topRule(tip.node.findings)
              ? ` · top: ${topRule(tip.node.findings)}`
              : ""}
            {!tip.node.isLeaf ? " · folder (click to zoom)" : ""}
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.node)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// One nested folder/leaf/overflow cell (T4). Zoom affordance (P13): folders and
// "…" get a dashed accent border + a "⤢" zoom glyph; leaves get a solid border.
// WP17 (T3): `deltaState` tints leaf tiles with new/resolved delta overlays.
function TreemapCell({
  cell,
  selectedPath,
  valueLabel,
  onActivate,
  onTip,
  onTipOut,
  onMenu,
  deltaState,
}: {
  cell: PlacedCell;
  valueMode: ValueMode;
  selectedPath: string | null;
  valueLabel: (n: TreeNode) => string;
  onActivate: () => void;
  onTip: (x: number, y: number) => void;
  onTipOut: () => void;
  onMenu: (x: number, y: number) => void;
  /** WP17 (T3) — delta tint state for this tile. */
  deltaState?: "new" | "resolved" | null;
}) {
  const { node, w, h, isOverflow } = cell;
  const zoomable = isOverflow || !node.isLeaf;
  const bg = isOverflow
    ? "var(--bg-elev)"
    : treemapCellColor(node, { includeDensity: false });
  const fgColor = isOverflow ? "var(--fg-muted)" : labelColorFor(bg);
  const selected = normalizePath(selectedPath ?? "") === normalizePath(node.path);

  const valueTextLayout = fitLabelForCell(valueLabel(node), w, h, {
    fonts: TREEMAP_VALUE_FONTS,
  });
  // Folders reserve a header strip; reduce the usable label width by the zoom
  // glyph + insets so we never overflow.
  const labelWidth = zoomable ? w - 16 : w;
  const label = fitLabelForCell(node.name, labelWidth, h, {
    fonts: TREEMAP_LABEL_FONTS,
  });
  // A second line for the metric value, only if tall enough.
  const showValue = valueTextLayout.text !== null && h >= 30;
  const valueText = showValue ? valueTextLayout.text : null;
  const labelY = Math.min(h - 3, Math.max(label.fontPx + 2, 9));
  const valueY = Math.min(h - 3, labelY + 12);
  const showLabel = label.text !== null;

  // WP17 (T3) — delta tint: new = dashed green border; resolved = muted green wash.
  // Uses border/overlay approach so the existing severity background stays visible.
  const deltaStroke = deltaState === "new" ? "#3fb864" : undefined;
  const deltaStrokeDash = deltaState === "new" ? "4 2" : undefined;

  return (
    <g
      transform={`translate(${cell.x},${cell.y})`}
      onMouseMove={(e) => onTip(e.clientX, e.clientY)}
      onMouseLeave={onTipOut}
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      className={
        zoomable
          ? "tm-zoom"
          : deltaState === "new"
          ? "tm-leaf tm-delta-new"
          : deltaState === "resolved"
          ? "tm-leaf tm-delta-resolved"
          : "tm-leaf"
      }
    >
      <rect
        width={w}
        height={h}
        fill={bg}
        stroke={
          selected
            ? "var(--accent)"
            : deltaStroke ?? (zoomable ? "var(--accent-dim)" : "var(--bg)")
        }
        strokeWidth={selected ? 2 : deltaState ? 2 : 1}
        strokeDasharray={
          selected
            ? undefined
            : deltaStrokeDash ?? (zoomable && !selected ? "3 2" : undefined)
        }
        rx={2}
      />
      {/* WP17 (T3) — resolved tint overlay: semi-transparent wash over the tile */}
      {deltaState === "resolved" && !isOverflow && (
        <rect
          width={w}
          height={h}
          fill="rgba(63, 184, 100, 0.10)"
          rx={2}
          style={{ pointerEvents: "none" }}
        />
      )}
      {label.text && (
        <text
          x={LABEL_X}
          y={labelY}
          style={{ fill: fgColor, fontSize: `${label.fontPx}px` }}
          className="tm-label"
        >
          {label.text}
        </text>
      )}
      {zoomable && showLabel && (
        <text
          x={w - ZOOM_GLYPH_X_OFFSET}
          y={labelY}
          style={{ fill: fgColor }}
          className="tm-zoom-glyph"
        >
          ⤢
        </text>
      )}
      {valueText && (
        <text
          x={LABEL_X}
          y={valueY}
          style={{
            fill: fgColor,
            opacity: 0.85,
            fontSize: `${valueTextLayout.fontPx}px`,
          }}
          className="tm-value"
        >
          {valueText}
        </text>
      )}
      {/* WP17 (T3) — +new badge on new tiles (leaf tiles only) */}
      {deltaState === "new" && showLabel && (
        <text
          x={w - LABEL_X}
          y={h - 4}
          style={{ fill: "#3fb864", fontSize: "8px", textAnchor: "end" }}
          className="tm-delta-badge"
        >
          +new
        </text>
      )}
    </g>
  );
}

function Legend() {
  const items = severityLegend();
  return (
    <div className="legend" aria-label="severity color scale">
      <span className="legend-title">Color: worst severity</span>
      {items.map((it) => (
        <div className="item" key={it.sev}>
          <span className="swatch" style={{ background: it.color }} />
          {it.label}
        </div>
      ))}
    </div>
  );
}
