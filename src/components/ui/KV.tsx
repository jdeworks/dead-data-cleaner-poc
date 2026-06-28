import type { ReactNode } from "react";

// A key/value definition list (the `.kv` two-column grid). Pass `pairs`; rows
// whose value is null/undefined/"" are skipped so callers can build the list
// declaratively without conditional spread.

export interface KVPair {
  k: ReactNode;
  v: ReactNode;
}

export function KV({ pairs }: { pairs: KVPair[] }) {
  return (
    <div className="kv">
      {pairs.map((p, i) =>
        p.v === null || p.v === undefined || p.v === "" ? null : (
          <KVRow key={i} k={p.k} v={p.v} />
        ),
      )}
    </div>
  );
}

function KVRow({ k, v }: KVPair) {
  return (
    <>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </>
  );
}
