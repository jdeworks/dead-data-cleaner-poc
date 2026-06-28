import { useMemo, useState, type ReactNode } from "react";
import { cx } from "../../lib/cx";

// One reusable data table for the whole app (WP02).
//
// Goals:
//  - Per-column click-to-sort (asc → desc → none), STABLE.
//  - Filtering: a global text box plus opt-in per-column filters.
//  - Alignment rule (P6): a column's HEADER alignment always matches its CELL
//    alignment. Numeric columns right-align both; text columns left-align both.
//    This kills the old left-header / right-value mismatch on `.num` columns.
//  - Headless-ish: the column model + alignment helpers are exported so a
//    non-sorting tree view (WP04) can reuse them WITHOUT enabling sort.
//
// Built on the existing `table.data` / `td.num` CSS so migrated tables render
// identically except for the intended header-alignment fix.

export type ColumnType = "number" | "text";

export interface Column<Row> {
  /** Stable identity for sort state + React keys. */
  key: string;
  /** Header label. */
  label: ReactNode;
  /** "number" right-aligns header+cell and sorts numerically; "text" (default)
   *  left-aligns and sorts lexically. */
  type?: ColumnType;
  /** Pull the raw value out of a row. Defaults to `row[key]`. */
  accessor?: (row: Row) => unknown;
  /** Render the cell. Receives the accessed value and the whole row. Defaults
   *  to the accessed value rendered as-is. Use a formatter (e.g. `formatBytes`)
   *  here for display while sort/filter still operate on the raw value. */
  formatter?: (value: unknown, row: Row) => ReactNode;
  /** Extra className for the <td>/<th> (e.g. "path-cell", "mono"). */
  cellClassName?: string;
  /** Opt in to a per-column filter input in a second header row. */
  filterable?: boolean;
  /** Disable sorting for this column (header is not clickable). */
  sortable?: boolean;
}

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

/** Per-column horizontal alignment derived purely from the column type. Shared
 *  so the (non-sorting) tree view can align its own headings the same way. */
export function columnAlign<Row>(col: Column<Row>): "left" | "right" {
  return col.type === "number" ? "right" : "left";
}

function accessValue<Row>(col: Column<Row>, row: Row): unknown {
  if (col.accessor) return col.accessor(row);
  return (row as Record<string, unknown>)[col.key];
}

function sortAffordance(
  active: boolean,
  dir?: SortDir,
): ReactNode {
  if (!active) return <span className="table-sort-icon">↕</span>;
  return (
    <span className={`table-sort-icon table-sort-icon-${dir}`}> {dir === "asc" ? "▲" : "▼"}</span>
  );
}

/** Human-readable byte size, e.g. 1536 → "1.5 KB", 1048576 → "1 MB".
 *  Shared formatter (WP03/P12). Sort/filter still use the raw byte number. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // Trim a trailing ".0" so 1 MB shows as "1 MB", not "1.0 MB".
  const s = v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}`;
}

function compare(a: unknown, b: unknown, type: ColumnType): number {
  if (type === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    const va = Number.isNaN(na) ? -Infinity : na;
    const vb = Number.isNaN(nb) ? -Infinity : nb;
    return va - vb;
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function matches(value: unknown, query: string): boolean {
  if (!query) return true;
  return String(value ?? "")
    .toLowerCase()
    .includes(query.toLowerCase());
}

export interface TableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  /** React key per row. Defaults to the row index. */
  rowKey?: (row: Row, index: number) => string;
  /** Initial sort. Omit for none (rows in source order). */
  defaultSort?: SortState;
  /** Show the global text filter input above the table. */
  globalFilter?: boolean;
  /** Placeholder for the global filter input. */
  globalFilterPlaceholder?: string;
  /** Optional per-row click handler (adds the selectable row styling). */
  onRowClick?: (row: Row) => void;
  /** Marks a row as selected (selected row styling). */
  isRowSelected?: (row: Row) => boolean;
  className?: string;
  /** Message when there are no rows (after filtering). */
  emptyMessage?: ReactNode;
}

function nextSort(current: SortState | null, key: string): SortState | null {
  // asc → desc → none, then back to asc.
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
  defaultSort,
  globalFilter = false,
  globalFilterPlaceholder = "Filter…",
  onRowClick,
  isRowSelected,
  className,
  emptyMessage = "No rows",
}: TableProps<Row>) {
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);
  const [global, setGlobal] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  const hasColFilters = columns.some((c) => c.filterable);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      // Per-column filters.
      for (const col of columns) {
        if (!col.filterable) continue;
        const q = colFilters[col.key];
        if (q && !matches(accessValue(col, row), q)) return false;
      }
      // Global filter — any visible column matches.
      if (global) {
        const hit = columns.some((col) =>
          matches(accessValue(col, row), global),
        );
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, columns, colFilters, global]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const type = col.type ?? "text";
    // Stable sort: decorate with the original index, break ties by it.
    const decorated = filtered.map((row, i) => ({ row, i }));
    decorated.sort((x, y) => {
      const c = compare(accessValue(col, x.row), accessValue(col, y.row), type);
      const dir = sort.dir === "asc" ? 1 : -1;
      if (c !== 0) return c * dir;
      return x.i - y.i;
    });
    return decorated.map((d) => d.row);
  }, [filtered, sort, columns]);

  const key = (row: Row, i: number) => (rowKey ? rowKey(row, i) : String(i));

  return (
    <div className={cx("table-wrap", className)}>
      {globalFilter && (
        <div className="table-toolbar">
          <input
            className="table-filter"
            type="text"
            value={global}
            placeholder={globalFilterPlaceholder}
            onChange={(e) => setGlobal(e.target.value)}
            aria-label="Filter rows"
          />
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              {columns.map((col) => {
                const align = columnAlign(col);
                const sortable = col.sortable !== false;
                const active = sort?.key === col.key;
                const sortDir = sort?.dir;
                return (
                  <th
                    key={col.key}
                    className={cx(
                      align === "right" && "num",
                      sortable && "table-sort",
                      active && "table-sort-active",
                      active && `table-sort-${sortDir}`,
                      !sortable && "no-sort",
                    )}
                    aria-sort={
                      active
                        ? sort?.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    onClick={
                      sortable
                        ? () => setSort((s) => nextSort(s, col.key))
                        : undefined
                    }
                  >
                    {col.label}
                    {sortable && sortAffordance(active, sortDir)}
                  </th>
                );
              })}
            </tr>
            {hasColFilters && (
              <tr className="table-col-filters">
                {columns.map((col) => {
                  const align = columnAlign(col);
                  return (
                    <th key={col.key} className={cx(align === "right" && "num")}>
                      {col.filterable && (
                        <input
                          className="table-filter table-filter-col"
                          type="text"
                          value={colFilters[col.key] ?? ""}
                          placeholder="Filter…"
                          aria-label={`Filter ${typeof col.label === "string" ? col.label : col.key}`}
                          onChange={(e) =>
                            setColFilters((f) => ({
                              ...f,
                              [col.key]: e.target.value,
                            }))
                          }
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="table-empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => {
                const selected = isRowSelected?.(row) ?? false;
                return (
                  <tr
                    key={key(row, i)}
                    className={cx(
                      onRowClick && "row-selectable",
                      selected && "selected",
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => {
                      const align = columnAlign(col);
                      const raw = accessValue(col, row);
                      const content = col.formatter
                        ? col.formatter(raw, row)
                        : (raw as ReactNode);
                      return (
                        <td
                          key={col.key}
                          className={cx(
                            align === "right" && "num",
                            col.cellClassName,
                          )}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
