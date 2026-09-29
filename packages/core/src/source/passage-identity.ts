/**
 * Passage identity — the ONE versioned segmentation and normalisation rule that authoring and
 * reading share (`[D-446]` option (a), ruled 2026-09-29 as decision-sheet row 42;
 * `ol-egov.141.89.5.32`).
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * `[D-093]`/`[D-292]` ask whether an instrument's OWN cited passage changed. Nothing persisted
 * says which passage of a note an instrument cites: a markdown source's cited unit is the whole
 * note, and `[D-181]` deliberately stores no character range. So the citation batch pass judged
 * the whole note, and a passage that merely MOVED was asked of the judge as a pair the targets do
 * not name. Option (a) closes that without storing any note text on the citation record: the
 * sidecar keeps one digest (`InstrumentCitation.passageDigest`, already a field), and a reader
 * that segments the current note by THIS rule can find the digest again, wherever the passage now
 * stands. That only works if the minter and the reader segment and normalise identically, which is
 * why both call this module and nothing else.
 *
 * ===========================================================================
 * THE RULE, VERSION 1
 * ===========================================================================
 * Front matter is not a passage. Otherwise the note is read line by line:
 *  - a heading line is a passage of its own and ends the block before it;
 *  - a fenced code block (``` or ~~~) is one passage, blank lines inside it included;
 *  - any other run of consecutive non-blank lines is one BLOCK passage, and, when it has two or
 *    more lines, each of its lines is ALSO a passage (a bullet, or one sentence-line of a
 *    paragraph, is a claim in its own right and is what an edit or a move usually touches).
 * Normalisation is whitespace only: every run of whitespace, line endings included, becomes one
 * space and the ends are trimmed. Case, punctuation and markup are part of a passage's identity —
 * the same normalisation `concept/revision/relocate.ts` already uses for `[D-093]`'s "exact
 * (whitespace-normalised) match elsewhere", deliberately narrower than row 1.4's
 * `canonicalizeForMateriality`, which also strips markup and so would let two different passages
 * that share plain wording read as one.
 *
 * A digest is `p<version>:<sha-256 hex of the normalised text>`. The version is IN the digest
 * text, so a digest minted under one rule can never be mistaken for, or silently compared with,
 * one minted under another: an old digest is located by its own rule while that rule stays in the
 * registry, and reads `unsupported-rule` (unresolved, never guessed) once it is retired.
 *
 * ===========================================================================
 * WHAT A DIGEST CAN AND CANNOT DO — the ruling's own qualification
 * ===========================================================================
 * A digest finds a passage that is UNCHANGED, wherever it stands: moved within its note, moved to
 * another note, re-wrapped or re-spaced. It cannot find a passage whose words were edited (the new
 * text has a different digest), and it must never pick one of two identical passages. So
 * {@link locatePassageByDigest} answers `unique`, `ambiguous` (the same text stands in two or more
 * places) or `absent` — and a caller that goes on to look for an edited passage by resemblance
 * ({@link passageRecall}) does so as its own, separately stated step, never inside this one.
 *
 * ===========================================================================
 * CHANGING THE RULE
 * ===========================================================================
 * A change to what counts as a passage or to normalisation is a NEW {@link PassageRule} with the
 * next version number, appended to {@link PASSAGE_RULES}; version 1's behaviour is frozen (its
 * tests pin it). Never edit a version in place: that would re-mean every digest already minted.
 */

import { RELOCATION_NEAR_MATCH_FLOOR } from '../concept/revision/relocate.js';
import { hashText } from '../ingestion/hash.js';
import type { InstrumentCitation } from '../instrument/citation-store.js';
import type { VaultPath, VaultSource } from '../vault/types.js';

/** The rule version new digests are minted under today. */
export const PASSAGE_RULE_VERSION = 1;

/** Whether a segment is a whole block of lines, or one line of a block that has several. */
export type PassageLevel = 'block' | 'line';
export type PassageKind = 'heading' | 'code' | 'text';

export interface PassageSegment {
  readonly level: PassageLevel;
  readonly kind: PassageKind;
  /** Character offsets into the source string this segment was cut from (`source.slice(start, end)` is {@link text}). */
  readonly start: number;
  readonly end: number;
  /** The segment's raw text, exactly as it stands in the source (line endings included). */
  readonly text: string;
  /** {@link text} under the rule's normalisation — what identity, digests and comparisons are taken over. */
  readonly normalised: string;
  /** How many lines the span covers (1 for a line-level segment and for a one-line block). */
  readonly lineCount: number;
}

/** One versioned segmentation-and-normalisation rule. Pure: no I/O, no clock, no randomness. */
export interface PassageRule {
  readonly version: number;
  readonly normalise: (text: string) => string;
  readonly segment: (source: string) => readonly PassageSegment[];
}

// ---- version 1 -------------------------------------------------------------------------------

interface Line {
  readonly start: number;
  /** Exclusive end of the line's content, the terminator not included. */
  readonly end: number;
  readonly content: string;
}

function splitLines(source: string): readonly Line[] {
  const lines: Line[] = [];
  const terminator = /\r\n|\r|\n/g;
  let start = 0;
  let match: RegExpExecArray | null = terminator.exec(source);
  while (match !== null) {
    lines.push({ start, end: match.index, content: source.slice(start, match.index) });
    start = match.index + match[0].length;
    match = terminator.exec(source);
  }
  lines.push({ start, end: source.length, content: source.slice(start) });
  return lines;
}

const BOM = '﻿';
const HEADING_LINE = /^\s{0,3}#{1,6}(\s|$)/;
const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;

function normaliseV1(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isBlank(content: string): boolean {
  return content.trim() === '';
}

function segmentV1(source: string): readonly PassageSegment[] {
  const lines = splitLines(source);
  const segments: PassageSegment[] = [];

  const push = (
    level: PassageLevel,
    kind: PassageKind,
    first: Line,
    last: Line,
    lineCount: number,
  ): void => {
    const text = source.slice(first.start, last.end);
    const normalised = normaliseV1(text);
    if (normalised.length === 0) return;
    segments.push({ level, kind, start: first.start, end: last.end, text, normalised, lineCount });
  };

  let index = 0;

  // Front matter: only at the very top, and only when a closing `---` line exists (the same
  // convention `block/parse.ts` uses; a leading BOM is tolerated on the opening line).
  const opening = lines[0];
  if (opening !== undefined && opening.content.replace(BOM, '') === '---') {
    for (let k = 1; k < lines.length; k++) {
      if (lines[k]?.content === '---') {
        index = k + 1;
        break;
      }
    }
  }

  let run: Line[] = [];
  const flushRun = (): void => {
    const first = run[0];
    const last = run[run.length - 1];
    if (first === undefined || last === undefined) return;
    push('block', 'text', first, last, run.length);
    if (run.length >= 2) {
      for (const line of run) push('line', 'text', line, line, 1);
    }
    run = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    const matchable = index === 0 ? line.content.replace(BOM, '') : line.content;

    const fence = FENCE_LINE.exec(matchable);
    if (fence !== null) {
      flushRun();
      const marker = fence[1] ?? '```';
      const fenceChar = marker.charAt(0);
      let close = index + 1;
      let closed = false;
      while (close < lines.length) {
        const candidate = lines[close]?.content ?? '';
        const closing = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(candidate);
        if (closing !== null) {
          const closingMarker = closing[1] ?? '';
          if (closingMarker.charAt(0) === fenceChar && closingMarker.length >= marker.length) {
            closed = true;
            break;
          }
        }
        close += 1;
      }
      const lastIndex = closed ? close : lines.length - 1;
      const lastLine = lines[lastIndex];
      if (lastLine !== undefined) push('block', 'code', line, lastLine, lastIndex - index + 1);
      index = lastIndex + 1;
      continue;
    }

    if (isBlank(matchable)) {
      flushRun();
      index += 1;
      continue;
    }

    if (HEADING_LINE.test(matchable)) {
      flushRun();
      push('block', 'heading', line, line, 1);
      index += 1;
      continue;
    }

    run.push(line);
    index += 1;
  }
  flushRun();

  return segments;
}

export const PASSAGE_RULE_V1: PassageRule = {
  version: 1,
  normalise: normaliseV1,
  segment: segmentV1,
};

/**
 * Every rule this build can still read, ascending by version. Append-only: a version is retired
 * only by a deliberate, reviewed removal, after which its digests read `unsupported-rule`.
 */
export const PASSAGE_RULES: readonly PassageRule[] = [PASSAGE_RULE_V1];

/** The rule new digests are minted under. */
export function currentPassageRule(rules: readonly PassageRule[] = PASSAGE_RULES): PassageRule {
  let best: PassageRule | undefined;
  for (const rule of rules) if (best === undefined || rule.version > best.version) best = rule;
  if (best === undefined) throw new Error('currentPassageRule: no passage rule is registered');
  return best;
}

export const CURRENT_PASSAGE_RULE: PassageRule = currentPassageRule();

// ---- the shared operations -------------------------------------------------------------------

/** `text` under `rule`'s normalisation (whitespace and line endings only, in version 1). */
export function normalisePassageText(
  text: string,
  rule: PassageRule = CURRENT_PASSAGE_RULE,
): string {
  return rule.normalise(text);
}

/** `source` cut into passages by `rule` — the segmentation authoring and reading both use. */
export function segmentPassages(
  source: string,
  rule: PassageRule = CURRENT_PASSAGE_RULE,
): readonly PassageSegment[] {
  return rule.segment(source);
}

/** The digest of a passage's text under `rule`: `p<version>:<sha-256 hex of the normalised text>`. */
export async function digestPassage(
  text: string,
  rule: PassageRule = CURRENT_PASSAGE_RULE,
): Promise<string> {
  return `p${rule.version}:${await hashText(rule.normalise(text))}`;
}

/** Splits a digest into its rule version and hash, or `null` when it is not one of ours. */
export function parsePassageDigest(digest: string): { version: number; hash: string } | null {
  const match = /^p([1-9]\d*):([0-9a-f]+)$/.exec(digest);
  if (match === null) return null;
  return { version: Number(match[1]), hash: match[2] ?? '' };
}

export type PassageLocation =
  | { readonly status: 'unique'; readonly segment: PassageSegment }
  /** The same text stands in `count` places: which one was cited cannot be told, so none is chosen. */
  | { readonly status: 'ambiguous'; readonly count: number }
  | { readonly status: 'absent' };

/** Finds the segment whose normalised text is exactly `normalised` — sync, for a caller that already holds the passage's text. */
export function locatePassageByText(
  segments: readonly PassageSegment[],
  normalised: string,
): PassageLocation {
  const matches = segments.filter((segment) => segment.normalised === normalised);
  const first = matches[0];
  if (first === undefined) return { status: 'absent' };
  if (matches.length === 1) return { status: 'unique', segment: first };
  return { status: 'ambiguous', count: matches.length };
}

export type DigestLocation =
  | PassageLocation
  /** The digest names a rule this build no longer (or does not yet) carries: unresolved, never guessed. */
  | { readonly status: 'unsupported-rule'; readonly version: number }
  | { readonly status: 'malformed' };

/**
 * Finds the passage `digest` names in `source`, segmenting by the digest's OWN rule version. The
 * answer is `unique`, `ambiguous` or `absent`, or — when the rule is not registered —
 * `unsupported-rule`; never a nearest match.
 */
export async function locatePassageByDigest(
  source: string,
  digest: string,
  rules: readonly PassageRule[] = PASSAGE_RULES,
): Promise<DigestLocation> {
  const parsed = parsePassageDigest(digest);
  if (parsed === null) return { status: 'malformed' };
  const rule = rules.find((candidate) => candidate.version === parsed.version);
  if (rule === undefined) return { status: 'unsupported-rule', version: parsed.version };

  const segments = rule.segment(source);
  // Hash each distinct text once: a note that repeats a line pays for it once, and a segment
  // whose text is shorter than its block twin costs no more than the block did.
  const hashByText = new Map<string, string>();
  const matches: PassageSegment[] = [];
  for (const segment of segments) {
    let hash = hashByText.get(segment.normalised);
    if (hash === undefined) {
      hash = await hashText(segment.normalised);
      hashByText.set(segment.normalised, hash);
    }
    if (hash === parsed.hash) matches.push(segment);
  }
  const first = matches[0];
  if (first === undefined) return { status: 'absent' };
  if (matches.length === 1) return { status: 'unique', segment: first };
  return { status: 'ambiguous', count: matches.length };
}

export type PassageCitation =
  | { readonly status: 'cited'; readonly digest: string; readonly segment: PassageSegment }
  | { readonly status: 'ambiguous'; readonly count: number }
  | { readonly status: 'absent' };

/**
 * Authoring's half: cite `passageText` in `source`. Mints a digest only when the passage stands
 * exactly once as a passage under the rule — a digest for a passage that already stands twice, or
 * for text the rule cannot segment out, would be unresolvable from the day it was written.
 */
export async function citePassage(
  source: string,
  passageText: string,
  rule: PassageRule = CURRENT_PASSAGE_RULE,
): Promise<PassageCitation> {
  const located = locatePassageByText(rule.segment(source), rule.normalise(passageText));
  if (located.status !== 'unique') return located;
  return {
    status: 'cited',
    digest: await digestPassage(located.segment.text, rule),
    segment: located.segment,
  };
}

/**
 * The note's only body passage: the single block-level segment that is not a heading, when there
 * is exactly one. Undefined for a note with none, or with several (which of them a question was
 * drafted from is then not something this module can say).
 */
export function soleBlockPassage(
  source: string,
  rule: PassageRule = CURRENT_PASSAGE_RULE,
): PassageSegment | undefined {
  const bodyBlocks = rule
    .segment(source)
    .filter((segment) => segment.level === 'block' && segment.kind !== 'heading');
  return bodyBlocks.length === 1 ? bodyBlocks[0] : undefined;
}

// ---- resemblance, for a caller that must look for an EDITED passage -------------------------------

function tokensOf(normalised: string): ReadonlySet<string> {
  return new Set(
    normalised
      .toLowerCase()
      .split(' ')
      .filter((token) => token.length > 0),
  );
}

/**
 * The share of `oldNormalised`'s words that also appear in `candidateNormalised` — the same
 * "how much of the OLD passage survives" measure `concept/revision/relocate.ts` uses for its near
 * match, so a caller comparing against {@link PASSAGE_RESEMBLANCE_FLOOR} reads it the same way.
 */
export function passageRecall(oldNormalised: string, candidateNormalised: string): number {
  const old = tokensOf(oldNormalised);
  if (old.size === 0) return 0;
  const candidate = tokensOf(candidateNormalised);
  let shared = 0;
  for (const token of old) if (candidate.has(token)) shared += 1;
  return shared / old.size;
}

/** The floor below which a segment is not read as resembling an old passage at all: `[D-093]`'s own declared near-match floor. */
export const PASSAGE_RESEMBLANCE_FLOOR = RELOCATION_NEAR_MATCH_FLOOR;

// ---- authoring: seal a citation ---------------------------------------------------------------

/**
 * What {@link sealCitationPassage} did with a citation's passage digest:
 *  - `not-applicable`: the cited source is not a separate markdown note in the vault (a PDF, the
 *    instrument's own note, an unreadable file), so there is nothing to segment and the citation is
 *    returned exactly as it came;
 *  - `kept`: a digest the caller supplied resolves to exactly one passage of the source;
 *  - `minted`: none was supplied and the source has exactly one body passage, so the digest is that
 *    passage's;
 *  - `dropped`: a digest was supplied but does not resolve to exactly one passage now (ambiguous,
 *    absent, unsupported rule, malformed) — it is removed rather than written, since a digest that
 *    cannot be found again would leave the instrument permanently unresolved.
 * An instrument left with no digest keeps today's whole-note grain; that is the ruling's "ambiguity
 * stays unresolved", not a failure.
 */
export type CitationPassageOutcome = 'not-applicable' | 'kept' | 'minted' | 'dropped';

function isMarkdownPath(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * Authoring's one call, at the moment a generated instrument's citation sidecar is written
 * (`materialize-mcq.ts`, `materialize-card.ts`). It reads the cited source note, segments it by
 * the shared rule, and returns the citation carrying a digest only where the passage is
 * identifiable without guessing. Never throws: a source it cannot read leaves the citation as it
 * was.
 *
 * `ownNotePath` is the note the instrument itself is written into. A citation naming that note is
 * the self-referential fallback (`materialize-card.ts`'s `[D-366]` write), whose "source" carries
 * the instrument block itself, so no passage is sealed for it.
 */
export async function sealCitationPassage(
  vault: VaultSource,
  citation: InstrumentCitation,
  ownNotePath: VaultPath,
  rules: readonly PassageRule[] = PASSAGE_RULES,
): Promise<{ readonly citation: InstrumentCitation; readonly outcome: CitationPassageOutcome }> {
  const withoutDigest = (): InstrumentCitation => {
    const { passageDigest: _dropped, ...rest } = citation;
    return rest;
  };
  const source = citation.sourcePath;
  if (!isMarkdownPath(source) || source === ownNotePath) {
    return { citation, outcome: 'not-applicable' };
  }
  let text: string;
  try {
    if (!(await vault.exists(source))) {
      return citation.passageDigest === undefined
        ? { citation, outcome: 'not-applicable' }
        : { citation: withoutDigest(), outcome: 'dropped' };
    }
    text = await vault.read(source);
  } catch {
    return { citation, outcome: 'not-applicable' };
  }

  if (citation.passageDigest !== undefined) {
    const located = await locatePassageByDigest(text, citation.passageDigest, rules);
    return located.status === 'unique'
      ? { citation, outcome: 'kept' }
      : { citation: withoutDigest(), outcome: 'dropped' };
  }

  const rule = currentPassageRule(rules);
  const sole = soleBlockPassage(text, rule);
  if (sole === undefined) return { citation, outcome: 'not-applicable' };
  return {
    citation: { ...citation, passageDigest: await digestPassage(sole.text, rule) },
    outcome: 'minted',
  };
}
