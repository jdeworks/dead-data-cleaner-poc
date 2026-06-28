// GitDiffView — GITVIEWER: renders a unified diff string as a syntax-highlighted
// code block, reusing the existing `fv-box`/`fv-line` CSS classes plus two new
// classes: `fv-line--added` (green) and `fv-line--removed` (red) and
// `fv-line--hunk` (hunk header, dimmed). Dependency-free — no external parsers.

import type { GitCommitInfo } from "../lib/tauri";

// ── Line classification ───────────────────────────────────────────────────────

type DiffLineKind = "added" | "removed" | "hunk" | "context" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in the new file (null for removed/meta/hunk lines). */
  newLine: number | null;
  /** 1-based line number in the old file (null for added/meta/hunk lines). */
  oldLine: number | null;
}

/** Parse a unified diff string into `DiffLine[]`. Pure function — no side effects. */
export function parseDiff(unified: string): DiffLine[] {
  if (!unified) return [];
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  // Track whether we have entered the first hunk. Once inside a hunk, `+++ `/
  // `--- ` prefixed lines are hunk content (e.g. a line whose text begins with
  // `++ foo`), NOT file-header meta — so we only classify them as meta BEFORE
  // the first `@@` header is seen.
  let inHunk = false;

  for (const raw of unified.split("\n")) {
    // A new file header inside a multi-file diff ends the current hunk, so the
    // following `--- `/`+++ ` lines are meta again (symmetric to the entry case).
    if (raw.startsWith("diff --git ")) {
      inHunk = false;
    }
    // Hunk header: @@ -a,b +c,d @@
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      inHunk = true;
      result.push({ kind: "hunk", text: raw, newLine: null, oldLine: null });
      continue;
    }
    // File header lines (diff --git, index, ---, +++) — only BEFORE the first hunk.
    // Once inside a hunk, `+++ ` / `--- ` are ordinary added/removed content lines
    // whose text happens to start with extra `+`/`-` characters; classifying them as
    // meta here would corrupt the line-number counters.
    if (!inHunk && (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("similarity") ||
      raw.startsWith("rename ")
    )) {
      result.push({ kind: "meta", text: raw, newLine: null, oldLine: null });
      continue;
    }
    if (raw.startsWith("+")) {
      result.push({ kind: "added", text: raw.slice(1), newLine: newLine++, oldLine: null });
    } else if (raw.startsWith("-")) {
      result.push({ kind: "removed", text: raw.slice(1), newLine: null, oldLine: oldLine++ });
    } else if (raw.startsWith(" ") || raw === "") {
      // Context line (space-prefixed) or blank.
      result.push({ kind: "context", text: raw.slice(1), newLine: newLine++, oldLine: oldLine++ });
    }
    // Else: unknown line, skip silently.
  }
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface GitDiffViewProps {
  /** The unified diff text from `gitFileDiff`. */
  unifiedDiff: string;
  /** The commit this diff belongs to (shown in header). */
  commit?: GitCommitInfo;
  /** Optional 1-based line to scroll to (the finding's span line). */
  scrollToLine?: number | null;
}

export function GitDiffView({ unifiedDiff, commit, scrollToLine }: GitDiffViewProps) {
  if (!unifiedDiff) {
    return (
      <div className="fv-error" style={{ padding: "8px 12px" }}>
        No diff available for this commit.
      </div>
    );
  }
  if (unifiedDiff === "(binary file)") {
    return (
      <div className="fv-excerpt-label" style={{ padding: "8px 12px" }}>
        Binary file — diff not shown.
      </div>
    );
  }

  const lines = parseDiff(unifiedDiff);

  return (
    <div className="git-diff-view">
      {commit && (
        <div className="git-diff-header">
          <span className="mono git-diff-hash">{commit.hash}</span>
          <span className="git-diff-author">{commit.author}</span>
          <span className="git-diff-date">{commit.date}</span>
          <span className="git-diff-subject">{commit.subject}</span>
          <span className="git-diff-stats">
            <span className="git-stat-add">+{commit.insertions}</span>
            {" "}
            <span className="git-stat-del">-{commit.deletions}</span>
          </span>
        </div>
      )}
      <pre className="fv-box mono git-diff-pre">
        {lines.map((line, i) => {
          const isTarget =
            scrollToLine != null &&
            line.newLine === scrollToLine;
          return (
            <div
              key={i}
              id={isTarget ? "git-diff-target-line" : undefined}
              className={`fv-line git-diff-line git-diff-line--${line.kind}${isTarget ? " fv-line--hl" : ""}`}
            >
              <span className="fv-gutter git-diff-gutter">
                {line.kind === "hunk" || line.kind === "meta"
                  ? ""
                  : line.newLine ?? line.oldLine ?? ""}
              </span>
              <span className="git-diff-sigil">
                {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
              </span>
              <span className="fv-code">{line.text}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
