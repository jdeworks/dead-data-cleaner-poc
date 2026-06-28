// GitHistoryPanel — GITVIEWER: per-file commit history list + inline diff viewer.
//
// Rendered when FileViewer is in "history" mode. Shows a commit list (hash, date,
// author, subject, +ins/-del); clicking a row loads and renders the per-file diff
// via GitDiffView. Requires `isTauri()` — in browser mode renders a "requires
// desktop app" notice (the same pattern CleanupPage uses).

import { useState, useEffect, useCallback } from "react";
import { isTauri, gitFileHistory, gitFileDiff } from "../lib/tauri";
import type { GitCommitInfo, GitFileHistory, GitFileDiff } from "../lib/tauri";
import { GitDiffView } from "./GitDiffView";
import { EmptyState } from "./ui";

// Age display: given a YYYY-MM-DD date string, return a human-readable relative
// label. Pure function — no side effects.
export function relativeAge(dateStr: string, now: Date = new Date()): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 0) return dateStr;
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

interface GitHistoryPanelProps {
  /** Absolute path of the file to show history for. */
  absPath: string;
  /** Display label (relative path). */
  displayPath?: string;
  /** The scan root directory (required for git commands). */
  scanRoot: string;
  /** Optional line to scroll to in diffs (the finding's start line). */
  scrollToLine?: number | null;
}

export function GitHistoryPanel({
  absPath,
  displayPath,
  scanRoot,
  scrollToLine,
}: GitHistoryPanelProps) {
  const label = displayPath ?? absPath;

  // Derive rel_path: strip scanRoot prefix.
  const relPath = absPath.startsWith(scanRoot)
    ? absPath.slice(scanRoot.length).replace(/^\//, "")
    : absPath;

  const [history, setHistory] = useState<GitFileHistory | null>(null);
  const [histError, setHistError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Per-commit diff state.
  const [selectedCommit, setSelectedCommit] = useState<GitCommitInfo | null>(null);
  const [diff, setDiff] = useState<GitFileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Load history when path/root changes.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    setLoading(true);
    setHistory(null);
    setHistError(null);
    setSelectedCommit(null);
    setDiff(null);
    gitFileHistory(scanRoot, relPath)
      .then((h) => {
        if (!cancelled) { setHistory(h); setLoading(false); }
      })
      .catch((e) => {
        if (!cancelled) {
          setHistError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [scanRoot, relPath]);

  const selectCommit = useCallback(
    (commit: GitCommitInfo) => {
      if (selectedCommit?.hashFull === commit.hashFull) {
        // Toggle off.
        setSelectedCommit(null);
        setDiff(null);
        return;
      }
      setSelectedCommit(commit);
      setDiff(null);
      setDiffError(null);
      setDiffLoading(true);
      gitFileDiff(scanRoot, commit.hashFull, relPath)
        .then((d) => { setDiff(d); setDiffLoading(false); })
        .catch((e) => {
          setDiffError(e instanceof Error ? e.message : String(e));
          setDiffLoading(false);
        });
    },
    [scanRoot, relPath, selectedCommit],
  );

  // Browser-mode guard (mirrors CleanupPage pattern).
  if (!isTauri()) {
    return (
      <div className="git-history-panel">
        <div className="fv-header mono">{label}</div>
        <EmptyState>
          <div>Git history viewer — requires the desktop app.</div>
        </EmptyState>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="git-history-panel">
        <div className="fv-header mono">{label}</div>
        <div className="git-history-loading">Loading history…</div>
      </div>
    );
  }

  if (histError) {
    return (
      <div className="git-history-panel">
        <div className="fv-header mono">{label}</div>
        <div className="fv-error" style={{ padding: "8px 12px" }}>{histError}</div>
      </div>
    );
  }

  if (!history) return null;

  if (!history.isTracked) {
    return (
      <div className="git-history-panel">
        <div className="fv-header mono">{label}</div>
        <EmptyState>
          <div>This file is not tracked by git, or the directory is not a git repository.</div>
        </EmptyState>
      </div>
    );
  }

  if (history.commits.length === 0) {
    return (
      <div className="git-history-panel">
        <div className="fv-header mono">{label}</div>
        <EmptyState>
          <div>No commit history found for this file.</div>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="git-history-panel">
      <div className="fv-header mono">
        {label}
        <span className="fv-range" style={{ marginLeft: 8, color: "var(--fg-dim)" }}>
          {history.commits.length} commit{history.commits.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="git-commit-list">
        {history.commits.map((c) => {
          const isSelected = selectedCommit?.hashFull === c.hashFull;
          return (
            <div key={c.hashFull}>
              <div
                className={`git-commit-row${isSelected ? " git-commit-row--active" : ""}`}
                onClick={() => selectCommit(c)}
                title={`${c.hashFull}\n${c.author} — ${c.date}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && selectCommit(c)}
              >
                <span className="mono git-commit-hash">{c.hash}</span>
                <span className="git-commit-age">{relativeAge(c.date)}</span>
                <span className="git-commit-author">{c.author}</span>
                <span className="git-commit-subject">{c.subject}</span>
                <span className="git-commit-stats">
                  <span className="git-stat-add">+{c.insertions}</span>
                  {" "}
                  <span className="git-stat-del">-{c.deletions}</span>
                </span>
              </div>
              {isSelected && (
                <div className="git-diff-container">
                  {diffLoading && (
                    <div className="git-history-loading" style={{ padding: "8px 12px" }}>
                      Loading diff…
                    </div>
                  )}
                  {diffError && (
                    <div className="fv-error" style={{ padding: "8px 12px" }}>{diffError}</div>
                  )}
                  {diff && (
                    <GitDiffView
                      unifiedDiff={diff.unifiedDiff}
                      commit={c}
                      scrollToLine={scrollToLine}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
