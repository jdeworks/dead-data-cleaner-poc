import { useEffect, useState } from "react";

// Small shared fullscreen toggle for the demo views (treemap, project tree, …)
// whose dense content is cramped on a phone. Returns the open state plus setters;
// while open it binds Esc-to-close and locks body scroll. Apply the `is-fullscreen`
// class to the view's root container (see the `.is-fullscreen` rules in ddc.css).
export function useFullscreen(): {
  fullscreen: boolean;
  setFullscreen: (v: boolean) => void;
  toggleFullscreen: () => void;
} {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);
  return { fullscreen, setFullscreen, toggleFullscreen: () => setFullscreen((f) => !f) };
}
