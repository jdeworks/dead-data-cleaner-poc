// WP07 (T2, P19) — turn a user-configured editor-launch template into discrete
// argv tokens with the finding's `{path}`/`{line}` substituted as DISCRETE
// argument values. The result is spawned program-then-args by the Tauri
// `open_in_editor` command — it is NEVER passed to a shell — so no shell-injection
// surface exists: a `{path}` like `foo; rm -rf ~` lands as a single argv element,
// never interpreted as two commands.
//
// Template grammar: whitespace-separated tokens. A token may CONTAIN the
// placeholders `{path}` and `{line}`; substitution happens inside the token, so
// `code -g {path}:{line}` becomes ["code", "-g", "/abs/foo.ts:42"] — the path and
// line stay glued to their token but the whole token is still ONE argv element.

interface EditorTarget {
  /** Absolute (or repo-relative) file path to open. Required. */
  path: string;
  /** 1-based line, when the finding carries a span. Optional. */
  line?: number | null;
}

interface BuildEditorArgvResult {
  program: string;
  args: string[];
}

/**
 * Split `template` on whitespace and substitute `{path}`/`{line}` placeholders
 * inside each token, returning the program + its args as discrete strings.
 *
 * Returns `null` (the action is unavailable) when:
 *  - the template is empty/whitespace, or
 *  - the template references `{line}` but no line is available.
 *
 * Throwing is avoided so callers can simply hide/disable the action on `null`.
 */
export function buildEditorArgv(
  template: string | null | undefined,
  target: EditorTarget,
): BuildEditorArgvResult | null {
  const tpl = (template ?? "").trim();
  if (!tpl) return null;

  const hasLine = target.line != null && Number.isFinite(target.line);
  // If the template wants a line but we don't have one, the action can't be
  // satisfied meaningfully → treat as unavailable rather than emitting "{line}".
  if (tpl.includes("{line}") && !hasLine) return null;

  const tokens = tpl.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  const subst = (tok: string): string =>
    tok
      .replace(/\{path\}/g, target.path)
      .replace(/\{line\}/g, hasLine ? String(target.line) : "");

  const [first, ...rest] = tokens.map(subst);
  return { program: first, args: rest };
}

/** Whether an editor template is configured (non-empty after trimming). */
export function hasEditorCommand(template: string | null | undefined): boolean {
  return !!(template ?? "").trim();
}
