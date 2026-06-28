import { useEffect, useRef, useState } from "react";
import type { Finding, GraphData, OriginRow } from "../types";
import { derivedConfidence, findingSeverity } from "../lib/severity";
import { ruleLabel, findNodeIdForFinding, revealForCloneSite, revealForFinding } from "../lib/report";
import type { RevealTarget } from "../lib/report";
import { GatingChip, SeverityChip, TierChip } from "./badges";
import { TraceDetail, hasTrace } from "./TraceDetail";
import { WhyTree } from "./WhyTree";
import { Panel } from "./ui/Panel";
import { FileViewer } from "./FileViewer";
import { EvidenceLocations, type EvidenceSite } from "./EvidenceLocations";
import { evidenceSitesForFinding } from "../lib/evidenceSites";
import { buildEditorArgv } from "../lib/editorCommand";
import { getSettings, openInEditor, isTauri } from "../lib/tauri";
import { getRuleInfo } from "../lib/ruleInfo";
import { getMultiplierHint } from "../lib/multiplierInfo";
import { suppressFindingFlow } from "../lib/suppress";
import { inertControlProps } from "./demoInert";

export function EvidencePanel({
  finding,
  graph,
  origins,
  onTraceInGraph,
  targetRoot,
  memberRoots,
  scanRoot,
  onViewHistory,
  demoInert,
}: {
  finding: Finding | null;
  graph?: GraphData;
  /** B-VIZ2: the report's origin-flow rows (`report.origins`), so the Why tree
   *  can attach the rename/over-fetch chain to a cross-layer finding. Optional. */
  origins?: OriginRow[];
  onTraceInGraph?: (nodeId: string) => void;
  // Absolute root the findings' repo-relative paths join against
  // (`report.run.target_root`). Optional so existing renders/tests don't break;
  // when absent the inline code viewer is simply omitted.
  targetRoot?: string;
  // WP5.3.2: the per-member absolute roots (`report.member_roots`) for a multi-root
  // report. When present, the reveal join splits a `"<member_id>/<rel>"` finding path
  // and joins against the member's own root instead of `targetRoot`. Absent (single
  // root) → the existing single-root join is used.
  memberRoots?: Record<string, string>;
  /**
   * GITVIEWER: the scan root directory (absolute path). When provided alongside
   * `onViewHistory`, the "View file history →" deep-link button appears in the
   * badges row. Also passed to FileViewer to enable the Code/History tab toggle.
   */
  scanRoot?: string;
  /**
   * GITVIEWER: deep-link callback — opens the file in the ProjectTree panel's
   * FileViewer in History mode. App.tsx wires this to set the active path and
   * switch the FileViewer to initialMode="history".
   */
  onViewHistory?: (absPath: string) => void;
  /** Static demo: show desktop-only "Open in editor" as enabled-looking but
   *  inert (with a tooltip) instead of hiding it, so the affordance is visible. */
  demoInert?: boolean;
}) {
  // WP07 (T2, P19) — the configured editor-launch template (`editorCommand`),
  // loaded once from the global settings. Empty/undefined → no template → the
  // "Open in editor" action is hidden. Browser mode never has Tauri fs, so we
  // skip the fetch there and the action stays hidden.
  const [editorTemplate, setEditorTemplate] = useState<string | undefined>(
    undefined,
  );
  // WP25 T1 — per-rule explainer drawer (collapsed by default, per-panel instance).
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [historyReveal, setHistoryReveal] = useState<RevealTarget | null>(null);

  // B-VIZ2 — the FileViewer wrapper, so the Why tree's "show in source" leaf can
  // scroll the already-rendered source into view (reveal-to-file without leaving
  // the panel).
  const fileViewerRef = useRef<HTMLDivElement | null>(null);

  // A3 — per-finding suppress: feedback state for the Suppress action.
  // `null` = idle, string = success/info/error message to show inline.
  const [suppressStatus, setSuppressStatus] = useState<string | null>(null);
  // A3 — browser-mode copy snippet: set when suppressFindingFlow returns
  // { status: "browser" } and cleared when the user copies or dismisses.
  const [suppressSnippet, setSuppressSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);

  // A3 — reset suppress state when the selected finding changes.
  useEffect(() => {
    setSuppressStatus(null);
    setSuppressSnippet(null);
    setSnippetCopied(false);
    setHistoryReveal(null);
  }, [finding?.id]);

  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    void getSettings()
      .then((s) => {
        if (live) setEditorTemplate(s.editorCommand);
      })
      .catch(() => {
        /* settings unreadable → action simply stays hidden */
      });
    return () => {
      live = false;
    };
  }, []);

  if (!finding) {
    return (
      <div className="panel evidence">
        <h2>Evidence</h2>
        <div className="empty">
          Select a finding to see its evidence and confidence derivation.
        </div>
      </div>
    );
  }

  const { evidence, target } = finding;
  const derived = derivedConfidence(finding);
  const mismatch = derived !== finding.confidence;
  const spanTxt = target.span
    ? `:${target.span.start_line}${
        target.span.end_line !== target.span.start_line
          ? `-${target.span.end_line}`
          : ""
      }`
    : "";

  const graphNodeId =
    onTraceInGraph && graph ? findNodeIdForFinding(graph, finding) : null;

  // "Show me the code": resolve the (file-kind) target to an absolute path + span.
  // Null for non-file targets (e.g. dependency names) or when no root is available.
  const reveal = revealForFinding(finding, targetRoot, memberRoots);

  // WP06 T2/T3 + WP54 T2 — multi-location evidence/source sites derived from
  // the untyped evidence.graph.
  const evidenceSites: EvidenceSite[] = evidenceSitesForFinding(finding);
  // Render every explicit evidence/source site. Some rules target one file but
  // prove the finding from another source file, so a single site can still add
  // essential context.
  const showLocations = evidenceSites.length > 0;

  // WP07 (T2, P19) — the "Open in editor" argv, or null when the action is
  // unavailable (no template configured, no resolvable file path, or the template
  // needs a {line} this finding lacks). Built program-then-args by the tested
  // builder; spawned (never shell-evaluated) by the `open_in_editor` command.
  const editorArgv =
    reveal && editorTemplate
      ? buildEditorArgv(editorTemplate, {
          path: reveal.absPath,
          line: target.span?.start_line ?? null,
        })
      : null;

  // WP25 T1 — rule explainer (looked up once per render; never throws).
  const ruleInfo = getRuleInfo(finding.rule);
  const similarDocPair = similarDocPairDetails(finding, targetRoot, memberRoots);

  return (
    <div className="panel evidence">
      <h2>
        Evidence — {ruleLabel(finding.rule)}
        <button
          className="explainer-toggle"
          aria-expanded={explainerOpen}
          onClick={() => setExplainerOpen((o) => !o)}
          title={explainerOpen ? "Hide rule explanation" : "Show rule explanation"}
          style={{ marginLeft: 8, padding: "1px 6px", fontSize: 11, cursor: "pointer" }}
        >
          ⓘ
        </button>
      </h2>

      {/* WP25 T1 — explainer drawer, collapsed by default */}
      {explainerOpen && (
        <div
          className="explainer-drawer"
          data-testid="explainer-drawer"
          style={{
            background: "var(--bg-subtle, #1e1e2e)",
            border: "1px solid var(--border, #3a3a5c)",
            borderRadius: 4,
            padding: "10px 12px",
            marginBottom: 10,
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>What this flags: </span>
            {ruleInfo.description}
          </div>
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>Why it accrues: </span>
            {ruleInfo.whyItAccrues}
          </div>
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>How to fix: </span>
            {ruleInfo.howToFix}
          </div>
          <div>
            <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>How to prevent: </span>
            {ruleInfo.howToPrevent}
          </div>
        </div>
      )}

      <div className="badges">
        <SeverityChip severity={findingSeverity(finding)} />
        <GatingChip gating={finding.gating} />
        <TierChip tier={finding.determinism_tier} />
        <span className="chip tier">conf {finding.confidence}</span>
        {graphNodeId && onTraceInGraph && (
          <button
            className="gn-trace-btn"
            onClick={() => onTraceInGraph(graphNodeId)}
            title="open this node in the Trace tree"
          >
            Trace in graph →
          </button>
        )}
        {editorArgv && (
          <button
            className="gn-trace-btn"
            onClick={() =>
              void openInEditor(editorArgv.program, editorArgv.args)
            }
            title={`run: ${editorArgv.program} ${editorArgv.args.join(" ")}`}
          >
            Open in editor ↗
          </button>
        )}
        {/* Static demo: no editor template (no Tauri), but a file-kind finding
            would have one in the full app — show the affordance, inert. */}
        {demoInert && !editorArgv && reveal && (
          <button className="gn-trace-btn" {...inertControlProps()}>
            Open in editor ↗
          </button>
        )}
        {/* GITVIEWER: "View file history" deep-link — shown when scanRoot and the
            handler are both provided AND the finding has a resolvable file path. */}
        {onViewHistory && reveal && scanRoot && (
          <button
            className="gn-trace-btn"
            onClick={() => {
              setHistoryReveal(reveal);
              onViewHistory(reveal.absPath);
            }}
            title={`Open git history for ${reveal.displayPath ?? reveal.absPath}`}
          >
            View file history →
          </button>
        )}
        {/* A3 — Suppress this finding: shown whenever targetRoot is available
            (needed to locate the project ddc.toml). On desktop: preview merged
            ddc.toml → confirm → write via write_config chokepoint. On browser:
            degrade to a copy-to-clipboard snippet. The button resets status
            when the selected finding changes (suppressStatus/suppressSnippet are
            per-finding-selection state). */}
        {targetRoot && (
          <button
            className="gn-trace-btn"
            data-testid="suppress-btn"
            onClick={() => {
              setSuppressStatus(null);
              setSuppressSnippet(null);
              setSnippetCopied(false);
              void suppressFindingFlow(targetRoot, target.path).then((res) => {
                if (res.status === "written") {
                  setSuppressStatus(
                    `Suppressed. Rule written to ${res.path}. Re-scan to hide this finding.`,
                  );
                } else if (res.status === "cancelled") {
                  setSuppressStatus(null);
                } else if (res.status === "browser") {
                  setSuppressSnippet(res.snippet);
                } else {
                  setSuppressStatus(`Suppress failed: ${res.message}`);
                }
              });
            }}
            title={`Add "${target.path}" to [rules].ignore in ddc.toml`}
          >
            Suppress…
          </button>
        )}
      </div>

      {/* A3 — suppress action feedback (desktop write confirmation or error) */}
      {suppressStatus && (
        <div
          data-testid="suppress-status"
          style={{
            fontSize: 12,
            color: suppressStatus.startsWith("Suppress failed")
              ? "var(--sev-high, #e05252)"
              : "var(--sev-info, #4ec9b0)",
            marginBottom: 6,
            padding: "4px 0",
          }}
        >
          {suppressStatus}
          {" "}
          <button
            style={{ fontSize: 11, cursor: "pointer", padding: "0 4px" }}
            onClick={() => setSuppressStatus(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* A3 — browser-mode suppress: show the snippet to copy instead of writing */}
      {suppressSnippet && (
        <div
          data-testid="suppress-snippet"
          style={{
            background: "var(--bg-subtle, #1e1e2e)",
            border: "1px solid var(--border, #3a3a5c)",
            borderRadius: 4,
            padding: "8px 10px",
            marginBottom: 8,
            fontSize: 12,
          }}
        >
          <div style={{ marginBottom: 4, color: "var(--fg-muted)" }}>
            Add this to your <code>ddc.toml</code> to suppress this finding:
          </div>
          <pre style={{ margin: 0, fontSize: 11, overflowX: "auto" }}>
            {suppressSnippet}
          </pre>
          <button
            style={{ fontSize: 11, marginTop: 6, marginRight: 6 }}
            onClick={() => {
              void navigator.clipboard
                .writeText(suppressSnippet)
                .then(() => {
                  setSnippetCopied(true);
                  setTimeout(() => setSnippetCopied(false), 2000);
                })
                .catch(() => {/* clipboard unavailable — user can select manually */});
            }}
          >
            {snippetCopied ? "Copied!" : "Copy"}
          </button>
          <button
            style={{ fontSize: 11, marginTop: 6 }}
            onClick={() => {
              setSuppressSnippet(null);
              setSnippetCopied(false);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="reason">{evidence.reason}</div>

      {/* B-VIZ2 — the interactive why tree: this finding's reasoning as an
          explorable tree (verdict → confidence → evidence → target → origin
          flow → whole-stack node). Collapsed by default; the flat sections
          below remain the always-on view. */}
      <Panel
        title="Why tree"
        className="why-tree-panel"
        collapsible
        defaultOpen={false}
        persistKey="evidence-why-tree"
      >
        <WhyTree
          finding={finding}
          graph={graph}
          origins={origins}
          onTraceInGraph={
            onTraceInGraph && graphNodeId
              ? (nodeId) => onTraceInGraph(nodeId)
              : undefined
          }
          onRevealFile={
            reveal && target.span
              ? () =>
                  fileViewerRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  })
              : undefined
          }
        />
      </Panel>

      {reveal && (
        <div ref={fileViewerRef}>
          <div className="fv-excerpt-label">
            {target.span
              ? "Source file"
              : "Source file (no span in this finding; showing file start)"}
          </div>
          <FileViewer
            absPath={reveal.absPath}
            displayPath={reveal.displayPath}
            highlightStart={reveal.highlightStart}
            highlightEnd={reveal.highlightEnd}
            scanRoot={scanRoot}
          />
        </div>
      )}

      {historyReveal && scanRoot && (
        <div className="similar-doc-pair" data-testid="file-history-inline">
          <div className="fv-excerpt-label">File history</div>
          <FileViewer
            key={`${historyReveal.absPath}:history`}
            absPath={historyReveal.absPath}
            displayPath={historyReveal.displayPath}
            highlightStart={historyReveal.highlightStart}
            highlightEnd={historyReveal.highlightEnd}
            scanRoot={scanRoot}
            initialMode="history"
          />
        </div>
      )}

      {similarDocPair && (
        <div className="similar-doc-pair" data-testid="similar-doc-pair-details">
          <div className="fv-excerpt-label">Similar document pair</div>
          <div className="similar-doc-pair-grid">
            {similarDocPair.docs.map((doc, i) => (
              <details key={doc.path} className="similar-doc-card">
                <summary>
                  <span className="mono">{doc.path}</span>
                  <span className="chip tier">doc {i === 0 ? "A" : "B"}</span>
                </summary>
                {doc.reveal ? (
                  <FileViewer
                    absPath={doc.reveal.absPath}
                    displayPath={doc.reveal.displayPath}
                    highlightStart={doc.reveal.highlightStart}
                    highlightEnd={doc.reveal.highlightEnd}
                    scanRoot={scanRoot}
                  />
                ) : (
                  <div className="evl-noreveal mono">
                    {doc.path} — open in your editor
                  </div>
                )}
              </details>
            ))}
          </div>
        </div>
      )}

      {showLocations && (
        <EvidenceLocations
          sites={evidenceSites}
          targetRoot={targetRoot}
          memberRoots={memberRoots}
          scanRoot={scanRoot}
          defaultOpen={evidenceSites.length === 1}
        />
      )}

      <TraceDetail finding={finding} />

      <div className="confidence-math">
        <div style={{ marginBottom: 6, color: "var(--fg-muted)" }}>
          Confidence derivation
        </div>
        <div className="mult" style={{ borderTop: "none" }}>
          <span className="nm">base prior</span>
          <span className="factor">{evidence.base_prior.toFixed(3)}</span>
        </div>
        {evidence.multipliers.length === 0 && (
          <div className="mult">
            <span className="dt">no multipliers applied</span>
            <span className="factor">×1.000</span>
          </div>
        )}
        {evidence.multipliers.map((m, i) => {
          const hint = getMultiplierHint(m.name, m.factor);
          return (
          <div className="mult" key={`${m.name}:${i}`}>
            <span>
              <span className="nm">{m.name}</span>
              <br />
              <span className="dt">{m.detail}</span>
              {/* WP25 T2 — per-multiplier hint */}
              <br />
              <span
                className="dt"
                style={{ color: m.factor < 1 ? "var(--sev-advisory, #e5a00d)" : "var(--fg-muted)" }}
                data-testid={`mult-hint-${i}`}
              >
                {hint}
              </span>
            </span>
            <span className="factor">×{m.factor.toFixed(3)}</span>
          </div>
          );
        })}
        <div className="result">
          <span>= derived confidence</span>
          <span>{derived}%</span>
        </div>
        {mismatch && (
          <div className="mismatch">
            Note: engine-reported confidence is {finding.confidence}% (rounding
            or post-adjustment may apply).
          </div>
        )}
      </div>

      <div className="kv">
        <span className="k">Target</span>
        <span className="v">
          {target.path}
          {spanTxt}
        </span>
        <span className="k">Kind</span>
        <span className="v">{target.kind}</span>
        <span className="k">Node id</span>
        <span className="v">{target.node_id}</span>
        <span className="k">Impact</span>
        <span className="v">
          {finding.impact.value} {finding.impact.metric}
        </span>
        <span className="k">Finding id</span>
        <span className="v">{finding.id}</span>
      </div>

      <details className="graph-raw" open={!hasTrace(finding.rule)}>
        <summary>raw evidence graph</summary>
        <pre className="graph mono">
          {JSON.stringify(evidence.graph, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function similarDocPairDetails(
  finding: Finding,
  targetRoot: string | undefined,
  memberRoots?: Record<string, string>,
): { docs: Array<{ path: string; reveal: RevealTarget | null }> } | null {
  if (finding.rule !== "similar-doc-pair") return null;
  const graph = finding.evidence.graph as Record<string, unknown>;
  const pair = Array.isArray(graph.pair)
    ? graph.pair.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  const paths = pair.length >= 2 ? pair.slice(0, 2) : [finding.target.path].filter(Boolean);
  if (paths.length < 2) return null;

  const chunkMatches = Array.isArray(graph.chunk_matches) ? graph.chunk_matches : [];
  const firstChunk = chunkMatches.find((m) => m && typeof m === "object") as Record<string, unknown> | undefined;
  const linesFor = (key: "lines_a" | "lines_b"): [number, number] | null => {
    const value = firstChunk?.[key];
    return Array.isArray(value) &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
      ? [value[0], value[1]]
      : null;
  };
  const lines = [linesFor("lines_a"), linesFor("lines_b")];

  return {
    docs: paths.map((path, i) => {
      const span = lines[i];
      return {
        path,
        reveal: revealForCloneSite(
          {
            path,
            start_line: span?.[0] ?? 1,
            end_line: span?.[1] ?? span?.[0] ?? 1,
          },
          targetRoot,
          memberRoots,
        ),
      };
    }),
  };
}
