/**
 * `olea-uid` stamping (C1.4, P1-T04).
 *
 * This is the first real consumer of `setEntryValue` (../frontmatter/serialize.ts)
 * outside its own test suite, and it exercises the exact defect class that
 * function's terminator-reuse fix exists to prevent: a bare replacement
 * value silently eating the entry's own line terminator and welding two
 * lines together. Stamping a note that already has frontmatter but no
 * `olea-uid` key means *inserting a brand-new entry* — an operation
 * `setEntryValue` deliberately does not do (it throws on a missing key, per
 * its own doc, rather than silently no-op-ing on a caller bug) — so this
 * module does that insertion itself as a tiny, obviously-correct step
 * (`appendEmptyEntry`, below: append one new `key:` line with an empty
 * value, using the frontmatter block's own terminator), and then routes the
 * actual value-fill through `setEntryValue` with a **bare** id string (no
 * trailing newline supplied), so the terminator-reuse path is really
 * exercised rather than bypassed by always handing it a pre-terminated
 * value.
 *
 * Idempotent by construction (P1-T04 accept criteria): a note whose
 * `olea-uid` entry already carries a non-empty value is returned
 * byte-identical, `changed: false` — re-running `stampUid` on an
 * already-stamped file is therefore always a no-op diff.
 */

import { parseDocument } from '../block/parse.js';
import type { FrontmatterBlock } from '../block/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { serializeFrontmatter, setEntryValue } from '../frontmatter/serialize.js';
import type { EntryNode, Frontmatter, FrontmatterNode } from '../frontmatter/types.js';

/** Default frontmatter key this module stamps and reads. */
export const OLEA_UID_KEY = 'olea-uid';

export interface StampUidOptions {
  /** Frontmatter key to stamp. Defaults to `olea-uid` (`OLEA_UID_KEY`). */
  readonly key?: string;
  /** Id generator, injectable for deterministic tests. Defaults to `crypto.randomUUID()`. */
  readonly generateId?: () => string;
}

export interface StampResult {
  /** The full, new file content (identical to the input when `changed` is `false`). */
  readonly content: string;
  /** `false` when the file already carried a non-empty uid — a true no-op. */
  readonly changed: boolean;
  /** The uid now present, whether newly generated or pre-existing. */
  readonly uid: string;
}

function defaultGenerateId(): string {
  return globalThis.crypto.randomUUID();
}

/** The line terminator (`\n` or `\r\n`) an existing frontmatter block uses, taken from its last node; `\n` when the block is empty (nothing to infer from). */
function detectTerminator(fm: Frontmatter): '\n' | '\r\n' {
  const last = fm.nodes[fm.nodes.length - 1];
  if (last?.raw.endsWith('\r\n')) return '\r\n';
  return '\n';
}

/**
 * Appends a brand-new entry (`key: ` + `terminator`, empty value — the same
 * "separator space, nothing after it" shape her own templates use, see
 * `04 Templates/Lecture Note Template.md`'s `course: `/`week: ` fields) as
 * the last node of `fm`. Defensively terminates the previous last node
 * first if it does not already end in a line break, so the new key line is
 * never welded onto it — the same failure class `setEntryValue`'s own
 * terminator-reuse fix guards against, handled here because *this* is the
 * insertion step, not a `setEntryValue` call.
 *
 * The placeholder's `raw` is deliberately `key: ` + terminator (not
 * `key:` + terminator) so that the prefix `setEntryValue` later recovers —
 * `raw` minus `valueRaw` — includes the separating space, and the id it
 * splices in reads as `key: <id>` rather than `key:<id>`.
 *
 * A real file's frontmatter can't actually produce an un-terminated last
 * node (the block parser requires a closing `---` on its own line, which
 * means the entry before it was always newline-terminated) — but the
 * `Frontmatter` type itself doesn't forbid constructing one directly (see
 * `stamp.spec.ts`, matching the same construction style
 * `test/frontmatter/golden.spec.ts` already uses for this exact edge case),
 * so the defensive fix-up is real code, not dead code.
 *
 * Exported for direct testing of this one edge case; `stampUid` is the only
 * real caller.
 */
export function appendEmptyEntry(
  fm: Frontmatter,
  key: string,
  terminator: '\n' | '\r\n',
): Frontmatter {
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
    raw: `${key}: ${terminator}`,
    valueRaw: terminator,
  };
  nodes.push(entry);

  return { inner: nodes.map((n) => n.raw).join(''), nodes };
}

/** `raw`'s prefix up to and including its first line ending — the frontmatter block's opening `---` line. */
function openingDelimiterLine(raw: string): string {
  const nl = raw.indexOf('\n');
  return nl === -1 ? raw : raw.slice(0, nl + 1);
}

function stampExistingFrontmatter(
  content: string,
  fmBlock: FrontmatterBlock,
  key: string,
  generateId: () => string,
): StampResult {
  const fm = parseFrontmatter(fmBlock.inner);
  const existing = fm.nodes.find((n): n is EntryNode => n.kind === 'entry' && n.key === key);

  if (existing && existing.valueRaw.trim() !== '') {
    return { content, changed: false, uid: existing.valueRaw.trim() };
  }

  const terminator = detectTerminator(fm);
  const withEntry = existing ? fm : appendEmptyEntry(fm, key, terminator);
  const id = generateId();
  // Bare value, deliberately no trailing terminator supplied — exercises
  // setEntryValue's terminator-reuse path rather than sidestepping it.
  const stamped = setEntryValue(withEntry, key, id);
  const newInner = serializeFrontmatter(stamped);

  const openingLine = openingDelimiterLine(fmBlock.raw);
  const closingLine = fmBlock.raw.slice(openingLine.length + fmBlock.inner.length);
  const newBlockRaw = openingLine + newInner + closingLine;

  const newContent = content.slice(0, fmBlock.start) + newBlockRaw + content.slice(fmBlock.end);
  return { content: newContent, changed: true, uid: id };
}

/**
 * Creates a minimal frontmatter block ahead of a file with none, stamping
 * `key` on it. **Decision, documented here since nothing in the contract
 * dictates it:** the created block is exactly
 *
 * ```
 * ---
 * olea-uid: <id>
 * ---
 * ```
 *
 * with the original file content appended immediately after — no blank
 * line inserted between the closing `---` and whatever the file's first
 * byte already was. This is a plain concatenation (`created + content`), so
 * the original body survives byte-for-byte by construction, which is what
 * this bead's acceptance criteria actually asks for; a cosmetic blank
 * separator line (matching the convention her own notes use, per the
 * fixture vault) was not requested and would be one more byte this function
 * invents rather than preserves, so it's left out.
 */
function stampNoFrontmatter(content: string, key: string, generateId: () => string): StampResult {
  const terminator = content.includes('\r\n') ? '\r\n' : '\n';
  const id = generateId();
  const created = `---${terminator}${key}: ${id}${terminator}---${terminator}`;
  return { content: created + content, changed: true, uid: id };
}

export function stampUid(content: string, options: StampUidOptions = {}): StampResult {
  const key = options.key ?? OLEA_UID_KEY;
  const generateId = options.generateId ?? defaultGenerateId;

  const doc = parseDocument(content);
  const first = doc.blocks[0];
  const fmBlock: FrontmatterBlock | undefined = first?.kind === 'frontmatter' ? first : undefined;

  if (!fmBlock) return stampNoFrontmatter(content, key, generateId);
  return stampExistingFrontmatter(content, fmBlock, key, generateId);
}
