/**
 * Canonicalisation for the materiality trigger's free formatting-only gate
 * (register row 1.4, `TRG-1`). Two texts that canonicalise identically carry
 * no content signal to send the model, whatever their raw bytes did: rather
 * than asking a model to distinguish reformatting from content, this makes
 * reformatting invisible to the comparison in the first place.
 *
 * Fail-safe rule (ol-egov.141.89.5.60, [D-511]): when unsure, KEEP the
 * character, so the change goes to the judge. An earlier version stripped
 * every leading marker and every run of `*` or `_` anywhere, which made
 * content edits compare equal (a changed list sign, a quote marker before a
 * number, a changed list number, an unpaired asterisk, an underscore inside a
 * token, `#tag` against `tag`) and exit free with no judge call. Now:
 *
 *  1. Whitespace: split lines, collapse whitespace runs to one space, trim,
 *     drop empty lines.
 *  2. Headings: a leading `#{1,6}` is stripped only when followed by
 *     whitespace or end of line (`#tag` stays).
 *  3. List markers (`-`, `*`, `+`), ordered-list numbers with their
 *     delimiter, and block-quote `>` are all kept as written.
 *  4. Emphasis: only PAIRED delimiter runs of the same character and length
 *     (1-3 of `*` or `_`) are removed. The opening run sits at line start or
 *     after whitespace/punctuation and is followed by non-whitespace; the
 *     closing run follows non-whitespace and precedes line end, whitespace or
 *     punctuation. Unpaired, intra-word and backslash-escaped runs stay.
 *
 * A change this function's output cannot see is restricted to whitespace,
 * heading level and paired emphasis, never what the text says.
 */

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);
const isPunct = (c: string | undefined): boolean => c !== undefined && /[\p{P}\p{S}]/u.test(c);

interface Run {
  readonly start: number;
  readonly end: number;
  readonly ch: string;
  canOpen: boolean;
  canClose: boolean;
}

/** Remove paired same-character, same-length emphasis runs; keep all else. */
function stripPairedEmphasis(line: string): string {
  const runs: Run[] = [];
  for (const m of line.matchAll(/[*_]+/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const len = m[0].length;
    if (len > 3 || line[start - 1] === '\\') continue;
    const before = start === 0 ? undefined : line[start - 1];
    const after = end >= line.length ? undefined : line[end];
    const beforeOk = before === undefined || isSpace(before) || isPunct(before);
    const afterOk = after === undefined || isSpace(after) || isPunct(after);
    runs.push({
      start,
      end,
      ch: m[0][0] as string,
      canOpen: beforeOk && after !== undefined && !isSpace(after),
      canClose: before !== undefined && !isSpace(before) && afterOk,
    });
  }
  const removed = new Set<Run>();
  const open: Run[] = [];
  for (const run of runs) {
    const len = run.end - run.start;
    if (run.canClose) {
      let at = -1;
      for (let i = open.length - 1; i >= 0; i--) {
        const o = open[i] as Run;
        if (o.ch === run.ch && o.end - o.start === len) {
          at = i;
          break;
        }
      }
      if (at >= 0) {
        removed.add(open[at] as Run);
        removed.add(run);
        open.splice(at);
        continue;
      }
    }
    if (run.canOpen) open.push(run);
  }
  if (removed.size === 0) return line;
  let out = '';
  let pos = 0;
  for (const run of runs) {
    if (!removed.has(run)) continue;
    out += line.slice(pos, run.start);
    pos = run.end;
  }
  return out + line.slice(pos);
}

/**
 * Canonical form per the rule in the module comment: collapse whitespace,
 * strip a heading marker, remove paired emphasis; keep every other marker.
 */
export function canonicalizeForMateriality(text: string): string {
  const canonicalLines: string[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const collapsed = rawLine.replace(/\s+/g, ' ').trim();
    const withoutHeading = collapsed.replace(/^#{1,6}(?:\s+|$)/, '');
    const canonical = stripPairedEmphasis(withoutHeading).replace(/\s+/g, ' ').trim();
    if (canonical.length > 0) canonicalLines.push(canonical);
  }
  return canonicalLines.join('\n');
}
