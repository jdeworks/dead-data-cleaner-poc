import type { MouseEvent } from "react";

// Static promo demo (browser, no Tauri backend): several desktop-only controls
// have no real action to take. Rather than greying them out (which reads as
// "broken"), we keep them looking ENABLED but make them inert — a hover tooltip
// explains that the action lives in the full app. This is the single source of
// truth for that behaviour so the treatment stays consistent across components.

export const DEMO_INERT_TITLE = "Available in the full app";

/**
 * Props for a control that should look enabled but do nothing. Spread onto a
 * <button> (or similar). The element stays keyboard-focusable; `aria-disabled`
 * communicates the inert state to assistive tech without the greyed-out look of
 * the native `disabled` attribute, and the `title` surfaces the explanation.
 */
export function inertControlProps(title: string = DEMO_INERT_TITLE): {
  title: string;
  "aria-disabled": true;
  onClick: (e: MouseEvent) => void;
} {
  return {
    title,
    "aria-disabled": true,
    onClick: (e: MouseEvent) => {
      // Swallow the click so nothing happens, but keep the control interactive
      // (focusable, hoverable) so the tooltip is discoverable.
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
