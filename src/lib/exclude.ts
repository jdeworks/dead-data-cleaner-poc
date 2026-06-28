// WP5 Phase 5 (P14) — the reusable "exclude a folder from analysis" flow:
// PREVIEW (add_exclusion, read-only) -> CONFIRM -> WRITE (writeConfig, the one
// guarded write path). Kept here, decoupled from any one view, so WP8 (the treemap
// right-click "exclude this folder") can reuse the EXACT same compute+confirm+write
// without duplicating the read-only contract.
//
// The ONLY write happens through `writeConfig` and ONLY after `confirm` returns
// true. `addExclusion` is read-only/preview. `overwrite` is true because we are
// editing the user's OWN ddc.toml after showing them the full merged result.

import { addExclusion, writeConfig } from "./tauri";

/** Injectable confirm — defaults to `window.confirm`. Tests pass a stub so they
 *  can assert confirm→write and cancel→no-write without a real dialog. */
type ConfirmFn = (message: string) => boolean;

/** The outcome of {@link excludeFolderFlow}. `cancelled` is returned (rather than
 *  throwing) when the user declines the confirm — so callers can stay quiet. */
type ExcludeResult =
  | { status: "written"; path: string; merged: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Run the full exclude-a-folder flow for `folder` (a scan-root-relative path)
 * against the `ddc.toml` owned by `dir`:
 *
 *  1. `add_exclusion` (READ-ONLY) computes the merged `ddc.toml` text — preview.
 *  2. `confirm` shows the merged text + the suppress-not-skip caveat. On decline,
 *     returns `{ status: "cancelled" }` and NOTHING is written.
 *  3. On confirm, `writeConfig(dir, "ddc.toml", merged, true)` persists it — the
 *     single guarded write path. Overwrite is intentional (we just showed the user
 *     the exact result of editing their own file).
 *
 * Any failure (preview compute or write) is returned as `{ status: "error" }`
 * rather than thrown, so a caller can surface it inline.
 */
export async function excludeFolderFlow(
  dir: string,
  folder: string,
  confirm: ConfirmFn = (m) => window.confirm(m),
): Promise<ExcludeResult> {
  let merged: string;
  try {
    // Step 1 — read-only preview of the merged config.
    merged = await addExclusion(dir, folder);
  } catch (e) {
    return { status: "error", message: String((e as Error).message ?? e) };
  }

  // Step 2 — explicit confirm, showing the full merged TOML and the semantics:
  // [rules].ignore SUPPRESSES findings under the folder; the engine still scans it.
  const ok = confirm(
    `Exclude "${folder}" from analysis by adding it to ${dir}/ddc.toml?\n\n` +
      `This SUPPRESSES findings under that folder (the scan still walks it; ` +
      `matching findings are just abstained). The merged ddc.toml will be:\n\n` +
      `${merged}\n` +
      `This is the only file ddc writes, and only on this confirm. Continue?`,
  );
  if (!ok) return { status: "cancelled" };

  // Step 3 — the one guarded write. Overwrite=true: we are editing the user's own
  // ddc.toml after showing them the exact merged result.
  try {
    const path = await writeConfig(dir, "ddc.toml", merged, true);
    return { status: "written", path, merged };
  } catch (e) {
    return { status: "error", message: String((e as Error).message ?? e) };
  }
}
