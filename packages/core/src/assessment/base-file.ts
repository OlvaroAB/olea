/**
 * A narrow scan over an Obsidian `.base` file's text (P1-T06).
 *
 * **This is not a YAML parser**, general or otherwise — no dependency was
 * added for it (CONVENTIONS pins the toolchain; a YAML library is not on
 * that list, and `.base` files are never written back by this reader, so
 * none of INV-2's round-trip reasoning about frontmatter applies here
 * either way). It extracts exactly the three things `read.ts` needs, each
 * by its own small, deliberately-scoped scan of the source text:
 *
 *   1. the folder(s) named by `file.inFolder("...")` filter expressions,
 *   2. the extension(s) named by `file.ext == "..."` filter expressions,
 *   3. the top-level keys declared under a `properties:` block.
 *
 * A `.base` file this vault's fixture doesn't need (nested list items under
 * `properties`, multiple `views`, a `sort` key if Bases ever grows one — see
 * fixtures/vault/README.md's "Obsidian Bases" section for that open
 * question) is out of scope until a real one proves otherwise, exactly the
 * same "her shapes, not spec completeness" rule the frontmatter and block
 * parsers already follow.
 */

/**
 * Folder paths named in `file.inFolder("...")` filter expressions anywhere
 * in the source, in the order they appear. Not scoped to `filters.and`
 * specifically — a `.base` file with a bare `filters: file.inFolder(...)`
 * (no `and`) is still found.
 */
export function extractInFolderFilters(source: string): readonly string[] {
  const re = /file\.inFolder\(\s*"([^"]*)"\s*\)/g;
  const out: string[] = [];
  for (const match of source.matchAll(re)) {
    const path = match[1];
    if (path !== undefined) out.push(path);
  }
  return out;
}

/** Lowercase extensions named in `file.ext == "..."` filter expressions. */
export function extractExtFilters(source: string): readonly string[] {
  const re = /file\.ext\s*==\s*"([^"]*)"/g;
  const out: string[] = [];
  for (const match of source.matchAll(re)) {
    const ext = match[1];
    if (ext !== undefined && ext !== '') out.push(ext.toLowerCase());
  }
  return out;
}

/**
 * Top-level keys declared under a `properties:` block — the columns the
 * Base exposes. An indentation-based scan: finds the `properties:` line,
 * then treats every subsequent non-blank line indented by exactly the same
 * amount as the first key under it as one more declared column, stopping at
 * the first line indented less than that (dedent out of the block) or at
 * end of file. Lines indented *more* than the key level (e.g. a nested
 * `displayName:`) are detail, not columns, and are skipped.
 */
export function extractDeclaredProperties(source: string): readonly string[] {
  const lines = source.split(/\r\n|\n/);
  const propsIndex = lines.findIndex((line) => /^properties:\s*$/.test(line));
  if (propsIndex === -1) return [];

  const keys: string[] = [];
  let keyIndent: number | undefined;

  for (let i = propsIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === '') continue;

    const indentMatch = /^(\s*)(\S.*)$/.exec(line);
    if (!indentMatch) continue;
    const indent = (indentMatch[1] ?? '').length;
    const rest = indentMatch[2] ?? '';

    if (keyIndent === undefined) keyIndent = indent;
    if (indent < keyIndent) break;
    if (indent > keyIndent) continue;

    const keyMatch = /^(\S[^:]*):\s*$/.exec(rest);
    if (keyMatch) keys.push((keyMatch[1] ?? '').trim());
  }

  return keys;
}
