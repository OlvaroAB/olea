/**
 * The card-style profile (F3.9, `[D-101]`) — "measured off her existing
 * cards... median 9-word fronts, 8-word backs, stems opening What/Which/How/
 * Why/In, and roughly 1 in 5 answers enumerating a list. Recompute the
 * profile as her own cards accumulate." (functional scope F3.9). Bound to
 * `features/F3-learn-from-anything.md`'s "The style profile measures
 * confident-hers material only" (`@auto:core/generate/style-profile.spec`).
 *
 * **Shed line for `ol-p3t07c`.** The full recompute-from-her-accumulating-
 * corpus pipeline needs a real per-student card scan classified by `[D-101]`
 * — that classifier is F1's block (unbuilt today; same boundary
 * `voice-sources.ts` draws), and reading her vault's card corpus is not a
 * file this bead owns. What this file builds in full instead: the PURE
 * measurement function both F3.9 scenarios specify — only confident-hers
 * material is measured, and the profile reports itself `thin` under low
 * input rather than silently widening what counts — plus
 * `DEFAULT_STYLE_PROFILE`, a DECLARED constant (component register's
 * declared/derived line: defensible in plain English, not fitted) lifted
 * verbatim from the clause's own stated numbers. The declared default is
 * what ships in every request today; the day a real corpus feed exists,
 * only the call site changes — `computeStyleProfile` is already the real
 * thing and already tested against classified fixtures.
 */

export type CardAuthorship = 'hers' | 'not-hers' | 'unknown';

export interface ClassifiedCard {
  readonly front: string;
  readonly back: string;
  readonly authorship: CardAuthorship;
}

export interface StyleProfile {
  /** `true` when too little confident-hers material backs this profile — F3.9's "reports itself thin rather than silently widening its inputs." */
  readonly thin: boolean;
  /** How many confident-hers cards the profile is actually measured from (0 when `thin`, since a thin profile falls back to the declared default rather than a real measurement). */
  readonly sampleSize: number;
  readonly medianFrontWords: number;
  readonly medianBackWords: number;
  /** Stem openings observed on fronts — e.g. "What", "Which", "How", "Why", "In". */
  readonly openingStems: readonly string[];
  /** Fraction of backs that enumerate a list (0..1). */
  readonly listEnumerationRatio: number;
}

/**
 * F3.9's own stated current numbers, as written in the functional scope — a
 * DECLARED constant, not a fitted one. Used as the interim personalization
 * payload until a real per-student corpus feed exists (see module doc).
 */
export const DEFAULT_STYLE_PROFILE: StyleProfile = {
  thin: true,
  sampleSize: 0,
  medianFrontWords: 9,
  medianBackWords: 8,
  openingStems: ['What', 'Which', 'How', 'Why', 'In'],
  listEnumerationRatio: 0.2,
};

/** Below this many confident-hers cards, the profile reports itself thin rather than measuring — a handful of cards is not a style. */
export const MIN_SAMPLE_FOR_PROFILE = 10;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? upper;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}

const OPENING_STEM_WORDS = ['what', 'which', 'how', 'why', 'in'];

function openingStem(front: string): string | null {
  const firstWord = front.trim().split(/\s+/)[0]?.toLowerCase();
  const match =
    firstWord === undefined ? undefined : OPENING_STEM_WORDS.find((stem) => stem === firstWord);
  if (match === undefined) return null;
  return match.charAt(0).toUpperCase() + match.slice(1);
}

/**
 * A back "enumerates a list" when it carries two or more markdown/numbered
 * bullet lines, or two-plus comma/semicolon-joined items — cheap and
 * syntactic, the same kind of rule `sourceContext.ts`'s furniture check
 * uses, so this never grows into a content-quality judgment.
 */
function enumeratesList(back: string): boolean {
  const bulletLines = back.split(/\r?\n/).filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line));
  if (bulletLines.length >= 2) return true;
  return (back.match(/[,;]/g)?.length ?? 0) >= 2;
}

/**
 * Measures the style profile from her existing cards, per F3.9's two
 * scenarios: only confident-hers material is measured (a false inclusion
 * corrupts the measurement silently — the clause's own words), and a corpus
 * with too little confident-hers material reports itself `thin` rather than
 * widening its inputs to unknown or not-hers material.
 */
export function computeStyleProfile(cards: readonly ClassifiedCard[]): StyleProfile {
  const hers = cards.filter((card) => card.authorship === 'hers');

  if (hers.length < MIN_SAMPLE_FOR_PROFILE) {
    return { ...DEFAULT_STYLE_PROFILE, thin: true, sampleSize: hers.length };
  }

  const frontWordCounts = hers.map((card) => wordCount(card.front));
  const backWordCounts = hers.map((card) => wordCount(card.back));
  const stems = hers
    .map((card) => openingStem(card.front))
    .filter((stem): stem is string => stem !== null);
  const enumerating = hers.filter((card) => enumeratesList(card.back)).length;

  return {
    thin: false,
    sampleSize: hers.length,
    medianFrontWords: median(frontWordCounts),
    medianBackWords: median(backWordCounts),
    openingStems: [...new Set(stems)].sort(),
    listEnumerationRatio: enumerating / hers.length,
  };
}
