/**
 * Transcript part grain — where a cited lecture-transcript passage stands in the transcript's
 * current version, found by its text alone (`ol-egov.141.89.5.43`; `[D-465]` item 8, `[D-467]`;
 * design: olea-service `docs/direction/papers/lecture-transcripts/PERSISTENCE.md` sections 2.2,
 * 2.3, 2.5, 2.6 and 2.9). Pure over what it is given, except {@link readTranscriptVersion}, which
 * only reads.
 *
 * ===========================================================================
 * WHAT IDENTIFIES A CITED PASSAGE
 * ===========================================================================
 * Its spoken text, never its part. A part number names a position within ONE version of one file
 * (core `extract/transcript.ts`: "never identity; never compared across versions"), so it is read
 * only to seed an anchor from the very version the citation was drafted from (the sidecar's
 * `sourceRevision` equal to the current bytes hash, {@link seedFromCitedPart}). From then on the
 * anchor holds the passage's text and every later version is searched for that text.
 *
 * The spoken-text stream is every part's text in order with whitespace collapsed, so where part
 * or cue boundaries now fall never changes the answer (a split cue, two merged cues, a re-cut
 * export). The reader keeps speaker labels inside the part text (it parses none), so a changed
 * label reads as changed text: more judging, never a wrong match.
 *
 * ===========================================================================
 * THE LADDER — {@link resolveTranscriptPassage}
 * ===========================================================================
 *  1. EXACT: the passage's words stand exactly once in the stream: `present`, no judge. Twice or
 *     more: `ambiguous` (which one was cited cannot be told).
 *  2. RESEMBLING: windows of the stream as long as the passage are scored by the share of the
 *     passage's distinct words each keeps (the same measure as core's `passageRecall`, lower-cased
 *     and split on spaces). Runs of windows at or above the declared floor
 *     (`PASSAGE_RESEMBLANCE_FLOOR`, one third, `[D-093]`) are candidate regions. Exactly one region,
 *     localised: `changed`, and its text is what the materiality judge reads against the old
 *     passage (`[D-293]`: the changed region, never the whole transcript). Two or more: `ambiguous`.
 *     None: `missing`. LOCALISED means every resembling window of the region overlaps the one
 *     edited occurrence found in it; a window that resembles the passage without touching that
 *     occurrence does so through words the whole stream shares (the glue of speech), so the
 *     correspondence is `ambiguous`. Found by a synthetic case: a passage of one short cue, half of
 *     whose distinct words are glue words, cleared the floor against every window of an unrelated
 *     lecture, as one stream-long region that would otherwise have been judged as its new version.
 *  3. NEVER ELSEWHERE. Only the one file the anchor names is read. Equal text in another file, a
 *     lecture link, a shared stem or folder, or a part label is never lineage (PERSISTENCE 2.2);
 *     continuity across files comes only from a rename Olea saw (`CitationRevisionTrigger.
 *     onSourceRenamed`).
 *
 * Inside the one region, the changed passage's extent is found by a local word alignment
 * (match +2, mismatch -1, gap -1) of the old passage against the region, widened at either end by
 * as many words as the old passage had there unaligned, so a corrected first or last word stays
 * inside it. That only decides which words the judge reads as "now"; whether there is one region
 * is decided by the floor alone. A lecture reuses its vocabulary, so several regions may clear the
 * floor: the result is more withholding, never a wrong match (PERSISTENCE 2.5, "A risk in the
 * floor"); a different floor for transcripts is a threshold change and goes through a decision.
 */

import {
  digestPassage,
  hashContent,
  PASSAGE_RESEMBLANCE_FLOOR,
  readTranscriptText,
  resolveTranscriptFormat,
  type TranscriptFormat,
  type VaultPath,
  type VaultSource,
} from 'olea-core';

/** Extensions that make a file a transcript by its path alone; Markdown is one only when it declares so. */
const TRANSCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['txt', 'vtt', 'srt']);

function extensionOf(path: VaultPath): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(dot + 1).toLowerCase() : '';
}

/** Whether `path` is a transcript by its extension alone (plain text, WebVTT, SRT). */
export function hasTranscriptExtension(path: VaultPath): boolean {
  return TRANSCRIPT_EXTENSIONS.has(extensionOf(path));
}

/** A passage's spoken text: whitespace collapsed to single spaces, trimmed. */
export function spokenText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function wordsOf(text: string): string[] {
  const spoken = spokenText(text);
  return spoken === '' ? [] : spoken.split(' ');
}

/** One version of one transcript file, as the reader cuts it. Held in memory for one pass only. */
export interface TranscriptVersion {
  readonly path: VaultPath;
  readonly format: TranscriptFormat;
  /** The file's bytes hash (`hashContent` over `readBinary`): the value a citation's `sourceRevision` records. */
  readonly bytesHash: string;
  readonly parts: readonly { readonly ordinal: number; readonly spoken: string }[];
  /** The spoken-text stream: every part's words, in order. */
  readonly words: readonly string[];
}

export type TranscriptRead =
  | { readonly kind: 'read'; readonly version: TranscriptVersion }
  | { readonly kind: 'absent' }
  /** An undeclared Markdown file: her note, never read as a transcript. */
  | { readonly kind: 'not-a-transcript' }
  /** A transcript this build has no reader for, or whose read failed. */
  | { readonly kind: 'unreadable' };

/** Reads `path` as a transcript, by the format its path (and, for Markdown, its declaration) resolves to. Reads only. */
export async function readTranscriptVersion(
  vault: VaultSource,
  path: VaultPath,
): Promise<TranscriptRead> {
  try {
    if (!(await vault.exists(path))) return { kind: 'absent' };
    const text = await vault.read(path);
    const resolution = resolveTranscriptFormat(path, text);
    if (resolution.kind === 'not-a-transcript') return { kind: 'not-a-transcript' };
    if (resolution.kind === 'no-reader') return { kind: 'unreadable' };
    const result = readTranscriptText(text, resolution.format);
    if (!result.ok) return { kind: 'unreadable' };
    const bytesHash = await hashContent(await vault.readBinary(path));
    const parts = result.parts.map((part) => ({
      ordinal: part.ordinal,
      spoken: spokenText(part.text),
    }));
    const words = parts.flatMap((part) => wordsOf(part.spoken));
    return { kind: 'read', version: { path, format: resolution.format, bytesHash, parts, words } };
  } catch {
    return { kind: 'unreadable' };
  }
}

export type TranscriptPassageResolution =
  /** Exactly once, unchanged. `text` is the passage as the anchor holds it, normalised. */
  | { readonly kind: 'present'; readonly text: string }
  /** One region resembles it: `text` is that region's spoken text now, for the judge. */
  | { readonly kind: 'changed'; readonly text: string }
  | { readonly kind: 'unresolved'; readonly reason: 'missing' | 'ambiguous' };

/** How many times `passage` stands, word for word, in `words` (overlapping occurrences count). Stops at two. */
function exactOccurrences(passage: readonly string[], words: readonly string[]): number {
  let found = 0;
  for (let i = 0; i + passage.length <= words.length; i += 1) {
    let j = 0;
    while (j < passage.length && words[i + j] === passage[j]) j += 1;
    if (j === passage.length) {
      found += 1;
      if (found > 1) return found;
    }
  }
  return found;
}

interface Region {
  /** First word of the region in the stream. */
  readonly start: number;
  /** One past its last word. */
  readonly end: number;
}

/** Runs of passage-length windows whose share of the passage's distinct words is at or above the floor (module doc, rung 2). */
function resemblingRegions(passage: readonly string[], words: readonly string[]): Region[] {
  const target = new Set(passage.map((word) => word.toLowerCase()));
  if (target.size === 0 || words.length === 0) return [];
  const lower = words.map((word) => word.toLowerCase());
  const width = Math.min(passage.length, lower.length);
  const counts = new Map<string, number>();
  let covered = 0;
  const add = (token: string): void => {
    if (!target.has(token)) return;
    const count = counts.get(token) ?? 0;
    if (count === 0) covered += 1;
    counts.set(token, count + 1);
  };
  const drop = (token: string): void => {
    if (!target.has(token)) return;
    const count = counts.get(token) ?? 0;
    if (count === 1) covered -= 1;
    counts.set(token, Math.max(0, count - 1));
  };
  for (let k = 0; k < width; k += 1) add(lower[k] as string);
  const regions: Region[] = [];
  const last = lower.length - width;
  let runStart = -1;
  for (let i = 0; i <= last; i += 1) {
    if (i > 0) {
      drop(lower[i - 1] as string);
      add(lower[i + width - 1] as string);
    }
    const resembles = covered / target.size >= PASSAGE_RESEMBLANCE_FLOOR;
    if (resembles && runStart === -1) runStart = i;
    if (!resembles && runStart !== -1) {
      regions.push({ start: runStart, end: i - 1 + width });
      runStart = -1;
    }
  }
  if (runStart !== -1) regions.push({ start: runStart, end: last + width });
  return regions;
}

const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;
/** Above this many alignment cells the whole region is the changed text: never wrong, only wider. */
const MAX_ALIGNMENT_CELLS = 4_000_000;

/**
 * The changed passage's extent within `region` (module doc, the alignment paragraph), as stream
 * word offsets. `undefined` when nothing aligns.
 */
function changedExtent(
  passage: readonly string[],
  words: readonly string[],
  region: Region,
): Region | undefined {
  const a = passage.map((word) => word.toLowerCase());
  const slice = words.slice(region.start, region.end);
  const b = slice.map((word) => word.toLowerCase());
  if (a.length * b.length > MAX_ALIGNMENT_CELLS) return region;
  const cols = b.length + 1;
  const score = new Int32Array((a.length + 1) * cols);
  let best = 0;
  let bestI = 0;
  let bestJ = 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const diagonal =
        (score[(i - 1) * cols + j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? MATCH : MISMATCH);
      const up = (score[(i - 1) * cols + j] ?? 0) + GAP;
      const left = (score[i * cols + j - 1] ?? 0) + GAP;
      const value = Math.max(0, diagonal, up, left);
      score[i * cols + j] = value;
      if (value > best) {
        best = value;
        bestI = i;
        bestJ = j;
      }
    }
  }
  if (best === 0) return undefined;
  let i = bestI;
  let j = bestJ;
  while (i > 0 && j > 0 && (score[i * cols + j] ?? 0) > 0) {
    const value = score[i * cols + j] ?? 0;
    const diagonal =
      (score[(i - 1) * cols + j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? MATCH : MISMATCH);
    if (value === diagonal) {
      i -= 1;
      j -= 1;
    } else if (value === (score[(i - 1) * cols + j] ?? 0) + GAP) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  // Aligned: passage words [i, bestI) against region words [j, bestJ). Widen by the unaligned ends.
  const from = Math.max(0, j - i);
  const to = Math.min(b.length, bestJ + (a.length - bestI));
  return { start: region.start + from, end: region.start + to };
}

/**
 * Whether every resembling window of `region` overlaps the one edited occurrence at `extent`. A
 * window resembles an edited passage by overlapping it; one that resembles it without touching it
 * resembles it through words the whole stream shares (the glue of speech, a recurring term), so
 * the correspondence is not localised and is ambiguous. No number of its own: it reads the same
 * windows the floor already selected.
 */
function isLocalised(region: Region, extent: Region, width: number): boolean {
  const firstWindowEnd = region.start + width;
  const lastWindowStart = region.end - width;
  return firstWindowEnd > extent.start && lastWindowStart < extent.end;
}

/** Where `anchorText` stands in a version's spoken-text stream (module doc, the ladder). */
export function resolveTranscriptPassage(
  anchorText: string,
  words: readonly string[],
): TranscriptPassageResolution {
  const passage = wordsOf(anchorText);
  if (passage.length === 0) return { kind: 'unresolved', reason: 'missing' };
  const exact = exactOccurrences(passage, words);
  if (exact === 1) return { kind: 'present', text: passage.join(' ') };
  if (exact > 1) return { kind: 'unresolved', reason: 'ambiguous' };
  const regions = resemblingRegions(passage, words);
  const only = regions[0];
  if (only === undefined) return { kind: 'unresolved', reason: 'missing' };
  if (regions.length > 1) return { kind: 'unresolved', reason: 'ambiguous' };
  const extent = changedExtent(passage, words, only);
  if (extent === undefined || extent.end <= extent.start) {
    return { kind: 'unresolved', reason: 'missing' };
  }
  if (!isLocalised(only, extent, Math.min(passage.length, words.length))) {
    return { kind: 'unresolved', reason: 'ambiguous' };
  }
  return { kind: 'changed', text: words.slice(extent.start, extent.end).join(' ') };
}

/**
 * `[D-567]` (functional scope C5.3, "Which part"): the part one passage names in one transcript
 * version. A citation names a part only when its question was drafted from a single passage that
 * names it, so this answers only when the passage's words stand exactly once in the version's
 * spoken text and that one occurrence lies inside a single part. Anything else (no words, absent,
 * standing twice, or running across a part boundary) is `undefined`: the citation then names no
 * part and the whole transcript is protected, as a note is under `[D-543]`.
 *
 * The part is recorded as the citation's `page` (the part ordinal, a label in this version only)
 * and `passageDigest`: the digest of the part's spoken text, under the passage rule's own
 * whitespace-only normalisation, which is exactly the text a part-grain anchor is seeded with.
 * Its presence is what says a part is named; its absence is the whole-transcript grain, the same
 * representation `[D-543]` reads for a note (a citation with no passage digest). No field is added.
 */
export async function namedTranscriptPart(
  parts: readonly { readonly ordinal: number; readonly spoken: string }[],
  passage: string,
): Promise<{ readonly page: number; readonly passageDigest: string } | undefined> {
  const wanted = wordsOf(passage);
  if (wanted.length === 0) return undefined;
  const bounds: {
    readonly ordinal: number;
    readonly spoken: string;
    readonly start: number;
    readonly end: number;
  }[] = [];
  const words: string[] = [];
  for (const part of parts) {
    const own = wordsOf(part.spoken);
    bounds.push({
      ordinal: part.ordinal,
      spoken: part.spoken,
      start: words.length,
      end: words.length + own.length,
    });
    words.push(...own);
  }
  let at = -1;
  for (let i = 0; i + wanted.length <= words.length; i += 1) {
    let j = 0;
    while (j < wanted.length && words[i + j] === wanted[j]) j += 1;
    if (j < wanted.length) continue;
    if (at !== -1) return undefined; // stands twice: which one it was drafted from cannot be told
    at = i;
  }
  if (at === -1) return undefined;
  const holder = bounds.find((bound) => bound.start <= at && at + wanted.length <= bound.end);
  if (holder === undefined) return undefined; // runs across a part boundary: no single part
  return { page: holder.ordinal, passageDigest: await digestPassage(holder.spoken) };
}

export type TranscriptSeed =
  | { readonly kind: 'seeded'; readonly text: string }
  | {
      readonly kind: 'withheld';
      readonly reason: 'passage-missing' | 'passage-ambiguous';
      /** What was observed, for keying the hold to the state checked: the bytes hash, or empty. */
      readonly observed: string;
    };

/**
 * PERSISTENCE 2.9: an anchor is seeded from the citation's part number only in the version the
 * citation was drafted from (the current bytes hash equal to `sourceRevision`), and only when that
 * part's text stands exactly once in the version. Anything less is withheld: a citation with no
 * recorded version, a changed file, a missing part, or text that stands twice.
 */
export function seedFromCitedPart(
  version: TranscriptVersion | undefined,
  citation: { readonly page?: number; readonly sourceRevision?: string } | undefined,
): TranscriptSeed {
  const observed = version?.bytesHash ?? '';
  if (
    version === undefined ||
    citation?.page === undefined ||
    citation.sourceRevision === undefined ||
    citation.sourceRevision !== version.bytesHash
  ) {
    return { kind: 'withheld', reason: 'passage-missing', observed };
  }
  const part = version.parts.find((candidate) => candidate.ordinal === citation.page);
  if (part === undefined || part.spoken === '') {
    return { kind: 'withheld', reason: 'passage-missing', observed };
  }
  const located = resolveTranscriptPassage(part.spoken, version.words);
  if (located.kind !== 'present') {
    return { kind: 'withheld', reason: 'passage-ambiguous', observed };
  }
  return { kind: 'seeded', text: located.text };
}

/**
 * The presentation-time half, for the session's own check (`review/open-session.ts`'s
 * `citedPassageUnchanged` would call it for a transcript anchor; not wired yet, see
 * `ol-egov.141.89.5.43`'s hand-back): true only when the anchored passage stands, exactly and
 * once, in the transcript at the anchor's path now. Reads only; every failure is `false`.
 */
export async function transcriptAnchorStandsUnchanged(
  vault: VaultSource,
  anchor: { readonly sourcePath: VaultPath; readonly text: string },
): Promise<boolean> {
  if (anchor.text === '') return false;
  const read = await readTranscriptVersion(vault, anchor.sourcePath);
  if (read.kind !== 'read') return false;
  return resolveTranscriptPassage(anchor.text, read.version.words).kind === 'present';
}
