import { useEffect, useRef } from "react";

// WP8 P14-nav — a small, absolutely-positioned right-click menu for the treemap.
// Driven entirely by a `{x, y}` anchor + a list of items the caller assembles
// (folder-vs-leaf differences live in the caller). It clamps its origin to the
// viewport like the treemap tooltip, and closes on any outside-click / Escape /
// scroll — read-only navigation chrome that never lingers.

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  /** When set, the item renders disabled and ignores clicks (e.g. an action that
   *  is only meaningful in the desktop shell). */
  disabled?: boolean;
  /** Optional hover tooltip. Used by the static demo to keep an item looking
   *  enabled while explaining (via `aria-disabled` + tooltip) that the real
   *  action lives in the full app. */
  title?: string;
  /** Static demo: looks enabled but does nothing on click (paired with `title`). */
  inert?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape / scroll. Each listener is registered once
  // and torn down on unmount (the menu unmounts whenever its driving state goes
  // null), so no listener leaks across opens.
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll() {
      onClose();
    }
    // `mousedown` (not `click`) so the menu is gone before any underlying click
    // handler fires; capture-phase scroll so nested scrollers also dismiss it.
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  // Clamp the origin into the viewport (mirrors the tooltip's right-edge clamp).
  const left = Math.min(x, window.innerWidth - 240);
  const top = Math.min(y, window.innerHeight - (items.length * 34 + 12));

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: Math.max(left, 4), top: Math.max(top, 4) }}
      role="menu"
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className="context-menu-item"
          disabled={it.disabled}
          aria-disabled={it.inert || undefined}
          title={it.title}
          onClick={() => {
            if (it.disabled) return;
            // Inert demo items keep the menu open-then-close UX but take no action.
            if (it.inert) {
              onClose();
              return;
            }
            it.onClick();
            onClose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
