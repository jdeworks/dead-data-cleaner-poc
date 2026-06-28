import type { Finding } from "../types";
import type { EvidenceSite } from "../components/EvidenceLocations";

// evidenceSites (WP06 T2/T3 + WP54 T2) — derive the generic EvidenceLocations
// site list from a finding's untyped `evidence.graph`. Sources today:
//
//   - missing-env-var (P22): `graph.found_in[]` = {file, line, kind, weight, snippet}
//     — the unified "found in N places" payload (code reads + doc mentions). When the
//     older `used_at[]` is the only shape present, fall back to it.
//   - missing-dependency (P18/T5 → T3 display): `graph.import_site` = {file, line, text}
//     — the exact undeclared import statement, rendered as a single site.
//   - doc/source evidence: generic `source_*` / `evidence_*` location payloads.
//   - architecture-violation: `graph.offending_imports[]` source files, currently
//     file-start fallbacks because the engine does not emit import spans yet.
//
// All reads are defensive (the graph is `Record<string, unknown>`): a malformed/absent
// payload yields an empty list and the viewer simply doesn't render.

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asNum(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function spanStart(v: unknown): number | undefined {
  const obj = asObj(v);
  if (!obj) return undefined;
  return asNum(obj.start_line) ?? asNum(obj.startLine) ?? asNum(obj.line);
}

function siteFromObj(o: Record<string, unknown>): EvidenceSite | null {
  const file =
    asStr(o.file) ??
    asStr(o.path) ??
    asStr(o.source_file) ??
    asStr(o.sourceFile) ??
    asStr(o.source_path) ??
    asStr(o.sourcePath);
  const line =
    asNum(o.line) ??
    asNum(o.start_line) ??
    asNum(o.startLine) ??
    spanStart(o.span) ??
    spanStart(o.location);
  if (!file) return null;
  return {
    file,
    line: line ?? 1,
    kind: asStr(o.kind),
    weight: asStr(o.weight),
    // env found_in uses `snippet`; import_site uses `text` (the statement).
    snippet: asStr(o.snippet) ?? asStr(o.text) ?? asStr(o.statement),
    fallbackToFileStart: line == null,
    fallbackLabel:
      line == null ? "No source span in this finding; showing file start." : undefined,
  };
}

function pushSite(
  out: EvidenceSite[],
  item: unknown,
  defaults: Partial<Pick<EvidenceSite, "kind" | "snippet" | "fallbackLabel">> = {},
) {
  const obj = asObj(item);
  if (!obj) return;
  const s = siteFromObj(obj);
  if (!s) return;
  out.push({
    ...s,
    kind: s.kind ?? defaults.kind,
    snippet: s.snippet ?? defaults.snippet,
    fallbackLabel: s.fallbackLabel ?? defaults.fallbackLabel,
  });
}

export function evidenceSitesForFinding(finding: Finding): EvidenceSite[] {
  const g = finding.evidence.graph;
  const out: EvidenceSite[] = [];

  // 1) The unified env "found in N places" payload.
  const foundIn = g.found_in;
  if (Array.isArray(foundIn)) {
    for (const item of foundIn) {
      pushSite(out, item);
    }
  } else if (Array.isArray(g.used_at)) {
    // Fallback for an older env payload without found_in.
    for (const item of g.used_at) {
      pushSite(out, item, { kind: "code-ref" });
    }
  }

  // 2) missing-dependency import line (single site).
  const importSite = g.import_site;
  if (importSite && typeof importSite === "object") {
    pushSite(out, importSite, { kind: "import" });
  }

  // 3) Generic evidence/source site payloads used by doc and architecture rules.
  for (const key of [
    "source_site",
    "source_location",
    "source",
    "evidence_site",
    "evidence_location",
    "location",
    "site",
  ]) {
    pushSite(out, g[key], { kind: "source" });
  }

  for (const key of ["source_sites", "source_locations", "evidence_sites", "evidence_locations"]) {
    const value = g[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) pushSite(out, item, { kind: "source" });
  }

  // 4) architecture-violation: the engine names offending import file pairs but
  // does not yet include import spans, so show each source file at file start and
  // label the fallback explicitly.
  if (Array.isArray(g.offending_imports)) {
    for (const item of g.offending_imports) {
      const obj = asObj(item);
      const fromFile = obj ? asStr(obj.from_file) ?? asStr(obj.fromFile) : undefined;
      if (!fromFile) continue;
      const toFile = asStr(obj?.to_file) ?? asStr(obj?.toFile);
      out.push({
        file: fromFile,
        line: 1,
        kind: "violating import",
        snippet: toFile ? `imports ${toFile}` : undefined,
        fallbackToFileStart: true,
        fallbackLabel: "No import span in this finding; showing file start.",
      });
    }
  }

  return out;
}
