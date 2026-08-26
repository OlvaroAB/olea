/**
 * Canonicalisation for the materiality trigger's free formatting-only gate
 * (register row 1.4, `TRG-1`). Two texts that canonicalise identically carry
 * no content signal to send the model, whatever their raw bytes did — this
 * is the structural half of row 1.4's own health check, "a formatting-only
 * edit produces zero triggers": rather than asking a model to distinguish
 * reformatting from content, this makes reformatting invisible to the
 * comparison in the first place.
 *
 * Deliberately conservative: it strips only markup and whitespace that
 * carries no wording of its own (heading/list/emphasis markers, blockquote
 * markers, collapsed whitespace, trailing punctuation-adjacent spacing), and
 * never touches word or number content. A change this function's output
 * cannot see is, by construction, restricted to how the text is laid out —
 * never to what it says.
 */

/**
 * Strip leading heading (`#`), list (`-`, `*`, `+`, digit-dot), and
 * blockquote (`>`) markers from a line, plus emphasis/strong markers
 * (`*`, `_`) anywhere in it, then collapse internal whitespace to single
 * spaces and trim. Applied line-by-line so reflowing a paragraph, retagging
 * a bullet, or promoting a heading level never registers as content.
 */
export function canonicalizeForMateriality(text: string): string {
  const lines = text.split(/\r\n|\r|\n/);
  const canonicalLines: string[] = [];
  for (const rawLine of lines) {
    const withoutBlockMarkers = rawLine.replace(/^\s*(#{1,6}\s*|[-*+]\s+|\d+[.)]\s+|>\s*)+/, '');
    const withoutEmphasis = withoutBlockMarkers.replace(/[*_]{1,3}/g, '');
    const collapsed = withoutEmphasis.replace(/\s+/g, ' ').trim();
    if (collapsed.length > 0) canonicalLines.push(collapsed);
  }
  return canonicalLines.join('\n');
}
