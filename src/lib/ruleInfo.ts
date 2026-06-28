// WP25 T1 — per-rule explainers baked into the UI bundle.
//
// Decision (binding): explainer content is BAKED here, not fetched. The catalog
// command is desktop-only; the browser bundle + dropped-JSON path need explainers
// too. A vitest parity test (ruleInfo.test.ts) pins the baked rule-id list against
// the catalog expectations; drift = failing test.
//
// Source: `crates/cli/src/catalog.rs` (descriptions verbatim), plus the research
// catalogs (`doc-drift-catalog.md`, `staleness-heuristics-catalog.md`) and the
// rule-crate doc comments for whyItAccrues/howToFix/howToPrevent.

interface RuleInfo {
  /** Verbatim from catalog.rs — the concise engine description. */
  description: string;
  /** Why this class of dead data tends to accumulate (1–2 sentences). */
  whyItAccrues: string;
  /** How to address an existing finding (1–2 sentences). "Auto-fixable via Clean up" for fixable rules. */
  howToFix: string;
  /** How to prevent it from coming back (1–2 sentences, naming the concrete artifact). */
  howToPrevent: string;
}

/** The complete per-rule explainer map. Keys are stable engine rule ids. */
const RULE_INFO_MAP: Record<string, RuleInfo> = {
  // ── Core graph / dependency ──────────────────────────────────────────────

  "orphan-file": {
    description:
      "A source file no other tracked file imports or references (unreachable from any entry point).",
    whyItAccrues:
      "Files accumulate when features are deleted piecemeal — callers are removed but the implementation is left behind, or a refactor moves logic without deleting the old module.",
    howToFix:
      "Delete the file (or re-import it if it was accidentally disconnected). Auto-fixable via Clean up for confirmed orphans.",
    howToPrevent:
      "Gate CI on `ddc . --json` exit code (nonzero when ci-blocking findings exist) so new orphans block merges. Add an `[rules].ignore` glob for generated or intentionally standalone files.",
  },

  "unused-dependency": {
    description:
      "A declared package dependency that no code in the project actually imports.",
    whyItAccrues:
      "Dependencies linger when the feature or library they backed is removed without updating the manifest, or when an alternative package is added without removing the old one.",
    howToFix:
      "Remove the entry from `package.json` / `pyproject.toml` / `Cargo.toml` and re-lock. Auto-fixable via Clean up.",
    howToPrevent:
      "Enable this rule in CI; run `ddc --incremental` in a pre-commit hook to catch new unused deps at commit time.",
  },

  "missing-dependency": {
    description:
      "An imported package that is used but not declared in the manifest's dependencies.",
    whyItAccrues:
      "Packages are sometimes available transitively (a dep-of-a-dep) without being listed directly; the import works until the transitive chain changes.",
    howToFix:
      "Add the package as an explicit dependency and re-lock the manifest.",
    howToPrevent:
      "Add this rule to the CI gate; if the package is intentionally runtime-provided (e.g. a peer dep or container injection), add its name to `env.allow` or `rules.ignore`.",
  },

  // ── Symbol-level ─────────────────────────────────────────────────────────

  "unused-export": {
    description:
      "An exported symbol that nothing outside its module ever imports.",
    whyItAccrues:
      "Exports accumulate when a public API shrinks — consumers are deleted but the export declaration stays, or a symbol is exported speculatively and never consumed.",
    howToFix:
      "Drop the `export` keyword (make the symbol module-local) or delete the symbol entirely if it is no longer needed.",
    howToPrevent:
      "Enforce with CI gating; use barrel-file audits on pull requests that modify `index.ts` exports.",
  },

  "could-be-local": {
    description:
      "An exported symbol used only within its own module — it need not be exported.",
    whyItAccrues:
      "Symbols are often exported defensively for future use or testing convenience, then never consumed from outside.",
    howToFix:
      "Remove the `export` keyword; the symbol remains available within its module.",
    howToPrevent:
      "Make module-private by default and export explicitly only at API boundaries. CI gating on this rule keeps the surface minimal.",
  },

  "never-called": {
    description:
      "A defined function or method that is never called anywhere.",
    whyItAccrues:
      "Dead functions survive refactors when callers are removed but the implementation is left in place, or when a function is defined speculatively.",
    howToFix:
      "Delete the function, or move it behind a feature flag if it is intended for future use.",
    howToPrevent:
      "Gate CI on this rule to block adding un-called code. Use `rules.ignore` globs for intentional utility or extension-point stubs.",
  },

  // ── Duplication ───────────────────────────────────────────────────────────

  "duplicate-block": {
    description:
      "A block of code duplicated (near-)verbatim across files — a copy-paste / DRY candidate.",
    whyItAccrues:
      "Copy-paste propagates logic across files when shared abstractions are missing or when contributors are unaware of existing helpers.",
    howToFix:
      "Extract the duplicated logic into a shared helper or module and replace the copies with imports.",
    howToPrevent:
      "Configure `dup.near_clones = true` for broader coverage and gate CI; use code-review checklists for changes that duplicate existing patterns.",
  },

  // ── Cruft ─────────────────────────────────────────────────────────────────

  "untracked-data": {
    description:
      "Local data left in the working tree but not tracked by version control (stray output/scratch data).",
    whyItAccrues:
      "Training runs, evaluation outputs, and scratch data accumulate without a consistent cleanup policy between experiments.",
    howToFix:
      "Delete or archive the file, or add it to `.gitignore` if it should always stay local.",
    howToPrevent:
      "Add output/eval/checkpoint directories to `.gitignore`; use a pre-commit hook that warns on new large untracked data files.",
  },

  "forgot-to-track": {
    description:
      "A file that looks like it should be tracked but was never added to version control.",
    whyItAccrues:
      "New source files are sometimes created and edited without being staged, especially during exploratory work.",
    howToFix:
      "Run `git add` to track the file, or add it to `.gitignore` if it is intentionally local.",
    howToPrevent:
      "Use a pre-commit hook that surfaces unstaged source files, or enable repo-wide file-tracking checks in CI.",
  },

  // ── Freshness ─────────────────────────────────────────────────────────────

  "seems-outdated": {
    description:
      "A file whose content appears stale relative to the rest of the project (long-untouched, likely outdated).",
    whyItAccrues:
      "Long-lived files drift when surrounding code evolves but the file is not updated — often documentation, configuration templates, or helper scripts.",
    howToFix:
      "Review the file against the current state of the project and update or delete it as appropriate.",
    howToPrevent:
      "Gate advisory freshness findings in CI to surface systematic staleness early; assign ownership (CODEOWNERS) to files that must stay current.",
  },

  // ── Doc-drift ─────────────────────────────────────────────────────────────

  "doc-drift": {
    description:
      "A documentation file references code/paths that no longer exist — the docs drifted from the code.",
    whyItAccrues:
      "Docs are updated less frequently than code; references to file paths, function names, or API routes become stale after refactors.",
    howToFix:
      "Update the broken references in the doc to point to the current paths or remove the stale section.",
    howToPrevent:
      "Gate this rule in CI; use relative-path links in docs where possible so renames are caught by `git mv`. Consider a doc-linting step that validates internal links.",
  },

  "orphan-doc": {
    description:
      "A documentation file nothing links to and that is not a conventional entry doc (README/CHANGELOG/…).",
    whyItAccrues:
      "Docs are created for features or designs that are later abandoned or superseded without the doc being removed or linked into the main tree.",
    howToFix:
      "Link the doc from a relevant README or index, archive it, or delete it if it is no longer relevant.",
    howToPrevent:
      "Require every new doc to be linked from at least one other doc at review time. Use `docs.entry_docs` to whitelist intentionally standalone files.",
  },

  // ── Env-var ───────────────────────────────────────────────────────────────

  "dead-env-var": {
    description:
      "An environment variable declared in a config file (.env/compose/CI) but no code reads it.",
    whyItAccrues:
      "Env vars linger in `.env` files and CI configs when the feature they configured is removed without cleaning up the declarations.",
    howToFix:
      "Remove the unused variable from the config file. Verify it is not consumed by a framework implicitly before deleting.",
    howToPrevent:
      "Enable this rule in CI; use `env.ignore` globs for generated or injected env files that should not be scanned.",
  },

  "missing-env-var": {
    description:
      "An environment variable read by code but never declared in any config file (may be runtime-provided).",
    whyItAccrues:
      "Env vars are sometimes added in code without a corresponding `.env.example` entry, or are expected to be injected by the runtime/CI without documentation.",
    howToFix:
      "Add the variable to `.env.example` (or equivalent) with a placeholder value, or add it to `env.allow` if it is always provided by the runtime.",
    howToPrevent:
      "Use `env.allow` to list known runtime-provided vars (CI/cloud platform vars) so new code-side reads of undeclared vars surface immediately in CI.",
  },

  // ── Architecture ──────────────────────────────────────────────────────────

  "architecture-violation": {
    description:
      "A module/layer import that the declared `[architecture]` rules do not allow (deny-by-default drift).",
    whyItAccrues:
      "Layer boundaries erode over time as shortcuts are taken under deadline pressure; without automated enforcement each violation makes the next easier.",
    howToFix:
      "Refactor the import to route through the allowed layer, or add a legitimate `[[architecture.rule]]` entry if the dependency is intentional.",
    howToPrevent:
      "Enable `architecture.enabled = true` and gate CI on this rule so every boundary violation is blocked at merge time.",
  },

  // ── Cross-reference ───────────────────────────────────────────────────────

  "frontend-call-to-missing-route": {
    description:
      "A frontend HTTP call targets a backend route that does not exist (a dangling API reference).",
    whyItAccrues:
      "Frontend calls become dangling when backend routes are renamed, versioned, or deleted without updating the callers.",
    howToFix:
      "Update the frontend call to use the current route path, or restore the backend route if the removal was unintentional.",
    howToPrevent:
      "Gate this cross-layer rule in CI using a `[[link]]` declaration; consumer-driven contract tests (e.g. Pact) catch mismatches at the integration level.",
  },

  "unused-endpoint": {
    description:
      "A backend route no traced frontend caller ever reaches (a possibly-dead endpoint).",
    whyItAccrues:
      "Endpoints accumulate when UI features are removed or refactored without removing the backing API, or when a route was added speculatively.",
    howToFix:
      "Verify that the endpoint is not called from mobile clients, third-party integrations, or external tools before deleting. Use `crossref.external_allow` globs for intentionally external-only routes.",
    howToPrevent:
      "Add the route to `crossref.external_allow` if it is intentionally external-facing (webhooks, health checks). Gate advisory findings in CI to review new endpoints regularly.",
  },

  "over-fetched-response-field": {
    description:
      "A response-model field declared by an endpoint that no frontend caller ever reads (over-fetching).",
    whyItAccrues:
      "Response models grow over time as fields are added for features that are later removed on the frontend, or as shared DTOs include more data than any single caller needs.",
    howToFix:
      "Remove the unused field from the response model or DTO, or move it to a separate endpoint variant.",
    howToPrevent:
      "Enable `crossref.over_fetch = true` and review response shape during API design; prefer field-scoped query parameters (GraphQL, field masks) to avoid over-fetching by construction.",
  },

  "field-name-convention-drift": {
    description:
      "A response model whose wire keys mix snake_case and camelCase (a missing/partial naming convention).",
    whyItAccrues:
      "Convention drift happens when fields are added by contributors from different backgrounds (backend vs frontend) without a shared style guide.",
    howToFix:
      "Pick one convention and rename all fields consistently; update any callers that depend on the old names.",
    howToPrevent:
      "Enable `crossref.convention_drift = true`; enforce a JSON naming convention in code review and document it in the API guidelines.",
  },

  // ── Recommendation packs ──────────────────────────────────────────────────

  "reinvented-wheel": {
    description:
      "Hand-rolled code that re-implements functionality a well-known library already provides.",
    whyItAccrues:
      "Custom implementations are written when contributors are unaware of an existing library, or when the library was not available at the time of writing.",
    howToFix:
      "Replace the custom implementation with the recommended library. Review edge cases to ensure behavior parity.",
    howToPrevent:
      "Enable `packs.reinvented_wheel = true` in CI reviews; maintain a shared catalog of approved libraries for common patterns.",
  },

  "prefer-library": {
    description:
      "A dispreferred library where a recommended substitute exists (a prefer-library suggestion).",
    whyItAccrues:
      "Older or less-maintained libraries persist when they were added before a better option was available, or when contributors use familiar tools.",
    howToFix:
      "Migrate to the recommended substitute; consult the finding's evidence for the specific recommendation and migration guide.",
    howToPrevent:
      "Enable `packs.prefer_library = true`; use `packs.keep` to whitelist libraries the team has decided to retain despite the advisory.",
  },

  // ── Online enrichment ─────────────────────────────────────────────────────

  "deprecated-dependency": {
    description:
      "A dependency the registry reports as deprecated (online enrichment).",
    whyItAccrues:
      "Deprecated packages persist when they were added before the deprecation notice, or when an upgrade is deferred indefinitely.",
    howToFix:
      "Replace the package with the recommended successor listed in the deprecation notice. Check the registry page for migration guidance.",
    howToPrevent:
      "Run `ddc` with `online.enabled = true` in CI to surface registry advisories automatically; subscribe to the package's release feed.",
  },

  "vulnerable-dependency": {
    description:
      "A dependency with a known security advisory / vulnerability (online enrichment).",
    whyItAccrues:
      "Vulnerabilities appear in already-pinned dependencies when a CVE is published after the lockfile was last updated.",
    howToFix:
      "Upgrade to a patched version. If no patch is available, evaluate mitigations or replace the dependency.",
    howToPrevent:
      "Run `ddc` with `online.enabled = true` in CI or use a dedicated SCA tool (Dependabot, Snyk) for continuous monitoring.",
  },

  // ── Doc-symbol-drift ─────────────────────────────────────────────────────

  "doc-symbol-drift": {
    description:
      "A doc chunk references a backtick-quoted symbol name that no longer exists in the codebase, with a near-miss symbol suggesting a rename or deletion.",
    whyItAccrues:
      "Symbol names drift in documentation when functions, constants, or types are renamed during refactors without updating the prose that mentions them by name in backtick spans.",
    howToFix:
      "Update the backtick-quoted name in the doc to match the current symbol name shown in the finding's `near_miss` field.",
    howToPrevent:
      "Gate this advisory rule in CI; review doc backtick spans when renaming symbols. Consider using code-aware doc linters that track identifier references across renames.",
  },

  // ── Doc-similarity ────────────────────────────────────────────────────────

  "similar-doc-pair": {
    description:
      "Two documentation files with substantially overlapping content — one may be a stale copy or a redundant near-duplicate.",
    whyItAccrues:
      "Docs are duplicated when a new document starts as a copy of an existing one and the two diverge without a clear canonical source, or when docs are reorganized without merging overlapping content.",
    howToFix:
      "Merge the two docs into a single canonical file and link or redirect from the other; or clearly differentiate their scope if both are needed.",
    howToPrevent:
      "Review new documentation additions against the existing doc tree; use `docs.entry_docs` to protect intentional root-level docs from being flagged.",
  },
};

/** Generic fallback for rule ids not found in the map (e.g. dynamically-added rules). */
export const GENERIC_RULE_INFO: RuleInfo = {
  description: "A finding from the ddc analysis engine.",
  whyItAccrues:
    "Dead data accumulates incrementally — each small omission in cleanup compounds over time.",
  howToFix:
    "Review the finding's evidence (reason, span, graph) to understand the specific issue; then remove, update, or suppress as appropriate.",
  howToPrevent:
    "Gate CI on `ddc . --json` (nonzero exit on ci-blocking findings) and use `rules.ignore` globs for intentionally accepted patterns.",
};

/**
 * Return the RuleInfo for a rule id. Falls back to the generic entry rather than
 * throwing, so unknown/future rules never crash the UI.
 */
export function getRuleInfo(ruleId: string): RuleInfo {
  return RULE_INFO_MAP[ruleId] ?? GENERIC_RULE_INFO;
}

/**
 * The canonical list of rule ids covered by this module. Used by the parity test
 * to detect drift between this file and `catalog.rs`.
 */
export const COVERED_RULE_IDS: readonly string[] = Object.keys(RULE_INFO_MAP);
