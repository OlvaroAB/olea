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

// The cue gate (ol-zjke.1, D-625): a cheap deterministic screen that decides which sentences of a
// part go to the model that judges whether the lecturer is correcting what a slide, deck, handout
// or screen says. A sentence it skips is never judged, so it favours recall over call volume and
// leaves precision to the judge. Word lists cover English and Swedish.

// Unicode-aware word edges (Swedish letters are word characters).
const CUE_W = (alt: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'iu');

// Things a lecturer points at (course material and where it is shown).
const CUE_MEDIUM = CUE_W(
  [
    'slides?',
    'decks?',
    'handouts?',
    'screens?',
    'whiteboard',
    'blackboard',
    'board',
    'powerpoint',
    'ppt',
    'presentation',
    'notes',
    'lecture notes',
    'page',
    'sheet',
    'worksheet',
    'textbook',
    'book',
    'table',
    'figure',
    'equation',
    'formula',
    'diagram',
    'graph',
    'chart',
    'axis',
    'caption',
    'up there',
    'up here',
    'on here',
    'says here',
    'it says',
    'that says',
    'this says',
    'reads',
    'written',
    'wrote',
    'printed',
    'typed',
    'listed',
    'shown',
    'shows',
    'displayed',
    'bild',
    'bilden',
    'bilder',
    'bilderna',
    'sliden',
    'slidesen',
    'skärmen',
    'tavlan',
    'presentationen',
    'utdelningen',
    'kompendiet',
    'boken',
    'tabellen',
    'formeln',
    'figuren',
    'diagrammet',
    'där uppe',
    'står det',
    'det står',
  ].join('|'),
);

// Explicit error / discrepancy words.
const CUE_MISTAKE = CUE_W(
  [
    'mistakes?',
    'mistaken',
    'errors?',
    'typos?',
    'misprints?',
    'wrong',
    'incorrect(?:ly)?',
    'inaccurate',
    'false',
    'off',
    'miswrote',
    'mistyped',
    'misspoke',
    'misspelled',
    'incorrectly',
    'confusing',
    'misleading',
    'bug',
    'outdated',
    'fel',
    'felaktig(?:t|a)?',
    'felskrivning',
    'skrivfel',
    'tryckfel',
    'felsagt',
    'missade',
    'stämmer inte',
    'inte rätt',
    'är fel',
    'blev fel',
    'föråldrad(?:e|t)?',
  ].join('|'),
);

// Correction idioms that are corrections even with no medium named.
const CUE_STRONG: readonly RegExp[] = [
  /\b(?:it|that|this|which|they|these|those|there|he|she)\s*(?:'s|is|are|was|were)?\s*(?:really\s+|actually\s+|supposed\s+to|meant\s+to)\s*(?:be|say|read|have\s+been)\b/iu,
  /\b(?:should|ought\s+to|shoulda|should've|should\s+have)\s+(?:be|read|say|have\s+been|said|been|go)\b/iu,
  /\bshould\s+(?:actually\s+)?(?:be|read|say)\b/iu,
  /\b(?:ignore|disregard|forget|skip|never\s+mind|scratch|strike|cross|erase|delete|remove)\s+(?:that|this|it|what|the|those|these|everything|out)\b/iu,
  /\bcross(?:ed|ing)?\s+(?:that|this|it|them|those)?\s*out\b/iu,
  /\b(?:strike|scratch)\s+that\b/iu,
  /\b(?:let\s+me|i'?ll|i\s+need\s+to|i\s+have\s+to|i\s+must|i'?d\s+like\s+to|going\s+to|gonna|want\s+to|just)\s+(?:quickly\s+)?(?:correct|fix|amend|change|rectify|update|revise|redo)\b/iu,
  /\b(?:correction|correcting|corrected|rectif(?:y|ied)|retract|retraction|erratum)\b/iu,
  /\bi\s+(?:mis[a-z]+|got\s+(?:that|it|this)\s+wrong|made\s+(?:a|an)\s+\w+|messed\s+up|screwed\s+up|goofed|slipped|misremembered|said\s+(?:it\s+)?wrong|wrote\s+(?:it\s+)?wrong|typed\s+(?:it\s+)?wrong|put\s+(?:it\s+)?wrong)\b/iu,
  /\b(?:my\s+bad|my\s+mistake|my\s+error|my\s+apologies|apologies|sorry\s+about\s+that|oops|whoops|woops)\b/iu,
  /\bi\s+meant\b|\bwhat\s+i\s+meant\b|\bwhat\s+i\s+should\s+have\b|\bi\s+should\s+have\s+(?:said|written|put|typed)\b/iu,
  /\b(?:is|are|was|were)\s+(?:not\s+)?(?:actually|in\s+fact|really)\s+(?:the\s+)?(?:wrong|incorrect|a\s+typo|a\s+mistake|an\s+error)\b/iu,
  /\b(?:that|this|it|which)\s*(?:'s|is|was)\s+(?:not\s+(?:right|correct|true|quite\s+right)|wrong|incorrect|a\s+(?:typo|mistake|misprint)|an\s+error|off)\b/iu,
  /\b(?:the\s+)?(?:right|correct)\s+(?:answer|value|number|figure|formula|term|word|one|version|way|name|date|unit|sign)\s+(?:is|would\s+be|should\s+be)\b/iu,
  /\b(?:is|are|be|read|says?)\s+(?:actually|really)\s+(?:the\s+)?\S/iu,
  /\bnot\s+[^,.;]{1,40}?[,;]?\s+(?:but|rather|instead)\s+\S/iu,
  /\binstead\s+of\s+(?:what|that|this|the)\b/iu,
  /\b(?:replace|swap|change)\s+(?:that|this|it|the|\w+)\s+(?:with|to|by)\b/iu,
  /\bwhere\s+it\s+(?:says|reads|has)\b/iu,
  /\bwhat\s+(?:it|that|this|the\s+\w+)\s+(?:says|said|reads|shows)\s+(?:there|here|is|isn't|is\s+not)\b/iu,
  /\b(?:doesn't|does\s+not|don't|do\s+not|isn't|is\s+not|wasn't|aren't|not)\s+(?:quite\s+)?(?:match|add\s+up|agree|apply|hold|true|right|correct)\b/iu,
  /\bnot\s+(?:quite\s+)?(?:what|how)\s+(?:i|it|we)\b/iu,
  // Swedish
  /(?<![\p{L}\p{N}])(?:ska|borde|bör|skulle)\s+(?:egentligen\s+|alltså\s+|istället\s+)?(?:vara|stå|heta|läsa|ha\s+varit|stått)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:ignorera|bortse|glöm|stryk|stryka|sudda|stryker|struken|radera|hoppa\s+över)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:rätta|rättar|rättelse|korrigera|korrigerar|korrigering|justera|ändra|ändrar)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])jag\s+(?:skrev|sa|sade|sagt|skrivit|råkade|tänkte|menade|slarvade|missade|hade\s+fel|har\s+fel|hade\s+skrivit)\s*(?:fel|att|bara|tokigt)?(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:förlåt|ursäkta|hoppsan|oj\s+då|min\s+miss|mitt\s+fel|det\s+här\s+är\s+fel|det\s+är\s+fel)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])inte\s+[^,.;]{1,40}?[,;]?\s+(?:utan|snarare)\s+\S/iu,
  /(?<![\p{L}\p{N}])det\s+(?:stämmer|stämde)\s+(?:inte|ej)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:det\s+)?rätta\s+(?:svaret|värdet|talet|ordet)(?![\p{L}\p{N}])/iu,
];

// Weak cues that count only together with a named medium or a number.
const CUE_WEAK_DISCREPANCY = CUE_W(
  [
    'but',
    'however',
    'actually',
    'in fact',
    'really',
    'instead',
    'rather',
    'no',
    'nope',
    'not',
    "isn't",
    'differs?',
    'different',
    "doesn't",
    "don't",
    'update[ds]?',
    'old',
    'previous',
    'earlier',
    'version',
    'men',
    'egentligen',
    'faktiskt',
    'istället',
    'snarare',
    'utan',
    'nej',
    'inte',
    'annorlunda',
    'gammal',
  ].join('|'),
);

const CUE_NUMERAL =
  /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|hundred|thousand|half|percent|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|tjugo)\b/iu;

// A sentence that merely points at what the material says, expecting a fix next.
const CUE_POINTER = CUE_W(
  'says?|said|reads?|written|wrote|printed|typed|listed|shows?|has|have|put|states?|gives?|står|stod|skrivit|skrev|visar|säger|sa',
);

// A sentence that opens like a fix for a pointer in the sentence before it.
const CUE_FIX_OPENER =
  /^\W*(?:no|nope|but|actually|well|sorry|so|rather|in\s+fact|it|that|this|the\s+(?:right|correct|real)|should|nej|men|egentligen|det|den|ska|alltså|istället)\b/iu;

function cueSignals(t: string) {
  const medium = CUE_MEDIUM.test(t);
  const mistake = CUE_MISTAKE.test(t);
  const strong = CUE_STRONG.some((r) => r.test(t));
  const weak = CUE_WEAK_DISCREPANCY.test(t);
  const num = CUE_NUMERAL.test(t);
  const pointer = medium && CUE_POINTER.test(t);
  const own =
    strong ||
    (medium && mistake) ||
    (medium && weak && num) ||
    (mistake && num) ||
    (pointer && weak);
  return { medium, mistake, strong, weak, num, pointer, own };
}

/**
 * Claims that may be the lecturer correcting a slide: a CUE for the model to judge, never a
 * verdict. Whether the correction is attributable and clear is not decided here. A sentence
 * passes on a correction idiom alone, on a named medium with a mistake or discrepancy word, or
 * as the neighbour of such a sentence when the fix is spread over two.
 */
export function slideCorrectionCues(
  text: string,
): readonly { start: number; end: number; text: string }[] {
  const spans = claimSpans(text);
  const info = spans.map((s) => cueSignals(text.slice(s.start, s.end)));
  const pass: boolean[] = new Array(spans.length).fill(false);
  for (let i = 0; i < spans.length; i++) {
    const here = info[i] as ReturnType<typeof cueSignals>;
    const prev = info[i - 1];
    const next = info[i + 1];
    const nextSpan = spans[i + 1];
    if (here.own) pass[i] = true;
    // Two-sentence correction: a pointer or a bare mistake claim hands the fix to the next sentence.
    if ((here.medium || here.mistake || here.strong) && next && nextSpan) {
      const nextText = text.slice(nextSpan.start, nextSpan.end);
      const numericFix = here.pointer && CUE_NUMERAL.test(nextText);
      if (CUE_FIX_OPENER.test(nextText) || next.weak || numericFix) pass[i + 1] = true;
    }
    // Reverse: the fix comes first and the pointer after.
    if (here.pointer && prev && (prev.strong || prev.weak)) {
      pass[i - 1] = true;
      if (prev.strong) pass[i] = true;
    }
    // A bare mistake claim with no medium points at the sentence before it.
    if (here.strong && !here.medium && here.mistake && prev?.medium) pass[i - 1] = true;
  }
  return spans
    .filter((_, i) => pass[i])
    .map(({ start, end }) => ({ start, end, text: text.slice(start, end) }));
}
