import type { ReactNode } from "react";

// The muted, centered "nothing to show / select something" message. Use inside
// a <Panel> when a view has no data for the current report or selection.

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
