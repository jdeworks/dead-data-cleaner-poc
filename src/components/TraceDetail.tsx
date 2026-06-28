import type { Finding } from "../types";

// Per-rule structured "trace" — turns a finding's `evidence.graph` blob into a
// legible WHAT + WHY so a user can see why we'd flag (and possibly remove) the
// target, not just trust a confidence number. Each renderer reads the graph
// defensively (it's an untyped Record) and degrades to nothing when a key is
// absent; EvidencePanel still shows the raw graph below for power users.

type Graph = Record<string, unknown>;

const asStr = (v: unknown): string | null =>
  typeof v === "string" ? v : null;
const asNum = (v: unknown): number | null =>
  typeof v === "number" ? v : null;
const asArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const asObj = (v: unknown): Graph =>
  v !== null && typeof v === "object" ? (v as Graph) : {};

/** A labelled key/value row. */
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="trace-row">
      <span className="trace-k">{k}</span>
      <span className="trace-v mono">{v}</span>
    </div>
  );
}

/** `over-fetched-response-field`: the declared response model fields with a
 *  read/unread badge each — the over-fetched field is the unread one. */
function OverFetch({ g }: { g: Graph }) {
  const declared = asArr(g.declared_fields);
  const read = new Set(asArr(g.read_fields));
  const field = asStr(g.field);
  return (
    <div className="trace">
      <div className="trace-headline">
        Response model <code>{asStr(g.model)}</code> served by{" "}
        <code>{asStr(g.endpoint)}</code> — frontend reads{" "}
        <strong>{`${read.size} of ${declared.length}`}</strong> declared
        field(s).
      </div>
      <div className="field-grid">
        {declared.map((f) => {
          const isRead = read.has(f);
          const isThis = f === field;
          return (
            <span
              key={f}
              className={`field-chip ${isRead ? "read" : "unread"}${
                isThis ? " focus" : ""
              }`}
              title={isRead ? "read by a caller" : "declared but never read — over-fetched"}
            >
              {`${isRead ? "✓" : "✗"} ${f}`}
            </span>
          );
        })}
      </div>
      <Row k="this finding" v={field ? `${field} (over-fetched)` : null} />
      <Row k="callers traced" v={asNum(g.callers_traced)} />
      <Row k="scope" v={asStr(g.scope)} />
      <div className="trace-why">
        Why: this field is declared by the backend response model but no traced
        caller of this endpoint reads it — a candidate to drop from the response
        (advisory; the field may still be planned).
      </div>
    </div>
  );
}

/** `unused-endpoint`: the route + that it has zero resolvable callers, with the
 *  honest hedge (dynamic calls the static scan can't resolve). */
function UnusedEndpoint({ g }: { g: Graph }) {
  const dynamic = g.client_has_dynamic_calls === true;
  return (
    <div className="trace">
      <div className="trace-headline">
        Route <code>{asStr(g.method)} {asStr(g.path_normalized)}</code> has{" "}
        <strong>0</strong> resolvable frontend callers.
      </div>
      <Row k="handler" v={asStr(g.handler_symbol)} />
      <Row k="response model" v={asStr(g.response_schema)} />
      <div className="trace-chain">
        <span className="node ok">route declared</span>
        <span className="arrow">→</span>
        <span className="node bad">no caller matched (method + path)</span>
      </div>
      <div className="trace-why">
        Why: no resolved frontend call joins this route.{" "}
        {dynamic
          ? "BUT the client has dynamic calls the static scan can't resolve — confidence demoted (any of them could hit this route). Review, don't delete."
          : "Review before removing — external/dynamic/generated callers are invisible to a static scan."}
      </div>
    </div>
  );
}

/** `frontend-call-to-missing-route`: a resolved call that joins no route. */
function MissingRoute({ g }: { g: Graph }) {
  const services = asArr(g.linked_services);
  return (
    <div className="trace">
      <div className="trace-headline">
        Frontend call <code>{asStr(g.method)} {asStr(g.path_normalized)}</code>{" "}
        reaches no backend route.
      </div>
      <Row k="raw url" v={asStr(g.raw_url)} />
      <Row k="in function" v={asStr(g.enclosing_symbol)} />
      <Row k="routes in service" v={asNum(g.routes_in_service)} />
      <Row k="linked service(s)" v={services.join(", ") || null} />
      <div className="trace-chain">
        <span className="node ok">resolved call</span>
        <span className="arrow">→</span>
        <span className="node bad">no route serves (method + path)</span>
      </div>
      <div className="trace-why">
        Why: this call's (method, path) matches no route in the linked
        service(s) — a dangling reference (drift or a typo).
      </div>
    </div>
  );
}

/** `field-name-convention-drift`: a model mixing snake_case + camelCase wire keys. */
function ConventionDrift({ g }: { g: Graph }) {
  const snake = asArr(g.snake_keys);
  const camel = asArr(g.camel_keys);
  return (
    <div className="trace">
      <div className="trace-headline">
        Model <code>{asStr(g.model)}</code> mixes wire-key conventions.
      </div>
      <div className="dual-col">
        <div>
          <div className="col-h">snake_case ({snake.length})</div>
          {snake.map((k) => (
            <span key={k} className="field-chip">{k}</span>
          ))}
        </div>
        <div>
          <div className="col-h">camelCase ({camel.length})</div>
          {camel.map((k) => (
            <span key={k} className="field-chip">{k}</span>
          ))}
        </div>
      </div>
      <div className="trace-why">
        Why: a missing/partial alias_generator leaves the wire shape
        inconsistent — brittle for any rename-aware consumer.
      </div>
    </div>
  );
}

/** `duplicate-block`: the clone-class member sites. */
function DuplicateBlock({ g }: { g: Graph }) {
  const sites = Array.isArray(g.sites) ? g.sites : [];
  return (
    <div className="trace">
      <div className="trace-headline">
        Clone class — <strong>{sites.length}</strong> duplicated site(s).
      </div>
      <div className="field-grid">
        {sites.map((s, i) => {
          const o = (s ?? {}) as Record<string, unknown>;
          const path = asStr(o.path) ?? asStr(o.file) ?? `site ${i + 1}`;
          const line = asNum(o.start_line) ?? asNum(o.line);
          return (
            <span key={i} className="field-chip">
              {path}
              {line !== null ? `:${line}` : ""}
            </span>
          );
        })}
      </div>
      <div className="trace-why">
        Why: these spans are token-for-token (or near) duplicates — candidates to
        unify behind one definition.
      </div>
    </div>
  );
}

/** `orphan-file`: a source file no seeded entry point can reach. The honest
 *  hedge is resolver completeness — an incomplete resolve (no package.json /
 *  leftover unresolved imports) means we can't be sure it's truly dead. */
function OrphanFile({ g }: { g: Graph }) {
  const inbound = asArr(g.inbound_edges);
  const entries = asArr(g.entries_seeded);
  const resolver = asObj(g.resolver);
  const unresolved = asNum(resolver.unresolved_count) ?? 0;
  const foundPkg = resolver.found_package_json === true;
  const incomplete = unresolved > 0 || !foundPkg;
  return (
    <div className="trace">
      <div className="trace-headline">
        Classified <code>{asStr(g.classified_as)}</code> file is{" "}
        <strong>unreachable</strong> from every seeded entry point.
      </div>
      <Row k="inbound edges" v={`${inbound.length} file(s) import it`} />
      {inbound.length > 0 ? (
        <div className="field-grid">
          {inbound.slice(0, 6).map((f) => (
            <span key={f} className="field-chip">{f}</span>
          ))}
          {inbound.length > 6 ? (
            <span className="field-chip">+{inbound.length - 6} more</span>
          ) : null}
        </div>
      ) : null}
      <Row k="entries seeded" v={`${entries.length} searched`} />
      <Row
        k="resolver"
        v={`package.json ${foundPkg ? "✓" : "✗"} · tsconfig ${
          resolver.found_tsconfig === true ? "✓" : "✗"
        } · ${unresolved} unresolved import(s)`}
      />
      <div className="trace-chain">
        <span className="node ok">{entries.length} entry point(s)</span>
        <span className="arrow">→</span>
        <span className="node bad">no path → this file</span>
      </div>
      <div className="trace-why">
        Why: no import path from any seeded entry reaches this file.{" "}
        {incomplete
          ? "BUT resolution was incomplete (missing package.json / unresolved imports) — confidence demoted; don't trust this as hard-dead."
          : "Resolution was complete, so the unreachability is well-grounded — still advisory."}
      </div>
    </div>
  );
}

/** `unused-export`: an exported symbol no other file imports. Hedges on
 *  intra-file refs and on whether resolution actually completed. */
function UnusedExport({ g }: { g: Graph }) {
  const hasRef = g.has_ref_in_file === true;
  const complete = g.resolution_complete === true;
  const useAll = g.reached_via_use_all === true;
  return (
    <div className="trace">
      <div className="trace-headline">
        Exported symbol <code>{asStr(g.symbol)}</code> is imported by{" "}
        <strong>{asNum(g.importers) ?? 0}</strong> other file(s).
      </div>
      <Row k="callable" v={g.callable === true ? "yes" : "no"} />
      <Row k="intra-file ref" v={hasRef ? "yes" : "no"} />
      <Row k="entry file" v={g.is_entry_file === true ? "yes" : "no"} />
      <div className="trace-chain">
        <span className="node ok">export declared</span>
        <span className="arrow">→</span>
        <span className="node bad">no importer matched</span>
      </div>
      <div className="trace-why">
        Why: nothing outside this file imports it
        {hasRef ? "" : " and it has no in-file reference either"}.{" "}
        {useAll
          ? "It was only reached via a wildcard `use *`-style re-export, which the scan can't pin to a real consumer. "
          : ""}
        {complete
          ? "Advisory: dynamic/generated importers are invisible to a static scan."
          : "Resolution was incomplete here, so treat this as a soft hint, not a verdict."}
      </div>
    </div>
  );
}

/** `could-be-local`: exported but only ever used in its own file → the export
 *  is dead surface area; drop the keyword, keep the symbol. */
function CouldBeLocal({ g }: { g: Graph }) {
  return (
    <div className="trace">
      <div className="trace-headline">
        Symbol <code>{asStr(g.symbol)}</code> is exported but used{" "}
        <strong>only in its own file</strong>.
      </div>
      <Row k="external importers" v={asNum(g.importers) ?? 0} />
      <Row k="used in file" v={g.has_ref_in_file === true ? "yes" : "no"} />
      <Row k="suggestion" v={asStr(g.suggestion)} />
      <div className="trace-chain">
        <span className="node bad">exported (public surface)</span>
        <span className="arrow">→</span>
        <span className="node ok">used in-file only</span>
      </div>
      <div className="trace-why">
        Why: the symbol is referenced inside its own file but imported nowhere
        else — drop the <code>export</code> keyword and keep the symbol to
        shrink the public surface.
      </div>
    </div>
  );
}

/** `never-called`: a callable export with no resolvable caller. Built
 *  analogous to unused-export (no anvil sample) — degrades on missing keys. */
function NeverCalled({ g }: { g: Graph }) {
  const hasRef = g.has_ref_in_file === true;
  const complete = g.resolution_complete === true;
  return (
    <div className="trace">
      <div className="trace-headline">
        Callable <code>{asStr(g.symbol)}</code> has{" "}
        <strong>{asNum(g.importers) ?? 0}</strong> resolvable caller(s).
      </div>
      <Row k="callable" v={g.callable === false ? "no" : "yes"} />
      <Row k="intra-file call" v={hasRef ? "yes" : "no"} />
      <div className="trace-chain">
        <span className="node ok">function defined</span>
        <span className="arrow">→</span>
        <span className="node bad">no caller matched</span>
      </div>
      <div className="trace-why">
        Why: no resolved call site reaches this function
        {hasRef ? "" : " (and no call inside its own file either)"}.{" "}
        {complete
          ? "Advisory: dynamic dispatch / reflection callers are invisible to a static scan."
          : "Resolution was incomplete, so treat this as a soft hint."}
      </div>
    </div>
  );
}

/** `missing-dependency`: an import with no matching manifest declaration. The
 *  target.path IS the dependency name. Caveat: import name ≠ dist name. */
function MissingDependency({ g }: { g: Graph }) {
  const caveat = g.import_dist_name_caveat === true;
  return (
    <div className="trace">
      <div className="trace-headline">
        Dependency is <strong>imported</strong> by source but{" "}
        <strong>not declared</strong> in the manifest.
      </div>
      <Row k="imported" v={g.imported === true ? "yes" : "no"} />
      <Row k="declared" v={g.declared === true ? "yes" : "no"} />
      <Row k="declared deps" v={asNum(g.declared_dep_count)} />
      <div className="trace-chain">
        <span className="node ok">import in source</span>
        <span className="arrow">→</span>
        <span className="node bad">no manifest entry</span>
      </div>
      <div className="trace-why">
        Why: source imports this package but the manifest doesn't list it — a
        missing dependency (or a phantom/transitive resolve).{" "}
        {caveat
          ? "Caveat: the import name can differ from the published distribution name, so the manifest may declare it under another name."
          : ""}
      </div>
    </div>
  );
}

/** `unused-dependency`: a declared manifest dep no source imports. Built
 *  defensively (no anvil sample) — config-only/runtime tools are common FPs. */
function UnusedDependency({ g }: { g: Graph }) {
  return (
    <div className="trace">
      <div className="trace-headline">
        Dependency is <strong>declared</strong> in the manifest but{" "}
        <strong>never imported</strong> by source.
      </div>
      <Row k="declared" v={g.declared === false ? "no" : "yes"} />
      <Row k="imported" v={g.imported === true ? "yes" : "no"} />
      <Row k="note" v={asStr(g.note) ?? asStr(g.demotion)} />
      <div className="trace-chain">
        <span className="node ok">manifest entry</span>
        <span className="arrow">→</span>
        <span className="node bad">no source import</span>
      </div>
      <div className="trace-why">
        Why: the manifest declares this package but no source file imports it.
        Advisory only — it may be a config-only or runtime tool (bundler,
        linter, CLI) the static scan never sees as an import.
      </div>
    </div>
  );
}

/** `seems-outdated`: a file last touched long before the repo's newest commit,
 *  corroborated by extra signals. Advisory — old can just mean stable. */
function SeemsOutdated({ g }: { g: Graph }) {
  const age = asObj(g.age);
  const days = asNum(age.age_days);
  const frac = asNum(age.age_fraction_of_span);
  const signals = asArr(g.corroborating_signals);
  return (
    <div className="trace">
      <div className="trace-headline">
        Last touched{" "}
        <strong>{days !== null ? `${days} day(s)` : "long"}</strong> before the
        repo's newest commit.
      </div>
      <Row k="last change" v={asStr(age.value)} />
      <Row k="age source" v={asStr(age.source)} />
      <Row k="age confidence" v={asStr(age.confidence)} />
      <Row
        k="age fraction"
        v={frac !== null ? `${Math.round(frac * 100)}% of its age span` : null}
      />
      {signals.length > 0 ? (
        <div className="field-grid">
          {signals.map((s) => (
            <span key={s} className="field-chip">{s}</span>
          ))}
        </div>
      ) : null}
      <div className="trace-why">
        Why: this file sits near the old end of the repo's commit-age span and
        carries corroborating staleness signals
        {signals.length > 0 ? ` (${signals.join(", ")})` : ""}. Advisory only —
        old code can simply be stable, finished code.
      </div>
    </div>
  );
}

/** `forgot-to-track`: an untracked-but-not-ignored source/config file the
 *  engine reroutes here. Explicitly NOT a delete candidate — a "commit me?". */
function ForgotToTrack({ g }: { g: Graph }) {
  const age = asObj(g.age);
  return (
    <div className="trace">
      <div className="trace-headline">
        Untracked file that git is <strong>not ignoring</strong> — should it be
        committed?
      </div>
      <Row k="git set" v={asStr(g.git_set)} />
      <Row
        k="secret allowlist"
        v={g.allowlist_checked === true ? "checked (clear)" : null}
      />
      <Row k="rerouted from" v={asStr(g.rerouted_from)} />
      <Row k="last change" v={asStr(age.value)} />
      <Row k="age source" v={asStr(age.source)} />
      <div className="trace-chain">
        <span className="node bad">untracked, not ignored</span>
        <span className="arrow">→</span>
        <span className="node ok">commit candidate (not delete)</span>
      </div>
      <div className="trace-why">
        Why: this is real source/config the working tree has but git doesn't
        track and <code>.gitignore</code> doesn't exclude. The engine reroutes
        it away from the delete pile — it's a "forgot to commit?" nudge. The
        secret/.env allowlist was checked so we're not surfacing a credential.
      </div>
    </div>
  );
}

/** `doc-drift`: a doc reference (link / anchor / inline path) that resolves to
 *  nothing. Heuristic tiers are lower-confidence than the AST-link floor. */
function DocDrift({ g }: { g: Graph }) {
  const tier = asStr(g.tier);
  const heuristic = tier !== null && tier.includes("heuristic");
  return (
    <div className="trace">
      <div className="trace-headline">
        Doc reference <code>{asStr(g.span)}</code> resolves to{" "}
        <strong>nothing</strong>.
      </div>
      <Row k="kind" v={asStr(g.subkind)} />
      <Row k="confidence tier" v={tier} />
      <div className="trace-chain">
        <span className="node ok">reference in doc</span>
        <span className="arrow">→</span>
        <span className="node bad">target not found</span>
      </div>
      <div className="trace-why">
        Why: the referenced path/link/anchor doesn't resolve to a real target —
        doc drift.{" "}
        {heuristic
          ? "This is a lower-confidence heuristic guess (e.g. an inline-code path that merely looks like a file), not the AST-link floor — verify before acting."
          : "This came from the AST-link floor (a real parsed link), so it's high-confidence."}
      </div>
    </div>
  );
}

/** `orphan-doc`: a doc with in-degree 0 that no entry or nav doc reaches.
 *  Link density shows the verdict is drawn from a link-rich (trustable) doc. */
function OrphanDoc({ g }: { g: Graph }) {
  const density = asNum(g.doc_link_density);
  return (
    <div className="trace">
      <div className="trace-headline">
        Doc has <strong>in-degree {asNum(g.in_degree) ?? 0}</strong> — nothing
        links to it.
      </div>
      <Row k="inbound links" v={asNum(g.in_degree)} />
      <Row k="resolved refs out" v={asNum(g.resolved_refs)} />
      <Row k="nav-referenced" v={g.nav_referenced === true ? "yes" : "no"} />
      <Row
        k="link density"
        v={density !== null ? `${Math.round(density * 100)}%` : null}
      />
      <div className="trace-chain">
        <span className="node ok">entry / nav docs</span>
        <span className="arrow">→</span>
        <span className="node bad">no link → this doc</span>
      </div>
      <div className="trace-why">
        Why: no other doc links here and it isn't reachable from any entry or
        nav doc. The corpus is link-dense enough
        {density !== null ? ` (${Math.round(density * 100)}% link density)` : ""}{" "}
        that "nobody references it" is a meaningful signal, not just a sparse
        graph artifact.
      </div>
    </div>
  );
}

/** `prefer-library` / `reinvented-wheel`: opt-in recommendation packs. No anvil
 *  sample — surface the obvious string fields best-effort and frame it as an
 *  advisory recommendation carrying a when-not caveat. */
function Recommendation({ g }: { g: Graph }) {
  const library = asStr(g.library) ?? asStr(g.recommended_library);
  const recommendation = asStr(g.recommendation) ?? asStr(g.suggestion);
  const caveat = asStr(g.caveat) ?? asStr(g.when_not);
  return (
    <div className="trace">
      <div className="trace-headline">
        Recommendation: consider{" "}
        <strong>{library ? <code>{library}</code> : "a library"}</strong>{" "}
        instead of this hand-rolled code.
      </div>
      <Row k="recommendation" v={recommendation} />
      <Row k="library" v={library} />
      <Row k="when not" v={caveat} />
      <div className="trace-why">
        Why: this looks like behaviour a well-known library already provides —
        an opt-in advisory recommendation, never a delete.{" "}
        {caveat
          ? `Caveat: ${caveat}`
          : "Skip it if the in-house version is intentional or carries project-specific behaviour."}
      </div>
    </div>
  );
}

const RENDERERS: Record<string, (p: { g: Graph }) => React.ReactNode> = {
  "over-fetched-response-field": OverFetch,
  "unused-endpoint": UnusedEndpoint,
  "frontend-call-to-missing-route": MissingRoute,
  "field-name-convention-drift": ConventionDrift,
  "duplicate-block": DuplicateBlock,
  "orphan-file": OrphanFile,
  "unused-export": UnusedExport,
  "could-be-local": CouldBeLocal,
  "never-called": NeverCalled,
  "missing-dependency": MissingDependency,
  "unused-dependency": UnusedDependency,
  "seems-outdated": SeemsOutdated,
  "forgot-to-track": ForgotToTrack,
  "doc-drift": DocDrift,
  "orphan-doc": OrphanDoc,
  "prefer-library": Recommendation,
  "reinvented-wheel": Recommendation,
};

export function TraceDetail({ finding }: { finding: Finding }) {
  const Renderer = RENDERERS[finding.rule];
  if (!Renderer) return null;
  return <Renderer g={finding.evidence.graph} />;
}

/** Whether a rule has a tailored trace renderer (so EvidencePanel can collapse
 *  the raw graph by default when one exists). */
export function hasTrace(rule: string): boolean {
  return rule in RENDERERS;
}
