import type { Finding } from "../types";

// A consistent severity scale used across treemap, project tree, and table.
export type Severity = "clean" | "low" | "medium" | "high" | "blocking";

export const SEVERITY_ORDER: Severity[] = [
  "clean",
  "low",
  "medium",
  "high",
  "blocking",
];

export const SEVERITY_LABEL: Record<Severity, string> = {
  clean: "Clean",
  low: "Low",
  medium: "Medium",
  high: "High",
  blocking: "CI-blocking",
};

// Severity of a single finding: ci-blocking dominates; otherwise scaled by
// confidence, but gating-aware — an `advisory-only` finding can never present as
// "high" regardless of confidence (WP4 P19: a confident orphan-doc is still only
// advisory, so it should not render as a high-severity alarm). Clean files have no
// findings (handled by the aggregate helper).
export function findingSeverity(f: Finding): Severity {
  if (f.gating === "ci-blocking") return "blocking";
  // Advisory-only findings cap at "medium" no matter how confident.
  if (f.gating === "advisory-only") {
    return f.confidence >= 40 ? "medium" : "low";
  }
  if (f.confidence >= 70) return "high";
  if (f.confidence >= 40) return "medium";
  return "low";
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

// Worst severity across a set of findings; "clean" when the set is empty.
export function aggregateSeverity(findings: Finding[]): Severity {
  return findings.reduce<Severity>(
    (acc, f) => maxSeverity(acc, findingSeverity(f)),
    "clean",
  );
}

// base_prior * product(multiplier factors), clamped to [0,1], expressed as 0-100.
// Used by the evidence panel to "show the work" and confirm it matches `confidence`.
export function derivedConfidence(f: Finding): number {
  const product = f.evidence.multipliers.reduce(
    (acc, m) => acc * m.factor,
    f.evidence.base_prior,
  );
  return Math.round(Math.min(1, Math.max(0, product)) * 100);
}
