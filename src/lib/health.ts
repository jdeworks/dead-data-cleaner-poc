import type { Finding, Metrics } from "../types";

// WP09 T4 — repo HEALTH SCORE. A single 0–100 number (+ A–F letter) derived
// purely from fields already present in `ddc --json` (metrics.* + per-finding
// gating/confidence/rule) so the engine stays byte-identical and the score
// updates live per scan. See workpackages/WP09-metrics-page.md "T4 Health-score
// proposal" for the full rationale + reference calibration.
//
// Penalty model: start at 100, deduct three capped penalties (live issue
// density, duplication, parse-failure blind-spots), clamp to [0,100].

type HealthGrade = "A" | "B" | "C" | "D" | "F";

export interface HealthBreakdown {
  /** Final 0–100 score (rounded to 1 dp). */
  score: number;
  grade: HealthGrade;
  /** Weighted, confidence-scaled, non-clone issues per 1000 LOC. */
  density: number;
  /** Capped penalty from weighted issue density (max 55). */
  issuePenalty: number;
  /** Capped penalty from duplication_ratio (max 30). */
  dupPenalty: number;
  /** Capped penalty from parse failures (max 15). */
  parsePenalty: number;
}

// Severity weight: a CI-blocking issue is ~5× heavier than an advisory one,
// satisfying "CI-blocking heavier than low-confidence".
function severityWeight(f: Finding): number {
  return f.gating === "ci-blocking" ? 10 : 2;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function gradeFor(score: number): HealthGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function computeHealth(
  findings: Finding[],
  metrics: Metrics,
): HealthBreakdown {
  const kloc = Math.max(metrics.total_loc / 1000, 1);

  // Weighted issue density — duplicate-block excluded (duplication has its own
  // dedicated penalty; counting both would double-penalize, and clones are the
  // overwhelming majority of findings).
  let wsum = 0;
  for (const f of findings) {
    if (f.rule === "duplicate-block") continue;
    wsum += severityWeight(f) * (clamp(f.confidence, 0, 100) / 100);
  }
  const density = wsum / kloc;

  // Saturating curve: a few issues hurt, a long advisory tail can't blow the cap.
  const issuePenalty = 55 * (1 - Math.exp(-density / 8));
  // Use prod_duplication_ratio when available so test-heavy repos are not
  // unfairly penalised for idiomatic test-fixture boilerplate duplication.
  const dupRatio = metrics.prod_duplication_ratio ?? metrics.duplication_ratio;
  const dupPenalty =
    (Math.min(Math.max(dupRatio, 0), 40) / 40) * 30;
  const parsePenalty =
    (Math.min(Math.max(metrics.parse_failures, 0), 10) / 10) * 15;

  const raw = 100 - issuePenalty - dupPenalty - parsePenalty;
  const score = Math.round(clamp(raw, 0, 100) * 10) / 10;

  return {
    score,
    grade: gradeFor(score),
    density,
    issuePenalty,
    dupPenalty,
    parsePenalty,
  };
}

// One-line explanation of how the score is built (T3 affordance on the score).
export const HEALTH_EXPLANATION =
  "0–100 (A–F): starts at 100, then deducts for confidence/gating-weighted " +
  "issue density per 1000 LOC (CI-blocking ≈5× advisory), code duplication, " +
  "and parse-failure blind spots. Clones counted once, via duplication.";
