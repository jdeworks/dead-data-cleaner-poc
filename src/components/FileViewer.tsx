import { useEffect, useRef, useState, useCallback } from "react";
import { Button, EmptyState } from "./ui";
import { isTauri, readTextRange, gitBlameHeat } from "../lib/tauri";
import type { GitAgeBucket } from "../lib/tauri";
import { GitHistoryPanel } from "./GitHistoryPanel";

// The "show me the code" file viewer (WP2). Generic and reusable — it knows about
// a path + an optional highlight range, NOT about findings. It reads a small line
// window around the highlight through the Tauri `read_text_range` command and
// renders it in a gutter + code box modeled on `pre.graph`. Paging ("load N more
// above/below") nudges the window outward; there is NO full virtualization yet
// (that's WP10). In browser mode (no Tauri fs) it degrades to a provided excerpt
// or an "open in your editor" hint — it never calls `readTextRange` there.
//
// GITVIEWER: when `scanRoot` is provided and running under Tauri, a "Code / History"
// tab toggle is added. History mode renders GitHistoryPanel. The blame heat strip
// (age-colored blocks per gutter line) is shown in code mode when blame data loads.

const DEFAULT_CONTEXT_LINES = 20;
// How many lines each "load more" click pulls in.
const PAGE_STEP = 100;
// When there's no span, show the file head.
const HEAD_LINES = 40;

// ── Blame heat color map ──────────────────────────────────────────────────────
// Each age bucket maps to a subtle background bar in the gutter.
export const BLAME_COLORS: Record<GitAgeBucket, string> = {
  fresh:   "#1a4a2a", // dark green
  recent:  "#1a2e4a", // dark blue
  aging:   "#3a3010", // dark amber
  old:     "#3a2010", // dark orange
  ancient: "#3a1010", // dark red
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface FileViewerProps {
  absPath: string;
  displayPath?: string;
  highlightStart?: number | null;
  highlightEnd?: number | null;
  contextLines?: number;
  fallbackExcerpt?: string;
  /**
   * GITVIEWER: the scan root directory. When provided and running under Tauri,
   * a "Code / History" tab toggle appears and the blame heat strip is shown.
   * Optional — omitting it leaves FileViewer unchanged from its pre-GITVIEWER
   * behavior, so all existing call sites are unaffected.
   */
  scanRoot?: string;
  /**
   * GITVIEWER: initial mode. Defaults to "code". Pass "history" to open
   * FileViewer in History mode immediately (e.g. from a deep-link).
   */
  initialMode?: "code" | "history";
}

// The EvidencePanel range idiom: ":start" or ":start-end" (omit end when equal).
function rangeLabel(start?: number | null, end?: number | null): string {
  if (start == null) return "";
  if (end != null && end !== start) return `:${start}-${end}`;
  return `:${start}`;
}

// ── BlameHeatBar ──────────────────────────────────────────────────────────────
// A narrow vertical canvas strip showing age-bucket colors per line.
// Rendered once per visible window; very cheap to draw.

function BlameHeatBar({
  heatLines,
  winStart,
  lineCount,
  lineHeight = 18,
}: {
  heatLines: GitAgeBucket[];
  winStart: number; // 1-based start of visible window
  lineCount: number;
  lineHeight?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    ctx.clearRect(0, 0, w, canvas.height);
    for (let i = 0; i < lineCount; i++) {
      const lineNo = winStart + i - 1; // 0-based index into heatLines
      const bucket = heatLines[lineNo];
      if (!bucket) continue;
      ctx.fillStyle = BLAME_COLORS[bucket];
      ctx.fillRect(0, i * lineHeight, w, lineHeight);
    }
  }, [heatLines, winStart, lineCount, lineHeight]);

  return (
    <canvas
      ref={canvasRef}
      width={4}
      height={lineCount * lineHeight}
      style={{ position: "absolute", left: 0, top: 0, opacity: 0.85 }}
      title="Blame age: green=fresh, blue=recent, amber=aging, orange=old, red=ancient"
      aria-hidden="true"
    />
  );
}

// ── FileViewer ────────────────────────────────────────────────────────────────

export function FileViewer({
  absPath,
  displayPath,
  highlightStart,
  highlightEnd,
  contextLines = DEFAULT_CONTEXT_LINES,
  fallbackExcerpt,
  scanRoot,
  initialMode = "code",
}: FileViewerProps) {
  const label = displayPath ?? absPath;
  const hasSpan = highlightStart != null;

  // GITVIEWER: code/history tab toggle (only when scanRoot is provided + Tauri).
  const [mode, setMode] = useState<"code" | "history">(initialMode);
  const hasGitViewer = !!scanRoot && isTauri();

  // Loaded window state (Tauri mode only).
  const [lines, setLines] = useState<string[] | null>(null);
  const [winStart, setWinStart] = useState(1); // 1-based line of lines[0]
  const [totalLines, setTotalLines] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // GITVIEWER: blame heat data (loaded lazily when code tab opens + scanRoot available).
  const [blameLines, setBlameLines] = useState<GitAgeBucket[] | null>(null);

  const hlRowRef = useRef<HTMLDivElement | null>(null);
  const scrolledRef = useRef(false);

  // Initial fetch: a context window around the span, or the file head when none.
  useEffect(() => {
    if (!isTauri()) return;
    if (mode !== "code") return;
    let cancelled = false;
    const start = hasSpan
      ? Math.max(1, (highlightStart ?? 1) - contextLines)
      : 1;
    const end = hasSpan
      ? (highlightEnd ?? highlightStart ?? 1) + contextLines
      : HEAD_LINES;
    scrolledRef.current = false;
    readTextRange(absPath, start, end)
      .then((r) => {
        if (cancelled) return;
        setLines(r.lines);
        setWinStart(r.startLine);
        setTotalLines(r.totalLines);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setLines(null);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [absPath, hasSpan, highlightStart, highlightEnd, contextLines, mode]);

  // GITVIEWER: load blame heat lazily when code tab is active + scanRoot present.
  useEffect(() => {
    if (!hasGitViewer || mode !== "code") return;
    if (!scanRoot) return;
    let cancelled = false;
    const relPath = absPath.startsWith(scanRoot)
      ? absPath.slice(scanRoot.length).replace(/^\//, "")
      : absPath;
    gitBlameHeat(scanRoot, relPath)
      .then((h) => {
        if (!cancelled) setBlameLines(h.lines.length > 0 ? h.lines : null);
      })
      .catch(() => { /* blame heat is best-effort — ignore errors */ });
    return () => { cancelled = true; };
  }, [absPath, scanRoot, hasGitViewer, mode]);

  // Scroll the first highlighted row into view once after a load (guard null span).
  useEffect(() => {
    if (!hasSpan || scrolledRef.current) return;
    if (hlRowRef.current) {
      hlRowRef.current.scrollIntoView({ block: "center" });
      scrolledRef.current = true;
    }
  }, [lines, hasSpan]);

  const loadMore = useCallback(
    (dir: "above" | "below") => {
      if (!lines) return;
      const curEnd = winStart + lines.length - 1;
      const start = dir === "above" ? Math.max(1, winStart - PAGE_STEP) : winStart;
      const end =
        dir === "below"
          ? Math.min(totalLines, curEnd + PAGE_STEP)
          : curEnd;
      readTextRange(absPath, start, end)
        .then((r) => {
          setLines(r.lines);
          setWinStart(r.startLine);
          setTotalLines(r.totalLines);
        })
        .catch((e) =>
          setError(e instanceof Error ? e.message : String(e)),
        );
    },
    [lines, winStart, totalLines, absPath],
  );

  const header = (
    <div className="fv-header mono">
      {label}
      <span className="fv-range">{rangeLabel(highlightStart, highlightEnd)}</span>
      {/* GITVIEWER: Code / History tab toggle */}
      {hasGitViewer && (
        <div
          className="seg"
          role="tablist"
          aria-label="File viewer mode"
          style={{ marginLeft: "auto", display: "inline-flex" }}
        >
          <button
            role="tab"
            aria-selected={mode === "code"}
            className={`seg-btn${mode === "code" ? " active" : ""}`}
            style={{ fontSize: 11, padding: "1px 8px" }}
            onClick={() => setMode("code")}
          >
            Code
          </button>
          <button
            role="tab"
            aria-selected={mode === "history"}
            className={`seg-btn${mode === "history" ? " active" : ""}`}
            style={{ fontSize: 11, padding: "1px 8px" }}
            onClick={() => setMode("history")}
          >
            History
          </button>
        </div>
      )}
    </div>
  );

  // ---- History mode (GITVIEWER) ----
  if (mode === "history" && hasGitViewer && scanRoot) {
    return (
      <div className="file-viewer">
        {header}
        <GitHistoryPanel
          absPath={absPath}
          displayPath={displayPath}
          scanRoot={scanRoot}
          scrollToLine={highlightStart ?? undefined}
        />
      </div>
    );
  }

  // ---- Browser / fallback / error paths (never read off disk) ----
  if (!isTauri() || error || lines == null) {
    // 1) An engine-provided excerpt, when present.
    if (fallbackExcerpt && !error) {
      return (
        <div className="file-viewer">
          {header}
          <div className="fv-excerpt-label">excerpt (engine-provided)</div>
          <pre className="fv-box fv-box--plain mono">{fallbackExcerpt}</pre>
        </div>
      );
    }
    // 2) The "open in your editor" hint (browser mode, or a fetch error).
    return (
      <div className="file-viewer">
        {header}
        <EmptyState>
          <div>
            <span className="mono">
              {label}
              {rangeLabel(highlightStart, highlightEnd)}
            </span>{" "}
            — open in your editor
          </div>
          {error && <div className="fv-error">{error}</div>}
        </EmptyState>
      </div>
    );
  }

  // ---- Tauri mode: rendered window ----
  const winEnd = winStart + lines.length - 1;
  const canLoadAbove = winStart > 1;
  const canLoadBelow = winEnd < totalLines;

  return (
    <div className="file-viewer">
      {header}
      {canLoadAbove && (
        <div className="fv-more">
          <Button onClick={() => loadMore("above")}>load {PAGE_STEP} more above</Button>
        </div>
      )}
      <pre className="fv-box mono" style={{ position: "relative" }}>
        {/* GITVIEWER: blame heat strip (4px wide, absolute left) */}
        {blameLines && (
          <BlameHeatBar
            heatLines={blameLines}
            winStart={winStart}
            lineCount={lines.length}
          />
        )}
        {lines.map((text, i) => {
          const lineNo = winStart + i;
          const hl =
            hasSpan &&
            lineNo >= (highlightStart ?? 0) &&
            lineNo <= (highlightEnd ?? highlightStart ?? 0);
          const isFirstHl = hl && lineNo === highlightStart;
          return (
            <div
              key={lineNo}
              ref={isFirstHl ? hlRowRef : undefined}
              className={`fv-line${hl ? " fv-line--hl" : ""}`}
              // Indent slightly when heat strip is shown.
              style={blameLines ? { paddingLeft: 6 } : undefined}
            >
              <span className="fv-gutter">{lineNo}</span>
              <span className="fv-code">{text || " "}</span>
            </div>
          );
        })}
      </pre>
      {canLoadBelow && (
        <div className="fv-more">
          <Button onClick={() => loadMore("below")}>load {PAGE_STEP} more below</Button>
        </div>
      )}
    </div>
  );
}
