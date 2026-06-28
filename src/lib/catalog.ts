// WP5 Phase 4 — the CONFIG CATALOG, as the frontend sees it. These TS types mirror
// the Rust `Catalog` assembled in `crates/cli/src/catalog.rs` (and re-exported by
// the Tauri `config_catalog` command in `ui/src-tauri/src/main.rs`): every rule id
// the engine can emit (+ description + default-enabled + tier) and every `ddc.toml`
// config key (+ coarse value_type + plain-language help + default literal + owning
// section). The catalog is the single source of truth that drives the schema-driven
// config builder, so a rule/key change in the engine flows through to the UI.


/** One catalogued rule (mirrors Rust `CatalogRule`). */
export interface CatalogRule {
  /** The stable engine rule id (e.g. `"orphan-file"`). */
  id: string;
  /** A concise plain-language sentence describing what the rule flags. */
  description: string;
  /** `true` iff the rule runs on a default (offline, no `ddc.toml`) scan. */
  default_enabled: boolean;
  /** A coarse grouping label (which engine layer owns the rule), or null. */
  tier: string | null;
  /** WP20: base severity band for this rule (e.g. `"medium"`). */
  severity: string;
}

/** Coarse value-type labels the catalog uses. Anything not in this set is treated
 *  as a scalar text input by the builder. `"table[]"` keys are table-arrays
 *  ([[member]], [[architecture.layer]], …) — advanced, seeded from auto-detect. */
type CatalogValueType = "bool" | "string" | "string[]" | "table[]" | string;

/** One catalogued `ddc.toml` config key (mirrors Rust `CatalogConfigKey`). */
export interface CatalogConfigKey {
  /** The dotted key path (`"rules.ignore"`, `"architecture.enabled"`, …). */
  key_path: string;
  /** A coarse type label (`"bool"`, `"string"`, `"string[]"`, `"table[]"`). */
  value_type: CatalogValueType;
  /** A plain-language explanation of what the key does. */
  help: string;
  /** How the inert default renders (`"false"`, `"[]"`, `"\".ddc/…\""`). */
  default_literal: string;
  /** The owning `[section]` (or `"(top-level)"` for root scalars). */
  section: string;
}

/** The assembled catalog (mirrors Rust `Catalog`). */
export interface Catalog {
  rules: CatalogRule[];
  config_keys: CatalogConfigKey[];
}

/** A table-array value-type marks an advanced [[section]] key the v1 builder does
 *  not edit inline — it is seeded read-only from the auto-detect output. */
export function isTableArray(key: CatalogConfigKey): boolean {
  return key.value_type === "table[]";
}
