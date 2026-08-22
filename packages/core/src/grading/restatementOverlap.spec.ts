import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RESTATEMENT_PRECHECK_OPTIONS,
  gradeExplainBackWithPrecheck,
  measureAnswerSourceOverlap,
  precheckRestatement,
} from './restatementOverlap.js';

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
  it('never short-circuits when the threshold is disabled (the shipped default)', () => {
    expect(DEFAULT_RESTATEMENT_PRECHECK_OPTIONS.thresholdContainment).toBeNull();
    const result = precheckRestatement(
      { question: 'q', studentAnswer: VERBATIM, referenceAnswer: SOURCE },
      DEFAULT_RESTATEMENT_PRECHECK_OPTIONS,
    );
    expect(result.shortCircuited).toBe(false);
    expect(result.grading).toBeNull();
    // Still measures and reports the overlap even when disabled.
    expect(result.overlap.containment).toBe(1);
  });

  it('short-circuits a verbatim paste at a moderate threshold, with a non-empty missedPoints', () => {
    const result = precheckRestatement(
      { question: 'q', studentAnswer: VERBATIM, referenceAnswer: SOURCE },
      { thresholdContainment: 0.5 },
    );
    expect(result.shortCircuited).toBe(true);
    expect(result.grading?.verdict).toBe('incorrect');
    // The literal "source minus answer" is empty for an exact copy (nothing
    // textually missing) — asserting non-empty here is what would catch a
    // regression back to the bead's literal proposal, which would silently
    // reproduce E2a's own `nothing-missed` false-praise criterion.
    expect(result.grading?.missedPoints.length).toBeGreaterThan(0);
  });

  it('lets a lightly-edited paraphrase through to the model instead of short-circuiting', () => {
    const result = precheckRestatement(
      { question: 'q', studentAnswer: PARAPHRASE_WITH_SYNONYMS, referenceAnswer: SOURCE },
      { thresholdContainment: 0.5 },
    );
    expect(result.shortCircuited).toBe(false);
    expect(result.grading).toBeNull();
  });

  it('never short-circuits a genuine explanation', () => {
    const result = precheckRestatement(
      { question: 'q', studentAnswer: GENUINE_OWN_WORDS, referenceAnswer: SOURCE },
      { thresholdContainment: 0.2 },
    );
    expect(result.shortCircuited).toBe(false);
  });

  it('never short-circuits an empty answer, even at threshold 0', () => {
    const result = precheckRestatement(
      { question: 'q', studentAnswer: '', referenceAnswer: SOURCE },
      { thresholdContainment: 0 },
    );
    expect(result.shortCircuited).toBe(false);
    expect(result.grading).toBeNull();
  });

  it('returns the literal source-minus-answer sentences for a partial paste', () => {
    const result = precheckRestatement(
      { question: 'q', studentAnswer: PARTIAL_PASTE, referenceAnswer: SOURCE },
      { thresholdContainment: 0.3 },
    );
    expect(result.shortCircuited).toBe(true);
    expect(result.grading?.missedPoints).toHaveLength(2);
    // The two sentences PARTIAL_PASTE never reproduces.
    expect(result.grading?.missedPoints.join(' ')).toContain('endosymbiotic theory');
    expect(result.grading?.missedPoints.join(' ')).toContain('inherited separately');
  });
});

describe('gradeExplainBackWithPrecheck', () => {
  it('never calls the model when the pre-check short-circuits (asserted by counting calls)', async () => {
    const callModel = vi.fn(async () => ({
      verdict: 'correct' as const,
      feedback: 'x',
      missedPoints: [],
    }));
    const result = await gradeExplainBackWithPrecheck(
      { question: 'q', studentAnswer: VERBATIM, referenceAnswer: SOURCE },
      { thresholdContainment: 0.5 },
      callModel,
    );
    expect(callModel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ verdict: 'incorrect' });
  });

  it('calls the model exactly once when the pre-check does not short-circuit', async () => {
    const modelGrading = { verdict: 'partial' as const, feedback: 'y', missedPoints: ['z'] };
    const callModel = vi.fn(async () => modelGrading);
    const result = await gradeExplainBackWithPrecheck(
      { question: 'q', studentAnswer: GENUINE_OWN_WORDS, referenceAnswer: SOURCE },
      { thresholdContainment: 0.5 },
      callModel,
    );
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result).toBe(modelGrading);
  });

  it('calls the model when the pre-check is disabled, regardless of overlap', async () => {
    const callModel = vi.fn(async () => ({
      verdict: 'incorrect' as const,
      feedback: 'y',
      missedPoints: ['z'],
    }));
    await gradeExplainBackWithPrecheck(
      { question: 'q', studentAnswer: VERBATIM, referenceAnswer: SOURCE },
      DEFAULT_RESTATEMENT_PRECHECK_OPTIONS,
      callModel,
    );
    expect(callModel).toHaveBeenCalledTimes(1);
  });
});
