import type { DeterminismTier, Gating } from "../types";
import { SEVERITY_LABEL, type Severity } from "../lib/severity";
import { ISSUE_SEVERITY_LABEL, type IssueSeverity } from "../lib/filterSpec";

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={`chip sev-${severity}`}>{SEVERITY_LABEL[severity]}</span>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span
      className="sev-dot"
      style={{ background: `var(--sev-${severity})` }}
      title={SEVERITY_LABEL[severity]}
    />
  );
}

// WP25 T4 — plain-language glossary tooltips for gating values.
export const GATING_TOOLTIP: Record<Gating, string> = {
  "ci-blocking":
    "ci-blocking: this finding causes ddc to exit nonzero — it will fail CI unless suppressed or fixed.",
  "advisory-only":
    "advisory-only: never fails CI — either a heuristic-tier finding or one demoted below the confidence gate. Review at your discretion.",
};

export function GatingChip({ gating }: { gating: Gating }) {
  return (
    <span className={`chip gating ${gating}`} title={GATING_TOOLTIP[gating]}>
      {gating}
    </span>
  );
}

const TIER_SHORT: Record<DeterminismTier, string> = {
  deterministic: "deterministic",
  "detect-deterministic-interpret-ai": "detect→interpret-ai",
  ai: "ai",
};

// WP25 T4 — plain-language glossary tooltips for determinism tier values.
export const TIER_TOOLTIP: Record<DeterminismTier, string> = {
  deterministic:
    "deterministic: the signal is detected and interpreted by a fully deterministic static analysis — no AI involved. Results are byte-identical across runs.",
  "detect-deterministic-interpret-ai":
    "detect→interpret-ai: the signal is detected deterministically; its interpretation uses the optional AI layer. The detection itself is reproducible; the interpretation may vary.",
  ai: "ai: both detection and interpretation use the AI layer. Advisory only; non-deterministic across runs.",
};

/** WP20: new-axis severity chip — distinct from the treemap/tree SeverityChip. */
export function IssueSeverityChip({ severity }: { severity: IssueSeverity }) {
  return (
    <span className={`chip issue-sev issue-sev-${severity}`}>
      {ISSUE_SEVERITY_LABEL[severity]}
    </span>
  );
}

export function TierChip({ tier }: { tier: DeterminismTier }) {
  return (
    <span className="chip tier" title={TIER_TOOLTIP[tier]}>
      {TIER_SHORT[tier]}
    </span>
  );
}
