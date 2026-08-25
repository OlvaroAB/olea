/**
 * Per-assessment scope (F1.7, ASC-1) — WHAT an assessment covers, as distinct
 * from ./read.ts's WHEN it is and WHAT IT'S WORTH. Nothing here answers "is
 * this likely to be on the exam" — that is a whole-course, past-paper-derived
 * judgement (F4.2's exam-likelihood ranking) and a different, probabilistic
 * thing. Per-assessment scope is narrower and more mundane: a fact the course
 * usually just states, carried verbatim, with no confidence score attached.
 *
 * Precedence, in the shape D-068 settled for a convention-varying vault (her
 * conventions are EVIDENCE that corroborates and outranks inference, never a
 * precondition without which nothing is found):
 *
 *   1. STATED  — she recorded it on the assessment note itself: a frontmatter
 *      property naming coverage (`scope`/`covers`/`coverage`/`topics`, tolerant
 *      the same way ./read.ts's `FIELD_ALIASES` is), or, failing that, the
 *      note's own body prose — most of her assessment notes are one line of
 *      plain description under the heading, and requiring a new property
 *      before that counts would be requiring a structure she hasn't adopted.
 *   2. INFERRED — built from material dated or sequenced before the
 *      assessment's due date, where nothing is stated. This module does not
 *      gather or date that material itself (that judgement belongs with
 *      whichever caller already has the corpus in hand — ../source and
 *      ../concept, not here); `resolveScope` only combines a caller-supplied,
 *      already-ordered candidate list with whatever was stated.
 *   3. ASKED — a single question at the point it matters. No code path: see
 *      features/F1-sources.md's `@manual` scenario for F1.7.
 *
 * An absent scope (neither stated nor inferrable) is not an error and not
 * reported as one — `resolveScope` returns `undefined`, and callers degrade to
 * the ordinary whole-course ranking (F4.2) rather than an empty result, the
 * same loud-not-silent posture ./read.ts already applies to unmatched columns
 * (there is simply nothing to report: an absent scope is a valid, expected
 * state, not a read failure).
 */

import { parseDocument } from '../block/parse.js';
import type { ParagraphBlock, ParsedDocument } from '../block/types.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import type { EntryNode, Frontmatter } from '../frontmatter/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';

/** How a resolved `AssessmentScope.text` came to be. */
export type AssessmentScopeOrigin = 'stated' | 'inferred';

/**
 * A resolved per-assessment scope. `text` is always verbatim — her own
 * words, or a plain naming of the material an inference drew from — never a
 * summary, a citation list, or a confidence-weighted judgement.
 */
export interface AssessmentScope {
  readonly text: string;
  readonly origin: AssessmentScopeOrigin;
}

/**
 * One piece of material a caller has already judged to precede an
 * assessment's due date (by date or by course sequence — that ordering
 * judgement is the caller's, not this module's; see the file doc). `label`
 * is what names it in the inferred scope text — a concept name, a lecture
 * title, a week label.
 */
export interface ScopeMaterialCandidate {
  readonly label: string;
}

/** Same normalisation as ./read.ts's `normalizeKey` — kept local rather than imported so this module has no dependency on the required-field column-matching machinery, which `scope` deliberately never joins (it is never required). */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

/** Aliases for a frontmatter property naming an assessment's coverage, should she ever add one. Corroborating evidence when present; its absence is never a failure — most of her assessment notes carry no such property today, and body prose (below) is the fallback that already works for those. */
const SCOPE_KEY_ALIASES: readonly string[] = ['scope', 'covers', 'coverage', 'topics'];

function findScopeEntry(fm: Frontmatter): EntryNode | undefined {
  return fm.nodes.find(
    (node): node is EntryNode =>
      node.kind === 'entry' && SCOPE_KEY_ALIASES.includes(normalizeKey(node.key)),
  );
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/**
 * Every paragraph block's text, trimmed, in document order — the note's own
 * plain-prose description of itself. Headings, lists, callouts, code and
 * frontmatter are excluded: they are structure she added, not the sentence
 * that says what the assessment covers.
 */
function bodyParagraphText(doc: ParsedDocument): string | undefined {
  const paragraphs = doc.blocks
    .filter((block): block is ParagraphBlock => block.kind === 'paragraph')
    .map((block) => block.raw.trim())
    .filter((text) => text !== '');
  return paragraphs.length > 0 ? paragraphs.join('\n\n') : undefined;
}

/**
 * Extracts whatever an already-parsed assessment note states about its own
 * coverage — a scope-aliased frontmatter property first, else its body
 * prose. Pure (no vault I/O), so ./read.ts can call it on frontmatter and a
 * document it has already parsed rather than re-reading the note.
 */
export function extractStatedScope(fm: Frontmatter, doc: ParsedDocument): string | undefined {
  const entry = findScopeEntry(fm);
  if (entry !== undefined) {
    const value = unquote(entry.valueRaw.trim());
    if (value !== '') return value;
  }
  return bodyParagraphText(doc);
}

/**
 * Reads and parses one assessment note from the vault, then extracts its
 * stated scope (see `extractStatedScope`). `undefined` for a missing note, a
 * note with no frontmatter block, or one with nothing to say about its own
 * coverage — all three are the ordinary "nothing stated" case, not an error.
 */
export async function readStatedScope(
  vault: VaultSource,
  path: VaultPath,
): Promise<string | undefined> {
  if (!(await vault.exists(path))) return undefined;
  const content = await vault.read(path);
  const doc = parseDocument(content);
  const first = doc.blocks[0];
  if (first?.kind !== 'frontmatter') return undefined;
  const fm = parseFrontmatter(first.inner);
  return extractStatedScope(fm, doc);
}

/**
 * Resolves an assessment's scope in D-068's precedence order: `stated` wins
 * wherever present, verbatim. Absent that, `candidates` — material a caller
 * has already judged to precede the assessment — are named into one inferred
 * sentence. `undefined` when neither leg has anything; callers must treat
 * that as "no scope to narrow by," never as an error (see the file doc).
 */
export function resolveScope(
  stated: string | undefined,
  candidates: readonly ScopeMaterialCandidate[] = [],
): AssessmentScope | undefined {
  if (stated !== undefined && stated !== '') return { text: stated, origin: 'stated' };
  if (candidates.length > 0) {
    return { text: candidates.map((c) => c.label).join(', '), origin: 'inferred' };
  }
  return undefined;
}
