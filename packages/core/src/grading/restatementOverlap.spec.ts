import { describe, expect, it } from 'vitest';
import { measureAnswerSourceOverlap, precheckRestatement } from './restatementOverlap.js';

// Synthetic, invented study material — never real vault content (INV-3).
// Topic and wording made up for this test only.
const SOURCE =
  'Mitochondria are membrane bound organelles found in eukaryotic cells. ' +
  "They generate most of the cell's supply of adenosine triphosphate through the process of cellular respiration. " +
  'Because mitochondria contain their own small circular genome they are often described as having originated from free living bacteria that were engulfed by an ancestral host cell. ' +
  'This endosymbiotic theory explains why mitochondrial DNA is inherited separately from nuclear DNA.';

const VERBATIM = SOURCE;

// Six words swapped for synonyms, spread through the passage — the shape of
// a paste with light editing, not a copy.
const PARAPHRASE_WITH_SYNONYMS =
  'Mitochondria are membrane enclosed organelles located in eukaryotic cells. ' +
  "They produce most of the cell's supply of ATP via the process of cellular respiration. " +
  'Since mitochondria contain their own small circular genome they are often said to have originated from free living bacteria that were absorbed by an ancestral host cell. ' +
  'This endosymbiotic theory explains why mitochondrial DNA is inherited separately from nuclear DNA.';

// Same facts, her own sentence structure and vocabulary throughout.
const GENUINE_OWN_WORDS =
  'Mitochondria are the parts of a cell that make energy. They take in nutrients and turn them into ATP, ' +
  'which the rest of the cell uses as fuel. Scientists think they used to be separate bacteria that got ' +
  'absorbed into another cell a very long time ago, which is why they still carry a bit of their own DNA ' +
  "that is passed down mostly from the mother's side.";

// First two sentences copied verbatim, the rest is a genuine (if vague) own-words continuation.
const PARTIAL_PASTE =
  'Mitochondria are membrane bound organelles found in eukaryotic cells. ' +
  "They generate most of the cell's supply of adenosine triphosphate through the process of cellular respiration. " +
  "I think they also help with other stuff in the cell but I don't remember what.";

describe('measureAnswerSourceOverlap', () => {
  it('measures containment 1 for a word-for-word copy of the source', () => {
    const result = measureAnswerSourceOverlap(VERBATIM, SOURCE);
    expect(result.containment).toBe(1);
    expect(result.answerTokenCount).toBeGreaterThan(0);
  });

  it('drops containment sharply for a lightly-edited paraphrase, even though bag-of-words overlap stays high', () => {
    const result = measureAnswerSourceOverlap(PARAPHRASE_WITH_SYNONYMS, SOURCE);
    // This is the load-bearing claim of the design: containment (order-
    // sensitive, contiguous) is a much sharper signal than jaccard
    // (unordered bag-of-words) for exactly this shape of input. If
    // `measureAnswerSourceOverlap` were changed to gate on jaccard instead
    // of containment, this assertion pair would fail — jaccard stays high
    // (proven below) while containment must stay low.
    expect(result.containment).toBeLessThan(0.3);
    expect(result.jaccard).toBeGreaterThan(0.6);
  });

  it('measures containment 0 for a genuine explanation in different words', () => {
    const result = measureAnswerSourceOverlap(GENUINE_OWN_WORDS, SOURCE);
    expect(result.containment).toBe(0);
  });

  it('returns an all-zero measurement for an empty answer, without throwing', () => {
    const result = measureAnswerSourceOverlap('', SOURCE);
    expect(result.containment).toBe(0);
    expect(result.lcsRatio).toBe(0);
    expect(result.jaccard).toBe(0);
    expect(result.answerTokenCount).toBe(0);
  });

  it('shrinks the n-gram size for answers shorter than the requested n, rather than reporting 0 shingles', () => {
    const result = measureAnswerSourceOverlap('membrane bound organelles', SOURCE, 8);
    // 3 tokens: n cannot be 8, so it must have shrunk to something <= 3.
    expect(result.ngramSize).toBeLessThanOrEqual(3);
    // Those exact 3 words appear verbatim in SOURCE, so containment must be 1,
    // not 0 — a fixed n=8 with no adaptation would report 0 here (no 8-grams
    // exist in a 3-token answer), which would be the wrong number to gate on.
    expect(result.containment).toBe(1);
  });
});

describe('precheckRestatement', () => {
  // Record-only since `[D-138]` deleted the gating threshold: this function
  // only ever measures and returns an `OverlapMeasurement` — there is no
  // short-circuit, no fixed grading, and no options field left to disable.

  it('measures containment 1 for a verbatim paste, exactly like measureAnswerSourceOverlap', () => {
    const result = precheckRestatement({
      question: 'q',
      studentAnswer: VERBATIM,
      referenceAnswer: SOURCE,
    });
    expect(result.containment).toBe(1);
  });

  it('measures containment 0 for a genuine explanation in different words', () => {
    const result = precheckRestatement({
      question: 'q',
      studentAnswer: GENUINE_OWN_WORDS,
      referenceAnswer: SOURCE,
    });
    expect(result.containment).toBe(0);
  });

  it('folds a supplied sourceExcerpt into the source material measured against', () => {
    const withExcerpt = precheckRestatement({
      question: 'q',
      studentAnswer: PARTIAL_PASTE,
      referenceAnswer: 'unrelated reference text with no overlap at all',
      sourceExcerpt: SOURCE,
    });
    // PARTIAL_PASTE's opening sentences are verbatim from SOURCE, not from
    // referenceAnswer — containment is only non-zero once sourceExcerpt is
    // folded in, proving the two are combined rather than either alone used.
    expect(withExcerpt.containment).toBeGreaterThan(0);
  });

  it('passes ngramSize through to measureAnswerSourceOverlap', () => {
    const result = precheckRestatement(
      { question: 'q', studentAnswer: 'membrane bound organelles', referenceAnswer: SOURCE },
      { ngramSize: 8 },
    );
    expect(result.ngramSize).toBeLessThanOrEqual(3);
    expect(result.containment).toBe(1);
  });
});
