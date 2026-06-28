/**
 * filterSpec.ts — WP20: shared FilterSpec for the findings table, cleanup, and export.
 *
 * This is the TS mirror of `crates/ddc-model/src/filter.rs`. The Rust engine emits
 * `severity` on every finding; this module falls back to a local computation for old
 * stored reports that predate WP20 (the `severityOf` helper).
 *
 * **Field mapping (camelCase TS ↔ snake_case Rust):**
 * - `groups`       ↔ `groups`
 * - `rules`        ↔ `rules`
 * - `minSeverity`  ↔ `min_severity`
 * - `minCertainty` ↔ `min_certainty`
 * - `gating`       ↔ `gating`
 * - `pathContains` ↔ `path_contains`
 */

import type { Finding, Gating } from "../types";

// ── IssueSeverity type ─────────────────────────────────────────────────────

/**
 * Five-band severity taxonomy — the NEW axis (WP20).
 * Distinct from the existing UI color scale in `lib/severity.ts`
 * (`clean|low|medium|high|blocking`), which powers treemap/tree COLORS and
 * is NOT deleted in this WP.
 */
export type IssueSeverity = "info" | "low" | "medium" | "high" | "critical";

/** Ascending order (Info=0 → Critical=4). Used for comparisons. */
export const ISSUE_SEVERITY_ORDER: IssueSeverity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];

/** Human-readable labels for each band. */
export const ISSUE_SEVERITY_LABEL: Record<IssueSeverity, string> = {
  info: "Info",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

/** Ordinal of a severity band (info=0 … critical=4). */
export function severityOrdinal(s: IssueSeverity): number {
  return ISSUE_SEVERITY_ORDER.indexOf(s);
}

/** Return the higher-severity of two bands. */
export function maxIssueSeverity(a: IssueSeverity, b: IssueSeverity): IssueSeverity {
  return severityOrdinal(a) >= severityOrdinal(b) ? a : b;
}

// ── Base severity map ──────────────────────────────────────────────────────
// Mirrors `crates/ddc-model/src/severity.rs::base_severity`.
// The shared fixture numbers in T1/T3 tests are the cross-language drift guard.

const BASE_SEVERITY_MAP: Record<string, IssueSeverity> = {
  // critical
  "vulnerable-dependency": "critical",
  // high
  "frontend-call-to-missing-route": "high",
  "missing-dependency": "high",
  "missing-env-var": "high",
  // medium
  "orphan-file": "medium",
  "unused-endpoint": "medium",
  "architecture-violation": "medium",
  "dead-env-var": "medium",
  "unused-dependency": "medium",
  "forgot-to-track": "medium",
  "never-called": "medium",
  "deprecated-dependency": "medium",
  // low
  "unused-export": "low",
  "could-be-local": "low",
  "duplicate-block": "low",
  "doc-drift": "low",
  "orphan-doc": "low",
  "over-fetched-response-field": "low",
  "untracked-local-data": "low",
  "similar-doc-pair": "low",
  "dead-subtree": "low",
  "doc-symbol-drift": "low",
  // info
  "seems-outdated": "info",
  "reinvented-wheel": "info",
  "prefer-library": "info",
  "field-name-convention-drift": "info",
};

/** Base severity for a rule id, before escalators. Unknown rules → "low". */
export function baseSeverity(rule: string): IssueSeverity {
  return BASE_SEVERITY_MAP[rule] ?? "low";
}

// ── Escalators ─────────────────────────────────────────────────────────────
// Mirrors `crates/ddc-model/src/severity.rs::severity_of` exactly.
// Numbers match the Rust test fixtures (500 LOC / 100 KB / 10k tokens, 8 sites).

function bump(s: IssueSeverity): IssueSeverity {
  switch (s) {
    case "info":     return "low";
    case "low":      return "medium";
    case "medium":   return "high";
    case "high":
    case "critical": return "critical";
  }
}

/**
 * Compute the effective severity for a finding.
 *
 * When `f.severity` is present (WP20+ reports), return it directly.
 * For old reports that lack the field, apply the same base-map + escalators
 * logic the engine uses — so pre-WP20 stored runs display correct bands.
 *
 * **Escalators (same as Rust):**
 * 1. Impact: Loc ≥ 500, Bytes ≥ 100_000, TokenWeight ≥ 10_000 (primary or secondary)
 * 2. Clone-class: duplicate-block with site_count ≥ 8 (or sites array length)
 * 3. Gating floor: ci-blocking → max(severity, high)
 */
export function severityOf(f: Finding): IssueSeverity {
  // Fast path: engine already computed it (WP20+ findings)
  if (f.severity) return f.severity as IssueSeverity;

  // Fallback: recompute for old reports
  let sev = baseSeverity(f.rule);

  // Escalator 1 — impact
  const impact = f.impact;
  let impactTriggered = false;
  if (impact.metric === "loc" && impact.value >= 500) impactTriggered = true;
  else if (impact.metric === "bytes" && impact.value >= 100_000) impactTriggered = true;
  else if (impact.metric === "token_weight" && impact.value >= 10_000) impactTriggered = true;
  const graph = f.evidence.graph as Record<string, unknown>;
  // Secondary metrics (bytes / token_weight fields on Impact — optional)
  const impactBytes = (impact as unknown as Record<string, unknown>).bytes as number | undefined;
  const impactTokenWeight = (impact as unknown as Record<string, unknown>).token_weight as number | undefined;
  if (!impactTriggered && impactBytes !== undefined && impactBytes >= 100_000) impactTriggered = true;
  if (!impactTriggered && impactTokenWeight !== undefined && impactTokenWeight >= 10_000) impactTriggered = true;
  if (impactTriggered) sev = bump(sev);

  // Escalator 2 — clone-class size
  if (f.rule === "duplicate-block") {
    const siteCount =
      typeof graph["site_count"] === "number"
        ? (graph["site_count"] as number)
        : Array.isArray(graph["sites"])
          ? (graph["sites"] as unknown[]).length
          : 0;
    if (siteCount >= 8) sev = bump(sev);
  }

  // Escalator 3 — gating floor
  if (f.gating === "ci-blocking" && severityOrdinal(sev) < severityOrdinal("high")) {
    sev = "high";
  }

  return sev;
}

// ── Certainty bands ────────────────────────────────────────────────────────

export interface CertaintyBand {
  label: string;
  minCertainty: number;
}

/** Preset certainty bands (mirrors the spec). */
export const CERTAINTY_BANDS: CertaintyBand[] = [
  { label: "Confirmed (≥90)", minCertainty: 90 },
  { label: "High (≥70)",      minCertainty: 70 },
  { label: "Medium (≥40)",    minCertainty: 40 },
  { label: "Low (any)",       minCertainty: 0 },
];

// ── FilterSpec ─────────────────────────────────────────────────────────────

/**
 * Shared filter specification — mirrors Rust `FilterSpec` in
 * `crates/ddc-model/src/filter.rs`.
 *
 * All fields are optional / empty = no constraint.
 *
 * Note: `excludeClones` is a UI-only flag (WP26). It is NOT sent to the Rust
 * engine — it only affects the findings table display. Exports / cleanup keep
 * clones in scope via their groups / severity settings.
 */
export interface FilterSpec {
  /** Catalog tiers to include (e.g. `["core", "symbol"]`). Empty = all. */
  groups: string[];
  /** Optional rule-id refinement. Empty / undefined = all rules. */
  rules?: string[];
  /** Minimum severity (inclusive). "info" = no floor. */
  minSeverity: IssueSeverity;
  /** Minimum confidence 0–100 (inclusive). 0 = no floor. */
  minCertainty: number;
  /** When present (non-empty), only findings with this gating value pass. */
  gating?: Gating;
  /** Case-insensitive substring to match against `finding.target.path`. */
  pathContains?: string;
  /**
   * WP26 UI-only: exclude `duplicate-block` findings from the main findings
   * table (default true). When true, clones are hidden from the table and a
   * grouped banner row is shown instead. The flag is persisted alongside the
   * rest of the spec in localStorage. Does NOT affect exports or cleanup plans.
   */
  excludeClones?: boolean;
}

/** Empty FilterSpec that passes every finding (no constraints at all). */
export function emptyFilterSpec(): FilterSpec {
  return {
    groups: [],
    rules: undefined,
    minSeverity: "info",
    minCertainty: 0,
    gating: undefined,
    pathContains: undefined,
    excludeClones: false,
  };
}

/**
 * WP26 — Default FilterSpec for the findings table.
 * Like `emptyFilterSpec()` but with `excludeClones: true` so duplicate-block
 * findings are hidden from the table by default (they live in Duplication view).
 * FindingsPanel initialises from this when no persisted spec exists.
 */
export function defaultFindingSpec(): FilterSpec {
  return { ...emptyFilterSpec(), excludeClones: true };
}

/** Preset: safe-cleanup = { minSeverity: "medium", minCertainty: 70 }. */
export function safeCleanupPreset(): FilterSpec {
  return { ...defaultFindingSpec(), minSeverity: "medium", minCertainty: 70 };
}

/** Preset: cleanup-plan-everything = { minSeverity: "low", minCertainty: 40 }. */
export function aiPlanEverythingPreset(): FilterSpec {
  // Cleanup plans want clones (grouped, low-severity tasks). excludeClones=false.
  return { ...emptyFilterSpec(), minSeverity: "low", minCertainty: 40 };
}

// ── Group map (mirrors group_of in severity.rs) ────────────────────────────

const GROUP_MAP: Record<string, string> = {
  // core
  "orphan-file": "core",
  "unused-dependency": "core",
  "missing-dependency": "core",
  // symbol
  "unused-export": "symbol",
  "could-be-local": "symbol",
  "never-called": "symbol",
  "dead-subtree": "symbol",
  // duplication
  "duplicate-block": "duplication",
  // cruft
  "untracked-local-data": "cruft",
  "forgot-to-track": "cruft",
  // freshness
  "seems-outdated": "freshness",
  // docs
  "doc-drift": "docs",
  "orphan-doc": "docs",
  "similar-doc-pair": "docs",
  "doc-symbol-drift": "docs",
  // env
  "dead-env-var": "env",
  "missing-env-var": "env",
  // architecture
  "architecture-violation": "architecture",
  // crossref
  "frontend-call-to-missing-route": "crossref",
  "unused-endpoint": "crossref",
  "over-fetched-response-field": "crossref",
  "field-name-convention-drift": "crossref",
  // recommend
  "reinvented-wheel": "recommend",
  "prefer-library": "recommend",
  // online
  "deprecated-dependency": "online",
  "vulnerable-dependency": "online",
};

/** Group (catalog tier) for a rule id. Unknown rules → "core". */
export function groupOf(rule: string): string {
  return GROUP_MAP[rule] ?? "core";
}

// ── applyFilter ────────────────────────────────────────────────────────────

/** Apply a FilterSpec to an array of findings. Returns matching findings. */
export function applyFilter(findings: Finding[], spec: FilterSpec): Finding[] {
  return findings.filter((f) => passes(f, spec));
}

function passes(f: Finding, spec: FilterSpec): boolean {
  // WP26: clone exclusion (UI-only flag). When excludeClones is true and no
  // rule deep-link targets duplicate-block explicitly, clone findings are hidden.
  // The `excludeClones` flag is handled by callers that need the full exclusion
  // behaviour (banner + resolve folding). applyFilter respects it so that a
  // plain `applyFilter(findings, spec)` also excludes clones when the flag is set.
  if (spec.excludeClones && f.rule === "duplicate-block") return false;

  // Group filter
  if (spec.groups.length > 0) {
    const g = groupOf(f.rule);
    if (!spec.groups.includes(g)) return false;
  }

  // Rule refinement
  if (spec.rules && spec.rules.length > 0) {
    if (!spec.rules.includes(f.rule)) return false;
  }

  // Severity floor
  if (severityOrdinal(severityOf(f)) < severityOrdinal(spec.minSeverity)) return false;

  // Certainty floor
  if (f.confidence < spec.minCertainty) return false;

  // Gating filter
  if (spec.gating) {
    if (f.gating !== spec.gating) return false;
  }

  // Path substring (case-insensitive)
  if (spec.pathContains && spec.pathContains.trim().length > 0) {
    if (!f.target.path.toLowerCase().includes(spec.pathContains.toLowerCase())) return false;
  }

  return true;
}

// ── Persistence helpers ────────────────────────────────────────────────────
// Per-repo-key persistence in localStorage — same pattern as pinned baseline in delta.ts.

const LS_PREFIX = "ddc-filterspec-v1";

/** Load the persisted FilterSpec for a repo-key; returns null if absent/invalid. */
export function loadFilterSpec(repoKey: string): FilterSpec | null {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}:${repoKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as FilterSpec;
  } catch {
    return null;
  }
}

/** Save a FilterSpec for a repo-key to localStorage. */
export function saveFilterSpec(repoKey: string, spec: FilterSpec): void {
  try {
    localStorage.setItem(`${LS_PREFIX}:${repoKey}`, JSON.stringify(spec));
  } catch {
    // best-effort
  }
}
