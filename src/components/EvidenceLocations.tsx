import { useState } from "react";
import type { RevealTarget } from "../lib/report";
import { revealForCloneSite } from "../lib/report";
import { FileViewer } from "./FileViewer";

// EvidenceLocations (WP06 T2) — a shared, GitHub-diff-style multi-location evidence
// viewer for any finding that surfaces in several places (env "found in N places",
// missing-dependency import line, doc-drift, …).
//
//   - Top-level collapsible (one `<details>`): lean by default, expand on demand.
//   - File-collapsible: one `<details>` per file (sites in the same file → ONE entry).
//   - Per site, a ±CONTEXT-line window (default 20 lines = ±10) via the existing
//     FileViewer (reused, not reimplemented).
//   - Sites in the same file whose context windows OVERLAP are MERGED into one hunk
//     (one FileViewer spanning both); non-adjacent sites render as separate hunks
//     with a "…" gap between them (FileViewer's own load-more bridges the gap).
//
// It is intentionally generic: it knows about a list of {file, line, …} sites, NOT
// about any specific rule. Callers build the EvidenceSite[] from their evidence.graph.

// Half-window of context shown around each site (so the default window is 2×+1 lines).
const SITE_CONTEXT_LINES = 10;

export interface EvidenceSite {
  /** Repo-relative (or member-prefixed) file path. */
  file: string;
  /** 1-based line of the evidence in that file. */
  line: number;
  /** Optional classification, e.g. "code-ref" | "doc-mention" | "import". */
  kind?: string;
  /** Optional weight, e.g. "hard" | "weak" — rendered as a small tag. */
  weight?: string;
  /** Optional verbatim source/statement text shown as a one-line preview. */
  snippet?: string;
  /** True when the engine named a file but did not provide a precise span/line. */
  fallbackToFileStart?: boolean;
  /** Short explanation for file-start fallbacks. */
  fallbackLabel?: string;
}

// A merged hunk: a contiguous line range to render in one FileViewer, plus the
// individual site lines that fall inside it (so each gets highlighted).
interface Hunk {
  start: number;
  end: number;
  siteLines: number[];
}

// Group sites of one file (already line-sorted) into hunks, merging any two whose
// ±context windows touch/overlap. Pure + deterministic.
export function mergeHunks(lines: number[], context: number): Hunk[] {
  const hunks: Hunk[] = [];
  for (const ln of [...lines].sort((a, b) => a - b)) {
    const winStart = Math.max(1, ln - context);
    const winEnd = ln + context;
    const last = hunks[hunks.length - 1];
    // Overlap/adjacent if the new window starts at/under the previous window end.
    if (last && winStart <= last.end + 1) {
      last.end = Math.max(last.end, winEnd);
      last.siteLines.push(ln);
    } else {
      hunks.push({ start: winStart, end: winEnd, siteLines: [ln] });
    }
  }
  return hunks;
}

function FileGroup({
  file,
  sites,
  targetRoot,
  memberRoots,
  scanRoot,
}: {
  file: string;
  sites: EvidenceSite[];
  targetRoot?: string;
  memberRoots?: Record<string, string>;
  /** GITVIEWER: scan root to pass to the internal FileViewer (enables Code/History tabs). */
  scanRoot?: string;
}) {
  const lines = sites.map((s) => s.line);
  const hunks = mergeHunks(lines, SITE_CONTEXT_LINES);
  // Resolve each hunk to an absolute path + highlight on its first site line. We
  // reuse the clone-site reveal (it joins a {path,start_line,end_line} against the
  // single/multi-root config exactly like a target reveal).
  return (
    <details className="evl-file" open>
      <summary className="evl-file-head">
        <span className="mono evl-file-path">{file}</span>
        <span className="evl-file-count">
          {sites.length} {sites.length === 1 ? "site" : "sites"}
        </span>
      </summary>
      {hunks.map((h, i) => {
        const reveal: RevealTarget | null = revealForCloneSite(
          { path: file, start_line: h.start, end_line: h.start },
          targetRoot,
          memberRoots,
        );
        const firstSite = sites.find((s) => h.siteLines.includes(s.line));
        return (
          <div className="evl-hunk" key={`${file}:${h.start}`}>
            {i > 0 && <div className="evl-gap mono">…</div>}
            {firstSite?.snippet && (
              <div className="evl-snippet mono" title={firstSite.snippet}>
                {firstSite.kind && (
                  <span className="evl-tag">{firstSite.kind}</span>
                )}
                {firstSite.weight && (
                  <span className={`evl-tag evl-tag--${firstSite.weight}`}>
                    {firstSite.weight}
                  </span>
                )}
                {firstSite.snippet}
              </div>
            )}
            {firstSite?.fallbackToFileStart && (
              <div className="evl-snippet">
                <span className="evl-tag">file start</span>
                {firstSite.fallbackLabel ?? "No source span in this finding; showing file start."}
              </div>
            )}
            {reveal ? (
              <FileViewer
                absPath={reveal.absPath}
                displayPath={reveal.displayPath}
                highlightStart={h.siteLines[0]}
                highlightEnd={h.siteLines[h.siteLines.length - 1]}
                contextLines={SITE_CONTEXT_LINES}
                scanRoot={scanRoot}
              />
            ) : (
              <div className="evl-noreveal mono">
                {file}:{h.siteLines.join(", ")} — open in your editor
              </div>
            )}
          </div>
        );
      })}
    </details>
  );
}

export function EvidenceLocations({
  sites,
  title,
  targetRoot,
  memberRoots,
  scanRoot,
  defaultOpen = false,
}: {
  sites: EvidenceSite[];
  /** Heading for the collapsible summary, e.g. "Found in 2 places". */
  title?: string;
  targetRoot?: string;
  memberRoots?: Record<string, string>;
  /**
   * GITVIEWER: scan root directory (absolute path). When provided, the internal
   * FileViewer instances receive it to enable the Code / History tab toggle.
   * Additive — omitting it leaves existing behaviour unchanged.
   */
  scanRoot?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (sites.length === 0) return null;

  // Group by file, preserving first-seen file order; sort each group's sites by line.
  const byFile = new Map<string, EvidenceSite[]>();
  for (const s of sites) {
    const arr = byFile.get(s.file) ?? [];
    arr.push(s);
    byFile.set(s.file, arr);
  }
  for (const arr of byFile.values()) arr.sort((a, b) => a.line - b.line);

  const fileCount = byFile.size;
  const heading =
    title ??
    `Found in ${sites.length} place${sites.length === 1 ? "" : "s"}` +
      (fileCount > 1 ? ` across ${fileCount} files` : "");

  return (
    <details
      className="evidence-locations"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="evl-summary">{heading}</summary>
      <div className="evl-body">
        {[...byFile.entries()].map(([file, fsites]) => (
          <FileGroup
            key={file}
            file={file}
            sites={fsites}
            targetRoot={targetRoot}
            memberRoots={memberRoots}
            scanRoot={scanRoot}
          />
        ))}
      </div>
    </details>
  );
}
