import type { CognitiveRow, Finding, Metrics, Run } from "../types";
import { Panel, Stat, StatGrid, KV, Table, type Column } from "./ui";
import type { ScanDelta } from "../lib/delta";
import { Chip } from "./ui/Chip";
import { FileViewer } from "./FileViewer";
import { useState } from "react";

// One consolidated "top functions" table (WP02/P8) replacing the former two
// separate "Top by cognitive complexity" and "Top by LOC" panels. Both old
// tables showed the SAME columns over overlapping subsets of the same
// functions; we merge the two row sets (dedup by file:line:name) into a single
// resortable table defaulting to cognitive desc — nothing is lost, less space.
const TOP_COLUMNS: Column<CognitiveRow>[] = [
  {
    key: "file",
    label: "File",
    type: "text",
    cellClassName: "path-cell",
    filterable: true,
  },
  { key: "name", label: "Function", type: "text", cellClassName: "mono" },
  { key: "line", label: "Line", type: "number" },
  { key: "loc", label: "LOC", type: "number" },
  { key: "cognitive", label: "Cognitive", type: "number" },
  { key: "nesting", label: "Nesting", type: "number" },
  { key: "params", label: "Params", type: "number" },
];

function mergeTopRows(
  byCognitive: CognitiveRow[],
  byLoc: CognitiveRow[],
): CognitiveRow[] {
  const seen = new Set<string>();
  const out: CognitiveRow[] = [];
  for (const r of [...byCognitive, ...byLoc]) {
    const id = `${r.file}:${r.line}:${r.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

export function resolveViewerPath(targetRoot: string, scanRoot: string | undefined, path: string): string {
  const root = targetRoot && targetRoot !== "." ? targetRoot : scanRoot;
  if (!root || root === ".") return path;
  return `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function TopFunctionsTable({
  metrics,
  targetRoot,
  scanRoot,
}: {
  metrics: Metrics;
  targetRoot: string;
  scanRoot?: string;
}) {
  const rows = mergeTopRows(
    metrics.top_by_cognitive ?? [],
    metrics.top_by_loc ?? [],
  );
  const [selected, setSelected] = useState<CognitiveRow | null>(null);

  const functionLine = (row: CognitiveRow) => {
    if (Number.isFinite(row.line) && row.line > 0) return row.line;
    return 1;
  };

  const functionFallbackLabel = (row: CognitiveRow) => {
    if (Number.isFinite(row.line) && row.line > 0) {
      return `${row.name} (${row.file}:${row.line})`;
    }
    return `${row.name} (${row.file}: showing file start, no span)`;
  };

  return (
    <Panel
      title="Top functions"
      collapsible
      defaultOpen={false}
      persistKey="overview.top-functions"
      summary={`${rows.length} function${rows.length === 1 ? "" : "s"}`}
    >
      <p className="overview-section-hint">
        Largest and most complex functions from the scan, merged into one sortable list. Click a row to open the file at the function line.
      </p>
      <Table
        columns={TOP_COLUMNS}
        rows={rows}
        rowKey={(r, i) => `${r.file}:${r.line}:${r.name}:${i}`}
        defaultSort={{ key: "cognitive", dir: "desc" }}
        globalFilter
        globalFilterPlaceholder="Filter functions…"
        onRowClick={setSelected}
        isRowSelected={(row) =>
          selected?.file === row.file &&
          selected?.line === row.line &&
          selected?.name === row.name
        }
        emptyMessage="No function metrics"
      />
      {selected && (
        <div className="overview-function-viewer" data-testid="top-function-viewer">
          <FileViewer
            absPath={resolveViewerPath(targetRoot, scanRoot, selected.file)}
            displayPath={selected.file}
            highlightStart={functionLine(selected)}
            highlightEnd={functionLine(selected)}
            scanRoot={scanRoot}
            fallbackExcerpt={functionFallbackLabel(selected)}
          />
        </div>
      )}
    </Panel>
  );
}

// WP11 (T3) — a small ±N delta chip shown inline next to a stat.
// Green for improvement, red for regression, grey for zero.
// "Improvement" direction (spec + fix advisory):
//   findings: fewer = better → negative = green, positive = red
//   files / LOC: same convention — more = red, fewer = green
//   (improvementIsNegative=true for all three; the original code left
//    files/LOC always muted — fixed here per spec)
function DeltaChip({
  delta,
  improvementIsNegative = false,
}: {
  delta: number;
  improvementIsNegative?: boolean;
}) {
  if (delta === 0) return <Chip tone="muted" data-testid="delta-chip">±0</Chip>;
  const sign = delta > 0 ? "+" : "−";
  const abs = Math.abs(delta);
  // For all three metrics (findings, files, LOC): fewer = better = green
  const tone =
    improvementIsNegative
      ? delta < 0
        ? "delta-new"   // repurpose "delta-new" (green) for improvement
        : "bad"
      : "muted";        // caller opted out of directional coloring
  return (
    <Chip tone={tone} data-testid="delta-chip">
      {sign}{abs.toLocaleString()}
    </Chip>
  );
}

// WP26 (T1) — split findings into issues (non-clone) and clone classes.
interface FindingCounts {
  issueCount: number;
  cloneClassCount: number;
}

/** Compute issue/clone-class split from findings array. */
export function splitFindingCounts(findings: Finding[]): FindingCounts {
  let cloneClassCount = 0;
  let issueCount = 0;
  for (const f of findings) {
    if (f.rule === "duplicate-block") cloneClassCount++;
    else issueCount++;
  }
  return { issueCount, cloneClassCount };
}

export function MetricsHeader({
  metrics,
  run,
  findings,
  delta,
  onOpenDuplication,
  scanRoot,
}: {
  metrics: Metrics;
  run: Run;
  /** WP26 (T1): full findings array — used to compute issue/clone split and
   *  split delta chips. */
  findings: Finding[];
  // WP11 (T3) — optional scan delta for ±N chips in the stat grid.
  delta?: ScanDelta;
  /** WP26 (T1): navigate to the Duplication tab when the clone-classes tile
   *  is clicked. Optional — no navigation when absent. */
  onOpenDuplication?: () => void;
  /** Optional absolute scan root for FileViewer history/blame affordances. */
  scanRoot?: string;
}) {
  const { issueCount, cloneClassCount } = splitFindingCounts(findings);

  // Compute delta values only when delta is present and no ruleset mismatch.
  const showDelta = !!delta && !delta.rulesetMismatch;

  // WP26 (T1): split deltas by rule.
  // For issues (non-clone): count added/resolved that are NOT duplicate-block.
  // For clone classes: count added/resolved that ARE duplicate-block.
  const addedIssues = showDelta
    ? [...delta!.added].filter((id) => {
        // We only have IDs in delta.added; check against findings.
        const f = findings.find((x) => x.id === id);
        return f ? f.rule !== "duplicate-block" : true; // unknown → count as issue
      }).length
    : 0;
  const resolvedIssues = showDelta
    ? delta!.resolved.filter((f) => f.rule !== "duplicate-block").length
    : 0;
  const addedClones = showDelta
    ? [...delta!.added].filter((id) => {
        const f = findings.find((x) => x.id === id);
        return f ? f.rule === "duplicate-block" : false;
      }).length
    : 0;
  const resolvedClones = showDelta
    ? delta!.resolved.filter((f) => f.rule === "duplicate-block").length
    : 0;

  // Prev issue count and clone count from which deltas are derived.
  const prevIssueCount = showDelta ? issueCount - addedIssues + resolvedIssues : 0;
  const issuesDelta = showDelta ? issueCount - prevIssueCount : 0;
  const prevCloneCount = showDelta ? cloneClassCount - addedClones + resolvedClones : 0;
  const clonesDelta = showDelta ? cloneClassCount - prevCloneCount : 0;

  const filesDelta = showDelta ? metrics.files - delta!.prevMetrics.files : 0;
  const locDelta = showDelta ? metrics.total_loc - delta!.prevMetrics.total_loc : 0;

  return (
    <div>
      <p className="overview-section-hint overview-metrics-hint">
        Run totals give the scale of this scan; issue and clone tiles link to the detailed views when available.
      </p>
      <StatGrid>
        {/* WP26 (T1): issues tile (non-clone findings) */}
        <Stat
          value={
            <>
              <span data-testid="issue-count">{issueCount.toLocaleString()}</span>
              {showDelta && (
                <DeltaChip delta={issuesDelta} improvementIsNegative />
              )}
            </>
          }
          label="Issues"
        />
        {/* WP26 (T1): clone classes tile — clickable → Duplication view */}
        <Stat
          value={
            <>
              <span data-testid="clone-class-count">{cloneClassCount.toLocaleString()}</span>
              {showDelta && (
                <DeltaChip delta={clonesDelta} improvementIsNegative />
              )}
            </>
          }
          label={`Clone classes · ${metrics.duplication_ratio.toFixed(1)}% dup`}
          tone={metrics.duplication_ratio >= 20 ? "warn" : "default"}
          onClick={onOpenDuplication}
        />
        <Stat
          value={
            <>
              {metrics.files}
              {showDelta && <DeltaChip delta={filesDelta} improvementIsNegative />}
            </>
          }
          label="Files"
        />
        <Stat
          value={
            <>
              {metrics.total_loc.toLocaleString()}
              {showDelta && <DeltaChip delta={locDelta} improvementIsNegative />}
            </>
          }
          label="Total LOC"
        />
        <Stat value={metrics.total_tokens.toLocaleString()} label="Total tokens" />
        <Stat value={metrics.total_functions.toLocaleString()} label="Functions" />
        <Stat value={metrics.cloned_tokens.toLocaleString()} label="Cloned tokens" />
        <Stat value={metrics.min_tokens} label="Clone min tokens" />
        <Stat
          value={metrics.parse_failures}
          label="Parse failures"
          tone={metrics.parse_failures > 0 ? "warn" : "default"}
        />
        <Stat value={metrics.exact ? "exact" : "approx"} label="Clone mode" />
      </StatGrid>

      <Panel title="Run">
        <KV
          pairs={[
            { k: "Target root", v: run.target_root },
            { k: "Run id", v: run.id },
            { k: "Ruleset hash", v: run.ruleset_hash },
            { k: "Timestamp", v: run.timestamp },
          ]}
        />
      </Panel>

      <TopFunctionsTable metrics={metrics} targetRoot={run.target_root} scanRoot={scanRoot} />
    </div>
  );
}
