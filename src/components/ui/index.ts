// Shared UI primitives. Compose views from these instead of re-rolling buttons,
// panels, chips and stat cards. Severity/tier/gating chips live in
// `../badges` (canonical color scale); see ui/CONVENTIONS.md.
export { Button } from "./Button";
export type { ButtonProps } from "./Button";
export { Chip } from "./Chip";
export type { ChipTone } from "./Chip";
export { Panel, usePersistedOpen, smartDefaultOpen } from "./Panel";
export { Stat, StatGrid } from "./Stat";
export type { StatTone } from "./Stat";
export { KV } from "./KV";
export type { KVPair } from "./KV";
export { EmptyState } from "./EmptyState";
export { Table, columnAlign, formatBytes } from "./Table";
export type { Column, ColumnType, SortState, SortDir, TableProps } from "./Table";
