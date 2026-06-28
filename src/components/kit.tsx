import type { ReactNode } from "react";

// Generic UI kit shared across views (pattern from anvil-poc/src/components/ui.tsx).
// Classes use the @theme tokens from index.css (bg-canvas, text-fg, border-line, …).

export function Card({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-line bg-canvas-alt p-5 ${
        onClick ? "cursor-pointer transition-colors hover:border-accent" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warn" | "error" | "accent";
}) {
  const tones: Record<string, string> = {
    neutral: "border-line bg-canvas text-fg-muted",
    success: "border-success-border bg-success-bg text-success-fg",
    warn: "border-warn-border bg-warn-bg text-warn-fg",
    error: "border-error-border bg-error-bg text-error-fg",
    accent: "border-accent bg-canvas text-accent",
  };
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A 0–100 score with a colour ramp: high green, mid accent, low neutral grey. */
export function ScoreBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <Pill>n/a</Pill>;
  const pct = Math.round(value);
  const tone = pct >= 66 ? "success" : pct >= 33 ? "accent" : "neutral";
  return <Pill tone={tone}>{pct}</Pill>;
}

/** A labelled 0–100 metric as a thin bar. */
export function MetricBar({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const pct = value == null ? 0 : Math.round(value);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className="tabular-nums">{value == null ? "n/a" : pct}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-20 text-sm text-fg-muted">
      {label}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-error-fg">
      {children}
    </div>
  );
}
