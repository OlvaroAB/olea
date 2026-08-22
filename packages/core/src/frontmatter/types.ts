/**
 * The frontmatter round-trip engine (C1.3, INV-2, P1-T02).
 *
 * Nothing else in the product carries this much consequence, which is why G1
 * is a hard gate. It edits a real student's notes in place. A bug here does not
 * produce a wrong answer she can ignore — it silently rewrites the vault she has
 * spent a semester building.
 *
 * ## Why not a YAML library
 *
 * Standard YAML libraries are a **wrong answer here even when they are
 * semantically correct**, because they re-quote and re-order on emit. Measured
 * against the fixture vault at P0-T07, PyYAML on her frontmatter shapes:
 *
 *   - `related: [[A]] [[B]]`      → raises. A hard parse error. Loud, survivable.
 *   - `related: [[[A]], [[B]]]`   → parses "fine" and yields `[['A'], ['B']]`,
 *                                   silently reinterpreting each wikilink as a
 *                                   nested one-element list. **No exception.**
 *   - `related: "[[A]]"`          → becomes the plain string `[[A]]`, losing the
 *                                   link's identity.
 *
 * The second case is the one that matters: serialise that back and her links are
 * gone, with nothing raising and no test noticing unless the test asserts bytes.
 * Hence a deliberately lenient parser/emitter pair that works a line at a
 * time, and no YAML library anywhere on the round-trip path.
 *
 * ## The two paths, deliberately separated
 *
 * Reading *for meaning* and writing *for bytes* are different operations with
 * different failure modes, so this module keeps them apart:
 *
 *   - **The byte path** — `parseFrontmatter` → `serializeFrontmatter` is exactly
 *     identity, and `setEntryValue` touches one entry's line and nothing else.
 *     Everything here is `raw`. This path never interprets.
 *   - **The meaning path** — `readScalar`, `readList`, `readWikilinks` are
 *     lossy-by-design readers for consumers like F1.4's `topic` extraction.
 *     Their output **must never be fed back into serialisation**; that is how a
 *     round-trip engine grows a YAML library's bugs by the back door.
 */

/** A `key: value` entry, holding its source lines verbatim. */
export interface EntryNode {
  readonly kind: 'entry';
  /** The key text as written, without the trailing colon. */
  readonly key: string;
  /**
   * Exact source slice for this entry including every continuation line (a
   * block list's `- item` lines belong to their key) and the trailing newline.
   */
  readonly raw: string;
  /**
   * The value text exactly as written: everything after the first `:` on the
   * key line, plus any continuation lines. Leading space after the colon is
   * part of the separator, not the value.
   */
  readonly valueRaw: string;
}

/**
 * Any line that is not an entry — comments, blanks, or something we do not
 * understand. Preserved positionally and byte-for-byte.
 *
 * Leniency is a requirement, not a fallback: a line this engine cannot classify
 * must survive untouched rather than be dropped or repaired. Her vault is the
 * authority on what frontmatter looks like, not our grammar.
 */
export interface PassthroughNode {
  readonly kind: 'other';
  readonly raw: string;
}

export type FrontmatterNode = EntryNode | PassthroughNode;

export interface Frontmatter {
  /** The inner text this was parsed from, exclusive of the `---` delimiters. */
  readonly inner: string;
  readonly nodes: readonly FrontmatterNode[];
}

/**
 * THE INVARIANT, stated as a predicate so tests assert it rather than restate it:
 *
 *   nodes.map(n => n.raw).join('') === inner
 *
 * Key order, quoting style, indentation, comments, blank lines and line endings
 * all survive because nothing is ever reconstructed — only spliced.
 */
export function isFrontmatterLossless(fm: Frontmatter): boolean {
  return fm.nodes.map((n) => n.raw).join('') === fm.inner;
}

/**
 * Interpreted view of a value, for the meaning path only.
 *
 * `wikilinks` is extracted from the raw text by scanning for `[[...]]`, not by
 * parsing the value as a data structure — which is precisely the step a YAML
 * library gets wrong. `scalar` and `items` are best-effort and may both be
 * empty for a value shape we decline to interpret; that is a legitimate outcome
 * and must not be an error.
 */
export interface InterpretedValue {
  readonly scalar: string;
  readonly items: readonly string[];
  readonly wikilinks: readonly string[];
}
