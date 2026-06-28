// A3 — per-finding ignore/suppress flow: PREVIEW (add_ignore, read-only) →
// CONFIRM (show merged ddc.toml) → WRITE (writeConfig, the one guarded write
// path). The "show before write" contract is identical to excludeFolderFlow
// (lib/exclude.ts) and the ExportPage's writeToml helper.
//
// Browser mode: when not under Tauri, `addIgnore` throws — callers detect this
// via the `"browser"` status and surface the snippet for manual copy instead
// (mirrors how ExtensionsSettings and ConfigBuilder degrade).
//
// The ONLY write happens through `writeConfig` and ONLY after `confirm` returns
// true. `addIgnore` is read-only/preview. `overwrite` is true because we are
// editing the user's OWN ddc.toml after showing them the full merged result.

import { addIgnore, writeConfig } from "./tauri";

/** Injectable confirm — defaults to `window.confirm`. Tests pass a stub so they
 *  can assert confirm→write and cancel→no-write without a real dialog. */
type ConfirmFn = (message: string) => boolean;

/** The outcome of {@link suppressFindingFlow}.
 *
 * - `written` — the merged ddc.toml was written successfully.
 * - `cancelled` — the user declined the confirm dialog.
 * - `browser` — running in a browser (no Tauri); the caller should surface
 *   the `snippet` to copy manually.
 * - `error` — a preview-compute or write failure; see `message`.
 */
type SuppressResult =
  | { status: "written"; path: string; merged: string }
  | { status: "cancelled" }
  | { status: "browser"; snippet: string }
  | { status: "error"; message: string };

/**
 * Build the ddc.toml snippet for a `[rules].ignore` suppression of a single
 * path. Used in browser mode (no Tauri) to surface what the user should copy.
 * Kept here rather than importing from `prevention.ts` so this module has no
 * transitive dependency on that file's broader concern (gate suggestions etc.).
 */
export function buildSuppressSnippet(glob: string): string {
  return `[rules]\nignore = [\n  "${glob}",\n]\n`;
}

/**
 * Run the full per-finding suppress flow for `glob` against the `ddc.toml`
 * owned by `dir`:
 *
 *  1. `add_ignore` (READ-ONLY) computes the merged `ddc.toml` text — preview.
 *  2. `confirm` shows the merged text + the suppress-not-skip caveat. On decline,
 *     returns `{ status: "cancelled" }` and NOTHING is written.
 *  3. On confirm, `writeConfig(dir, "ddc.toml", merged, true)` persists it — the
 *     single guarded write path. Overwrite is intentional (we just showed the
 *     user the exact result of editing their own file).
 *
 * **Browser mode**: when `addIgnore` throws "Not running under Tauri" (i.e.
 * there is no `window.__TAURI__`), the function returns
 * `{ status: "browser", snippet }` with a ready-to-copy TOML snippet so the
 * caller can degrade gracefully (copy-to-clipboard flow).
 *
 * Any other failure (preview compute or write) is returned as
 * `{ status: "error" }` rather than thrown, so a caller can surface it inline.
 */
export async function suppressFindingFlow(
  dir: string,
  glob: string,
  confirm: ConfirmFn = (m) => window.confirm(m),
): Promise<SuppressResult> {
  let merged: string;
  try {
    // Step 1 — read-only preview of the merged config.
    merged = await addIgnore(dir, glob);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    // Browser-mode degradation: addIgnore throws when Tauri is absent.
    if (/not running under tauri/i.test(msg)) {
      return { status: "browser", snippet: buildSuppressSnippet(glob) };
    }
    return { status: "error", message: msg };
  }

  // Step 2 — explicit confirm, showing the full merged TOML and the semantics.
  const ok = confirm(
    `Suppress this finding by adding "${glob}" to ${dir}/ddc.toml?\n\n` +
      `This adds "${glob}" to [rules].ignore, which SUPPRESSES findings whose ` +
      `target path matches (the engine still scans the file; the finding is ` +
      `just abstained on the next run). The merged ddc.toml will be:\n\n` +
      `${merged}\n` +
      `This is the only file ddc writes, and only on this confirm. Continue?`,
  );
  if (!ok) return { status: "cancelled" };

  // Step 3 — the one guarded write. Overwrite=true: we are editing the user's
  // own ddc.toml after showing them the exact merged result.
  try {
    const path = await writeConfig(dir, "ddc.toml", merged, true);
    return { status: "written", path, merged };
  } catch (e) {
    return { status: "error", message: String((e as Error).message ?? e) };
  }
}
