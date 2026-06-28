import { useState, type ReactNode } from "react";
import { cx } from "../../lib/cx";

// The standard bordered card with an optional uppercase title and a right-side
// actions slot. Every view section should be a <Panel> so spacing, borders and
// heading style stay uniform.
//
// P20: opt-in collapse. When `collapsible`, the panel renders as a native
// <details>/<summary> so it can fold; otherwise it renders the EXACTLY the
// original stateless <section> (byte-identical for the ~24 existing call sites
// that don't pass `collapsible`).

const PERSIST_PREFIX = "ddc.panel.";

/** Read/write the open state of a collapsible panel in localStorage, namespaced
 *  under `ddc.panel.<persistKey>`. All access is try/catch-guarded so a missing
 *  or quota-blocked storage (or SSR/jsdom edge) never throws. */
export function usePersistedOpen(
  persistKey: string | undefined,
  defaultOpen: boolean,
): [boolean, (next: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(() => {
    if (!persistKey) return defaultOpen;
    try {
      const raw = localStorage.getItem(PERSIST_PREFIX + persistKey);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      /* storage unavailable — fall back to the default */
    }
    return defaultOpen;
  });

  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (persistKey) {
      try {
        localStorage.setItem(PERSIST_PREFIX + persistKey, next ? "1" : "0");
      } catch {
        /* best-effort persistence */
      }
    }
  };

  return [open, setOpen];
}

/** Pure default-open policy. Each call site passes its OWN context; the Panel
 *  does not infer importance. Open when the section is high-importance, has
 *  findings, or is explicitly primary; collapsed for secondary / empty-summary
 *  sections. */
export function smartDefaultOpen({
  importance,
  hasFindings,
  primary,
}: {
  importance?: "high" | "secondary" | "summary";
  hasFindings?: boolean;
  primary?: boolean;
}): boolean {
  if (importance === "high") return true;
  if (hasFindings === true) return true;
  if (primary === true) return true;
  return false;
}

export function Panel({
  title,
  actions,
  className,
  children,
  collapsible,
  defaultOpen = true,
  persistKey,
  summary,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
  // P20 opt-in collapse:
  collapsible?: boolean;
  defaultOpen?: boolean;
  persistKey?: string;
  // Slot shown next to the title when the panel is collapsed.
  summary?: ReactNode;
}) {
  const [open, setOpen] = usePersistedOpen(persistKey, defaultOpen);

  if (collapsible) {
    return (
      <details
        className={cx("panel", className)}
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="panel-head">
          {title && <h2>{title}</h2>}
          {!open && summary && (
            <span className="panel-summary">{summary}</span>
          )}
          {actions && (
            <div
              className="panel-actions"
              // Don't toggle the panel when interacting with the actions slot.
              onClick={(e) => e.stopPropagation()}
            >
              {actions}
            </div>
          )}
          <span className="panel-chevron" aria-hidden="true">
            ▸
          </span>
        </summary>
        {children}
      </details>
    );
  }

  return (
    <section className={cx("panel", className)}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
