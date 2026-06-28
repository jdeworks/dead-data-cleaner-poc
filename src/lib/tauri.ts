// Tauri desktop bridge (M9b). The browser build never imports `@tauri-apps/api`
// — instead we feature-detect the global `window.__TAURI__` that the Tauri v1
// shell injects (`withGlobalTauri: true`). When absent (a plain browser), every
// helper here throws "not running under Tauri" and the app falls back to the
// existing file-drop flow, so the M9a browser experience is untouched.

import type { DdcReport } from "../types";
import type { Catalog } from "./catalog";
import { parseReport } from "../lib/report";

// The slice of the injected global we use. Typed loosely on purpose — it only
// exists at runtime inside the webview. `invoke` is generic so callers can name
// the expected return type at the call site.
interface TauriGlobal {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  dialog: {
    open: (opts?: {
      directory?: boolean;
      multiple?: boolean;
      title?: string;
    }) => Promise<string | string[] | null>;
  };
}

function tauri(): TauriGlobal | null {
  const g = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return g ?? null;
}

/** `true` when running inside the native Tauri desktop shell. */
export function isTauri(): boolean {
  return tauri() !== null;
}

/** The options the scan-setup flow hands to the `analyze` command. Mirrors the
 *  engine's flags 1:1; the backend translates these into `ddc` arguments. */
export interface AnalyzeOptions {
  path: string;
  graph: boolean;
  inventory: boolean;
  acceptDetected: boolean;
  exact: boolean;
  minTokens?: number;
  configPath?: string;
  /** EWP1 — enable the AI interpretation layer for this run (the desktop analog of
   *  the CLI `--ai` flag). `true` forces the AI layer on (overriding the config
   *  file); omit/`false` leaves the loaded config untouched. ADVISORY +
   *  non-deterministic — the backend shells out to `claude -p`; it only adds the
   *  isolated `ai_interpretation` key (the deterministic findings feed is unchanged).
   *  Desktop-only (the browser build has no engine). */
  ai?: boolean;
  /** WP5 Phase 3 Step 3 — optional additional source roots for a MULTI-ROOT
   *  (disjoint-checkout) analysis. Omit/empty for the single-root flow over `path`.
   *  Two or more roots — or a single root with a `client`/`service` role — switches
   *  the backend to the merged `analyze_multi` pipeline (returns a `member_roots`
   *  map). Each entry's `role` is `"client"` / `"service"`, or omitted for a plain
   *  member whose ecosystem the engine detects. */
  roots?: { path: string; role?: string }[];
}

// Shared native-picker chokepoint: opens the Tauri dialog (folder vs file via
// `directory`) and normalizes the cancelled cases (null, or a [] from an
// unexpected multi-select) to `null`. Throws when not running under Tauri.
async function pickPath(directory: boolean, title?: string): Promise<string | null> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  const picked = await t.dialog.open({ directory, multiple: false, title });
  if (picked === null || Array.isArray(picked)) return null; // cancelled
  return picked;
}

/**
 * Open the native folder picker. Resolves to the chosen absolute path, or `null`
 * if the user cancels. Throws when not running under Tauri.
 */
export async function pickDirectory(title?: string): Promise<string | null> {
  return pickPath(true, title);
}

/**
 * Open the native file picker. Resolves to the chosen absolute path, or `null`
 * if the user cancels. Throws when not running under Tauri.
 */
export async function pickFile(title?: string): Promise<string | null> {
  return pickPath(false, title);
}

/**
 * Run the engine on `opts.path` via the Tauri `analyze` command. The command
 * returns the same JSON shape as `ddc --json`; we validate it through
 * `parseReport` before handing it back, so callers always get a real report.
 * Throws when not running under Tauri, or when the engine command fails.
 */
export async function runAnalyze(opts: AnalyzeOptions): Promise<DdcReport> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  const raw = await t.invoke<unknown>("analyze", { opts });
  return parseReport(raw);
}

// ── WP03 T6 (P15) — large-repo background scan with progress polling ──────────

/** A background analysis job's live status (mirrors the Rust `JobStatus`). */
export interface JobStatus {
  phase: "scanning" | "analyzing" | "done" | "error" | string;
  report?: unknown;
  error?: string;
}

/** The large-repo size threshold (bytes) from the backend (default 50 MB). */
export async function analyzeThresholdBytes(): Promise<number> {
  const t = tauri();
  if (!t) return 50 * 1024 * 1024;
  return t.invoke<number>("analyze_threshold_bytes");
}

/** Gitignore-aware on-disk size (bytes) of a repo root — the size gate input. */
export async function directorySize(path: string): Promise<number> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<number>("directory_size", { path });
}

/**
 * WP03 T6 — run an analysis, choosing the BLOCKING or BACKGROUND path by repo
 * size. Small repos (≤ threshold) run synchronously via `runAnalyze` and feel
 * instant. Larger repos start a background job and POLL it, invoking `onProgress`
 * with a coarse phase so the UI can show a progress indicator and stay
 * responsive. Falls back to the blocking path if the size probe fails (a probe
 * error must never block a legitimate scan).
 *
 * `pollIntervalMs` (default 350) tunes the poll cadence.
 */
export async function runAnalyzeAuto(
  opts: AnalyzeOptions,
  onProgress?: (phase: string) => void,
  pollIntervalMs = 350,
): Promise<DdcReport> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");

  // Multi-root requests have no single size probe — run them on the blocking
  // path (they are an explicit power-user flow).
  if (opts.roots && opts.roots.length > 1) return runAnalyze(opts);

  let big = false;
  try {
    const [threshold, size] = await Promise.all([
      analyzeThresholdBytes(),
      directorySize(opts.path),
    ]);
    big = size > threshold;
  } catch {
    big = false; // probe failed → just run the normal blocking scan
  }

  if (!big) {
    onProgress?.("analyzing");
    return runAnalyze(opts);
  }

  // Background path: start the job, then poll until done/error.
  onProgress?.("scanning");
  const id = await t.invoke<number>("start_analyze", { opts });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const status = await t.invoke<JobStatus>("poll_analyze", { id });
    onProgress?.(status.phase);
    if (status.phase === "done") return parseReport(status.report);
    if (status.phase === "error") {
      throw new Error(status.error ?? "analysis failed");
    }
  }
}

/**
 * WP5 Phase 4 — fetch the machine-readable CONFIG CATALOG (rules + config keys)
 * via the `config_catalog` command. Resolves to the parsed `Catalog`, or `null`
 * when NOT running under Tauri (the builder is desktop-only; a plain browser shows
 * a "requires the desktop app" notice rather than crashing). The command itself
 * never fails in practice (it serializes a static catalog).
 */
export async function fetchCatalog(): Promise<Catalog | null> {
  const t = tauri();
  if (!t) return null;
  return t.invoke<Catalog>("config_catalog");
}

/**
 * WP5 Phase 4 — introspect the given source `roots` and return a TAILORED
 * `ddc.toml` STRING (the "auto-detect" seed for the config builder). This NEVER
 * writes: the caller previews the returned text and only persists it via the
 * `writeConfig` chokepoint on an explicit user action. Throws when not running
 * under Tauri, or when the engine's detection fails.
 */
export async function generateConfig(roots: string[]): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("generate_config", { roots });
}

/**
 * WP5 Phase 5 (P14) — compute the MERGED `ddc.toml` that would EXCLUDE `folder`
 * from analysis (by adding the suppress glob `folder/**` to `[rules].ignore`), and
 * return it as a STRING for the UI to PREVIEW. This NEVER writes: the backend only
 * reads `{dir}/ddc.toml` (if any) and returns the merged text; the caller persists
 * it via the `writeConfig` chokepoint on an explicit confirm. `folder` is a
 * scan-root-RELATIVE path; the backend does the folder→glob conversion. Throws when
 * not running under Tauri, or when the merge/read fails.
 */
export async function addExclusion(dir: string, folder: string): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("add_exclusion", { dir, folder });
}

/**
 * A3 — per-finding suppress: compute the MERGED `ddc.toml` that would suppress
 * findings whose `target.path` matches `glob` (by appending the glob to
 * `[rules].ignore`), and return it as a STRING for the UI to PREVIEW. This
 * NEVER writes: the backend only reads `{dir}/ddc.toml` (if any) and returns
 * the merged text; the caller persists it via the `writeConfig` chokepoint on
 * an explicit confirm. `glob` is the raw glob the UI derived from the finding
 * (e.g. `"src/lib/dead.ts"` for an exact-path suppress). Throws when not
 * running under Tauri, or when the merge/read fails.
 */
export async function addIgnore(dir: string, glob: string): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("add_ignore", { dir, glob });
}

// ── WP35 — extension management (H9 Tauri commands) ───────────────────────────

/** One discovered extension's status for the Settings → Extensions page. */
export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  source: string;
  path: string;
  /** Folder content hash (the trust key). */
  contentHash: string;
  /** "loaded" | "untrusted" | "failed" (+ `reason` when failed). */
  status: string;
  reason?: string;
  /** The per-extension trust decision currently recorded, if any. */
  trust?: "allow" | "deny" | null;
  /** Capability counts (for the trust dialog summary). */
  capabilities: {
    rules: number;
    collectors: number;
    seeds: number;
    aliases: number;
    views: number;
    dashboards: number;
    exports: number;
    wasm: number;
  };
  /** Permissions the manifest requests (for the trust dialog). */
  permissions: string[];
  /** A `disabledHint`-style note when a contributed view/dashboard is inert. */
  disabledHint?: string;
}

/**
 * WP35 (H9) — list every discovered extension for `scanDir` with its load status,
 * trust decision, capabilities, and requested permissions. Desktop-only; returns
 * `[]` in a plain browser. The backend runs discovery (the 4 §4.1 sources) and
 * cross-references the trust store; it never mutates anything.
 */
export async function listExtensions(scanDir: string): Promise<ExtensionInfo[]> {
  const t = tauri();
  if (!t) return [];
  return t.invoke<ExtensionInfo[]>("list_extensions", { scanDir });
}

/**
 * WP35 (H9) — enable/disable an extension by writing an `allow`/`deny` trust
 * decision for its CURRENT content hash. This is advisory-only: enabling never makes
 * the extension gate CI (the trust dialog's separate elevation is the only path, and
 * even that stays off by default). Returns the trust.toml path written.
 */
export async function setExtensionEnabled(
  scanDir: string,
  extId: string,
  enabled: boolean,
): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("set_extension_enabled", { scanDir, extId, enabled });
}

/**
 * WP35 (H9 + §4.11) — record an explicit TRUST decision for an extension (the trust
 * dialog's "Always allow" / "Deny"), optionally granting the requested permissions.
 * `elevatedGating` elevates this extension's deterministic findings to gate CI — OFF
 * by default; the ONLY path to elevation. Content-hash keyed, so a later `git pull`
 * that changes the extension re-prompts. Returns the trust.toml path.
 */
export async function trustExtension(
  scanDir: string,
  extId: string,
  decision: "allow" | "deny",
  permissions: string[],
  elevatedGating: boolean,
): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("trust_extension", {
    scanDir,
    extId,
    decision,
    permissions,
    elevatedGating,
  });
}

/** One extension's test-run result (from `ddc ext test`). */
export interface ExtTestResult {
  extId: string;
  passed: number;
  total: number;
  allPass: boolean;
  /** Per-case human lines (e.g. "✓ basic" / "✗ dup-fires — FAILED"). */
  cases: string[];
}

/**
 * WP35 (H9) — run an extension's golden-file tests (`ddc ext test`) for the "Run
 * tests" button. Read-only (the harness uses a confined temp scan). Returns the
 * per-case outcome summary.
 */
export async function runExtTests(extPath: string): Promise<ExtTestResult> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<ExtTestResult>("run_ext_tests", { extPath });
}

/** WP08 — one saved run in the unified report-history store. `file` is the
 *  absolute path of the stored JSON; `timestamp` is its ISO label (or `"latest"`
 *  for the convenience copy); `latest` marks that copy. Mirrors the Rust
 *  `StoredRun`. */
export interface StoredRun {
  file: string;
  timestamp: string;
  latest: boolean;
}

/** WP08 — one repo-key's history group: the stable key plus its runs (newest
 *  first). Mirrors the Rust `HistoryGroup`. */
export interface HistoryGroup {
  repoKey: string;
  runs: StoredRun[];
}

/** WP08 — the global settings document (`~/.ddc/settings.json`): how many runs to
 *  retain per repo (default 5) plus the reserved WP07 editor command. Mirrors the
 *  Rust `Settings`. */
export interface DdcSettings {
  retention: number;
  editorCommand?: string;
}

/**
 * WP08 (T3, P3/P31) — list the ENTIRE unified report history IN-APP, grouped by
 * repo-key (each group's runs newest-first), so the user never navigates the
 * native picker into the hidden `~/.ddc` dotfolder. Resolves to `[]` when not
 * running under Tauri (the browser viewer has no store). Read-only.
 */
export async function listHistory(): Promise<HistoryGroup[]> {
  const t = tauri();
  if (!t) return [];
  return t.invoke<HistoryGroup[]>("list_history");
}

/**
 * WP08 (T3) — list the saved runs for ONE repo `path` (newest first), so the
 * "Load ddc" flow can default to the repo the user just scanned. Resolves to `[]`
 * when not under Tauri. Read-only.
 */
export async function listRepoHistory(path: string): Promise<StoredRun[]> {
  const t = tauri();
  if (!t) return [];
  return t.invoke<StoredRun[]>("list_repo_history", { path });
}

/**
 * WP08 (T3) — read one stored report file back as a parsed `DdcReport` (the in-app
 * "open this past run" path; no native picker). `file` comes from a `listHistory` /
 * `listRepoHistory` entry. Throws when not under Tauri or the read fails.
 */
export async function readStoreReport(file: string): Promise<DdcReport> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  const raw = await t.invoke<unknown>("read_store_report", { file });
  return parseReport(raw);
}

/**
 * WP11 (T5) — one row in the per-repo-key aggregate history (`history.json`).
 * Appended on every `save_report` call. `healthScore` is -1 when the store
 * couldn't compute it (UI should skip that point on trend charts).
 */
export interface AggregateEntry {
  timestamp: string;
  findings: number;
  healthScore: number;
  totalLoc: number;
  files: number;
  duplicationRatio: number;
  perRule: Record<string, number>;
}

/**
 * WP11 (T5) — load the full aggregate history for the repo at `path`.
 * Returns `[]` when not under Tauri or no scans have been saved yet.
 */
export async function loadAggregateHistory(path: string): Promise<AggregateEntry[]> {
  const t = tauri();
  if (!t) return [];
  return t.invoke<AggregateEntry[]>("load_aggregate_history", { path });
}

/**
 * WP08 — read the global settings (`retention`, reserved `editorCommand`). Returns
 * the inert defaults when not under Tauri or the file is absent.
 */
export async function getSettings(): Promise<DdcSettings> {
  const t = tauri();
  if (!t) return { retention: 5 };
  return t.invoke<DdcSettings>("get_settings");
}

/**
 * WP08 — persist the global settings (the retention N the auto-save honours, plus
 * the reserved WP07 editor command). Returns the written absolute path. Throws when
 * not under Tauri or the write fails.
 */
export async function setSettings(settings: DdcSettings): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("set_settings", { settings });
}

/**
 * WP07 (T2, P19) — launch the user's configured editor on a file. `program` + `args`
 * are the DISCRETE argv produced by `buildEditorArgv` (program-then-args, never a
 * shell string), so there is no shell-injection surface. Throws when not under Tauri
 * or the spawn fails. Callers must only invoke this when an editor command is
 * configured (the action is hidden/disabled otherwise).
 */
export async function openInEditor(
  program: string,
  args: string[],
): Promise<void> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  await t.invoke("open_in_editor", { program, args });
}

/**
 * WP10 (P30) — the stable store repo-key for a scan-root `path`, so the Export page
 * can offer a `.ddc` store-copy of a freshly-scanned run. Resolves to `null` when
 * not under Tauri.
 */
export async function repoKeyForPath(path: string): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  return t.invoke<string>("repo_key_for_path", { path });
}

/**
 * WP10 (T2, P30) — export a unified report-store entry as a `.ddc` COPY into
 * `destDir`. `repoKey` selects which `store/<repo-key>/` dir (from `listHistory`);
 * the backend copies it into `destDir/<repoKey>/`, leaving the source store
 * untouched. Returns the created destination path. Throws when not under Tauri.
 */
export async function exportDdc(repoKey: string, destDir: string): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("export_ddc", { repoKey, destDir });
}

/**
 * WP21 (T2) — export `report` as the cleanup plan ZIP written to
 * `destDir/filename`. The backend rejects a `filename` with a separator or `..`
 * and refuses to clobber unless `overwrite`. Returns the written path. Throws when
 * not under Tauri.
 *
 * `filter` is the active FilterSpec (defaults to ai-plan-everything when null/undefined).
 * `resolvedRoot` is the scan directory or report target_root (passed so the plan
 * can emit the absolute repo root; pass `undefined` when not available).
 */
export async function exportPlanZip(
  report: DdcReport,
  destDir: string,
  filename: string,
  overwrite: boolean,
  filter: import("./filterSpec").FilterSpec,
  resolvedRoot?: string,
): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("export_plan_zip", {
    report,
    destDir,
    filename,
    overwrite,
    filter,
    resolvedRoot: resolvedRoot ?? null,
  });
}

/**
 * WP10 (T4, P30) — export `report` as a single self-contained static HTML file
 * written to `destDir/filename`. Same filename/overwrite guards as the LLM export.
 * Returns the written path. Throws when not under Tauri.
 *
 * WP17 (T4): pass `prevReport` to include the "Changes since last scan" delta
 * section in the exported HTML. Omit (or pass `undefined`) on the first run.
 *
 * WP21 (T4): pass `filter` to scope the exported findings (FilterSpec). When
 * omitted, all findings are exported (full report). The HTML heading shows
 * "N of M, filtered" when a filter narrows the result.
 */
export async function exportHtml(
  report: DdcReport,
  destDir: string,
  filename: string,
  overwrite: boolean,
  prevReport?: DdcReport,
  filter?: import("./filterSpec").FilterSpec,
): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("export_html", {
    report,
    prevReport: prevReport ?? null,
    destDir,
    filename,
    overwrite,
    filter: filter ?? null,
  });
}

/**
 * Read a text file off disk via the `read_text_file` command (used for the
 * config preview). Throws when not running under Tauri or the read fails.
 */
export async function readTextFile(path: string): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("read_text_file", { path });
}

/** A decoded slice of a text file returned by `read_text_range`: the requested
 *  (clamped) line window plus the metadata the viewer needs to render a gutter and
 *  page more lines. `startLine`/`endLine` are 1-based; `truncated` is true when the
 *  window was capped. Mirrors the Rust `TextRange`. */
export interface TextRange {
  lines: string[];
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

/**
 * Read a 1-based, inclusive line range from a text file via the `read_text_range`
 * command (the "show me the code" viewer). The backend clamps the window to the
 * file and to its line cap (flagging `truncated`), guards against binaries, and
 * normalizes CRLF. Throws when not running under Tauri or the read fails.
 */
export async function readTextRange(
  path: string,
  startLine: number,
  endLine: number,
): Promise<TextRange> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<TextRange>("read_text_range", { path, startLine, endLine });
}

/**
 * Write a config file into `dir` via the `write_config` command and return the
 * written absolute path. The backend rejects a `filename` containing `/`, `\`
 * or `..`, and refuses to clobber an existing file unless `overwrite` is true.
 * Throws when not running under Tauri or the write fails.
 */
export async function writeConfig(
  dir: string,
  filename: string,
  content: string,
  overwrite: boolean,
): Promise<string> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<string>("write_config", { dir, filename, content, overwrite });
}

// ── GITVIEWER — read-only git types + commands ───────────────────────────────

/** One commit in a file's history (mirrors Rust `CommitInfo`). */
export interface GitCommitInfo {
  /** Short SHA (7 hex chars). */
  hash: string;
  /** Full 40-char SHA. */
  hashFull: string;
  author: string;
  /** ISO-8601 date `YYYY-MM-DD`. */
  date: string;
  subject: string;
  insertions: number;
  deletions: number;
}

/** Per-file history result (mirrors Rust `FileHistory`). */
export interface GitFileHistory {
  commits: GitCommitInfo[];
  /** false when the file is not tracked or scan root is not a git repo. */
  isTracked: boolean;
}

/** The unified diff for a single file at a commit (mirrors Rust `FileDiff`). */
export interface GitFileDiff {
  hash: string;
  /** Unified diff text, or "(binary file)", or empty when unavailable. */
  unifiedDiff: string;
}

/** Age bucket for one line of a blame result (mirrors Rust `AgeBucket`). */
export type GitAgeBucket = "fresh" | "recent" | "aging" | "old" | "ancient";

/** Per-line blame heat for a file (mirrors Rust `BlameHeat`). */
export interface GitBlameHeat {
  /** One bucket per line (capped at 500). */
  lines: GitAgeBucket[];
  totalLines: number;
}

/** One repo-level commit summary (mirrors Rust `RepoCommit`). */
export interface GitRepoCommit {
  hash: string;
  hashFull: string;
  author: string;
  /** ISO-8601 date `YYYY-MM-DD`. */
  date: string;
  subject: string;
  filesChanged: number;
  files: string[];
}

/**
 * GITVIEWER — fetch the commit history for `relPath` in `scanRoot`.
 * Returns `{ isTracked: false, commits: [] }` when not under Tauri.
 * Read-only; safe for any file including non-git repos.
 */
export async function gitFileHistory(
  scanRoot: string,
  relPath: string,
): Promise<GitFileHistory> {
  const t = tauri();
  if (!t) return { commits: [], isTracked: false };
  return t.invoke<GitFileHistory>("git_file_history", { scanRoot, relPath });
}

/**
 * GITVIEWER — fetch the unified diff for `relPath` at `commitHash`.
 * Returns an empty `unifiedDiff` string when not under Tauri.
 * Read-only.
 */
export async function gitFileDiff(
  scanRoot: string,
  commitHash: string,
  relPath: string,
): Promise<GitFileDiff> {
  const t = tauri();
  if (!t) return { hash: commitHash, unifiedDiff: "" };
  return t.invoke<GitFileDiff>("git_file_diff", { scanRoot, commitHash, relPath });
}

/**
 * GITVIEWER — fetch the blame heat strip for `relPath` (capped at 500 lines).
 * Returns `{ lines: [], totalLines: 0 }` when not under Tauri.
 * Read-only.
 */
export async function gitBlameHeat(
  scanRoot: string,
  relPath: string,
): Promise<GitBlameHeat> {
  const t = tauri();
  if (!t) return { lines: [], totalLines: 0 };
  return t.invoke<GitBlameHeat>("git_blame_heat", { scanRoot, relPath });
}

/**
 * GITVIEWER — fetch the `n` most recent repo-level commits (max 50).
 * Returns `[]` when not under Tauri.
 * Read-only.
 */
export async function gitRecentCommits(
  scanRoot: string,
  n?: number,
): Promise<GitRepoCommit[]> {
  const t = tauri();
  if (!t) return [];
  return t.invoke<GitRepoCommit[]>("git_recent_commits", { scanRoot, n: n ?? 30 });
}

/**
 * GITVIEWER — most-recent commit entry per file across the whole repo.
 * Returns one `GitFileAgeEntry` per unique file seen in the last `limit`
 * commits (default 500). Used by App.tsx to build the ProjectTree last-change
 * age column in a single repo-level call (no N+1 per-file requests).
 * Returns `[]` when not under Tauri or when `scanRoot` is not a git repo.
 */
export interface GitFileAgeEntry {
  /** Repo-relative file path (no leading slash). */
  path: string;
  hash: string;
  hashFull: string;
  author: string;
  /** ISO-8601 date `YYYY-MM-DD`. */
  date: string;
  subject: string;
}

export async function gitFileAges(
  scanRoot: string,
  limit?: number,
): Promise<GitFileAgeEntry[]> {
  const t = tauri();
  if (!t) return [];
  return t.invoke<GitFileAgeEntry[]>("git_file_ages", { scanRoot, limit: limit ?? 500 });
}

// ── WP22 — deterministic cleanup types + commands ────────────────────────────

import type { FilterSpec } from "./filterSpec";

/** WP22 — result of probing a repo's git state. Mirrors Rust `GitState`. */
export type GitState =
  | { kind: "notGit" }
  | { kind: "dirty"; summary: string }
  | { kind: "detachedHead" }
  | { kind: "clean"; branch: string };

/** WP22 — a single cleanup operation. Mirrors Rust `FixOp`. */
export type FixOp =
  | {
      kind: "deleteFile";
      path: string;
      findingIds: string[];
      label: string;
    }
  | {
      kind: "removeManifestEntry";
      manifest: string;
      dep: string;
      section: string;
      findingIds: string[];
      label: string;
    }
  | {
      kind: "addManifestEntry";
      manifest: string;
      dep: string;
      version: string;
      section: string;
      findingIds: string[];
      label: string;
    }
  | {
      kind: "deleteLine";
      path: string;
      line: number;
      expectedContent: string;
      findingIds: string[];
      label: string;
    }
  | {
      kind: "stripExportKeyword";
      path: string;
      startLine: number;
      symbol: string;
      expectedPrefix: string;
      findingIds: string[];
      label: string;
    };

/** WP22 — a finding skipped during plan derivation. Mirrors Rust `SkippedFinding`. */
export interface SkippedFinding {
  id: string;
  rule: string;
  path: string;
  skipReason: string;
  detail: string;
}

/** WP22 — the complete fix plan. Mirrors Rust `FixPlan`. */
export interface FixPlan {
  ops: FixOp[];
  skipped: SkippedFinding[];
  /** Absolute path of the repo root (from the plan, used for the apply call). */
  repoRoot: string;
}

/** WP22 — status of a single dry-run op. Mirrors Rust `DryRunStatus`. */
export type DryRunStatus =
  | { status: "ok" }
  | { status: "skipped"; reason: string; detail: string };

/** WP22 — one rendered op in the dry-run preview. Mirrors Rust `DryRunOp`. */
export interface DryRunOp {
  label: string;
  findingIds: string[];
  status: DryRunStatus;
  /** Unified diff text; absent when status is "skipped". */
  diff?: string;
}

/** WP22 — the complete dry-run preview. Mirrors Rust `DryRun`. */
export interface DryRun {
  ops: DryRunOp[];
  okCount: number;
  skippedCount: number;
}

/** WP22 — the status of one applied op. Mirrors Rust `OpStatus`. */
export type OpStatus = "applied" | "skipped" | "failed";

/** WP22 — per-op result in `ApplyReport`. Mirrors Rust `ApplyOpResult`. */
export interface ApplyOpResult {
  opLabel: string;
  findingIds: string[];
  status: OpStatus;
  detail?: string;
}

/** WP22 — the complete result of `cleanupApply`. Mirrors Rust `ApplyReport`. */
export interface ApplyReport {
  repoRoot: string;
  gitBranch?: string;
  /** SHAs of op-group commits (one per apply-order group). */
  commits: string[];
  results: ApplyOpResult[];
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
}

/**
 * WP22 (T5) — probe the git state of `dir`. Read-only; never modifies the tree.
 * Returns the serialized `GitState`. Throws when not running under Tauri or `dir`
 * is not a directory.
 */
export async function cleanupGitState(dir: string): Promise<GitState> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<GitState>("cleanup_git_state", { dir });
}

/**
 * WP22 (T5) — derive a `FixPlan` from `report` findings + `filter`, then render
 * its unified-diff dry-run preview. **Read-only**: no file is modified.
 *
 * `report` is the `DdcReport` the frontend already holds; `filter` is the current
 * `FilterSpec` from the cleanup UI. `dir` is the repo root. `selectedFindingIds`
 * is the authoritative checkbox selection; the backend intersects the report
 * with these IDs before deriving any operation.
 *
 * Returns both the plan (needed for `cleanupApply`) and the rendered dry-run diffs
 * for the preview step. Throws when not under Tauri or on a backend error.
 */
export async function cleanupDeriveAndDryRun(
  report: DdcReport,
  filter: FilterSpec,
  dir: string,
  selectedFindingIds: string[],
): Promise<{ plan: FixPlan; dryRun: DryRun }> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<{ plan: FixPlan; dryRun: DryRun }>("cleanup_derive_and_dry_run", {
    report,
    filter,
    dir,
    selectedFindingIds,
  });
}

/**
 * WP22 (T5) — apply a `FixPlan` behind the git-cleanliness gate.
 *
 * `plan` is the value returned by `cleanupDeriveAndDryRun` (or a stored plan).
 * `dir` must match `plan.repoRoot` (validated by the backend).
 * `acceptBranch` controls whether a dirty/detached repo is snapshotted to a
 * `ddc/cleanup-<ts>` branch before applying. `forceNonGit` enables the
 * trash+.bak path for non-git directories.
 *
 * Returns the `ApplyReport` with per-op results and commit SHAs. Throws when not
 * under Tauri, on a git-gate refusal (the message is the human-readable
 * `RefusalError`), or on a backend error.
 */
export async function cleanupApply(
  plan: FixPlan,
  dir: string,
  acceptBranch: boolean,
  forceNonGit: boolean,
): Promise<ApplyReport> {
  const t = tauri();
  if (!t) throw new Error("Not running under Tauri.");
  return t.invoke<ApplyReport>("cleanup_apply", {
    plan,
    dir,
    acceptBranch,
    forceNonGit,
  });
}
