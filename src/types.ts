// Data contract for `ddc --json`. Single source of truth so the future
// Tauri (M9b) bindings can align against these shapes.

export type DeterminismTier =
  | "deterministic"
  | "detect-deterministic-interpret-ai"
  | "ai";

export type Gating = "ci-blocking" | "advisory-only";

export interface Span {
  start_line: number;
  end_line: number;
}

export interface Target {
  kind: string; // "file" | "symbol" | "dependency" | "doc" | ...
  node_id: string;
  path: string; // file path OR a non-path identifier (e.g. a dependency name)
  span: Span | null;
}

export interface Multiplier {
  name: string;
  factor: number;
  detail: string;
}

// WP18: vary_kind on per-run entries in a near-clone unify payload.
// Lives under `evidence.graph.unify.varying[]` for near-clone findings.
export type VaryKind = "trivial_rename" | "param_opportunity";

export interface UnifyVaryingRun {
  site_index: number;
  start_line: number;
  end_line: number;
  // WP18 (T2): optional alpha-rename classification — present when the engine
  // could pair the runs across the two sites; absent for asymmetric run counts.
  vary_kind?: VaryKind;
}

export interface Evidence {
  reason: string;
  base_prior: number;
  multipliers: Multiplier[];
  graph: Record<string, unknown>;
}

export interface Impact {
  metric: string; // "loc" | "bytes" | ...
  value: number;
}

export interface Finding {
  id: string;
  rule: string;
  confidence: number; // 0-100
  determinism_tier: DeterminismTier;
  gating: Gating;
  target: Target;
  evidence: Evidence;
  impact: Impact;
  run_id: string;
  /** WP20: engine-computed severity band. Present on WP20+ reports; absent on
   *  older stored runs (the UI's severityOf helper recomputes it for those). */
  severity?: string; // "info"|"low"|"medium"|"high"|"critical"
}

export interface CognitiveRow {
  file: string;
  name: string;
  line: number;
  loc: number;
  cognitive: number;
  nesting: number;
  params: number;
}

export interface Metrics {
  files: number;
  total_loc: number;
  total_tokens: number;
  total_functions: number;
  clone_classes: number;
  cloned_tokens: number;
  duplication_ratio: number;
  /** Production-only duplication ratio (excludes all-test clone classes).
   * Present in engine output since the test-overlap classification pass.
   * Falls back to `duplication_ratio` when absent (older reports). */
  prod_duplication_ratio?: number;
  min_tokens: number;
  exact: boolean;
  parse_failures: number;
  top_by_cognitive: CognitiveRow[];
  top_by_loc: CognitiveRow[];
}

export interface RunSummary {
  files?: number;
  nodes?: number;
  edges?: number;
  findings?: number;
  [k: string]: unknown;
}

export interface Run {
  id: string;
  ruleset_hash: string;
  summary: RunSummary;
  target_root: string;
  timestamp: string;
}

// A single 🔴 AI per-finding fix proposal (advisory). `id` is the deterministic
// finding id it addresses (always one the analyzer actually emitted — the engine
// drops any id the model invents); `action` is a short imperative fix; `detail` is
// the concrete how. Emitted under `ai_interpretation.fixes` when the AI layer is on.
export interface FixProposal {
  id: string;
  action: string;
  detail: string;
}

// Optional AI layer — only present when the AI layer is enabled. Tier 🔴: advisory,
// non-deterministic. `summary` is the triage text; `note` is a degradation reason
// (e.g. the `claude` CLI was missing/failed) shown instead of (or alongside) it;
// `backend` is the backend identifier (e.g. "claude-cli"); `fixes` is the optional
// per-finding fix-proposal list.
export interface AiInterpretation {
  summary?: string;
  note?: string;
  backend?: string;
  tier?: string;
  advisory?: boolean;
  deterministic?: boolean;
  fixes?: FixProposal[] | null;
  [k: string]: unknown;
}

// M11 multi-folder project model — emitted under `project_model` when a
// multi-member (client/service) model is detected or configured. Absent for a
// single-repo run.
export interface ProjectMember {
  path: string;
  ecosystem: string;
  role: string; // "service" | "client" | bare ecosystem label
  present?: boolean;
}
export interface ProjectLink {
  client: string;
  service: string;
}
export interface ProjectModel {
  members: ProjectMember[];
  links: ProjectLink[];
  source: string; // "manifest" | "--accept-detected-model" | ...
  confirmed: boolean;
  cross_layer_active: boolean;
}

// M11 cross-layer summary — emitted under `cross_layer` when the cross-layer pass
// ran (a confirmed, active client↔service model). Counts only; the findings flow
// through the `findings` array. Optional fields appear only when their pass ran.
export interface CrossLayerSummary {
  routes: number;
  resolved_calls: number;
  matched: number;
  missing_route: number;
  unused_endpoint_candidates: number;
  allowlisted: number;
  abstained_absent_service: number;
  dynamic_calls: number;
  external_calls: number;
  over_fetched?: number;
  over_fetch_abstained?: number;
  har_corroborated?: number;
  symbol_bound?: number;
}

// Phase 2b — whole-stack reachability/serves graph, emitted under `graph` only
// when `ddc --graph` is passed. A focused, node-centric trace explorer consumes
// this (see TraceTree). Node `id` formats: `file:<path>`,
// `route:<member>:<METHOD>:<path>`, `call:<file>:<line>:<METHOD>:<path>`.
// Edge `kind`: "imports" (file→file) or "serves" (call→route). Edges are
// referentially complete (every endpoint id exists as a node) and sorted.
export type GraphNodeKind = "file" | "route" | "call" | "doc" | "symbol";

export interface GraphSpan {
  start_line: number;
  end_line: number;
}

export type CallResolution =
  | "Literal"
  | "ConstantFolded"
  | "Dynamic"
  | "External"
  | "SymbolRef";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  // file
  label?: string;
  path?: string; // present on file + route + call + doc nodes
  reachable?: boolean;
  orphan?: boolean;
  // route + call
  method?: string;
  member?: string; // route only
  operation_id?: string; // route only, when declared
  file?: string; // route + call: source file
  line?: number; // call + route (if available)
  span?: GraphSpan; // route and call, when exact span is available
  resolution?: CallResolution; // call only
  symbol?: string | null; // call only (string for SymbolRef target, else null)
  // doc (WP14) — space metrics; present only on doc nodes when --inventory data available
  bytes?: number;
  loc?: number;
  tokens?: number;
  // symbol
  rule?: string;
  confidence?: number;
  gating?: Gating;
  exported?: boolean;
  callable?: boolean;
  deadness?: "used" | "unused-export" | "could-be-local" | "dead-subtree" | "unknown";
}

export type GraphEdgeKind = "imports" | "serves" | "references" | "defines" | "uses";

export interface GraphEdge {
  src: string;
  dst: string;
  kind: GraphEdgeKind;
}

// One seeded entry point (P12): the `file:` node it maps to, its path, and the
// WHY reason it was seeded — e.g. "filename-convention", "html-script-src",
// "package-json-entrypoint", "package-json-script", "workspace-entrypoint",
// "vite-setup-file", "nextjs-route" (JS/TS) or "pyproject-script",
// "launch-target", "alembic-migration", "launch-module", "test-entry",
// "dunder-main" (Python). `node_id` joins to the matching file node.
export interface GraphEntry {
  node_id: string;
  path: string;
  why: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  entries?: GraphEntry[]; // P12: seeded entry points + their WHY (only with --graph)
}

// Scan log / inventory — emitted under `scan_inventory` (additive). Accounts for
// every file the gitignore-aware walk saw: which were SCANNED (one `files` row
// each, with the WHY a file was treated as an artifact or failed to parse) vs
// which were EXCLUDED by the standard .gitignore/hidden filters (never analyzed).
export type ScanCategory =
  | "source"
  | "doc"
  | "data"
  | "config"
  | "other"
  | "artifact";

export type ScanInventoryLocMetric = "lines" | "unknown";

export interface ScanInventoryFile {
  path: string;
  category: ScanCategory;
  lang?: string; // omitted for non-source files
  bytes: number;
  loc_metric?: ScanInventoryLocMetric;
  loc: number;
  tokens: number;
  parse_failed: boolean;
  reason?: string; // "oversized" | "minified" | "generated-dir" — only on artifacts
  // WP4 (P9d): the graph entry-seed reason for this file when it was seeded as an
  // entry ("test-entry", "launch-module", "filename-convention", …). Omitted for
  // non-entry files. Additive/optional.
  entry_reason?: string;
  // WP4 (P9d): derived presentational role — "test" iff entry_reason ===
  // "test-entry", else omitted. The UI can badge test files directly off this.
  role?: string;
}

// WP4 (P9 b/c/d): one detected test framework — emitted under
// `detected_test_frameworks` (additive, only when at least one was detected).
// `declared_dependency` is true when a manifest dependency implied it (vs only a
// root config file / source convention). Frameworks: pytest, jest, vitest, go,
// cargo.
export interface DetectedTestFramework {
  name: string;
  declared_dependency: boolean;
}
export interface ScanInventoryExcluded {
  path: string;
  // Why the default walk dropped it. Known engine values (P10): "hidden"
  // (dotfile / hidden entry), "gitignore" (.gitignore / git exclude rule),
  // "ddc-ignore" (.ignore/.rgignore rule), or the "gitignored-or-hidden"
  // fallback when no single filter explains it. Kept as `string` for
  // forward-compat (the UI may further refine display, e.g. ".env" → env-file).
  reason: string;
}
export interface ScanInventory {
  summary: Record<string, number>;
  files: ScanInventoryFile[];
  excluded: ScanInventoryExcluded[];
}

// Origin flow rows — emitted under `origins` (additive, only with `--graph`).
// Each row traces one frontend field read back to its backend definition via the
// (method, path) join + the learned/declared renamed-as edge. Already sorted +
// deduped by the engine. `renamed` is true iff the chain crossed a renamed-as
// edge (frontend_name differs from the wire/backend name). Advisory.
export interface OriginRow {
  client: string;
  service: string;
  frontend_name: string;
  wire_name: string;
  backend_field: string;
  model: string;
  renamed: boolean;
  route_method: string;
  route_path: string;
  // The frontend READ PATH this origin resolved from, rendered dotted with `[]`
  // element markers (e.g. `items[].title`). Present ONLY for a NESTED read under a
  // sub-model; OMITTED for a ROOT read (flat — the read is directly on the response
  // object, so the path is just `frontend_name` and the engine skips the key).
  // Optional so older reports (no nested tracing) still typecheck.
  path?: string;
}

// Architecture (drift) model — emitted under `architecture` only when the opt-in
// declared-architecture analyzer ran. Describes the declared module/layer
// architecture (layers + allowed edges) versus the ACTUAL observed dependency
// graph (actual_edges). `violations` are actual layer→layer imports the declared
// architecture forbids (the drift); `unrealized` are declared edges nothing
// actually uses. The per-violation WHY (the concrete offending file imports)
// lives on the matching `architecture-violation` finding's `evidence.graph`.
// Advisory only — the declared architecture is a human judgement. Absent for a
// run without the analyzer; the view degrades gracefully.
export interface ArchLayer {
  name: string;
  globs: string[];
  file_count: number;
}
export interface ArchEdge {
  from: string;
  to: string;
}
export interface ArchActualEdge {
  from: string;
  to: string;
  count: number;
}
export interface ArchViolation {
  from: string;
  to: string;
  count: number;
}
export interface ArchitectureModel {
  layers: ArchLayer[];
  allowed_edges: ArchEdge[];
  actual_edges: ArchActualEdge[];
  violations: ArchViolation[];
  unrealized: ArchEdge[];
}

// ── WP35/WP36: extension UI contributions (the additive `report.extensions` section) ──
// Emitted ONLY when at least one extension reached `Loaded` status. Absent for a
// no-extension report → the whole report (and UI) is byte-identical to before.

/** One loaded/failed/untrusted extension row (mirrors `ext::LoadedExtension`). The
 *  `status` is a tagged-enum object: `{ status: "loaded" }` / `{ status: "failed",
 *  reason }` / `{ status: "untrusted" }`. */
export interface ExtensionRow {
  id: string;
  path: string;
  source: string;
  content_hash: string;
  version: string;
  status: { status: "loaded" | "untrusted" | "failed"; reason?: string };
}

/** An extension-contributed VIEW (FilterSpec preset + nav placement, §4.5/H2). */
export interface ExtensionView {
  /** Namespaced id `x/<ext>/<view>` (the nav SubId). */
  id: string;
  ext_id: string;
  label: string;
  /** Existing GroupId (e.g. "findings") or the default "extensions" group. */
  nav_group: string;
  /** The literal FilterSpec preset (camelCase wire form), or null. */
  filter: Partial<FilterSpecWire> | null;
  /** Optional namespaced dashboard id to render above the table. */
  dashboard?: string | null;
}

/** The camelCase FilterSpec wire form an extension view carries (a subset of the
 *  UI's full FilterSpec; all fields optional). */
export interface FilterSpecWire {
  groups: string[];
  rules: string[];
  minSeverity: string;
  minCertainty: number;
  gating: Gating;
  pathContains: string;
}

export type ExtensionPanelKind =
  | "stat"
  | "bar"
  | "donut"
  | "table"
  | "markdown"
  | "treemap";

/** One host-evaluated panel: definition fields + the COMPUTED rows. */
export interface ExtensionPanel {
  kind: ExtensionPanelKind;
  title: string;
  columns: string[];
  /** Shape depends on kind: stat → [{value}]; bar/donut → [{label,value}];
   *  table → [{<col>: value, "@reveal": {path, span?}}]; markdown → []. */
  rows: Record<string, unknown>[];
  body?: string | null;
}

/** One host-evaluated dashboard (definition + computed panel rows). */
export interface ExtensionDashboard {
  id: string; // namespaced `x/<ext>/<dashboard>`
  ext_id: string;
  title: string;
  panels: ExtensionPanel[];
}

/** WP36: one export target contributed by a loaded extension. */
export interface ExtensionExportTarget {
  /** Namespaced id: `x/<ext-id>/<local-id>` */
  id: string;
  /** The extension that contributed this target. */
  ext_id: string;
  /** Human label (e.g. "SARIF 2.1"). */
  label: string;
  /** Suggested filename (e.g. "ddc.sarif"). */
  filename: string;
  /** False when the template failed to load at registration time. */
  available: boolean;
  /** Load error message (when available === false). */
  error?: string | null;
}

/** The additive `extensions` section of a ddc report (WP30 core + WP31/35/36). */
export interface ExtensionsSection {
  extension_hash: string;
  extensions: ExtensionRow[];
  conflicts: { id: string; source: string }[];
  /** Severity/group overlay: namespaced-rule-id → { group, severity, ext_id, … }. */
  overlay: Record<string, { group: string; severity: string; ext_id: string; description?: string }>;
  /** WP31 (H7): catalog rows contributed by loaded extensions. */
  catalog_rules: unknown[];
  views: ExtensionView[];
  dashboards: ExtensionDashboard[];
  /** WP36 (H8): export targets contributed by loaded extensions. */
  export_targets: ExtensionExportTarget[];
}

// WP42 — cross-service grouping eligibility. One group per detected compose
// service cluster; `eligible` groups are the ones WP43 emits findings for;
// `withheld` groups show a CTA ("confirm to enable cross-service analysis").
// Emitted under `service_groups` ONLY when ≥2 services are detected (additive).
export interface ServiceGroupEntry {
  services: string[];
  confidence: "confident" | "unconfirmed";
  eligibility: "auto-confirmed" | "user-confirmed" | "withheld";
  eligible: boolean;
  /** CTA copy the UI surfaces for a withheld group; null when eligible. */
  cta: string | null;
}

export interface ServiceGroups {
  has_eligible: boolean;
  has_withheld: boolean;
  groups: ServiceGroupEntry[];
}

// WP-SESS-2: Session message and sessions data types.

export interface SessionMessage {
  id: string;
  source: string;      // "claude-code"
  timestamp: string;   // ISO 8601 UTC
  session_id: string;
  branch: string;
  text: string;
  occurrences: number; // 1 normally; >1 if collapsed duplicate
  note?: string;
}

export interface SessionsData {
  generated_at: string;
  sources: string[];
  window: { mode: string; days?: number };
  messages: SessionMessage[];
}

export interface DdcReport {
  findings: Finding[];
  metrics: Metrics;
  run: Run;
  /** WP35: extension UI contributions. Present only when ≥1 extension loaded. */
  extensions?: ExtensionsSection;
  ai_interpretation?: AiInterpretation;
  project_model?: ProjectModel;
  cross_layer?: CrossLayerSummary;
  graph?: GraphData;
  scan_inventory?: ScanInventory;
  origins?: OriginRow[];
  architecture?: ArchitectureModel;
  // WP4 (P9 b/c/d): the test frameworks the repo uses (additive; present only when
  // at least one was detected).
  detected_test_frameworks?: DetectedTestFramework[];
  // WP5.3.2: the per-member absolute roots for a MULTI-root run, keyed by member-id
  // slug (`{ "<member_id>": "<abs_root>" }`). Present ONLY in multi-root mode; in
  // that mode every on-disk finding path is `"<member_id>/<rel>"` and `run.target_root`
  // is the `<multi-root>` sentinel. The reveal join (`revealForFinding`) uses this map
  // to turn a prefixed path back into an absolute file path. Absent (undefined) for a
  // single-root report, which stays byte-identical to before.
  member_roots?: Record<string, string>;
  /** WP42: cross-service grouping eligibility. Additive — absent for single-repo. */
  service_groups?: ServiceGroups;
  /** WP-SESS-2: session messages extracted from AI coding tool logs. Additive. */
  sessions?: SessionsData;
}
