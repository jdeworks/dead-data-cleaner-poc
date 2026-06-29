// WP03 — pure treemap helpers (readability, severity gradient, value modes,
// nested-fit/overflow). Kept side-effect free so they can be unit-tested without
// rendering. The React component (Treemap.tsx) is a thin shell over these.

import type { Severity } from "./severity";
import { SEVERITY_ORDER } from "./severity";
import type { TreeNode } from "./tree";

// ── T1 (P9) — label contrast from cell-background luminance ──────────────────

/** Parse a #rgb / #rrggbb hex string into [r,g,b] 0-255. Returns null on bad
 *  input so callers can fall back. */
export function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  return null;
}

/** Relative luminance (WCAG sRGB) in [0,1]. Used to decide black vs white text
 *  so we never render grey-on-yellow. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0; // unparseable → assume dark → white text
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21) between two hex colors. */
export function contrastRatio(aHex: string, bHex: string): number {
  const la = relativeLuminance(aHex);
  const lb = relativeLuminance(bHex);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick a high-contrast label color for a given cell background hex. Picks
 *  whichever of pure white / pure black has the BETTER WCAG contrast against the
 *  cell — a fixed luminance threshold was wrong for the mid-luminance severity
 *  fills (yellow-green `low`, orange `high`), which sit just under the cutoff and
 *  so got light text at ~2.4:1 when dark text gives 7-8:1. Selecting by actual
 *  contrast clears AA (≥4.5:1) on every cell color in the severity ramp, in both
 *  themes (the ramp is theme-independent). */
export function labelColorFor(bgHex: string): string {
  return contrastRatio("#ffffff", bgHex) >= contrastRatio("#000000", bgHex)
    ? "#ffffff"
    : "#000000";
}

// ── T1 (P9) — label fit / clip / ellipsize ──────────────────────────────────

/** Approx glyph width at the given font size (px). The treemap font is a
 *  proportional sans; 0.58em is a safe average so we under-promise on width and
 *  never overflow. */
const GLYPH_W_RATIO = 0.58;

/** How many characters of `text` fit in `widthPx` at `fontPx`, with a small
 *  left/right inset. Returns the max char count (>= 0). */
export function charsThatFit(
  widthPx: number,
  fontPx: number,
  insetPx = 8,
): number {
  const usable = widthPx - insetPx;
  if (usable <= 0) return 0;
  return Math.floor(usable / (fontPx * GLYPH_W_RATIO));
}

/** Clip `label` to the cell width, adding an ellipsis when truncated. Returns
 *  null when not even one character (plus context) fits — the caller then HIDES
 *  the label entirely rather than overflowing into a neighbour. */
export function clipLabel(
  label: string,
  widthPx: number,
  fontPx: number,
  insetPx = 8,
): string | null {
  const max = charsThatFit(widthPx, fontPx, insetPx);
  if (max <= 0) return null;
  if (label.length <= max) return label;
  if (max <= 1) return null; // can't show a meaningful "x…"
  return label.slice(0, max - 1) + "…";
}

export interface LabelFit {
  text: string | null;
  fontPx: number;
}

/** Available font sizes (px) for treemap labels, from largest to smallest.
 *  Kept as a pure value so label fitting can be unit-tested independently. */
export const TREEMAP_LABEL_FONTS = [11, 10, 9, 8] as const;

/** Available font sizes (px) for the secondary value row on folder tiles. */
export const TREEMAP_VALUE_FONTS = [9, 8] as const;

export interface LabelFitOptions {
  fonts?: readonly number[];
  insetPx?: number;
}

/** Pick the largest pure-font layout that still fits in one line.
 *  Returns `text: null` when even the smallest requested font cannot
 *  show a readable fragment.
 */
export function fitLabelForCell(
  label: string,
  widthPx: number,
  heightPx: number,
  options: LabelFitOptions = {},
): LabelFit {
  const fonts = options.fonts ?? TREEMAP_LABEL_FONTS;
  const insetPx = options.insetPx ?? 8;
  for (const fontPx of fonts) {
    // Keep at least a readable glyph + small baseline margin.
    if (heightPx < Math.ceil(fontPx * 1.15) + 2) continue;
    const text = clipLabel(label, widthPx, fontPx, insetPx);
    if (text !== null) {
      return { text, fontPx };
    }
  }
  return { text: null, fontPx: fonts[fonts.length - 1] ?? TREEMAP_LABEL_FONTS[TREEMAP_LABEL_FONTS.length - 1] };
}

/** A cell can carry a label at all only if it is wide AND tall enough. Below
 *  this the label would visually collide with the cell border. */
export function cellFitsLabel(w: number, h: number): boolean {
  return w >= 24 && h >= 14;
}

// ── T2 (P10) — severity → color gradient ─────────────────────────────────────

// A perceptual green → yellow → orange → red ramp keyed on severity rank.
// clean(0) green, low(1) yellow-green, medium(2) yellow, high(3) orange,
// blocking(4) red. Replaces the old flat --sev-* greys for the worst-clean end.
const SEVERITY_RAMP: Record<Severity, string> = {
  clean: "#2f7d4f", // green
  low: "#7faf3a", // yellow-green
  medium: "#d9b310", // yellow
  high: "#e07a1f", // orange
  blocking: "#d83a3a", // red
};

/** Base background hex for a cell's WORST finding severity (T2). */
export function severityColor(sev: Severity): string {
  return SEVERITY_RAMP[sev] ?? SEVERITY_RAMP.clean;
}

export interface TreemapColorInput {
  severity: Severity;
  findingCount: number;
}

export interface TreemapColorOptions {
  includeDensity?: boolean;
  density?: number;
}

/** Color encoding for treemap tiles.
 *
 * Default: WORST severity only.
 * - `findingCount` does not affect hue.
 * - clean/no-finding cells stay clean.
 * - Optional `includeDensity` may add a bounded red-leaning nudge for same-severity
 *   density only (explicitly documented, off by default to avoid changing count
 *   semantics).
 */
export function treemapCellColor(
  input: TreemapColorInput,
  options: TreemapColorOptions = {},
): string {
  if (input.findingCount <= 0) return severityColor("clean");
  if (options.includeDensity) {
    return severityColorWithDensity(input.severity, options.density ?? 0);
  }
  return severityColor(input.severity);
}

/** Optional density nudge: a cell that is the same worst-severity but DENSER
 *  (more findings packed in) reads a touch hotter. `density` is findings/area
 *  normalized to [0,1] by the caller; 0 = base color, 1 = pushed one rank
 *  toward red. Pure interpolation in sRGB — good enough for a heat cue. */
export function severityColorWithDensity(sev: Severity, density: number): string {
  const base = severityColor(sev);
  if (sev === "blocking" || density <= 0) return base;
  const rank = SEVERITY_ORDER.indexOf(sev);
  const nextSev = SEVERITY_ORDER[Math.min(rank + 1, SEVERITY_ORDER.length - 1)];
  return mixHex(base, severityColor(nextSev), Math.min(1, Math.max(0, density)));
}

/** Linear sRGB mix of two hex colors; t in [0,1] (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const m = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return "#" + m.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** The legend scale, worst→clean, for the gradient (T2). */
export function severityLegend(): { sev: Severity; label: string; color: string }[] {
  return [
    { sev: "blocking", label: "CI-blocking", color: severityColor("blocking") },
    { sev: "high", label: "High", color: severityColor("high") },
    { sev: "medium", label: "Medium", color: severityColor("medium") },
    { sev: "low", label: "Low", color: severityColor("low") },
    { sev: "clean", label: "Clean", color: severityColor("clean") },
  ];
}

// ── T3 (P12) — value modes ───────────────────────────────────────────────────

export type ValueMode = "findings" | "loc" | "size";

/** The metric value used to SIZE a node's cell for the active value mode. Always
 *  >= 1 so a folder with no findings (but real LOC/bytes) still gets area, and a
 *  zero-byte file never collapses to nothing. */
export function nodeValue(n: TreeNode, mode: ValueMode): number {
  if (mode === "loc") return Math.max(n.loc, n.findingCount, 1);
  if (mode === "size") return Math.max(n.bytes, 1);
  return Math.max(n.findingCount, 1);
}

// ── T4 (P11) — nested fit + "…" overflow ─────────────────────────────────────

/** Minimum on-screen area (px²) a child cell must have to be worth rendering as
 *  its own tile. Below this, children are folded into a single "…" overflow
 *  rectangle that the user can zoom into. */
export const MIN_TILE_AREA = 24 * 14; // matches cellFitsLabel's floor

/** Minimum area for a node to be worth RECURSING into (drawing its own
 *  children nested inside it). Above the leaf floor so we don't try to nest into
 *  a cell that can barely show its own label. */
export const MIN_NEST_AREA = 90 * 60;

interface FitPlan<T> {
  /** Children that get their own tile, in input (area-desc) order. */
  shown: T[];
  /** Children folded into the overflow "…" cell (empty when all fit). */
  overflow: T[];
}

/**
 * Decide which children get a real tile and which collapse into a single "…"
 * overflow rectangle. The children are ranked by their ACTIVE-MODE value
 * (descending) here — independent of the input order, which the path-tree sorts
 * by finding count — so the biggest cells for the current value mode are kept.
 * We keep prefix children whose PROPORTIONAL area clears MIN_TILE_AREA; the first
 * one that doesn't (and all after it) overflow. If overflow would hold a single
 * child, we just show it (no point hiding one behind a "…").
 *
 * `valueOf` returns each child's metric value; `boxArea` is the parent px area.
 * `shown` is returned in value-descending order (largest first).
 */
export function planFit<T>(
  children: T[],
  valueOf: (c: T) => number,
  boxArea: number,
  minTileArea = MIN_TILE_AREA,
): FitPlan<T> {
  const total = children.reduce((s, c) => s + Math.max(valueOf(c), 0), 0);
  if (total <= 0 || boxArea <= 0) return { shown: [], overflow: children.slice() };
  // Rank by value desc so the "keep big, overflow small" prefix is correct for
  // the active value mode regardless of the input order.
  const ranked = children
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const d = Math.max(valueOf(b.c), 0) - Math.max(valueOf(a.c), 0);
      return d !== 0 ? d : a.i - b.i; // stable tie-break on original index
    })
    .map((x) => x.c);
  const shown: T[] = [];
  const overflow: T[] = [];
  let overflowing = false;
  for (const c of ranked) {
    const area = (Math.max(valueOf(c), 0) / total) * boxArea;
    if (!overflowing && area >= minTileArea) {
      shown.push(c);
    } else {
      overflowing = true;
      overflow.push(c);
    }
  }
  // Don't bother hiding a lone child behind "…".
  if (overflow.length === 1) {
    shown.push(overflow[0]);
    overflow.length = 0;
  }
  return { shown, overflow };
}
