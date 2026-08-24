/**
 * The frontmatter *map* layer (C1.3, C5.3, INV-2, [D-107]).
 *
 * `setEntryValue` (./serialize.ts) replaces one entry's **entire** value in a
 * single splice. That is enough for a scalar stamped once (`uid/stamp.ts`'s
 * `olea-uid`), but it has no concept of a nested map and no operation for
 * "append one line to a growing multi-line value while leaving its other
 * lines alone." This module is that operation — the layer [D-107] ruled must
 * be built rather than assumed, after `ol-k7eg` investigated the "just reuse
 * `setEntryValue`" suggestion and found it did not hold as stated.
 *
 * ## The shape
 *
 * One frontmatter key holds a growing YAML block map, one `mapKey: value`
 * pair per line, each indented two spaces under the key:
 *
 * ```
 * olea-cloze-ids:
 *   block-a1: cloze-x9y8z7
 *   block-b2: cloze-p4q5r6
 * ```
 *
 * That is a plain YAML block mapping — the shape Obsidian's own Properties
 * editor writes for a nested object, and the shape `parseFrontmatter`
 * already reads correctly with no change: a `key:` line with nothing after
 * the colon, followed by indented continuation lines, is exactly what
 * `parse.ts`'s "indented line belongs to the previous key" rule already
 * captures as one `EntryNode`'s `valueRaw`. What was missing was reading
 * *inside* that value (`readFrontmatterMap`, the meaning path) and
 * appending one more line to it without touching the others (`appendMapEntry`
 * and `appendFrontmatterMapEntry`, the byte path) — see this file's header
 * for why a hand-rolled nested format still has to earn the same "no YAML
 * library" discipline the rest of this engine holds to: mapKey/value are
 * restricted to single-line, colon-free-key text precisely so the shape
 * stays trivially unambiguous to re-parse, the same reasoning
 * `../frontmatter/types.ts`'s header applies to the outer format.
 *
 * ## Idempotence is read-then-mint, matching every other stamping site
 *
 * `appendMapEntry`/`appendFrontmatterMapEntry` never overwrite an existing
 * `mapKey`. If it is already present, the call is a byte-identical no-op and
 * the *existing* value is returned — the caller's `value` argument is
 * ignored in that case. This mirrors `uid/stamp.ts`'s `stampUid` and
 * `../instrument/mcq-format.ts`'s `stampMcqId`: an id, once written, is
 * thereafter only ever read, never recomputed. A consumer (e.g. cloze
 * identity, `ol-k7eg`) mints a candidate value only when `readFrontmatterMap`
 * shows the key absent, then calls append — but even a caller that always
 * calls append unconditionally cannot clobber an id that is already there.
 *
 * ## Designed for a whole-file consumer
 *
 * `appendFrontmatterMapEntry` operates on full note content, not a parsed
 * `Frontmatter`, and covers all three shapes a real note can be in: an
 * existing key with an existing map, an existing frontmatter block with no
 * such key yet, and no frontmatter block at all. That mirrors `stampUid`'s
 * three-way split (`stampExistingFrontmatter` vs. `stampNoFrontmatter`) on
 * purpose, so a consumer already familiar with the uid stamping shape reads
 * this one for free.
 */

import { type AppliedSpan, applyDocumentEdits, type DocumentEdit } from '../block/edit.js';
import { parseDocument } from '../block/parse.js';
import type { FrontmatterBlock } from '../block/types.js';
import { parseFrontmatter } from './parse.js';
import { serializeFrontmatter, setEntryValue } from './serialize.js';
import type { EntryNode, Frontmatter, FrontmatterNode } from './types.js';

/** One `mapKey: value` line read out of a map-shaped frontmatter entry. */
export interface FrontmatterMapEntry {
  readonly key: string;
  readonly value: string;
}

/**
 * An indented `key: value` continuation line — the map-entry shape this
 * module both reads and writes. Deliberately stricter than the outer
 * `KEY_LINE_RE` in `./parse.ts` in one respect only (leading indent is
 * required, which is how a continuation line is told apart from a sibling
 * top-level entry in the first place); otherwise the same grammar.
 */
const MAP_LINE_RE = /^[ \t]+(\S[^:]*):(?: (.*))?$/;

function parseMapLines(valueRaw: string): FrontmatterMapEntry[] {
  const out: FrontmatterMapEntry[] = [];
  for (const line of valueRaw.split(/\r?\n/)) {
    const match = MAP_LINE_RE.exec(line);
    if (!match) continue;
    const key = match[1];
    if (key === undefined) continue;
    out.push({ key, value: (match[2] ?? '').trim() });
  }
  return out;
}

/**
 * Reads the map an entry carries, in source order. Meaning path, best-effort
 * like `./read.ts`'s readers: a key with no such entry, or an entry that
 * isn't map-shaped, yields `[]` rather than throwing. **Never feed this back
 * into serialisation** — the same rule `./read.ts`'s header states for the
 * rest of the meaning path, and for the same reason.
 */
export function readFrontmatterMap(fm: Frontmatter, key: string): readonly FrontmatterMapEntry[] {
  const entry = fm.nodes.find(
    (node): node is EntryNode => node.kind === 'entry' && node.key === key,
  );
  if (!entry) return [];
  return parseMapLines(entry.valueRaw);
}

/** `readFrontmatterMap(fm, key)` narrowed to one `mapKey`, or `undefined`. */
export function getFrontmatterMapValue(
  fm: Frontmatter,
  key: string,
  mapKey: string,
): string | undefined {
  return readFrontmatterMap(fm, key).find((e) => e.key === mapKey)?.value;
}

function validateMapLine(mapKey: string, value: string): void {
  if (mapKey === '') throw new Error('appendMapEntry: mapKey must not be empty');
  if (/[:\r\n]/.test(mapKey)) {
    throw new Error(
      `appendMapEntry: mapKey ${JSON.stringify(mapKey)} must not contain ':' or a line break`,
    );
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(
      `appendMapEntry: value for ${JSON.stringify(mapKey)} must not contain a line break`,
    );
  }
}

/** The line terminator an existing frontmatter uses, taken from its last node; `\n` when there is nothing to infer from. Mirrors `uid/stamp.ts`'s `detectTerminator`, kept local rather than imported — this module owns no path under `uid/`. */
function detectTerminator(fm: Frontmatter): '\n' | '\r\n' {
  const last = fm.nodes[fm.nodes.length - 1];
  if (last?.raw.endsWith('\r\n')) return '\r\n';
  return '\n';
}

/**
 * Appends a brand-new `key:` entry (empty block-map header, nothing after
 * the colon on its own line) as the last node of `fm`. Same defensive
 * previous-node termination `uid/stamp.ts`'s `appendEmptyEntry` performs,
 * for the same reason (a real file's frontmatter can't actually reach this
 * function with an un-terminated last node, but the type doesn't forbid
 * constructing one, and the fixed-up path is exercised directly in tests).
 */
function appendMapHeader(fm: Frontmatter, key: string, terminator: '\n' | '\r\n'): Frontmatter {
  const nodes: FrontmatterNode[] = fm.nodes.slice();
  const lastIndex = nodes.length - 1;
  const last = nodes[lastIndex];

  if (last && !last.raw.endsWith('\n')) {
    nodes[lastIndex] =
      last.kind === 'entry'
        ? { ...last, raw: last.raw + terminator, valueRaw: last.valueRaw + terminator }
        : { ...last, raw: last.raw + terminator };
  }

  const entry: EntryNode = {
    kind: 'entry',
    key,
    // No trailing space after the colon: nothing follows it on this line,
    // the block map starts on the next (indented) line instead.
    raw: `${key}:${terminator}`,
    valueRaw: terminator,
  };
  nodes.push(entry);

  return { inner: nodes.map((n) => n.raw).join(''), nodes };
}

export interface AppendMapEntryResult {
  readonly frontmatter: Frontmatter;
  /** `false` when `mapKey` already carried a value — a true no-op; `value` below is the pre-existing one. */
  readonly changed: boolean;
  /** The value now present for `mapKey`, whether newly appended or pre-existing. */
  readonly value: string;
  /**
   * Span of the newly appended bytes within `frontmatter.inner` (not the
   * whole note), or `null` when `changed` is `false`. `appendFrontmatterMapEntry`
   * translates this into a whole-file `AppliedSpan`, the same "subtract the
   * insert and recover the original" proof `instrument/mcq-format.ts`'s
   * `stampMcqId` and `card-format.ts`'s stamping already use for C1.2.
   */
  readonly insertedSpan: { readonly start: number; readonly end: number } | null;
}

/**
 * Appends one `mapKey: value` line to the block map `fm` carries under
 * `key`, preserving every other byte — including every other line of that
 * same map — untouched (INV-2). Creates the top-level `key:` entry first if
 * it does not exist yet (covering the "empty/missing frontmatter" acceptance
 * case one layer down: a `Frontmatter` with zero nodes, i.e. an empty
 * frontmatter block, is handled by the same branch as a non-empty one that
 * simply lacks this key).
 *
 * Throws if the named entry already exists but is not map-shaped (a bare
 * scalar on the key's own line) — silently reinterpreting her existing
 * scalar as an empty map and appending under it would be exactly the kind
 * of silent structural reinterpretation `../frontmatter/types.ts`'s header
 * rules out YAML libraries for.
 */
export function appendMapEntry(
  fm: Frontmatter,
  key: string,
  mapKey: string,
  value: string,
): AppendMapEntryResult {
  validateMapLine(mapKey, value);

  const index = fm.nodes.findIndex(
    (node): node is EntryNode => node.kind === 'entry' && node.key === key,
  );

  if (index === -1) {
    const terminator = detectTerminator(fm);
    const withHeader = appendMapHeader(fm, key, terminator);
    const filled = setEntryValue(withHeader, key, `${terminator}  ${mapKey}: ${value}`);
    // The whole entry — both the new `key:` header line and the new map
    // line under it — is brand-new content, appended as the last node.
    const newEntry = filled.nodes[filled.nodes.length - 1];
    const newEntryRawLength = newEntry?.raw.length ?? 0;
    return {
      frontmatter: filled,
      changed: true,
      value,
      insertedSpan: {
        start: filled.inner.length - newEntryRawLength,
        end: filled.inner.length,
      },
    };
  }

  const target = fm.nodes[index];
  if (target?.kind !== 'entry') {
    throw new Error(`appendMapEntry: internal error locating key ${JSON.stringify(key)}`);
  }

  const firstLine = target.valueRaw.split(/\r?\n/)[0] ?? '';
  if (firstLine.trim() !== '') {
    throw new Error(
      `appendMapEntry: entry ${JSON.stringify(key)} already carries an inline scalar value, not a block map`,
    );
  }

  const existing = parseMapLines(target.valueRaw).find((e) => e.key === mapKey);
  if (existing) {
    return { frontmatter: fm, changed: false, value: existing.value, insertedSpan: null };
  }

  const prefixLen = fm.nodes.slice(0, index).reduce((sum, n) => sum + n.raw.length, 0);
  const terminator = /(\r?\n)/.exec(target.valueRaw)?.[1] ?? detectTerminator(fm);
  const base = /\r?\n$/.test(target.valueRaw) ? target.valueRaw : target.valueRaw + terminator;
  const newLine = `  ${mapKey}: ${value}${terminator}`;
  const newValueRaw = base + newLine;

  const filled = setEntryValue(fm, key, newValueRaw);
  return {
    frontmatter: filled,
    changed: true,
    value,
    insertedSpan: {
      start: prefixLen + target.raw.length,
      end: prefixLen + target.raw.length + newLine.length,
    },
  };
}

/** `raw`'s prefix up to and including its first line ending — the frontmatter block's opening `---` line. */
function openingDelimiterLine(raw: string): string {
  const nl = raw.indexOf('\n');
  return nl === -1 ? raw : raw.slice(0, nl + 1);
}

export interface AppendFrontmatterMapResult {
  /** The full, new file content (identical to the input when `changed` is `false`). */
  readonly content: string;
  /** `false` when `mapKey` already carried a value — a true no-op. */
  readonly changed: boolean;
  /** The value now present for `mapKey`, whether newly appended or pre-existing. */
  readonly value: string;
  /**
   * Span of the newly written bytes in `content`, or `null` when `changed`
   * is `false`. `removeSpans(content, [insertedSpan])` (`../block/edit.js`)
   * recovers the original note exactly — the direct, checkable proof that
   * this append is the *only* change (C1.2).
   */
  readonly insertedSpan: AppliedSpan | null;
}

/**
 * Whole-file entry point: appends one `mapKey: value` line to the block map
 * `content` carries under `key`, creating the map (and, if necessary, the
 * frontmatter block itself) on first use.
 *
 * Covers, by construction, every shape [D-107]'s acceptance list names:
 *
 *   - an existing map, growing by one entry, every other line untouched;
 *   - idempotence — a `mapKey` already present is a byte-identical no-op;
 *   - a frontmatter block that exists but is empty, or has no such `key`
 *     yet (`appendMapEntry`'s `index === -1` branch, reached via
 *     `parseFrontmatter('')` producing zero nodes for an empty block, same
 *     as any other frontmatter lacking the key);
 *   - no frontmatter block at all — a minimal one is created ahead of the
 *     file, exactly as `uid/stamp.ts`'s `stampNoFrontmatter` does for a
 *     single scalar, generalised to the two-line map header shape.
 */
export function appendFrontmatterMapEntry(
  content: string,
  key: string,
  mapKey: string,
  value: string,
): AppendFrontmatterMapResult {
  const doc = parseDocument(content);
  const first = doc.blocks[0];
  const fmBlock: FrontmatterBlock | undefined = first?.kind === 'frontmatter' ? first : undefined;

  if (!fmBlock) {
    validateMapLine(mapKey, value);
    const terminator = content.includes('\r\n') ? '\r\n' : '\n';
    const created = `---${terminator}${key}:${terminator}  ${mapKey}: ${value}${terminator}---${terminator}`;
    const edits: DocumentEdit[] = [{ kind: 'insert', at: 0, text: created }];
    const result = applyDocumentEdits(doc, edits);
    const insertedSpan = result.spans[0];
    if (!insertedSpan)
      throw new Error('appendFrontmatterMapEntry: internal error, missing inserted span');
    return { content: result.content, changed: true, value, insertedSpan };
  }

  const fm = parseFrontmatter(fmBlock.inner);
  const result = appendMapEntry(fm, key, mapKey, value);

  if (!result.changed || !result.insertedSpan) {
    return { content, changed: false, value: result.value, insertedSpan: null };
  }

  const newInner = serializeFrontmatter(result.frontmatter);
  const openingLine = openingDelimiterLine(fmBlock.raw);
  const closingLine = fmBlock.raw.slice(openingLine.length + fmBlock.inner.length);
  const newBlockRaw = openingLine + newInner + closingLine;

  const newContent = content.slice(0, fmBlock.start) + newBlockRaw + content.slice(fmBlock.end);
  const base = fmBlock.start + openingLine.length;
  const insertedSpan: AppliedSpan = {
    start: base + result.insertedSpan.start,
    end: base + result.insertedSpan.end,
  };

  return { content: newContent, changed: true, value, insertedSpan };
}
