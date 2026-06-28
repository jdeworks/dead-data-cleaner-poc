import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

// A single value + label tile. Replaces the two divergent stat cards that used
// to live in MetricsHeader (`Card`) and CrossLayerPanel (`Stat`). `tone="warn"`
// colors the value to flag a number that wants attention (parse failures, high
// duplication). Group several in a <StatGrid>.

export type StatTone = "default" | "warn";

export function Stat({
  value,
  label,
  hint,
  tone = "default",
  onClick,
}: {
  value: ReactNode;
  label: ReactNode;
  hint?: string;
  tone?: StatTone;
  // Opt-in: makes the tile a button (keyboard-activatable, role="button") that
  // deep-links somewhere — e.g. a cross-layer count → the pre-filtered Findings
  // tab. Plain (non-interactive) tiles omit it and stay a passive <div>.
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <div
        className={cx("stat", "stat-clickable")}
        title={hint}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <div className={cx("stat-v", tone === "warn" && "warn")}>{value}</div>
        <div className="stat-l">{label}</div>
      </div>
    );
  }
  return (
    <div className="stat" title={hint}>
      <div className={cx("stat-v", tone === "warn" && "warn")}>{value}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

// Responsive auto-fill grid (overview metrics). For a tight inline row use
// `layout="row"` (cross-layer join summary).
export function StatGrid({
  layout = "grid",
  children,
}: {
  layout?: "grid" | "row";
  children: ReactNode;
}) {
  return <div className={cx("stat-grid", layout === "row" && "row")}>{children}</div>;
}
