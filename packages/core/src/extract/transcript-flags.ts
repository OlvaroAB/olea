/**
 * Uncertain-evidence flags for supplied lecture transcripts (`ol-egov.141.89.1.64`, D-465;
 * functional scope C3.6 "Uncertain evidence"; PROPOSAL section 4.6). Pure: text in, flags out.
 *
 * THREE FLAG KINDS, matching the request contract's closed set:
 *  - `inaudible`          a caption uncertainty marker: [inaudible], [unclear], (?);
 *  - `visual-reference`   a deictic reference to a visual the transcript does not carry
 *                         ("this graph", "the second equation", "as you can see");
 *  - `term-discrepancy`   a spoken word that nearly matches, but differs from, a word of a
 *                         concept name in the same teaching event's slides or notes. A CANDIDATE
 *                         only: nothing is corrected, and neither side is declared the error.
 *
 * THE PER-CLAIM RULE (`claimEligibility`). A claim here is one sentence of the part. A sentence
 * that carries a flag span is withheld from grounding, an answer key and a grading basis, and its
 * text is returned exactly as read: nothing is reconstructed or filled in. Every other sentence
 * of the same part stays usable. A candidate term applies to every sentence that uses the spoken
 * variant.
 *
 * WHERE THE MODEL TAKES OVER. This file decides only that a sentence CARRIES a flag. Whether the
 * claim's MEANING really depends on the unseen visual, the inaudible phrase or the disputed term
 * (a sentence can mention "this graph" and still be self-contained) is a judgement about meaning:
 * every withheld claim is returned with `needsModelJudgement: true` and its exact span, and the
 * default until a model has judged is to withhold. No release path exists in this file.
 * Likewise whether a lecturer's correction of a slide is attributable and clear is the model's
 * call; `reconcileSlideAndSpeech` only refuses to pick a side without it.
 *
 * Bundle terms enter as data (`bundleTerms`), never as a read of the vault: the plugin takes them
 * from the lecture bundle and hands them in (INV-1; the core knows no bundle type).
 */

export const TRANSCRIPT_FLAG_KINDS = ['inaudible', 'visual-reference', 'term-discrepancy'] as const;
export type TranscriptFlagKind = (typeof TRANSCRIPT_FLAG_KINDS)[number];

export interface TranscriptFlagSpan {
  readonly kind: TranscriptFlagKind;
  /** Half-open UTF-16 offsets into the part text. */
  readonly start: number;
  readonly end: number;
  /** For `term-discrepancy` only: the slide or notes word it nearly matches. A candidate, not proof. */
  readonly candidateOf?: string;
}

export interface TranscriptPartFlags {
  /** The distinct kinds present, in the contract's order. Empty when the part is unflagged. */
  readonly flags: readonly TranscriptFlagKind[];
  readonly spans: readonly TranscriptFlagSpan[];
}

export interface TranscriptFlagOptions {
  /** Concept names (or slide/notes terms) of the same teaching event. Absent or empty: no term check. */
  readonly bundleTerms?: readonly string[] | undefined;
}

const INAUDIBLE = /\[(?:inaudible|unclear)[^\]]*\]|\(\?\)/gi;

const VISUAL_NOUN =
  '(?:graph|chart|plot|figure|diagram|equation|formula|table|slide|picture|image|curve|map)s?';
const VISUAL_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b(?:this|that|these|those)\\s+${VISUAL_NOUN}\\b`, 'gi'),
  new RegExp(
    `\\bthe\\s+(?:first|second|third|fourth|fifth|next|previous|last|following|top|bottom|left|right)\\s+${VISUAL_NOUN}\\b`,
    'gi',
  ),
  /\bas\s+(?:you\s+can|we\s+can|i\s+can)\s+see\b/gi,
  /\bas\s+(?:shown|illustrated|drawn)\s+(?:here|above|below|on\s+the\s+(?:board|slide))\b/gi,
  /\b(?:on|in)\s+(?:this|that)\s+one\b/gi,
];

function normalise(word: string): string {
  return word.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number;
      prev[j] = Math.min(
        up + 1,
        (prev[j - 1] as number) + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = up;
    }
  }
  return prev[b.length] as number;
}

/** A plural or possessive of the same word is not a discrepancy. */
function sameWordForm(a: string, b: string): boolean {
  const strip = (w: string) => w.replace(/(?:es|s|'s)$/u, '');
  return strip(a) === strip(b);
}

const MIN_WORD_LENGTH = 5;
const MAX_EDITS = 2;

/** Whether `spoken` is a near-match of, and not the same word as, `termWord`. */
function nearlyButNotEqual(spoken: string, termWord: string): boolean {
  if (spoken === termWord || sameWordForm(spoken, termWord)) return false;
  if (spoken.length < MIN_WORD_LENGTH || termWord.length < MIN_WORD_LENGTH) return false;
  const d = editDistance(spoken, termWord);
  return d <= MAX_EDITS && d <= Math.floor(Math.min(spoken.length, termWord.length) / 4);
}

function termDiscrepancies(
  text: string,
  bundleTerms: readonly string[],
): readonly TranscriptFlagSpan[] {
  const termWords = new Set<string>();
  for (const term of bundleTerms) {
    for (const w of term.match(/\p{L}[\p{L}\p{N}'-]*/gu) ?? []) termWords.add(normalise(w));
  }
  if (termWords.size === 0) return [];
  const out: TranscriptFlagSpan[] = [];
  for (const m of text.matchAll(/\p{L}[\p{L}\p{N}'-]*/gu)) {
    const spoken = normalise(m[0]);
    // A word the slides also use is the slides' word: no candidate.
    if (termWords.has(spoken)) continue;
    for (const tw of termWords) {
      if (nearlyButNotEqual(spoken, tw)) {
        out.push({
          kind: 'term-discrepancy',
          start: m.index,
          end: m.index + m[0].length,
          candidateOf: tw,
        });
        break;
      }
    }
  }
  return out;
}

/** The flags of one transcript part. Deterministic; reconstructs nothing. */
export function flagTranscriptPart(
  text: string,
  options: TranscriptFlagOptions = {},
): TranscriptPartFlags {
  const spans: TranscriptFlagSpan[] = [];
  for (const m of text.matchAll(INAUDIBLE)) {
    spans.push({ kind: 'inaudible', start: m.index, end: m.index + m[0].length });
  }
  for (const re of VISUAL_PATTERNS) {
    for (const m of text.matchAll(re)) {
      spans.push({ kind: 'visual-reference', start: m.index, end: m.index + m[0].length });
    }
  }
  spans.push(...termDiscrepancies(text, options.bundleTerms ?? []));
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const present = new Set(spans.map((s) => s.kind));
  return { flags: TRANSCRIPT_FLAG_KINDS.filter((k) => present.has(k)), spans };
}

export interface ClaimEligibility {
  /** The claim's exact text as read, never altered. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly flags: readonly TranscriptFlagKind[];
  readonly usableForGrounding: boolean;
  readonly usableForAnswerKey: boolean;
  readonly usableForGradingBasis: boolean;
  /** True on every withheld claim: whether it truly depends on the flagged item is the model's call. */
  readonly needsModelJudgement: boolean;
}

/** The claims of a part: one per sentence, with offsets into the part text. */
function claimSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let from = 0;
  const push = (to: number) => {
    let s = from;
    let e = to;
    while (s < e && /\s/.test(text[s] as string)) s++;
    while (e > s && /\s/.test(text[e - 1] as string)) e--;
    if (e > s) out.push({ start: s, end: e });
    from = to;
  };
  for (const m of text.matchAll(/[.!?]+(?=\s|$)|\n/g)) push(m.index + m[0].length);
  push(text.length);
  return out;
}

/**
 * The per-claim eligibility of a part. A claim carrying a flag is withheld from grounding, an
 * answer key and a grading basis; the others stay usable. A candidate term withholds every claim
 * that uses the spoken variant, because the candidate is in the span of each.
 */
export function claimEligibility(
  text: string,
  partFlags: TranscriptPartFlags = flagTranscriptPart(text),
): readonly ClaimEligibility[] {
  return claimSpans(text).map(({ start, end }) => {
    const here = partFlags.spans.filter((s) => s.start < end && s.end > start);
    const kinds = TRANSCRIPT_FLAG_KINDS.filter((k) => here.some((s) => s.kind === k));
    const withheld = kinds.length > 0;
    return {
      text: text.slice(start, end),
      start,
      end,
      flags: kinds,
      usableForGrounding: !withheld,
      usableForAnswerKey: !withheld,
      usableForGradingBasis: !withheld,
      needsModelJudgement: withheld,
    };
  });
}

export type SlideSpeechOutcome =
  /** Neither the slide nor the speech is chosen; the conflict stays open. */
  | 'unresolved'
  /** A clear, attributable lecturer correction may support corrected grounding. The slide is not overwritten. */
  | 'correction-may-support-grounding';

/**
 * Slides never automatically override speech, and speech never automatically overrides a slide.
 * Only a correction the model has judged both attributable (the lecturer's) and clear lets the
 * correction support corrected grounding; every other disagreement stays unresolved.
 */
export function reconcileSlideAndSpeech(judgement: {
  readonly attributableToLecturer: boolean;
  readonly clear: boolean;
}): SlideSpeechOutcome {
  return judgement.attributableToLecturer && judgement.clear
    ? 'correction-may-support-grounding'
    : 'unresolved';
}

const CORRECTION_CUE =
  /\b(?:correction|mistake|error|typo|wrong|incorrect|misprint)\b[^.!?\n]*\b(?:slide|slides|deck)\b|\b(?:slide|slides|deck)\b[^.!?\n]*\b(?:mistake|error|typo|wrong|incorrect|misprint)\b/i;

/**
 * Claims that look like the lecturer correcting a slide: a CUE for the model to judge, never a
 * verdict. Whether the correction is attributable and clear is not decided here.
 */
export function slideCorrectionCues(
  text: string,
): readonly { start: number; end: number; text: string }[] {
  return claimSpans(text)
    .map(({ start, end }) => ({ start, end, text: text.slice(start, end) }))
    .filter((c) => CORRECTION_CUE.test(c.text));
}
