// WP11 (T1) — scan-over-scan diff: pure TypeScript, no side effects.
// Computes `ScanDelta` from two `DdcReport` objects loaded from the unified
// store. The diff is computed by finding.id (content-addressed, stable across
// line-number shifts). A `rulesetMismatch` guard disables delta chips when the
// two scans used different configs (all IDs change atomically). A
// `targetRootMismatch` guard warns but still shows delta indicators.

import type { DdcReport, Finding, Metrics } from "../types";
import type { HealthBreakdown } from "./health";
import { computeHealth } from "./health";

/** The delta surface threaded as an optional prop to FindingsPanel /
 *  MetricsHeader / MetricsPage. `undefined` = no previous scan loaded. */
export interface ScanDelta {
  /** IDs present in the current scan but not the previous one. */
  added: Set<string>;
  /** Full Finding objects from the PREVIOUS scan that are no longer in the
   *  current scan (needed for the resolved section display). */
  resolved: Finding[];
  /** Metrics from the previous scan (for ±N chips in MetricsHeader /
   *  MetricsPage). */
  prevMetrics: Metrics;
  /** Health breakdown from the previous scan (for ±N.N in MetricsPage). */
  prevHealth: HealthBreakdown;
  /** True when the two scans' `ruleset_hash` values differ. When true,
   *  `added` and `resolved` are empty — callers render the warning banner
   *  but skip delta chips. */
  rulesetMismatch: boolean;
  /** True when the two scans' `target_root` values differ. Callers render
   *  an amber warning but still show delta indicators. */
  targetRootMismatch: boolean;
}

/**
 * Compute the diff between `current` and `prev` DdcReport values.
 *
 * Matching key: `finding.id` (content-addressed, rule + node_id + ruleset_hash).
 * A finding that "moves" (e.g. a renamed file) is semantically a new finding on
 * a new target — the correct semantic.
 *
 * When `rulesetMismatch`, `added` and `resolved` are empty (IDs are not
 * comparable across ruleset changes) — callers should show a banner instead of
 * delta chips.
 */
export function computeDelta(current: DdcReport, prev: DdcReport): ScanDelta {
  const rulesetMismatch = current.run.ruleset_hash !== prev.run.ruleset_hash;
  const targetRootMismatch = current.run.target_root !== prev.run.target_root;

  const prevHealth = computeHealth(prev.findings, prev.metrics);

  if (rulesetMismatch) {
    return {
      added: new Set<string>(),
      resolved: [],
      prevMetrics: prev.metrics,
      prevHealth,
      rulesetMismatch: true,
      targetRootMismatch,
    };
  }

  // Build sets of all IDs in each scan.  Since WP19, finding.id IS unique
  // within a run: the engine's post-pass appends a deterministic `-<k>` ordinal
  // suffix to collision-group members 2…n (same rule + node_id).  Set membership
  // here is now a precise 1-to-1 finding identity check, not just a
  // "rule+node_id combination exists" approximation.  The delta semantics are
  // unchanged — matching by id is still the right operation.
  const currentIds = new Set<string>(current.findings.map((f) => f.id));
  const prevIds = new Set<string>(prev.findings.map((f) => f.id));

  // added = ids in current but not in prev.
  const added = new Set<string>();
  for (const id of currentIds) {
    if (!prevIds.has(id)) added.add(id);
  }

  // resolved = full Finding objects from prev that are not in current.
  // De-duplicate by id so each resolved id appears once in the section.
  const resolvedSeen = new Set<string>();
  const resolved: Finding[] = [];
  for (const f of prev.findings) {
    if (!currentIds.has(f.id) && !resolvedSeen.has(f.id)) {
      resolvedSeen.add(f.id);
      resolved.push(f);
    }
  }

  return {
    added,
    resolved,
    prevMetrics: prev.metrics,
    prevHealth,
    rulesetMismatch: false,
    targetRootMismatch,
  };
}

// ── WP17 (T2) — health-score sparkline path computation ──────────────────────
// Pure geometry: converts an array of (x, y) points into an SVG path string.
// No chart library, consistent with Charts.tsx.

/** A single data point for the sparkline: x in [0, width], y in [0, height]. */
export interface SparkPoint {
  /** ISO timestamp label (display only). */
  timestamp: string;
  /** Health score 0–100. */
  value: number;
}

/**
 * Compute an SVG `d` path string from a list of health-score points.
 *
 * - 0 points → empty string (caller renders nothing).
 * - 1 point → a small circle path (M + a tiny arc) to represent a single dot.
 * - ≥2 points → a `M L …` polyline path (no curves, no library dependency).
 *
 * `width` / `height` define the SVG viewport the path lives in.
 * Points are linearly scaled to fit the viewport with small margins.
 */
export function computeSparklinePath(
  points: SparkPoint[],
  width: number,
  height: number,
): string {
  if (points.length === 0) return "";

  const MARGIN_X = 4;
  const MARGIN_Y = 4;

  const pw = width - MARGIN_X * 2;
  const ph = height - MARGIN_Y * 2;

  const n = points.length;

  // Scale Y: clamp to [0, 100] health-score range.
  const toY = (v: number) =>
    MARGIN_Y + ph - Math.max(0, Math.min(ph, (v / 100) * ph));
  // Scale X: evenly spaced.
  const toX = (i: number) =>
    MARGIN_X + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);

  if (n === 1) {
    // Single point: a small filled circle using two arcs (standard SVG circle trick).
    const cx = toX(0);
    const cy = toY(points[0].value);
    const r = 3;
    return (
      `M ${cx - r} ${cy} ` +
      `A ${r} ${r} 0 1 1 ${cx + r} ${cy} ` +
      `A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
    );
  }

  // ≥2 points: polyline.
  const parts = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(2)} ${toY(p.value).toFixed(2)}`);
  return parts.join(" ");
}

// ── localStorage baseline picker ──────────────────────────────────────────────
// Owner decision (WP11 spec): baseline defaults to the previous scan (N−1) but
// the user can PIN any retained scan from the Load-history picker. A pinned path
// is stored under the key `ddc.baseline.<repoKey>` in localStorage.

const BASELINE_PREFIX = "ddc.baseline.";

/** Persist a pinned baseline file path for `repoKey`. Pass `null` to clear. */
export function setPinnedBaseline(repoKey: string, filePath: string | null): void {
  const key = BASELINE_PREFIX + repoKey;
  if (filePath === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, filePath);
  }
}

/** Retrieve the pinned baseline file path for `repoKey`, or `null` if none. */
export function getPinnedBaseline(repoKey: string): string | null {
  return localStorage.getItem(BASELINE_PREFIX + repoKey);
}

/** Clear all pinned baselines (e.g. on settings reset). */
export function clearAllPinnedBaselines(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(BASELINE_PREFIX)) keysToRemove.push(k);
  }
  for (const k of keysToRemove) {
    localStorage.removeItem(k);
  }
}
