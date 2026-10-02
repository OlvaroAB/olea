/**
 * The lecture-transcript reader for plain text and declared Markdown
 * (`ol-egov.141.89.8.49`; D-464, D-465; design: olea-service
 * `docs/direction/papers/lecture-transcripts/PERSISTENCE.md` 2.3, 2.4, 2.7,
 * 2.8).
 *
 * **What it is.** A supplied lecture transcript is instructor-curated course
 * material at document grain (C3.6). It is not a note of hers, so it is never
 * a voice exemplar and never evidence of what she believes. This module turns
 * the file's text into ordered, citable *parts*; it is pure over the text and
 * the declared format, and it never writes. The vault wrapper
 * (`readTranscriptFromVault`) only calls `VaultSource.read`.
 *
 * **Explicit format handling (D-465).** The closed set of formats is
 * `TRANSCRIPT_FORMATS`. A format is resolved once from the path (and, for
 * Markdown, the file's own declaration) and checked again at read time; a
 * value the build does not read, or one it does not know, fails with a named
 * reason. `webvtt` and `srt` are *known* formats whose reader is a later bead
 * (`ol-egov.141.89.8.50`); until it is registered in `READABLE_TRANSCRIPT_FORMATS`
 * they read as "no reader for this format", never as a transcript with no
 * content and never as read.
 *
 * **Markdown is a transcript only when it declares so.** The declaration is a
 * frontmatter `role` of `transcript` or `lecture transcript` (spelling-
 * insensitive), the same key her source registration already reads. An
 * undeclared `.md` stays her note and is never given to this reader.
 *
 * **The part rule (frozen; PERSISTENCE 2.8).** Deterministic over the text and
 * the format, with declared constants (never fitted):
 *  1. The body is the whole file, or for Markdown the text after the
 *     frontmatter block. Nothing is normalised: a part's text is the exact
 *     slice of the file, so `text.slice(range.start, range.end) === part.text`.
 *  2. A paragraph is a maximal run of lines that are not blank (blank = only
 *     spaces, tabs or the line ending), trimmed of surrounding whitespace.
 *  3. Parts pack whole paragraphs in order. A part takes the next paragraph
 *     while the slice from the part's start to that paragraph's end is at most
 *     `TRANSCRIPT_PART_MAX_CHARS` UTF-16 code units.
 *  4. A paragraph longer than the limit is cut into pieces of its own: each
 *     piece ends at the last whitespace within the limit, or at the limit
 *     (never inside a surrogate pair) when there is none. Pieces are never
 *     merged with neighbours.
 *  5. The parts cover every non-whitespace character of the body, in order,
 *     once. Only whitespace between parts is outside any part.
 *  6. A body with no non-whitespace character has zero parts
 *     (`'empty-document'`).
 * Parts are numbered from 1 by position. The ordinal means something only
 * within one revision of one file; it is never compared across versions and is
 * never identity.
 *
 * **Timing.** An untimed transcript has no time range, and none is estimated
 * from length, word count or position. `TranscriptPart` has no time field at
 * all in this reader; timed formats (T3) add one that is parsed from the file,
 * never persisted.
 *
 * Changing anything above changes where parts fall. Do not, once a build
 * is installed in her vault: it needs PERSISTENCE open question 1. The golden
 * test (`transcript.reader.ol-egov.141.89.8.49.spec.ts`, the E2 pin) fails
 * on any change and says so.
 */

import { parseDocument } from '../block/parse.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readScalar } from '../frontmatter/read.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { ExtractedUnit } from './types.js';

/** The closed set of transcript formats a queued job may carry (PERSISTENCE 2.7). */
export const TRANSCRIPT_FORMATS = ['plain-text', 'markdown', 'webvtt', 'srt'] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

/**
 * The formats this build has a reader for. T3 (`ol-egov.141.89.8.50`) adds
 * `webvtt` and `srt` here when its reader lands; nothing else changes.
 */
export const READABLE_TRANSCRIPT_FORMATS: ReadonlySet<TranscriptFormat> = new Set([
  'plain-text',
  'markdown',
]);

/** Names the reader's behaviour, kept apart from the extraction workflow version (PERSISTENCE 2.7, 2.8). Bump freely when parsing or labels change; the part rule is a separate, frozen version. */
export const TRANSCRIPT_READER_VERSION = 'transcript-reader:1';

/** Names where parts fall. Frozen from the first build installed in her vault. */
export const TRANSCRIPT_PART_RULE_VERSION = 1;

/** Declared, never fitted: a part holds up to about a page of speech. UTF-16 code units. */
export const TRANSCRIPT_PART_MAX_CHARS = 1500;

export function isTranscriptFormat(value: unknown): value is TranscriptFormat {
  return typeof value === 'string' && (TRANSCRIPT_FORMATS as readonly string[]).includes(value);
}

/** The values of a Markdown file's `role` that declare it a lecture transcript, after `normalizeRole`. */
const TRANSCRIPT_ROLE_VALUES: ReadonlySet<string> = new Set(['transcript', 'lecture-transcript']);

function normalizeRole(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/** Whether a Markdown file declares itself a lecture transcript (frontmatter `role`). Pure over the text. */
export function declaresTranscript(markdown: string): boolean {
  const first = parseDocument(markdown).blocks[0];
  if (first?.kind !== 'frontmatter') return false;
  const role = readScalar(parseFrontmatter(first.inner), 'role').scalar;
  return TRANSCRIPT_ROLE_VALUES.has(normalizeRole(role));
}

/** How a path (plus, for Markdown, its text) resolves, once, at enqueue time. */
export type TranscriptFormatResolution =
  | { readonly kind: 'transcript'; readonly format: TranscriptFormat }
  /** A known or unrecognised transcript format with no reader in this build. Listed as "no reader for this format". */
  | { readonly kind: 'no-reader'; readonly format: string }
  /** Not a transcript: an undeclared `.md` keeps the ordinary note path. */
  | { readonly kind: 'not-a-transcript' };

function extensionOf(path: VaultPath): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(dot + 1).toLowerCase() : '';
}

/**
 * Resolves the format of a file the caller already treats as a candidate
 * transcript. `.txt` is plain text; `.md` is Markdown only when it declares
 * itself (`text` is required for that check, and omitting it reads as
 * undeclared); `.vtt` and `.srt` are their formats. Anything else has no reader.
 * A known format outside `READABLE_TRANSCRIPT_FORMATS` is `no-reader`.
 */
export function resolveTranscriptFormat(
  path: VaultPath,
  text?: string,
): TranscriptFormatResolution {
  const ext = extensionOf(path);
  let format: TranscriptFormat;
  switch (ext) {
    case 'txt':
      format = 'plain-text';
      break;
    case 'md':
      if (text === undefined || !declaresTranscript(text)) return { kind: 'not-a-transcript' };
      format = 'markdown';
      break;
    case 'vtt':
      format = 'webvtt';
      break;
    case 'srt':
      format = 'srt';
      break;
    default:
      return { kind: 'no-reader', format: ext === '' ? 'unknown' : ext };
  }
  return READABLE_TRANSCRIPT_FORMATS.has(format)
    ? { kind: 'transcript', format }
    : { kind: 'no-reader', format };
}

/** One cited unit of a transcript. Marked as course material the lecturer curated; never her voice. */
export interface TranscriptPart {
  /** 1-based, by position within this revision. Never identity; never compared across versions. */
  readonly ordinal: number;
  /** The exact slice of the file. */
  readonly text: string;
  /** Half-open UTF-16 offsets into the file text as `VaultSource.read` returns it. */
  readonly range: { readonly start: number; readonly end: number };
  readonly authority: 'instructor-curated-course-material';
  readonly grain: 'document';
  readonly voiceExemplar: false;
  readonly evidenceOfBelief: false;
}

export type TranscriptReadFailure =
  /** The value is not in the closed set. Names the value. */
  | { readonly reason: 'unknown-format'; readonly format: string }
  /** A known format this build does not read: "no reader for this format". */
  | { readonly reason: 'no-reader-for-format'; readonly format: TranscriptFormat }
  /** The file no longer resolves to the recorded format (its declaration removed, say). */
  | {
      readonly reason: 'format-changed';
      readonly recorded: TranscriptFormat;
      readonly now: TranscriptFormatResolution;
    }
  /** Markdown handed to the reader without the declaration. */
  | { readonly reason: 'not-declared-transcript' };

export type TranscriptReadResult =
  | {
      readonly ok: true;
      readonly format: TranscriptFormat;
      readonly readerVersion: string;
      readonly partRuleVersion: number;
      /** `'empty-document'` has no parts; it is never read as success with content. */
      readonly outcome: 'extracted' | 'empty-document';
      readonly parts: readonly TranscriptPart[];
    }
  | ({ readonly ok: false } & TranscriptReadFailure);

/** The reason a failed read states, in her terms for the first two and a plain sentence for the rest. */
export function describeTranscriptFailure(failure: TranscriptReadFailure): string {
  switch (failure.reason) {
    case 'unknown-format':
      return `no reader for this format (transcript format "${failure.format}" is not one this build knows)`;
    case 'no-reader-for-format':
      return `no reader for this format (${failure.format})`;
    case 'format-changed':
      return `the file no longer reads as a ${failure.recorded} transcript (its declaration or extension changed since it was queued)`;
    case 'not-declared-transcript':
      return 'the Markdown file does not declare itself a transcript';
  }
}

interface Span {
  start: number;
  end: number;
}

/** Paragraph spans in `[from, text.length)`, each trimmed of surrounding whitespace. */
function paragraphSpans(text: string, from: number): Span[] {
  const spans: Span[] = [];
  let paraStart = -1;
  let paraEnd = -1;
  let pos = from;
  while (pos < text.length) {
    let lineEnd = text.indexOf('\n', pos);
    const next = lineEnd === -1 ? text.length : lineEnd + 1;
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(pos, lineEnd);
    const trimmedLeft = line.length - line.trimStart().length;
    const trimmedLine = line.trim();
    if (trimmedLine === '') {
      if (paraStart !== -1) {
        spans.push({ start: paraStart, end: paraEnd });
        paraStart = -1;
      }
    } else {
      if (paraStart === -1) paraStart = pos + trimmedLeft;
      paraEnd = pos + trimmedLeft + trimmedLine.length;
    }
    pos = next;
  }
  if (paraStart !== -1) spans.push({ start: paraStart, end: paraEnd });
  return spans;
}

function isWhitespace(ch: string): boolean {
  return ch.trim() === '';
}

/** Cuts one over-long span into pieces of at most `max` code units (rule 4). */
function cutLongSpan(text: string, span: Span, max: number): Span[] {
  const pieces: Span[] = [];
  let start = span.start;
  while (start < span.end) {
    if (span.end - start <= max) {
      pieces.push({ start, end: span.end });
      break;
    }
    let cut = start + max;
    // The last whitespace at or before the limit, if any piece text precedes it.
    let ws = -1;
    for (let i = cut; i > start; i--) {
      if (isWhitespace(text.charAt(i))) {
        ws = i;
        break;
      }
    }
    if (ws > start) {
      cut = ws;
    } else {
      const code = text.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    let end = cut;
    while (end > start && isWhitespace(text.charAt(end - 1))) end -= 1;
    pieces.push({ start, end });
    start = cut;
    while (start < span.end && isWhitespace(text.charAt(start))) start += 1;
  }
  return pieces;
}

/** Where the body starts: after the frontmatter block for Markdown, else 0. */
function bodyStart(text: string, format: TranscriptFormat): number {
  if (format !== 'markdown') return 0;
  const first = parseDocument(text).blocks[0];
  return first?.kind === 'frontmatter' ? first.end : 0;
}

/** The part rule (header, rules 1-6). Pure over `text`. */
function cutParts(text: string, format: TranscriptFormat): TranscriptPart[] {
  const paragraphs = paragraphSpans(text, bodyStart(text, format));
  const spans: Span[] = [];
  let current: Span | null = null;
  for (const para of paragraphs) {
    if (para.end - para.start > TRANSCRIPT_PART_MAX_CHARS) {
      if (current) spans.push(current);
      current = null;
      spans.push(...cutLongSpan(text, para, TRANSCRIPT_PART_MAX_CHARS));
      continue;
    }
    if (current && para.end - current.start <= TRANSCRIPT_PART_MAX_CHARS) {
      current.end = para.end;
    } else {
      if (current) spans.push(current);
      current = { start: para.start, end: para.end };
    }
  }
  if (current) spans.push(current);
  return spans.map((s, i) => ({
    ordinal: i + 1,
    text: text.slice(s.start, s.end),
    range: { start: s.start, end: s.end },
    authority: 'instructor-curated-course-material',
    grain: 'document',
    voiceExemplar: false,
    evidenceOfBelief: false,
  }));
}

/**
 * Reads transcript text in a stated format. Pure; the text is never altered.
 * `format` is `unknown` on purpose: it may come from a persisted job, and an
 * unknown value is a visible failure naming it, never a guess.
 */
export function readTranscriptText(text: string, format: unknown): TranscriptReadResult {
  if (!isTranscriptFormat(format)) {
    return { ok: false, reason: 'unknown-format', format: String(format) };
  }
  if (!READABLE_TRANSCRIPT_FORMATS.has(format)) {
    return { ok: false, reason: 'no-reader-for-format', format };
  }
  if (format === 'markdown' && !declaresTranscript(text)) {
    return { ok: false, reason: 'not-declared-transcript' };
  }
  const parts = cutParts(text, format);
  return {
    ok: true,
    format,
    readerVersion: TRANSCRIPT_READER_VERSION,
    partRuleVersion: TRANSCRIPT_PART_RULE_VERSION,
    outcome: parts.length === 0 ? 'empty-document' : 'extracted',
    parts,
  };
}

/**
 * Reads a transcript file with the format recorded at enqueue, checking it
 * again against what the file is now (PERSISTENCE 2.7, "checked again at
 * drain"). Reads only; nothing is ever written into her file.
 */
export async function readTranscriptFromVault(
  vault: VaultSource,
  path: VaultPath,
  recordedFormat: unknown,
): Promise<TranscriptReadResult> {
  if (!isTranscriptFormat(recordedFormat)) {
    return { ok: false, reason: 'unknown-format', format: String(recordedFormat) };
  }
  if (!READABLE_TRANSCRIPT_FORMATS.has(recordedFormat)) {
    return { ok: false, reason: 'no-reader-for-format', format: recordedFormat };
  }
  const text = await vault.read(path);
  const now = resolveTranscriptFormat(path, text);
  if (now.kind !== 'transcript' || now.format !== recordedFormat) {
    return { ok: false, reason: 'format-changed', recorded: recordedFormat, now };
  }
  return readTranscriptText(text, recordedFormat);
}

/**
 * The parts as citable units. `page` carries the part ordinal (PERSISTENCE
 * 2.3); `charRange` is relative to the unit's own text, as `SourceLocation`
 * defines it. No `section`: an untimed transcript has no label to show beyond
 * "part n", which is worked out at presentation.
 */
export function transcriptPartsToUnits(
  sourcePath: VaultPath,
  parts: readonly TranscriptPart[],
): ExtractedUnit[] {
  return parts.map((part) => ({
    text: part.text,
    provenance: {
      sourcePath,
      location: { page: part.ordinal, charRange: { start: 0, end: part.text.length } },
    },
  }));
}
