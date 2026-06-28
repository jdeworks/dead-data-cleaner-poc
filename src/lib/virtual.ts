// WP10 — list virtualization math (pure, DOM-free so it can be unit-tested).
//
// The Findings table renders ~1376 rows. Mounting that many <tr> at once janks
// scrolling under software rendering. We keep ONE real <table> (so column widths
// stay aligned) but only render the slice of rows that intersects the viewport,
// padding the missing rows above/below with spacer <tr>s of the right height so
// the scrollbar stays accurate.
//
// `computeWindow` turns the current scroll position + viewport height into the
// [startIndex, endIndex) half-open slice to render, clamped to [0, len] and
// padded by `overscan` rows on each side to avoid blank flashes while scrolling.

interface Window {
  startIndex: number;
  endIndex: number;
}

export function computeWindow(
  scrollTop: number,
  viewportH: number,
  rowH: number,
  len: number,
  overscan: number,
): Window {
  // Guard against a zero/negative row height (would divide-by-zero / NaN).
  if (rowH <= 0) return { startIndex: 0, endIndex: len };
  const first = Math.floor(scrollTop / rowH) - overscan;
  const last = Math.ceil((scrollTop + viewportH) / rowH) + overscan;
  const endIndex = Math.min(len, Math.max(0, last));
  // Clamp start into [0, endIndex] so the slice is never inverted, even when the
  // scroll position runs past the end of the (e.g. just-filtered) list.
  const startIndex = Math.min(endIndex, Math.max(0, first));
  return { startIndex, endIndex };
}
