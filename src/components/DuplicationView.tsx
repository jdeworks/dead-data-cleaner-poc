import { useMemo, useState } from "react";
import type { Finding, Metrics } from "../types";
import { findingSeverity } from "../lib/severity";
import { revealForCloneSite } from "../lib/report";
import { SeverityChip, GatingChip } from "./badges";
import { Button, Chip, Panel, Stat, StatGrid, EmptyState } from "./ui";
import { FileViewer } from "./FileViewer";
import { computeHealth } from "../lib/health";

// Renders the engine's `duplicate-block` findings as linked clone clusters —
// each finding is one clone class (a set of token-for-token / near-duplicate
// sites). This is a read-only viewer: it shows what ddc WOULD propose unifying
// and why. The data already lives in the feed; we only
// re-shape it for the eye (defensive reads of `evidence.graph`, an untyped
// Record, mirror TraceDetail's asStr/asNum helpers).
//
// WP6.3: the engine now also emits Type-3 NEAR clones (`kind:"near"`, a
// `similarity` score, a `unify` proposal) and JSX near clones (`jsx:true`, a
// `tag`, `unify.varying_props`). Exact findings stay byte-identical (no `kind`).
// Every new field is read DEFENSIVELY (optional / asNum / asStr) so old reports
// and exact findings render exactly as before.

// --- defensive graph readers (evidence.graph is Record<string, unknown>) ----
const asNum = (v: unknown): number | null =>
  typeof v === "number" ? v : null;
const asStr = (v: unknown): string | null =>
  typeof v === "string" ? v : null;
const asBool = (v: unknown): boolean => v === true;
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

interface CloneSite {
  path: string;
  start_line: number | null;
  end_line: number | null;
  tokens: number | null;
}

// One varying (diverging) run inside a unify proposal — the would-be wrapper
// parameters, as source line ranges keyed by the site they came from.
// WP18 (T2): `vary_kind` is the alpha-rename classification added by the engine.
interface VaryingRun {
  siteIndex: number | null;
  start_line: number | null;
  end_line: number | null;
  // "trivial_rename" = same variable in both sites; "param_opportunity" = different
  // variables → a real parameterization opportunity.  Absent on exact findings.
  vary_kind?: "trivial_rename" | "param_opportunity" | null;
}

interface UnifyData {
  sharedStart: number | null; // shared_span.start_line (absent on JSX unify)
  sharedEnd: number | null; // shared_span.end_line
  varying: VaryingRun[];
  suggestedParams: number | null;
  varyingProps: string[]; // JSX only: the differing prop names
}

// "exact" = byte-for-byte token clone (no `kind`); "near" = Type-3 token-shingle
// near clone; "jsx" = a JSX-element near clone (kind:"near" + jsx:true).
type CloneKind = "exact" | "near" | "jsx";

interface CloneClass {
  id: string;
  finding: Finding;
  duplicatedLoc: number; // LOC duplicated across the class (impact)
  siteCount: number;
  tokensPerSite: number | null; // representative tokens-per-site (first site)
  sites: CloneSite[];
  kind: CloneKind;
  similarity: number | null; // [0,1]; null for exact
  tag: string | null; // JSX tag, e.g. "Button"
  unify: UnifyData | null;
  expected: boolean;
  expectedReason: string | null;
  subtype: string | null;
  actionability: "high" | "medium" | "low";
}

/** Pull the clone class out of a duplicate-block finding, reading the untyped
 *  `evidence.graph` defensively and falling back to `impact` / `target`. All of
 *  the WP6.3 near/unify/jsx fields are OPTIONAL — an exact or old finding simply
 *  has none of them and reads back as `kind:"exact"`, similarity/unify null. */
function toCloneClass(f: Finding): CloneClass {
  const g = f.evidence.graph;
  const rawSites = Array.isArray(g.sites) ? g.sites : [];
  const sites: CloneSite[] = rawSites.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return {
      path: asStr(o.path) ?? asStr(o.file) ?? "(unknown)",
      start_line: asNum(o.start_line) ?? asNum(o.line),
      end_line: asNum(o.end_line),
      tokens: asNum(o.tokens),
    };
  });
  const duplicatedLoc = asNum(g.duplicated_loc) ?? f.impact.value ?? 0;
  const siteCount = asNum(g.site_count) ?? sites.length;
  // Tokens per site: the matched-token count is uniform across a clone class,
  // so the first site's token count represents the whole class.
  const tokensPerSite = sites.length > 0 ? sites[0].tokens : null;

  // WP6.3 near/jsx classification. `kind` is "near" on both general and JSX near
  // findings; `jsx:true` distinguishes the latter. Exact findings carry neither.
  const isNear = asStr(g.kind) === "near";
  const isJsx = isNear && asBool(g.jsx);
  const kind: CloneKind = isJsx ? "jsx" : isNear ? "near" : "exact";
  const similarity = isNear ? asNum(g.similarity) : null;
  const tag = isJsx ? asStr(g.tag) : null;
  const expected = asBool(g.expected);
  const expectedReason = asStr(g.expected_reason);
  const subtype = asStr(g.clone_subtype);
  const actionabilityRaw = asStr(g.actionability);
  const actionability =
    actionabilityRaw === "high" || actionabilityRaw === "medium" || actionabilityRaw === "low"
      ? actionabilityRaw
      : "high";

  // Unify proposal (near + jsx only). General near has `shared_span`; JSX unify
  // has `varying_props` instead. Both carry `varying[]` + `suggested_params`.
  let unify: UnifyData | null = null;
  if (isNear && g.unify && typeof g.unify === "object") {
    const u = g.unify as Record<string, unknown>;
    const span =
      u.shared_span && typeof u.shared_span === "object"
        ? (u.shared_span as Record<string, unknown>)
        : null;
    const varying: VaryingRun[] = Array.isArray(u.varying)
      ? u.varying.map((v) => {
          const o = (v ?? {}) as Record<string, unknown>;
          const vk = asStr(o.vary_kind);
          return {
            siteIndex: asNum(o.site_index),
            start_line: asNum(o.start_line),
            end_line: asNum(o.end_line),
            // WP18: carry through the alpha-rename classification (or undefined)
            vary_kind:
              vk === "trivial_rename" || vk === "param_opportunity" ? vk : undefined,
          };
        })
      : [];
    unify = {
      sharedStart: span ? asNum(span.start_line) : null,
      sharedEnd: span ? asNum(span.end_line) : null,
      varying,
      suggestedParams: asNum(u.suggested_params),
      varyingProps: asStrArr(u.varying_props),
    };
  }

  return {
    id: f.id,
    finding: f,
    duplicatedLoc,
    siteCount,
    tokensPerSite,
    sites,
    kind,
    similarity,
    tag,
    unify,
    expected,
    expectedReason,
    subtype,
    actionability,
  };
}

type SortKey = "loc" | "sites";
type KindFilter = "all" | "exact" | "near" | "jsx";

function actionabilityRank(a: CloneClass["actionability"]): number {
  if (a === "high") return 2;
  if (a === "medium") return 1;
  return 0;
}

function subtypeLabel(subtype: string): string {
  return subtype.replace(/-/g, " ");
}

// Render at most this many clusters at once; ~1187 clone classes in the real
// anvil sample would otherwise stutter the browser. Surfaced in the UI.
const VISIBLE_CAP = 60;

function siteLabel(s: CloneSite): string {
  if (s.start_line === null) return s.path;
  if (s.end_line === null || s.end_line === s.start_line) {
    return `${s.path}:${s.start_line}`;
  }
  return `${s.path}:${s.start_line}-${s.end_line}`;
}

/** The similarity / kind badge for a clone class. Exact clones get no similarity
 *  chip (just a neutral "exact" tag); near clones show `${pct}% similar`; JSX
 *  near clones additionally show the `<Tag> ×N` and a distinct info chip. */
function KindBadges({ cc }: { cc: CloneClass }) {
  if (cc.kind === "exact") {
    return <Chip tone="muted">exact</Chip>;
  }
  const pct =
    cc.similarity !== null ? `${Math.round(cc.similarity * 100)}% similar` : "near";
  return (
    <>
      {cc.kind === "jsx" && cc.tag !== null && (
        <Chip tone="info" title="JSX element near-clone">
          {`<${cc.tag}> ×${cc.siteCount}`}
        </Chip>
      )}
      <Chip tone="warn" title="Type-3 near-duplicate (token-shingle similarity)">
        {pct}
      </Chip>
    </>
  );
}

/** The "Unify candidate" panel for a near/jsx clone class. Surfaces the engine's
 *  actionable suggestion: the shared block range (general near), the number of
 *  varying parts / suggested params, and — for JSX — the differing prop names. */
function UnifyPanel({ unify }: { unify: UnifyData }) {
  const hasShared = unify.sharedStart !== null;
  const varyCount = unify.varying.length;
  const params = unify.suggestedParams;
  return (
    <div className="clone-unify">
      <div className="clone-unify-head">
        <Chip tone="ok">Unify candidate</Chip>
        {params !== null && (
          <span className="clone-unify-params mono">
            extract with {params} param{params === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <ul className="clone-unify-list">
        {hasShared && (
          <li>
            shared block{" "}
            <span className="mono">
              L{unify.sharedStart}
              {unify.sharedEnd !== null && unify.sharedEnd !== unify.sharedStart
                ? `–L${unify.sharedEnd}`
                : ""}
            </span>
          </li>
        )}
        {varyCount > 0 && (() => {
          // WP18: count trivial renames vs param opportunities across all runs
          const trivial = unify.varying.filter((r) => r.vary_kind === "trivial_rename").length;
          const param = unify.varying.filter((r) => r.vary_kind === "param_opportunity").length;
          return (
            <li>
              {varyCount} varying part{varyCount === 1 ? "" : "s"} (the would-be
              parameters)
              {param > 0 && (
                <Chip
                  tone="warn"
                  title="These runs use different variables — real parameterization opportunity"
                >
                  {param} parameterize
                </Chip>
              )}
              {trivial > 0 && (
                <Chip
                  tone="muted"
                  title="These runs are consistent renames of the same variable — trivial variation"
                >
                  {trivial} trivial rename
                </Chip>
              )}
            </li>
          );
        })()}
        {unify.varyingProps.length > 0 && (
          <li>
            varying props:{" "}
            {unify.varyingProps.map((p, i) => (
              <span key={p} className="mono">
                {p}
                {i < unify.varyingProps.length - 1 ? ", " : ""}
              </span>
            ))}
          </li>
        )}
      </ul>
    </div>
  );
}

/** One clone-class member site: its path:lines text plus a lazy "show code"
 *  toggle that mounts a FileViewer for just that site. Lazy = the FileViewer is
 *  only rendered when expanded, so a class with N sites never mounts N viewers at
 *  once. When the site can't be resolved to an on-disk path (browser / no roots),
 *  the toggle is hidden and only the path:lines text shows (graceful degrade). */
function SiteRow({
  site,
  reveal,
}: {
  site: CloneSite;
  reveal: { absPath: string; displayPath: string } | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="clone-site">
      <div className="clone-site-row">
        <span className="mono clone-site-path">{siteLabel(site)}</span>
        {site.tokens !== null && (
          <span className="clone-site-tok">{site.tokens} tok</span>
        )}
        {reveal && (
          <Button
            className="clone-site-toggle"
            active={open}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "hide code" : "show code"}
          </Button>
        )}
      </div>
      {open && reveal && (
        <div className="clone-site-code">
          <FileViewer
            absPath={reveal.absPath}
            displayPath={reveal.displayPath}
            highlightStart={site.start_line}
            highlightEnd={site.end_line}
          />
        </div>
      )}
    </li>
  );
}

/** One clone class, rendered as a card whose member sites are listed inside it
 *  — the containment is what makes the clones read as "linked" (one class). */
function ClusterCard({
  cc,
  targetRoot,
  memberRoots,
}: {
  cc: CloneClass;
  targetRoot?: string;
  memberRoots?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const f = cc.finding;
  const sev = findingSeverity(f);
  return (
    <div className="clone-cluster">
      <div className="clone-head">
        <Button
          className="clone-toggle"
          active={open}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "▾" : "▸"} {cc.siteCount} sites
        </Button>
        <span className="clone-metrics mono">
          {cc.duplicatedLoc} LOC
          {cc.tokensPerSite !== null ? ` · ${cc.tokensPerSite} tok/site` : ""}
        </span>
        <span className="spacer" />
        <KindBadges cc={cc} />
        {cc.subtype && cc.subtype !== "logic-clone" && (
          <Chip tone={cc.expected ? "muted" : "info"} title={cc.expectedReason ?? undefined}>
            {subtypeLabel(cc.subtype)}
          </Chip>
        )}
        {cc.expected && (
          <Chip tone="muted" title={cc.expectedReason ?? "expected low-actionability clone"}>
            expected
          </Chip>
        )}
        <Chip tone={cc.actionability === "high" ? "ok" : cc.actionability === "medium" ? "info" : "muted"}>
          {cc.actionability}
        </Chip>
        <SeverityChip severity={sev} />
        <Chip tone="muted">{f.confidence}% conf</Chip>
        <GatingChip gating={f.gating} />
      </div>
      <div className="clone-reason">{asStr(f.evidence.reason) ?? ""}</div>
      {cc.unify && <UnifyPanel unify={cc.unify} />}
      {open && (
        <ul className="clone-sites">
          {cc.sites.map((s, i) => (
            <SiteRow
              key={i}
              site={s}
              reveal={revealForCloneSite(s, targetRoot, memberRoots)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function DuplicationView({
  findings,
  metrics,
  targetRoot,
  memberRoots,
}: {
  findings: Finding[];
  metrics: Metrics;
  targetRoot?: string;
  memberRoots?: Record<string, string>;
}) {
  const [sort, setSort] = useState<SortKey>("loc");
  const [pathFilter, setPathFilter] = useState("");
  const [minSites, setMinSites] = useState(2);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [minSimilarity, setMinSimilarity] = useState(0); // 0..100 (%), near only
  const [includeExpected, setIncludeExpected] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Build the clone classes once from the duplicate-block findings.
  const classes = useMemo(
    () =>
      findings
        .filter((f) => f.rule === "duplicate-block")
        .map(toCloneClass),
    [findings],
  );

  // WP26 (T3): headline strip computations.
  const totalSites = useMemo(
    () => classes.reduce((s, cc) => s + cc.siteCount, 0),
    [classes],
  );
  const duplicatedLoc = useMemo(
    () =>
      findings
        .filter((f) => f.rule === "duplicate-block" && f.impact.metric === "loc")
        .reduce((s, f) => s + (f.impact.value ?? 0), 0),
    [findings],
  );
  // Health penalty — reuse computeHealth to avoid reimplementing the formula.
  const dupPenalty = useMemo(
    () => computeHealth(findings, metrics).dupPenalty,
    [findings, metrics],
  );

  // Counts per kind, for the mode Stat + filter labels.
  const counts = useMemo(() => {
    let exact = 0,
      near = 0,
      jsx = 0,
      expected = 0;
    for (const cc of classes) {
      if (cc.kind === "exact") exact++;
      else if (cc.kind === "jsx") jsx++;
      else near++;
      if (cc.expected) expected++;
    }
    return { exact, near, jsx, expected, visible: classes.length - expected };
  }, [classes]);

  const filtered = useMemo(() => {
    const needle = pathFilter.trim().toLowerCase();
    const matched = classes.filter((cc) => {
      if (!includeExpected && cc.expected) return false;
      if (cc.siteCount < minSites) return false;
      if (kindFilter !== "all" && cc.kind !== kindFilter) return false;
      // Similarity floor applies ONLY to near/jsx findings (exact has no score);
      // exact findings are unaffected by the slider.
      if (minSimilarity > 0 && cc.similarity !== null) {
        if (Math.round(cc.similarity * 100) < minSimilarity) return false;
      }
      if (needle && !cc.sites.some((s) => s.path.toLowerCase().includes(needle)))
        return false;
      return true;
    });
    matched.sort((a, b) => {
      const action = actionabilityRank(b.actionability) - actionabilityRank(a.actionability);
      if (action !== 0) return action;
      return sort === "loc"
        ? b.duplicatedLoc - a.duplicatedLoc
        : b.siteCount - a.siteCount;
    });
    return matched;
  }, [classes, sort, pathFilter, minSites, kindFilter, minSimilarity, includeExpected]);

  if (classes.length === 0) {
    return (
      <Panel title="Duplication">
        <EmptyState>
          No <code>duplicate-block</code> findings in this report — nothing
          duplicated above the token threshold.
        </EmptyState>
      </Panel>
    );
  }

  const visible = showAll ? filtered : filtered.slice(0, VISIBLE_CAP);
  const capped = !showAll && filtered.length > VISIBLE_CAP;
  const hasNear = counts.near + counts.jsx > 0;

  return (
    <>
      {/* WP26 (T3): headline summary strip — the canonical "clone view" that the
          MetricsHeader clone tile and FindingsPanel banner link into. */}
      <Panel title="Duplication summary">
        <StatGrid>
          <Stat
            value={<span data-testid="dup-summary-classes">{classes.length.toLocaleString()}</span>}
            label="clone classes"
            hint={`${counts.visible.toLocaleString()} visible by default; expected low-actionability classes are hidden unless included`}
          />
          <Stat
            value={<span data-testid="dup-summary-visible">{counts.visible.toLocaleString()}</span>}
            label="visible classes"
            hint="clone classes not tagged expected"
          />
          <Stat
            value={<span data-testid="dup-summary-expected">{counts.expected.toLocaleString()}</span>}
            label="expected"
            hint="low-actionability clone classes hidden by default"
          />
          <Stat
            value={<span data-testid="dup-summary-sites">{totalSites.toLocaleString()}</span>}
            label="total sites"
            hint="sum of site counts across all clone classes"
          />
          <Stat
            value={<span data-testid="dup-summary-loc">{duplicatedLoc.toLocaleString()}</span>}
            label="duplicated LOC"
            hint="sum of LOC-metric impact across all clone findings"
          />
          <Stat
            value={<span data-testid="dup-summary-ratio">{metrics.duplication_ratio.toFixed(1)}%</span>}
            label="duplication ratio"
            tone={metrics.duplication_ratio >= 20 ? "warn" : "default"}
            hint="share of tokens that are cloned (warn ≥ 20%)"
          />
          <Stat
            value={<span data-testid="dup-summary-penalty">−{dupPenalty.toFixed(1)} pts</span>}
            label="health penalty"
            tone={dupPenalty > 10 ? "warn" : "default"}
            hint="duplication deduction from the repo health score (max −30 pts)"
          />
        </StatGrid>
      </Panel>

      <Panel title="Duplication — clone classes">
        <StatGrid>
          <Stat
            value={metrics.clone_classes}
            label="clone classes"
            hint="distinct sets of duplicated code"
          />
          <Stat
            value={`${metrics.duplication_ratio.toFixed(1)}%`}
            label="duplication ratio"
            tone={metrics.duplication_ratio >= 20 ? "warn" : "default"}
            hint="share of tokens that are cloned (warn ≥ 20%)"
          />
          <Stat
            value={metrics.cloned_tokens.toLocaleString()}
            label="cloned tokens"
            hint="total tokens covered by clone classes"
          />
          <Stat
            value={
              hasNear
                ? `${counts.exact} exact · ${counts.near} near${
                    counts.jsx > 0 ? ` · ${counts.jsx} jsx` : ""
                  }`
                : metrics.exact
                  ? "exact"
                  : "approx"
            }
            label="clone mode"
            hint="exact = token-for-token; near = Type-3 similar; jsx = element near-clone"
          />
          <Stat
            value={metrics.min_tokens}
            label="min tokens"
            hint="minimum matched-token run for a clone to register"
          />
        </StatGrid>
        <div className="trace-why">
          Why: the spans in each class are token-for-token (or near) duplicates —
          candidates to unify behind one definition. Near-clones carry a
          similarity score and an extract-with-N-params unify proposal. Advisory
          only; this view is read-only and cleanup is separate.
        </div>
      </Panel>

      <Panel
        title="Clusters"
        actions={
          <span className="mono" style={{ color: "var(--fg-dim)" }}>
            {visible.length} of {filtered.length} matching · {counts.visible} visible / {classes.length} total
          </span>
        }
      >
        <div className="clone-controls">
          <label>
            <input
              type="checkbox"
              checked={includeExpected}
              onChange={(e) => setIncludeExpected(e.target.checked)}
            />
            include expected ({counts.expected})
          </label>
          <label>
            sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="loc">duplicated LOC</option>
              <option value="sites">site count</option>
            </select>
          </label>
          <label>
            kind
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            >
              <option value="all">all</option>
              <option value="exact">exact ({counts.exact})</option>
              <option value="near">near ({counts.near})</option>
              <option value="jsx">jsx ({counts.jsx})</option>
            </select>
          </label>
          {hasNear && (
            <label>
              min similarity {minSimilarity > 0 ? `${minSimilarity}%` : "off"}
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minSimilarity}
                onChange={(e) => setMinSimilarity(Number(e.target.value))}
                title="filters NEAR findings only; exact clones always shown"
              />
            </label>
          )}
          <label>
            path filter
            <input
              type="text"
              placeholder="substring of a site path…"
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
            />
          </label>
          <label>
            min sites
            <input
              type="number"
              min={2}
              value={minSites}
              onChange={(e) =>
                setMinSites(Math.max(2, Number(e.target.value) || 2))
              }
            />
          </label>
        </div>

        {filtered.length === 0 ? (
          <EmptyState>No clone class matches the current filters.</EmptyState>
        ) : (
          <>
            <div className="clone-list">
              {visible.map((cc) => (
                <ClusterCard
                  key={cc.id}
                  cc={cc}
                  targetRoot={targetRoot}
                  memberRoots={memberRoots}
                />
              ))}
            </div>
            {capped && (
              <div className="clone-more">
                <span className="mono" style={{ color: "var(--fg-dim)" }}>
                  Showing the first {VISIBLE_CAP} of {filtered.length} matching
                  classes (capped for performance).
                </span>
                <Button onClick={() => setShowAll(true)}>
                  Show all {filtered.length}
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
