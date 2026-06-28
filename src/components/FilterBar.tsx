/**
 * FilterBar.tsx — WP20: shared filter bar for the findings table, export (WP21),
 * and cleanup (WP22).
 *
 * Props:
 *   spec      — current FilterSpec (controlled)
 *   onChange  — called with the updated FilterSpec on any change
 *   findings  — the UNFILTERED findings array (used to build group chips + rule list)
 *
 * NOTE: `determinism_tier` is a UI-only filter — it is NOT part of the shared
 * FilterSpec (which mirrors the Rust engine spec). It is rendered here as an extra
 * control and carried as a separate prop (`tier` / `onTierChange`) so WP21/WP22
 * callers can omit it (they don't need it) while FindingsPanel continues to expose it.
 *
 * A1: Named/saved filter presets — saved to localStorage under
 * `ddc:filter-presets:v1` (a JSON array of { name, spec } objects, ordered by save
 * time, max 50 slots). The preset name input + save button appear below the built-in
 * preset row; saved presets are shown as chips with a × delete handle.
 */

import { useState } from "react";
import type { DeterminismTier, Finding } from "../types";
import {
  type FilterSpec,
  type IssueSeverity,
  ISSUE_SEVERITY_ORDER,
  ISSUE_SEVERITY_LABEL,
  CERTAINTY_BANDS,
  groupOf,
  safeCleanupPreset,
  aiPlanEverythingPreset,
  emptyFilterSpec,
} from "../lib/filterSpec";
import { ruleLabel } from "../lib/report";
import { getRuleInfo } from "../lib/ruleInfo";

// ── A1: Named preset persistence ──────────────────────────────────────────────

const PRESETS_LS_KEY = "ddc:filter-presets:v1";
const MAX_SAVED_PRESETS = 50;

interface SavedPreset {
  name: string;
  spec: FilterSpec;
}

/** Load all saved presets from localStorage. Returns [] on error. */
export function loadSavedPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedPreset[];
  } catch {
    return [];
  }
}

/** Persist the full presets array. Silently ignores storage errors. */
function writeSavedPresets(presets: SavedPreset[]): void {
  try {
    localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(presets));
  } catch {
    /* best-effort */
  }
}

/** Save a new preset (or overwrite an existing one with the same name).
 *  Enforces a MAX_SAVED_PRESETS cap by dropping the oldest entries. */
export function savePreset(name: string, spec: FilterSpec): SavedPreset[] {
  const trimmed = name.trim();
  if (!trimmed) return loadSavedPresets();
  const existing = loadSavedPresets().filter((p) => p.name !== trimmed);
  const next = [...existing, { name: trimmed, spec }].slice(-MAX_SAVED_PRESETS);
  writeSavedPresets(next);
  return next;
}

/** Delete a preset by name. */
export function deletePreset(name: string): SavedPreset[] {
  const next = loadSavedPresets().filter((p) => p.name !== name);
  writeSavedPresets(next);
  return next;
}

/** All distinct catalog groups present in the findings, sorted. */
function groupsInFindings(findings: Finding[]): string[] {
  const seen = new Set<string>();
  for (const f of findings) seen.add(groupOf(f.rule));
  return Array.from(seen).sort();
}

/** Count of findings in a given group. */
function countForGroup(findings: Finding[], g: string): number {
  return findings.filter((f) => groupOf(f.rule) === g).length;
}

/** All distinct rule ids in the findings, sorted. */
function rulesInFindings(findings: Finding[]): string[] {
  return Array.from(new Set(findings.map((f) => f.rule))).sort();
}

interface FilterBarProps {
  spec: FilterSpec;
  onChange: (spec: FilterSpec) => void;
  findings: Finding[];
  /** Optional UI-only tier filter (not in FilterSpec). */
  tier?: DeterminismTier | "";
  onTierChange?: (t: DeterminismTier | "") => void;
}

export function FilterBar({
  spec,
  onChange,
  findings,
  tier = "",
  onTierChange,
}: FilterBarProps) {
  const groups = groupsInFindings(findings);
  const rules = rulesInFindings(findings);

  // A1: saved preset state — loaded once on mount, kept in component state.
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>(() => loadSavedPresets());
  const [presetNameInput, setPresetNameInput] = useState<string>("");

  function toggleGroup(g: string) {
    const next = spec.groups.includes(g)
      ? spec.groups.filter((x) => x !== g)
      : [...spec.groups, g];
    onChange({ ...spec, groups: next });
  }

  function handleSavePreset() {
    const name = presetNameInput.trim();
    if (!name) return;
    const next = savePreset(name, spec);
    setSavedPresets(next);
    setPresetNameInput("");
  }

  function handleDeletePreset(name: string) {
    const next = deletePreset(name);
    setSavedPresets(next);
  }

  return (
    <div className="filter-bar">
      {/* Group chips */}
      {groups.length > 0 && (
        <div className="filter-row filter-groups" role="group" aria-label="Filter by group">
          {groups.map((g) => (
            <button
              key={g}
              role="checkbox"
              aria-checked={spec.groups.includes(g)}
              className={`chip group-chip${spec.groups.includes(g) ? " active" : ""}`}
              onClick={() => toggleGroup(g)}
              title={`Group: ${g}`}
            >
              {g} ({countForGroup(findings, g)})
            </button>
          ))}
        </div>
      )}

      <div className="filter-row">
        {/* Min severity select */}
        <label className="filter-control">
          Min severity
          <select
            className="filter-select"
            value={spec.minSeverity}
            onChange={(e) =>
              onChange({ ...spec, minSeverity: e.target.value as IssueSeverity })
            }
          >
            {ISSUE_SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>
                {ISSUE_SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        {/* Gating select */}
        <label className="filter-control">
          Gating
          <select
            className="filter-select"
            value={spec.gating ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...spec,
                gating: v === "" ? undefined : (v as FilterSpec["gating"]),
              });
            }}
          >
            <option value="">all</option>
            <option value="ci-blocking">ci-blocking</option>
            <option value="advisory-only">advisory-only</option>
          </select>
        </label>

        {/* Determinism tier (UI-only — not in FilterSpec) */}
        {onTierChange && (
          <label className="filter-control">
            Tier
            <select
              className="filter-select"
              value={tier}
              onChange={(e) =>
                onTierChange(e.target.value as DeterminismTier | "")
              }
            >
              <option value="">all</option>
              <option value="deterministic">deterministic</option>
              <option value="detect-deterministic-interpret-ai">
                detect→interpret-ai
              </option>
              <option value="ai">ai</option>
            </select>
          </label>
        )}

        {/* Rule (secondary refinement) */}
        <label className="filter-control">
          Rule
          <select
            className="filter-select"
            value={spec.rules?.[0] ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ ...spec, rules: v === "" ? undefined : [v] });
            }}
          >
            <option value="">all</option>
            {rules.map((r) => (
              <option key={r} value={r} title={getRuleInfo(r).description}>
                {ruleLabel(r)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="filter-row">
        {/* Certainty band presets */}
        <span className="filter-control-label">
          Certainty:
        </span>
        {CERTAINTY_BANDS.map((band) => (
          <button
            key={band.minCertainty}
            className={`chip${spec.minCertainty === band.minCertainty ? " active" : ""}`}
            onClick={() => onChange({ ...spec, minCertainty: band.minCertainty })}
          >
            {band.label}
          </button>
        ))}

        {/* Raw 0–100 slider */}
        <label className="filter-control filter-control-range">
          Min confidence: {spec.minCertainty}
          <input
            type="range"
            min={0}
            max={100}
            value={spec.minCertainty}
            onChange={(e) =>
              onChange({ ...spec, minCertainty: Number(e.target.value) })
            }
          />
        </label>

        {/* Path substring */}
        <label className="filter-control">
          Path contains
          <input
            className="filter-input"
            type="text"
            value={spec.pathContains ?? ""}
            placeholder="e.g. app/papers"
            onChange={(e) =>
              onChange({
                ...spec,
                pathContains: e.target.value || undefined,
              })
            }
          />
        </label>
      </div>

      {/* Preset buttons */}
      <div className="filter-row">
        <button
          className="chip"
          onClick={() => onChange(safeCleanupPreset())}
          title="min severity=medium, min confidence=70"
        >
          Safe cleanup
        </button>
        <button
          className="chip"
          onClick={() => onChange(aiPlanEverythingPreset())}
          title="min severity=low, min confidence=40"
        >
          Everything for the cleanup plan
        </button>
        <button
          className="chip"
          onClick={() => onChange(emptyFilterSpec())}
          title="Reset all filters"
        >
          Reset
        </button>
      </div>

      {/* A1: Saved preset chips — apply or delete */}
      {savedPresets.length > 0 && (
        <div className="filter-row filter-saved-presets" role="group" aria-label="Saved filter presets">
          <span className="filter-control-label">
            Saved:
          </span>
          {savedPresets.map((p) => (
            <span
              key={p.name}
              className="chip filter-preset-chip"
            >
              <button
                className="filter-preset-apply"
                onClick={() => onChange(p.spec)}
                title={`Apply preset: ${p.name}`}
                data-testid={`preset-apply-${p.name}`}
              >
                {p.name}
              </button>
              <button
                className="filter-preset-delete"
                onClick={() => handleDeletePreset(p.name)}
                title={`Delete preset: ${p.name}`}
                aria-label={`Delete preset ${p.name}`}
                data-testid={`preset-delete-${p.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* A1: Save current filter as a named preset */}
      <div className="filter-row filter-save-preset-row">
        <input
          type="text"
          className="filter-preset-name-input"
          value={presetNameInput}
          placeholder="Preset name…"
          aria-label="New preset name"
          data-testid="preset-name-input"
          onChange={(e) => setPresetNameInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSavePreset(); }}
        />
        <button
          className="chip"
          onClick={handleSavePreset}
          disabled={!presetNameInput.trim()}
          title="Save current filter as a named preset"
          data-testid="preset-save-btn"
        >
          Save preset
        </button>
      </div>
    </div>
  );
}
