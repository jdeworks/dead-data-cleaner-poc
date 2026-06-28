import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";

// A generic pill. For severity / determinism-tier / gating chips use the
// dedicated SeverityChip / TierChip / GatingChip from `../badges` — those carry
// the canonical color scale. This `Chip` covers everything else (status,
// counts, free-form tags) with a small neutral tone set.

// WP11 (T2) — `delta-new` and `delta-resolved` are new variants for the
// scan-delta indicators in FindingsPanel. `delta-new` = green (new finding
// in this scan); `delta-resolved` = muted blue/green (resolved since prev).
export type ChipTone =
  | "default"
  | "ok"
  | "muted"
  | "warn"
  | "bad"
  | "info"
  | "delta-new"
  | "delta-resolved";

const TONE_CLASS: Record<ChipTone, string> = {
  default: "tier", // the neutral bordered chip (index.css .chip.tier)
  ok: "ok-chip",
  muted: "muted-chip",
  warn: "tone-warn",
  bad: "tone-bad",
  info: "tone-info",
  "delta-new": "delta-new-chip",
  "delta-resolved": "delta-resolved-chip",
};

// WP11 (fix) — extend with HTMLAttributes so callers can pass `data-testid`,
// `data-*`, `aria-*`, and other standard span attributes.
interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  children: ReactNode;
}

export function Chip({
  tone = "default",
  title,
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <span className={cx("chip", TONE_CLASS[tone], className)} title={title} {...rest}>
      {children}
    </span>
  );
}
