import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeterminismTier, Finding, GraphData, OriginRow } from "../types";
import { ruleLabel } from "../lib/report";
import { computeWindow } from "../lib/virtual";
import { IssueSeverityChip, GatingChip, TierChip } from "./badges";
import { EvidencePanel } from "./EvidencePanel";
import type { ScanDelta } from "../lib/delta";
import { Chip } from "./ui/Chip";
import { normalizePath } from "../lib/paths";
import { getRuleInfo } from "../lib/ruleInfo";
import {
  type FilterSpec,
  severityOf,
  severityOrdinal,
  groupOf,
  isExpectedFinding,
  defaultFindingSpec,
  emptyFilterSpec,
  loadFilterSpec,
  saveFilterSpec,
} from "../lib/filterSpec";
import { FilterBar } from "./FilterBar";

type SortKey = "confidence" | "rule" | "path" | "severity";
type SortDir = "asc" | "desc";

export type FindingsSortKey = SortKey;
export type FindingsSortDir = SortDir;

// WP10 — list virtualization constants.
// ROW_H: fixed rendered row height in px. Rows are single-line (the table
// forces `white-space: nowrap`, .path-cell ellipsis) so the height is stable:
// 6+6 vertical padding (index.css `table.data th,td{padding:6px 8px}`) + the
// ~13px line box + 1px `border-bottom` ~= 33px. Verified against a rendered row.
const ROW_H = 33;
const OVERSCAN = 8; // extra rows above/below the viewport to avoid blank flashes
const WINDOW_THRESHOLD = 60; // only virtualize past this many rows
const DEFAULT_VIEWPORT_H = 600; // assumed height before first layout measure
// Number of <th> columns in the table — used for spacer-row colSpan.
const COL_COUNT = 6;

// Number of <th> columns in the table WITH the delta column.
const COL_COUNT_WITH_DELTA = 7;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function dedupeExactFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const finding of findings) {
    const key = stableStringify(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

export function FindingsPanel({
  findings,
  pathFilter,
  onClearPathFilter,
  graph,
  origins,
  onTraceInGraph,
  onSelectFinding,
  targetRoot,
  memberRoots,
  initialRule,
  focusFinding,
  onFocusFindingApplied,
  delta,
  onShowInGraph,
  repoKey,
  onOpenDuplication,
  scanRoot,
  onViewHistory,
  spec: controlledSpec,
  onSpecChange,
  tier: controlledTier,
  onTierChange,
  sortKey: controlledSortKey,
  onSortKeyChange,
  sortDir: controlledSortDir,
  onSortDirChange,
  resolvedSectionOpen: controlledResolvedSectionOpen,
  onResolvedSectionOpenChange,
  demoInert,
}: {
  findings: Finding[];
  pathFilter: string | null;
  onClearPathFilter: () => void;
  graph?: GraphData;
  /** B-VIZ2: report origin-flow rows, threaded to EvidencePanel's Why tree. */
  origins?: OriginRow[];
  onTraceInGraph?: (nodeId: string) => void;
  // P21 — a cross-layer drill-down can pre-seed the rule filter via this prop.
  // We sync it into local state ONLY when it changes (see effect below), so the
  // user's manual filter edits are never clobbered on unrelated re-renders.
  initialRule?: string | null;
  // Reports the exact clicked finding (bypasses the id lookup) for the debug drawer.
  onSelectFinding?: (f: Finding) => void;
  // Absolute root for the inline code viewer (threaded to EvidencePanel).
  targetRoot?: string;
  // WP5.3.2: per-member roots for a multi-root report (`report.member_roots`),
  // threaded to EvidencePanel for the multi-root reveal join.
  memberRoots?: Record<string, string>;
  // WP23 T3 — when set, clear filters that would hide this finding, select its
  // row, and open EvidencePanel. Applied once (same ref pattern as initialRule).
  // Pass the Finding object directly to avoid a lookup.
  focusFinding?: Finding;
  // Called after focusFinding has been applied so the parent can clear the state
  // (prevents re-triggering on unrelated re-renders).
  onFocusFindingApplied?: () => void;
  // WP11 (T2) — optional scan delta. When present, annotates rows with "new"
  // chips and shows a "Resolved" collapsible section below.
  delta?: ScanDelta;
  /** T3: jump to graph for a finding's target node; omit when graph is unavailable. */
  onShowInGraph?: (nodeId: string) => void;
  /** WP20: repo-key for FilterSpec persistence (optional — no persistence when absent). */
  repoKey?: string | null;
  /** WP26 (T2): navigate to Duplication tab from the clone-exclusion banner.
   *  Optional — banner link is hidden when absent. */
  onOpenDuplication?: () => void;
  /**
   * GITVIEWER: scan root directory (absolute path). Forwarded to EvidencePanel
   * so the FileViewer Code/History tab toggle activates for file findings.
   */
  scanRoot?: string;
  /**
   * GITVIEWER: deep-link callback for "View file history →" in EvidencePanel.
   * When provided (with scanRoot), the button appears in the evidence badges row.
   */
  onViewHistory?: (absPath: string) => void;
  spec?: FilterSpec;
  onSpecChange?: (spec: FilterSpec) => void;
  tier?: DeterminismTier | "";
  onTierChange?: (tier: DeterminismTier | "") => void;
  sortKey?: FindingsSortKey;
  onSortKeyChange?: (sortKey: FindingsSortKey) => void;
  sortDir?: FindingsSortDir;
  onSortDirChange?: (sortDir: FindingsSortDir) => void;
  resolvedSectionOpen?: boolean;
  onResolvedSectionOpenChange?: (open: boolean) => void;
  /** Static demo: render desktop-only actions (e.g. "Open in editor") as
   *  enabled-looking but inert, with an explanatory tooltip. */
  demoInert?: boolean;
}) {
  // WP20: FilterSpec now supports controlled mode for app-level persistence.
  // Fallback local state mirrors persisted repo-local defaults for backward
  // compatibility and WP26 behavior when caller does not control these props.
  const [specLocal, setSpecLocal] = useState<FilterSpec>(() => {
    const base: FilterSpec = (() => {
      if (repoKey) {
        const saved = loadFilterSpec(repoKey);
        if (saved) return saved;
      }
      return defaultFindingSpec();
    })();
    // WP26: if the deep-link targets duplicate-block, auto-flip excludeClones off
    // so the clone rows are immediately visible.
    if (initialRule === "duplicate-block") {
      return { ...base, rules: [initialRule], excludeClones: false };
    }
    if (initialRule) return { ...base, rules: [initialRule] };
    return base;
  });
  const [tierLocal, setTierLocal] = useState<DeterminismTier | "">("");
  const [sortKeyLocal, setSortKeyLocal] = useState<SortKey>("confidence");
  const [sortDirLocal, setSortDirLocal] = useState<SortDir>("desc");
  const [resolvedSectionOpenLocal, setResolvedSectionOpenLocal] = useState(true);

  const isControlledSpec = controlledSpec !== undefined;
  const isControlledTier = controlledTier !== undefined;
  const isControlledSortKey = controlledSortKey !== undefined;
  const isControlledSortDir = controlledSortDir !== undefined;
  const isControlledResolvedSection = controlledResolvedSectionOpen !== undefined;

  const spec = isControlledSpec ? controlledSpec : specLocal;
  const tier = isControlledTier ? controlledTier : tierLocal;
  const sortKey = isControlledSortKey ? controlledSortKey : sortKeyLocal;
  const sortDir = isControlledSortDir ? controlledSortDir : sortDirLocal;
  const resolvedSectionOpen = isControlledResolvedSection
    ? controlledResolvedSectionOpen
    : resolvedSectionOpenLocal;

  const setSpec = (next: FilterSpec) => {
    if (isControlledSpec) onSpecChange?.(next);
    else setSpecLocal(next);
  };
  const setTier = (next: DeterminismTier | "") => {
    if (isControlledTier) onTierChange?.(next);
    else setTierLocal(next);
  };
  const setSortKey = (next: FindingsSortKey) => {
    if (isControlledSortKey) onSortKeyChange?.(next);
    else setSortKeyLocal(next);
  };
  const setSortDir = (next: FindingsSortDir) => {
    if (isControlledSortDir) onSortDirChange?.(next);
    else setSortDirLocal(next);
  };
  const setResolvedSectionOpen = (next: boolean) => {
    if (isControlledResolvedSection) onResolvedSectionOpenChange?.(next);
    else setResolvedSectionOpenLocal(next);
  };
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const displayFindings = useMemo(
    () => dedupeExactFindings(findings),
    [findings],
  );

  // Persist FilterSpec whenever it changes (best-effort; skipped when no repoKey).
  useEffect(() => {
    if (!isControlledSpec && repoKey) saveFilterSpec(repoKey, spec);
  }, [isControlledSpec, repoKey, spec]);

  // P21 — seed the rule filter from `initialRule`, but ONLY when the prop's value
  // actually changes (a fresh deep-link), never on every render. We track the last
  // applied value in a ref: each new non-null `initialRule` overwrites `spec.rules`
  // exactly once, so the user can freely change the filter afterwards without
  // it snapping back. A null `initialRule` (no preset) leaves the filter alone.
  //
  // WP26: when deep-linking to duplicate-block, also flip excludeClones off so
  // the clone rows appear immediately (otherwise deep-link lands on empty table).
  const lastInitialRule = useRef<string | null | undefined>(initialRule);
  useEffect(() => {
    if (initialRule !== lastInitialRule.current) {
      lastInitialRule.current = initialRule;
      if (initialRule != null) {
        setSpec({
          ...spec,
          rules: [initialRule],
          ...(initialRule === "duplicate-block" ? { excludeClones: false } : {}),
        });
      }
    }
  }, [initialRule, spec]);

  // WP23 T3 — focus a specific finding (from TopIssues member-row click).
  // Applied once: we track the last focused finding identity in a ref so the
  // effect only fires when a NEW focusFinding arrives (not on every render).
  // On apply:
  //   1. Reset all filters that could hide the finding (emptyFilterSpec).
  //   2. Select the finding's row (keyOf) so EvidencePanel opens.
  //   3. Scroll the virtualized list to the row's approximate offset.
  //   4. Call onFocusFindingApplied() so the parent can clear the prop.
  //
  // The ref is initialized to a unique sentinel (not undefined, not any Finding)
  // so that providing focusFinding on initial mount ALSO triggers the effect —
  // unlike initialRule which is already handled by the useState initializer.
  const FOCUS_SENTINEL = useRef<Record<string, never>>({}).current; // stable object, never === any Finding
  const lastFocusFinding = useRef<Finding | Record<string, never>>(FOCUS_SENTINEL);
  useEffect(() => {
    if (focusFinding !== lastFocusFinding.current) {
      lastFocusFinding.current = focusFinding ?? FOCUS_SENTINEL;
      if (focusFinding != null) {
        // 1. Clear filters that could hide this finding, while retaining the
        // clicked rule so Overview member-row drill-down keeps rule + file context.
        setSpec({ ...emptyFilterSpec(), rules: [focusFinding.rule] });
        setTier("");
        // 2. Select the finding row. We use indexOf which maps finding objects
        //    to their index — focusFinding IS the same object from the report
        //    array (passed directly from App.tsx), so the lookup works.
        // keyOf is called inline to avoid depending on a memoized closure.
        const focusKey = stableStringify(focusFinding);
        const idx = displayFindings.findIndex((f) => stableStringify(f) === focusKey);
        if (idx >= 0) {
          const k = `${focusFinding.id}#${idx}`;
          setSelectedKey(k);
          onSelectFinding?.(focusFinding);
          // 3. Scroll the virtualized container to the row's offset.
          const el = scrollRef.current;
          if (el) {
            el.scrollTop = idx * ROW_H;
          }
        }
        // 4. Let the parent clear the state.
        onFocusFindingApplied?.();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFinding]);

  // Since WP19, finding.id IS unique within a run (the engine post-pass appends
  // a `-<k>` ordinal suffix to collision-group members 2…n).  The `id#index`
  // row key is still a fine stable React key — it is a superset of id-only and
  // costs nothing.  The selection / Evidence lookup is unaffected.
  const indexOf = useMemo(
    () => new Map(displayFindings.map((f, i) => [f, i] as const)),
    [displayFindings],
  );
  const keyOf = (f: Finding) => `${f.id}#${indexOf.get(f)}`;

  // WP26: count clone findings for the banner.
  const cloneCount = useMemo(
    () => displayFindings.filter((f) => f.rule === "duplicate-block").length,
    [displayFindings],
  );
  const pathFilterNorm = pathFilter ? normalizePath(pathFilter) : "";

  // When the user deep-links to a single file (e.g. clicking a treemap cell),
  // the cell's badge counts EVERY finding on that path — clones included. To keep
  // that number honest, a path filter overrides the default clone exclusion so
  // the table reveals exactly what the cell counted (no "87 on the cell, 1 in the
  // table" mismatch). Without a path filter, the default excludeClones stands.
  const effectiveExcludeClones = spec.excludeClones && !pathFilterNorm;

  // Whether the banner should show (clones excluded AND there are clones).
  const showCloneBanner = !!(effectiveExcludeClones && cloneCount > 0);
  const hiddenByDefaultCount = useMemo(
    () =>
      displayFindings.filter(
        (f) =>
          (effectiveExcludeClones && f.rule === "duplicate-block") ||
          (!spec.includeExpected && isExpectedFinding(f)),
      ).length,
    [displayFindings, effectiveExcludeClones, spec.includeExpected],
  );

  const filtered = useMemo(() => {
    const sub = (spec.pathContains ?? "").trim().toLowerCase();
    const ruleFilter = spec.rules?.[0] ?? "";
    const rows = displayFindings.filter((f) => {
      if (pathFilterNorm && normalizePath(f.target.path) !== pathFilterNorm) return false;
      // WP26: excludeClones flag — skip duplicate-block when active. A path filter
      // (treemap deep-link) suppresses this so the file's full count is shown.
      if (effectiveExcludeClones && f.rule === "duplicate-block") return false;
      if (!spec.includeExpected && isExpectedFinding(f)) return false;
      // FilterSpec fields
      if (spec.groups.length > 0) {
        if (!spec.groups.includes(groupOf(f.rule))) return false;
      }
      if (ruleFilter && f.rule !== ruleFilter) return false;
      if (spec.gating && f.gating !== spec.gating) return false;
      if (severityOrdinal(severityOf(f)) < severityOrdinal(spec.minSeverity)) return false;
      if (f.confidence < spec.minCertainty) return false;
      if (sub && !f.target.path.toLowerCase().includes(sub)) return false;
      // UI-only tier filter
      if (tier && f.determinism_tier !== tier) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let c = 0;
      if (sortKey === "confidence") c = a.confidence - b.confidence;
      else if (sortKey === "rule") c = a.rule.localeCompare(b.rule);
      else if (sortKey === "severity")
        c = severityOrdinal(severityOf(a)) - severityOrdinal(severityOf(b));
      else c = a.target.path.localeCompare(b.target.path);
      return c * dir;
    });
    return rows;
  }, [displayFindings, pathFilterNorm, spec, tier, sortKey, sortDir]);

  const selected = useMemo(
    () => filtered.find((f) => keyOf(f) === selectedKey) ?? null,
    // keyOf is derived from indexOf; depend on it so the lookup is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, selectedKey, indexOf],
  );

  // WP10 — windowing state. We measure the scroll container and track the
  // scroll offset so only the visible slice of rows is mounted. In jsdom
  // `clientHeight` is 0, so `viewportH` stays 0 and we fall back to render-all
  // (see `virtualize` below) — keeping existing tests on the full-render path.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    // ResizeObserver is absent in jsdom; guard so tests don't throw.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Virtualize only when we have a real measured viewport AND enough rows to
  // matter. The two-row test (and jsdom's clientHeight 0) take the render-all
  // branch, so selection/Evidence behavior is byte-for-byte unchanged there.
  const virtualize = viewportH > 0 && filtered.length > WINDOW_THRESHOLD;
  const effViewportH = viewportH > 0 ? viewportH : DEFAULT_VIEWPORT_H;
  const { startIndex, endIndex } = virtualize
    ? computeWindow(scrollTop, effViewportH, ROW_H, filtered.length, OVERSCAN)
    : { startIndex: 0, endIndex: filtered.length };
  const visible = virtualize
    ? filtered.slice(startIndex, endIndex)
    : filtered;
  const topPad = virtualize ? startIndex * ROW_H : 0;
  const bottomPad = virtualize ? (filtered.length - endIndex) * ROW_H : 0;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      // severity default: desc (critical first)
      setSortDir(key === "confidence" || key === "severity" ? "desc" : "asc");
    }
  };
  const sortIndicator = (key: SortKey) => {
    if (sortKey === key) {
      return <span className={`table-sort-icon table-sort-icon-${sortDir}`}>{sortDir === "asc" ? " ▲" : " ▼"}</span>;
    }
    return <span className="table-sort-icon table-sort-icon-idle"> ↕</span>;
  };

  const sortStateClass = (key: SortKey) =>
    `table-sort${sortKey === key ? ` table-sort-active table-sort-${sortDir}` : ""}`;

  const sortAria = (key: SortKey): "ascending" | "descending" | "none" =>
    sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  // WP11 (T2) — effective column count (with or without the delta column).
  const showDelta = !!delta && !delta.rulesetMismatch;
  const effectiveColCount = showDelta ? COL_COUNT_WITH_DELTA : COL_COUNT;

  // WP26 (T2): split resolved findings into clones vs non-clones for folding.
  const resolvedClones = showDelta
    ? delta!.resolved.filter((f) => f.rule === "duplicate-block")
    : [];
  const resolvedIssues = showDelta
    ? delta!.resolved.filter((f) => f.rule !== "duplicate-block")
    : [];

  return (
    <div className="findings-layout">
      <div>
        {/* WP11 (T2) — delta warning banners */}
        {delta?.rulesetMismatch && (
          <div
            className="delta-banner delta-banner-warn"
            role="alert"
            data-testid="ruleset-mismatch-banner"
          >
            Ruleset changed since last scan — delta indicators disabled
          </div>
        )}
        {delta && !delta.rulesetMismatch && delta.targetRootMismatch && (
          <div
            className="delta-banner delta-banner-amber"
            role="alert"
            data-testid="target-root-mismatch-banner"
          >
            Scan roots differ — delta may be incomplete
          </div>
        )}

        {/* WP26 (T2): Clone exclusion banner — shown when excludeClones is on and clones exist. */}
        {showCloneBanner && (
          <div
            className="clone-exclusion-banner"
            data-testid="clone-exclusion-banner"
          >
            <span>
              Duplicate blocks:{" "}
              <strong data-testid="clone-banner-count">{cloneCount.toLocaleString()}</strong>{" "}
              clone classes
              {onOpenDuplication && (
                <>
                  {" "}→{" "}
                  <button
                    className="link-btn"
                    data-testid="clone-banner-open-duplication"
                    onClick={onOpenDuplication}
                  >
                    open Duplication view
                  </button>
                </>
              )}
            </span>
            <button
              className="chip chip-muted"
              data-testid="clone-banner-include-chip"
              onClick={() => setSpec({ ...spec, excludeClones: false })}
            >
              include in table
            </button>
          </div>
        )}

        {/* WP20: FilterBar replaces the ad-hoc filter controls */}
        <FilterBar
          spec={spec}
          onChange={setSpec}
          findings={displayFindings}
          tier={tier}
          onTierChange={setTier}
        />

        {pathFilter && (
          <div className="active-file" style={{ marginBottom: 8 }}>
            file: <span className="mono">{pathFilterNorm}</span>
            <button onClick={onClearPathFilter}>clear</button>
          </div>
        )}

        <div style={{ color: "var(--fg-muted)", marginBottom: 8 }}>
          {filtered.length} of {displayFindings.length - hiddenByDefaultCount} {effectiveExcludeClones || !spec.includeExpected ? "issues" : "findings"}
        </div>

        <div
          className="findings-table-wrap"
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <table className="data">
            <thead>
              <tr>
                <th
                  className={sortStateClass("confidence")}
                  aria-sort={sortAria("confidence")}
                  onClick={() => toggleSort("confidence")}
                >
                  Conf{sortIndicator("confidence")}
                </th>
                <th
                  className={sortStateClass("severity")}
                  aria-sort={sortAria("severity")}
                  onClick={() => toggleSort("severity")}
                >
                  Sev{sortIndicator("severity")}
                </th>
                <th
                  className={sortStateClass("rule")}
                  aria-sort={sortAria("rule")}
                  onClick={() => toggleSort("rule")}
                >
                  Rule{sortIndicator("rule")}
                </th>
                <th>Gating</th>
                <th>Tier</th>
                <th
                  className={sortStateClass("path")}
                  aria-sort={sortAria("path")}
                  onClick={() => toggleSort("path")}
                >
                  Target{sortIndicator("path")}
                </th>
                {showDelta && <th>Delta</th>}
              </tr>
            </thead>
            <tbody>
              {topPad > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={effectiveColCount}
                    style={{ height: topPad, padding: 0, border: 0 }}
                  />
                </tr>
              )}
              {visible.map((f) => {
                const k = keyOf(f);
                const isNew = showDelta && delta!.added.has(f.id);
                return (
                <tr
                  key={k}
                  className={`row-selectable${
                    selectedKey === k ? " selected" : ""
                  }`}
                  onClick={() => {
                    setSelectedKey(k);
                    onSelectFinding?.(f);
                  }}
                >
                  <td className="num">{f.confidence}</td>
                  <td>
                    <IssueSeverityChip severity={severityOf(f)} />
                  </td>
                  <td title={getRuleInfo(f.rule).description}>{ruleLabel(f.rule)}</td>
                  <td>
                    <GatingChip gating={f.gating} />
                  </td>
                  <td>
                    <TierChip tier={f.determinism_tier} />
                  </td>
                  <td className="path-cell" title={f.target.path}>
                    {f.target.path}
                    {f.target.span ? `:${f.target.span.start_line}` : ""}
                    {isExpectedFinding(f) && (
                      <Chip tone="muted" title={String((f.evidence.graph as Record<string, unknown>).expected_reason ?? "expected finding")}>
                        expected
                      </Chip>
                    )}
                    {/* T3: inline "Show in Graph" for file/doc targets */}
                    {onShowInGraph && (f.target.kind === "file" || f.target.kind === "doc") && (
                      <button
                        title="Show in Graph"
                        style={{ marginLeft: 4, padding: "0 4px", fontSize: 10, lineHeight: "14px", opacity: 0.6, verticalAlign: "middle" }}
                        onClick={(e) => { e.stopPropagation(); onShowInGraph(f.target.node_id); }}
                      >
                        ⬡
                      </button>
                    )}
                  </td>
                  {showDelta && (
                    <td>
                      {isNew && (
                        <Chip tone="delta-new" title="New since last scan">new</Chip>
                      )}
                    </td>
                  )}
                </tr>
                );
              })}
              {bottomPad > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={effectiveColCount}
                    style={{ height: bottomPad, padding: 0, border: 0 }}
                  />
                </tr>
              )}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={effectiveColCount} style={{ color: "var(--fg-dim)" }}>
                    No findings match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* WP11 (T2) — collapsible "Resolved since last scan" section */}
        {showDelta && delta!.resolved.length > 0 && (
          <details
            className="resolved-section"
            data-testid="resolved-section"
            open={resolvedSectionOpen}
            onToggle={(e) =>
              setResolvedSectionOpen((e.currentTarget as HTMLDetailsElement).open)
            }
          >
            <summary>
              Resolved since last scan ({delta!.resolved.length})
              {/* WP26 (T2): when clones are excluded, fold resolved clones into a summary line */}
              {spec.excludeClones && resolvedClones.length > 0 && (
                <span className="resolved-clone-summary" style={{ marginLeft: 8, color: "var(--fg-muted)", fontSize: "0.9em" }}>
                  (incl. +{resolvedClones.length} clone class{resolvedClones.length === 1 ? "" : "es"} resolved)
                </span>
              )}
            </summary>
            <table className="data resolved-table">
              <thead>
                <tr>
                  <th>Conf</th>
                  <th>Sev</th>
                  <th>Rule</th>
                  <th>Gating</th>
                  <th>Tier</th>
                  <th>Target</th>
                  <th>Delta</th>
                </tr>
              </thead>
              <tbody>
                {/* WP26 (T2): when excludeClones is on, show only resolved issues in the table;
                    clone resolution is summarised in the summary line above. */}
                {(spec.excludeClones ? resolvedIssues : delta!.resolved).map((f, i) => (
                  <tr
                    key={`resolved-${f.id}-${i}`}
                    className="row-selectable resolved-row"
                    onClick={() => onSelectFinding?.(f)}
                  >
                    <td className="num" style={{ color: "var(--fg-dim)" }}>{f.confidence}</td>
                    <td style={{ opacity: 0.6 }}>
                      <IssueSeverityChip severity={severityOf(f)} />
                    </td>
                    <td style={{ color: "var(--fg-dim)" }}>{ruleLabel(f.rule)}</td>
                    <td style={{ opacity: 0.6 }}>
                      <GatingChip gating={f.gating} />
                    </td>
                    <td style={{ opacity: 0.6 }}>
                      <TierChip tier={f.determinism_tier} />
                    </td>
                    <td
                      className="path-cell"
                      style={{ color: "var(--fg-dim)" }}
                      title={f.target.path}
                    >
                      {f.target.path}
                      {f.target.span ? `:${f.target.span.start_line}` : ""}
                    </td>
                    <td>
                      <Chip tone="delta-resolved" title="Resolved since last scan">resolved</Chip>
                    </td>
                  </tr>
                ))}
                {/* Fallback when all resolved were clones and excludeClones is on */}
                {spec.excludeClones && resolvedIssues.length === 0 && resolvedClones.length > 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--fg-muted)", fontStyle: "italic" }}>
                      All {resolvedClones.length} resolved finding{resolvedClones.length === 1 ? "" : "s"} were clone classes — shown in summary above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </details>
        )}
      </div>

      <EvidencePanel
        finding={selected}
        graph={graph}
        origins={origins}
        onTraceInGraph={onTraceInGraph}
        targetRoot={targetRoot}
        memberRoots={memberRoots}
        scanRoot={scanRoot}
        onViewHistory={onViewHistory}
        demoInert={demoInert}
      />
    </div>
  );
}
