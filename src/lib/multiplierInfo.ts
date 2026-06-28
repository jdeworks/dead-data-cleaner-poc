// WP25 T2 — per-multiplier "why demoted / how to verify" hints.
//
// Keyed by the multiplier `name` field (the stable string emitted by the engine).
// For demotions (factor < 1) the hint explains what would raise confidence.
// For boosts (factor ≥ 1) the hint explains what the confirming signal is.
// Unknown names fall back to GENERIC_MULTIPLIER_HINT.
//
// Names were enumerated by:
//   grep -rn "Multiplier {" crates/ -A 2 | grep "name:" | sed 's/.*name: "\([^"]*\)".*/\1/' | sort -u
// plus dynamic names found in doc_similarity (tfidf-confirms, recency-section-blame-available,
// embed-confirms, embed-weakly-confirms) and freshness (relatively-old, stale-naming).

interface MultiplierHintEntry {
  /** Shown when factor < 1 (demotion) — what would lift the demotion. */
  demotion: string;
  /** Shown when factor ≥ 1 (boost) — what this confirming signal means. */
  boost: string;
}

const MULTIPLIER_HINTS: Record<string, MultiplierHintEntry> = {
  // ── Orphan / alias resolution ─────────────────────────────────────────────

  "alias-resolution-incomplete": {
    demotion:
      "Declare your tsconfig path aliases or module aliases in ddc.toml so the resolver can prove reachability — this demotion lifts when alias resolution completes.",
    boost: "Alias resolution completed successfully — all aliases are resolved.",
  },

  "orphan-resolution-incomplete": {
    demotion:
      "The resolver could not trace all reachability edges (e.g. dynamic imports or unresolved aliases). Providing more alias / path configuration in ddc.toml improves coverage.",
    boost:
      "Orphan resolution completed — all reachability edges were traced.",
  },

  // ── Cross-reference (closed-monolith) ────────────────────────────────────

  "closed-monolith": {
    demotion:
      "The closed-monolith signal did not fire (multiple clients or dynamic calls present).",
    boost:
      "Exactly one fully-static client links this service with no dynamic or external calls — a closed monolith, so an unused endpoint is strongly confirmed.",
  },

  // ── Symbol-level demotions ────────────────────────────────────────────────

  "closed-module-zero-inbound": {
    demotion:
      "The module has no inbound imports at all, reducing confidence that the export is genuinely dead. Verify the module is not dynamically required or lazy-loaded.",
    boost:
      "The module has at least one inbound import, confirming the symbol is reachable from outside.",
  },

  "closed-symbol-zero-importers": {
    demotion:
      "No other symbol in the graph imports this symbol, but the absence could be due to dynamic or reflective access. Verify no runtime reflection or dynamic require is involved.",
    boost: "The symbol has importers in the resolved graph.",
  },

  "multi-caller-or-nested-scope": {
    demotion:
      "The symbol has multiple callers or appears in a nested scope, reducing certainty. Review the evidence graph to confirm which call sites are live.",
    boost:
      "Multiple callers or a nested scope confirmed this symbol is in use.",
  },

  "single-caller-direct-access": {
    demotion:
      "Only one direct caller was found, which may indicate the symbol could be inlined. Verify whether the caller is also dead.",
    boost: "A single direct caller was found, confirming the symbol is used.",
  },

  "transitively-dead": {
    demotion:
      "The symbol is only reachable from other symbols that are themselves potentially dead — confidence is lower because the chain may be wrong.",
    boost:
      "This symbol is in a confirmed live call chain.",
  },

  // ── Cross-reference demotions ────────────────────────────────────────────

  "no-matching-route-resolved-literal": {
    demotion:
      "The call site could not be matched to a concrete route literal — the URL may be dynamic or parameterized. Verify the route pattern in the backend.",
    boost: "The call site was matched to a concrete route literal.",
  },

  "template-unified": {
    demotion:
      "The call URL was inferred by unifying template patterns, which may introduce false matches — or the clone was matched via template unification. Inspect the evidence graph for the specific template.",
    boost:
      "A template unification matched this call to a backend route or confirmed a near-clone pattern.",
  },

  "unresolved-calls-present": {
    demotion:
      "Some frontend calls could not be resolved (dynamic URLs or wrapper functions). Declare custom HTTP wrappers in [[crossref.http_wrappers]] to improve call coverage.",
    boost: "All frontend calls in scope were resolved.",
  },

  "multiple-ref-sites": {
    demotion:
      "Multiple reference sites were found, increasing uncertainty about which is authoritative. Review the evidence graph.",
    boost: "Multiple reference sites confirmed the finding.",
  },

  // ── Unused dependency ─────────────────────────────────────────────────────

  "config-or-runtime-usage-possible": {
    demotion:
      "The package may be required by a config file, build plugin, or runtime loader not captured by the static import graph. Verify by searching for the package name in config and build files.",
    boost: "No config/runtime usage path was found — the package appears genuinely unused.",
  },

  "import-name-vs-distribution-name": {
    demotion:
      "The package's import name differs from its distribution name (e.g. `lodash` vs `@types/lodash`). This may be a false positive; verify the declared package is the one being imported.",
    boost: "The import name and distribution name match.",
  },

  // ── Duplication demotions / boosts ────────────────────────────────────────

  "structural-data-clone": {
    demotion:
      "The cloned region looks like structured data (object literals, arrays) rather than logic. Data clones are common and may be intentional — review before extracting.",
    boost:
      "The clone was confirmed as a logic clone rather than structured data.",
  },

  "test-boilerplate-clone": {
    demotion:
      "The clone is in test boilerplate (setup/teardown patterns), which is often intentionally repeated. Consider whether extraction would actually improve maintainability.",
    boost: "This clone appears to be non-boilerplate logic.",
  },

  // ── Cruft boosts ─────────────────────────────────────────────────────────

  "cruft-dir-match": {
    demotion:
      "Confidence was adjusted because the directory name matches a typical output/scratch pattern. Verify the file is not legitimately tracked output.",
    boost:
      "The file is in a directory matching a known output/scratch pattern (e.g. checkpoints/, runs/, tmp/).",
  },

  "data-binary-ext": {
    demotion:
      "Confidence was adjusted because the file extension is associated with binary data. Verify this is not a tracked asset.",
    boost: "The file extension indicates binary/data content (.npy, .pkl, .bin, etc.).",
  },

  "large-size": {
    demotion:
      "Confidence was adjusted for file size — very large files are treated more conservatively. Verify the file is not a legitimate tracked artifact.",
    boost: "The file exceeds the size threshold for likely stray data (> threshold MiB).",
  },

  "stale-naming": {
    demotion:
      "Confidence was adjusted because the path contains a staleness token (old/bak/deprecated/legacy). Verify the file is truly stale.",
    boost: "The path contains a staleness token (old/bak/deprecated/legacy/…).",
  },

  "ambiguous-data-dir": {
    demotion:
      "The file is in a `data/` or `datasets/` directory, which may hold both input data and stale output. Lower confidence because it could be legitimate input.",
    boost: "The file is in a clear output data directory.",
  },

  "code-referenced": {
    demotion:
      "A tracked source file reads this path — confidence is significantly lower because the file may be intentional input data. Verify whether the reference is live.",
    boost: "No tracked source file references this path.",
  },

  // ── Doc-similarity boosts ─────────────────────────────────────────────────

  "tfidf-confirms": {
    demotion:
      "TF-IDF similarity is below the confirmation threshold. The documents may share boilerplate rather than substantive content.",
    boost:
      "TF-IDF term-frequency cosine similarity ≥ 0.55 confirms substantial content overlap beyond boilerplate.",
  },

  "recency-section-blame-available": {
    demotion:
      "Section-level blame data is unavailable — confidence in the staleness signal is reduced.",
    boost:
      "Git blame data for sections is available and was used to assess recency — the older doc's sections post-date the newer one, indicating content drift.",
  },

  "embed-confirms": {
    demotion:
      "Embedding cosine similarity is below the strong threshold. Documents may differ semantically despite token overlap.",
    boost:
      "model2vec embedding cosine ≥ 0.80 confirms strong semantic similarity — the documents cover the same topic.",
  },

  "embed-weakly-confirms": {
    demotion:
      "Embedding cosine similarity is below the moderate threshold.",
    boost:
      "model2vec embedding cosine ∈ [0.50, 0.80) provides moderate semantic confirmation — the documents are topically related.",
  },

  // ── Freshness boosts ──────────────────────────────────────────────────────

  "relatively-old": {
    demotion:
      "The file is not significantly older than the rest of the project — staleness confidence is lower.",
    boost:
      "The file's last commit is significantly older than comparable files in the project, confirming likely staleness.",
  },

  // ── Doc-drift boosts ─────────────────────────────────────────────────────

  "looks-like-path": {
    demotion: "The reference does not strongly resemble a file path.",
    boost:
      "The inline-code span contains a slash and a dotted file segment, confirming it looks like a file path reference.",
  },

  // ── Architecture ─────────────────────────────────────────────────────────

  "declared-architecture-deny-by-default": {
    demotion:
      "The architecture rules use deny-by-default; a missing explicit allow for this import lowered confidence. Add an [[architecture.rule]] entry to explicitly allow the dependency if it is intentional.",
    boost:
      "The architecture rule set confirmed this import violates a declared layer boundary.",
  },

  // ── Crossref / over-fetch ────────────────────────────────────────────────

  "doc-mention-only-evidence": {
    demotion:
      "The only evidence is a documentation mention — the field may be used in code that was not statically traced. Verify by searching for the field name in frontend source.",
    boost: "Code-level evidence confirmed this field is referenced.",
  },

  "example-only-declaration": {
    demotion:
      "The field appears only in example or test declarations, not in production response models. Lower confidence because examples may not reflect live API contracts.",
    boost: "The field appears in production response declarations.",
  },

  "mixed-wire-conventions": {
    demotion:
      "Only some fields in the response model mix conventions — the model may be intentionally hybrid. Review each mixed field individually.",
    boost:
      "Multiple response fields confirm mixed naming conventions across the model.",
  },

  // ── Recommendation packs ─────────────────────────────────────────────────

  "advisory-recommendation": {
    demotion:
      "This is an advisory recommendation — it does not indicate a definitive bug, only a pattern worth reviewing.",
    boost:
      "The recommendation pack matched a recognized pattern in the codebase.",
  },

  // ── Online enrichment ────────────────────────────────────────────────────

  "vuln-version-unverified": {
    demotion:
      "The exact installed version could not be verified against the advisory range — confidence is lower. Check the lockfile for the pinned version.",
    boost: "The installed version was verified to fall within the vulnerability range.",
  },

  "source-or-config-ext": {
    demotion:
      "The file extension suggests source or configuration content rather than stray data, reducing confidence.",
    boost: "The file extension confirms binary/data content.",
  },
};

/** Generic fallback hint for multiplier names not in the map. */
const GENERIC_DEMOTION_HINT =
  "A demotion multiplier — see its detail text above; improving the scanner's visibility into this area raises confidence.";
const GENERIC_BOOST_HINT =
  "A confidence boost — this signal confirmed or corroborated the finding.";

/**
 * Return the appropriate hint string for a multiplier, based on whether it is a
 * demotion (factor < 1) or boost (factor ≥ 1). Falls back gracefully for unknown names.
 */
export function getMultiplierHint(name: string, factor: number): string {
  const entry = MULTIPLIER_HINTS[name];
  if (!entry) {
    return factor < 1 ? GENERIC_DEMOTION_HINT : GENERIC_BOOST_HINT;
  }
  return factor < 1 ? entry.demotion : entry.boost;
}

/**
 * The full set of multiplier names covered by this module. Used by the parity test
 * to ensure every engine-emitted name has a hand-authored entry.
 */
export const COVERED_MULTIPLIER_NAMES: readonly string[] = Object.keys(MULTIPLIER_HINTS);
