import { describe, expect, it } from 'vitest';
import { classifyMateriality, resolveMateriality } from '../source/materiality.js';
import {
  type AcceptedGradingMisconceptionCandidate,
  buildObservationEventsFromAcceptedGrading,
} from './accepted-grading-observation.js';
import {
  admitBeliefBearingStatement,
  assertBeliefBearingStatement,
  BeliefSourceExcludedError,
  isConfidentlyHersProse,
} from './belief-source.js';
import { buildObservationEvent, type ObservationInput } from './events.js';
import { buildObservationEventWithEmbedding } from './observe.js';

// Synthetic study material only (INV-3) — invented concept/citation ids and
// wording, never real vault content.

describe('isConfidentlyHersProse — [D-101] admission bar', () => {
  it('is true only for "hers"', () => {
    expect(isConfidentlyHersProse('hers')).toBe(true);
    expect(isConfidentlyHersProse('not-hers')).toBe(false);
    expect(isConfidentlyHersProse('unknown')).toBe(false);
  });
});

describe('admitBeliefBearingStatement — the belief-bearing-statement gatherer', () => {
  it('admits confidently-hers prose', () => {
    expect(admitBeliefBearingStatement('hers')).toEqual({ admitted: true });
  });

  it('excludes not-hers prose, naming the reason, never the text', () => {
    expect(admitBeliefBearingStatement('not-hers')).toEqual({
      admitted: false,
      reason: 'not-hers',
    });
  });

  it('excludes unknown authorship exactly as not-hers — a defined behaviour, never a hole defaulting to hers', () => {
    expect(admitBeliefBearingStatement('unknown')).toEqual({
      admitted: false,
      reason: 'unknown-authorship',
    });
  });

  it('admits when no authorship fact was supplied at all (the field is optional; see its own doc for why absence is not the same question as "unknown")', () => {
    expect(admitBeliefBearingStatement(undefined)).toEqual({ admitted: true });
  });
});

describe('assertBeliefBearingStatement — defense-in-depth throw', () => {
  it('throws BeliefSourceExcludedError carrying the reason for not-hers', () => {
    expect(() => assertBeliefBearingStatement('not-hers')).toThrow(BeliefSourceExcludedError);
    try {
      assertBeliefBearingStatement('not-hers');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BeliefSourceExcludedError);
      expect((error as BeliefSourceExcludedError).reason).toBe('not-hers');
    }
  });

  it('throws for unknown authorship', () => {
    expect(() => assertBeliefBearingStatement('unknown')).toThrow(BeliefSourceExcludedError);
  });

  it('does not throw for hers or for an absent fact', () => {
    expect(() => assertBeliefBearingStatement('hers')).not.toThrow();
    expect(() => assertBeliefBearingStatement(undefined)).not.toThrow();
  });
});

function baseObservationInput(overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement: 'Believes X always implies Y.',
    correction: 'The source states X implies Y only under condition Z.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 3 },
    originInstrumentId: 'explain-back:concept-alpha:1',
    originReviewEventId: 'review-event-1',
    timestamp: '2026-08-16T09:00:00-04:00',
    ...overrides,
  };
}

describe('buildObservationEvent — wired in front of the statement field (events.ts)', () => {
  it('still builds the event exactly as before when no authorship fact is supplied', () => {
    const result = buildObservationEvent(baseObservationInput(), {
      statementEmbedding: [1, 0, 0, 0],
      candidates: [],
      generateEventId: () => 'event-1',
      generateMisconceptionId: () => 'misconception-1',
    });
    expect(result.event.statement).toBe('Believes X always implies Y.');
  });

  it('builds the event when authorship is confidently hers', () => {
    const result = buildObservationEvent(baseObservationInput({ statementAuthorship: 'hers' }), {
      statementEmbedding: [1, 0, 0, 0],
      candidates: [],
    });
    expect(result.event.statement).toBe('Believes X always implies Y.');
  });

  it('throws rather than let a not-hers statement reach the event', () => {
    expect(() =>
      buildObservationEvent(baseObservationInput({ statementAuthorship: 'not-hers' }), {
        statementEmbedding: [1, 0, 0, 0],
        candidates: [],
      }),
    ).toThrow(BeliefSourceExcludedError);
  });

  it('throws rather than let an unknown-authorship statement reach the event', () => {
    expect(() =>
      buildObservationEvent(baseObservationInput({ statementAuthorship: 'unknown' }), {
        statementEmbedding: [1, 0, 0, 0],
        candidates: [],
      }),
    ).toThrow(BeliefSourceExcludedError);
  });
});

const embeddingInput: ObservationInput = {
  conceptId: 'concept-alpha',
  confusedWithConceptId: null,
  statement: 'Thinks X always causes Y.',
  correction: 'X causes Y only under condition Z.',
  citation: { path: 'Courses/Sample/notes.md', blockIndex: 3 },
  originInstrumentId: 'explain-back:concept-alpha:2',
  originReviewEventId: 'review-event-2',
  timestamp: '2026-08-20T09:00:00-04:00',
};

describe('buildObservationEventWithEmbedding — wired in front of the statement field (observe.ts)', () => {
  it('still builds the event exactly as before when no authorship fact is supplied (no embedder configured)', async () => {
    const result = await buildObservationEventWithEmbedding(embeddingInput, {
      embedder: null,
      candidateRecords: [],
      generateMisconceptionId: () => 'fresh-id',
    });
    expect(result.event.statement).toBe('Thinks X always causes Y.');
  });

  it('throws before any embedding work when authorship is not-hers', async () => {
    let embedCalls = 0;
    await expect(
      buildObservationEventWithEmbedding(
        { ...embeddingInput, statementAuthorship: 'not-hers' },
        {
          embedder: {
            embed: async (texts) => {
              embedCalls += 1;
              return texts.map(() => [0, 0, 0]);
            },
          },
          candidateRecords: [],
        },
      ),
    ).rejects.toThrow(BeliefSourceExcludedError);
    expect(embedCalls).toBe(0);
  });

  it('throws before any embedding work when authorship is unknown', async () => {
    await expect(
      buildObservationEventWithEmbedding(
        { ...embeddingInput, statementAuthorship: 'unknown' },
        { embedder: null, candidateRecords: [] },
      ),
    ).rejects.toThrow(BeliefSourceExcludedError);
  });
});

function acceptedCandidate(
  overrides: Partial<AcceptedGradingMisconceptionCandidate> = {},
): AcceptedGradingMisconceptionCandidate {
  return {
    concept: 'concept-label',
    statement: 'Believes X always implies Y.',
    correction: 'The source states X implies Y only under condition Z.',
    correctionSourceBlockIds: ['block-1'],
    ...overrides,
  };
}

describe('buildObservationEventsFromAcceptedGrading — the real, non-throwing observe-path gate', () => {
  const context = {
    originInstrumentId: 'explain-back:concept-alpha:1',
    originReviewEventId: 'review-event-1',
    timestamp: '2026-08-16T09:00:00-04:00',
    resolveCitation: () => ({ path: 'Courses/Sample/notes.md', blockIndex: 3 }),
    resolveConceptId: () => 'concept-alpha',
    candidateRecordsForConcept: () => [],
  };
  const deps = { embedder: null };

  it('records an event for a candidate with no authorship fact (unchanged behaviour)', async () => {
    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [acceptedCandidate()],
      context,
      deps,
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.skipped).toBe(false);
  });

  it('records an event for a candidate confidently hers', async () => {
    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [acceptedCandidate({ statementAuthorship: 'hers' })],
      context,
      deps,
    );
    expect(outcomes[0]?.skipped).toBe(false);
  });

  it('skips, with reason "not-hers", a candidate whose prose is a pasted classmate claim — never recorded as what she appears to believe', async () => {
    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [acceptedCandidate({ statementAuthorship: 'not-hers' })],
      context,
      deps,
    );
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0];
    if (outcome === undefined || outcome.skipped === false) {
      expect.unreachable('expected a skipped outcome');
      return;
    }
    expect(outcome.reason).toBe('not-hers');
  });

  it('skips, with reason "unknown-authorship", a candidate whose authorship is unknown — excluded exactly as not-hers is, not defaulted to hers', async () => {
    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [acceptedCandidate({ statementAuthorship: 'unknown' })],
      context,
      deps,
    );
    const outcome = outcomes[0];
    if (outcome === undefined || outcome.skipped === false) {
      expect.unreachable('expected a skipped outcome');
      return;
    }
    expect(outcome.reason).toBe('unknown-authorship');
  });

  it('her practice evidence remains the path by which a genuine misconception of hers surfaces: a hers-authorship candidate for the same concept is still recorded alongside an excluded one', async () => {
    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [
        acceptedCandidate({ statementAuthorship: 'not-hers', statement: 'A pasted claim.' }),
        acceptedCandidate({ statementAuthorship: 'hers', statement: 'Her own explanation.' }),
      ],
      context,
      deps,
    );
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.skipped).toBe(true);
    expect(outcomes[1]?.skipped).toBe(false);
  });
});

describe('against the real [D-101] classifier (../source/materiality.ts), read-only', () => {
  it('a slide-export PDF classifies not-hers, and that fact excludes its prose from the observe path end to end', async () => {
    const classified = classifyMateriality({
      path: 'Courses/Sample/01 Courses/PSYCH999/lecture-slides.pdf',
      format: 'pdf',
    });
    expect(classified.fact.authorship).toBe('not-hers');

    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [
        acceptedCandidate({
          statement: 'Pasted straight from the slide export.',
          statementAuthorship: classified.fact.authorship,
        }),
      ],
      {
        originInstrumentId: 'explain-back:concept-alpha:1',
        originReviewEventId: 'review-event-1',
        timestamp: '2026-08-16T09:00:00-04:00',
        resolveCitation: () => ({ path: 'Courses/Sample/notes.md', blockIndex: 3 }),
        resolveConceptId: () => 'concept-alpha',
        candidateRecordsForConcept: () => [],
      },
      { embedder: null },
    );

    const outcome = outcomes[0];
    if (outcome === undefined || outcome.skipped === false) {
      expect.unreachable('expected a skipped outcome');
      return;
    }
    expect(outcome.reason).toBe('not-hers');
  });

  it('a document with no cue at all resolves to unknown, and unknown excludes exactly as not-hers does', () => {
    const classified = resolveMateriality({
      path: 'Courses/Sample/99 Unfiled/orphan-note.md',
      format: null,
    });
    expect(classified.fact.authorship).toBe('unknown');
    expect(admitBeliefBearingStatement(classified.fact.authorship)).toEqual({
      admitted: false,
      reason: 'unknown-authorship',
    });
  });

  it('the zettelkasten folder prior resolves hers, and hers is admitted through the observe path', async () => {
    const classified = classifyMateriality({
      path: 'Courses/Sample/05 Zettelkasten/my-own-thoughts.md',
      format: null,
    });
    expect(classified.fact.authorship).toBe('hers');

    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [
        acceptedCandidate({
          statement: 'What she actually appears to believe.',
          statementAuthorship: classified.fact.authorship,
        }),
      ],
      {
        originInstrumentId: 'explain-back:concept-alpha:1',
        originReviewEventId: 'review-event-1',
        timestamp: '2026-08-16T09:00:00-04:00',
        resolveCitation: () => ({ path: 'Courses/Sample/notes.md', blockIndex: 3 }),
        resolveConceptId: () => 'concept-alpha',
        candidateRecordsForConcept: () => [],
      },
      { embedder: null },
    );

    expect(outcomes[0]?.skipped).toBe(false);
  });
});
