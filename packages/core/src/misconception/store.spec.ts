/**
 * `ol-2zfj.70` — the read-time reconciliation between Stream A (this
 * directory's own event log) and Stream B (a review-log
 * `misconception-observed` MCQ pick, `[D-202]`/`[D-220]`). Beyond pinning
 * `store.ts`'s own identity-resolution rules, this suite is the evidence
 * for this bead's reachability requirement: it feeds a Stream-B-derived
 * `MisconceptionRecord` through the three real production readers —
 * `./digest.js` (the explain-back judge's context, C7.9/F5.6),
 * `./framing.js` (encouragement copy, F6.8) and `./corroboration.js`
 * (`contrasts-with` corroboration, C7.10) — none of which change; they
 * already operate on `MisconceptionRecord[]`, agnostic to origin.
 *
 * INV-3: every concept/instrument id and wording here is coined. No course
 * code, note title or wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { ConfusionPairingConcept } from '../concept/confusion-pairing/types.js';
import { type ConceptRelation, deriveRelationSet, type RelationSet } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import { corroborateConfusionPairings } from './corroboration.js';
import { buildMisconceptionDigest } from './digest.js';
import { misconceptionFramingLine } from './framing.js';
import {
  type McqMisconceptionPick,
  mcqObservationKey,
  normalizeMcqPick,
  projectMisconceptionsFromAllSources,
} from './store.js';
import type { EmbeddingVector, MisconceptionEvent, MisconceptionRecord } from './types.js';

/** Narrows `records[index]` to a defined `MisconceptionRecord`, without a non-null assertion. */
function expectRecordAt(records: readonly MisconceptionRecord[], index = 0): MisconceptionRecord {
  const record = records[index];
  if (record === undefined) {
    throw new Error(`expected a record at index ${index}, got ${records.length} records`);
  }
  return record;
}

// Synthetic events/picks only (INV-3): invented concept/instrument ids and
// wording, never real vault content.

function pick(overrides: Partial<McqMisconceptionPick> = {}): McqMisconceptionPick {
  return {
    eventId: 'mcq-observed-1',
    timestamp: '2026-09-01T09:00:00-04:00',
    instrumentId: 'mcq:concept-alpha:1',
    conceptIds: ['concept-alpha'],
    reviewEventId: 'review-1',
    distractor: {
      text: 'a plausible wrong option',
      believes: 'she believes the wrong thing this option encodes',
      source_says: 'what the source material actually says instead',
    },
    ...overrides,
  };
}

function streamAObserved(
  overrides: Partial<Extract<MisconceptionEvent, { kind: 'observed' }>> = {},
): MisconceptionEvent {
  return {
    schemaVersion: 1,
    kind: 'observed',
    eventId: 'explain-back-observed-1',
    timestamp: '2026-08-20T09:00:00-04:00',
    originInstrumentId: 'explain-back:concept-alpha:1',
    originReviewEventId: null,
    misconceptionId: 'm-explain-back-1',
    conceptId: 'concept-alpha',
    confusedWithConceptId: 'concept-beta',
    statement: 'Believes alpha always implies beta.',
    correction: 'Alpha implies beta only under a stated condition.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 2 },
    ...overrides,
  };
}

function streamAResolution(
  overrides: Partial<Extract<MisconceptionEvent, { kind: 'resolution-evidence' }>> = {},
): MisconceptionEvent {
  return {
    schemaVersion: 1,
    kind: 'resolution-evidence',
    eventId: 'resolution-1',
    timestamp: '2026-08-21T09:00:00-04:00',
    originInstrumentId: 'explain-back:concept-alpha:2',
    originReviewEventId: null,
    conceptId: 'concept-alpha',
    evidenceKind: 'explanation',
    ...overrides,
  };
}

describe('normalizeMcqPick', () => {
  it('fans out one entry per conceptIds element, namespacing eventId per concept', () => {
    const entries = normalizeMcqPick(pick({ conceptIds: ['concept-alpha', 'concept-beta'] }));
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.eventId)).toEqual([
      mcqObservationKey(pick(), 'concept-alpha'),
      mcqObservationKey(pick(), 'concept-beta'),
    ]);
  });

  it('maps distractor.believes/source_says to statement/correction, with no citation and no confusedWithConceptId', () => {
    const [entry] = normalizeMcqPick(pick());
    expect(entry).toMatchObject({
      kind: 'observed',
      conceptId: 'concept-alpha',
      confusedWithConceptId: null,
      statement: 'she believes the wrong thing this option encodes',
      correction: 'what the source material actually says instead',
      citation: null,
      originInstrumentId: 'mcq:concept-alpha:1',
    });
  });
});

describe('projectMisconceptionsFromAllSources — recurrence (C7.9/F5.6)', () => {
  it('a fresh MCQ pick creates a new active record, occurrenceCount 1', () => {
    const records = projectMisconceptionsFromAllSources([], [pick()]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      conceptId: 'concept-alpha',
      status: 'active',
      occurrenceCount: 1,
      citation: null,
      confusedWithConceptId: null,
    });
  });

  it('two picks of the EXACT SAME distractor, on the same instrument, collapse to one record — occurrenceCount 2', () => {
    const first = pick({ eventId: 'mcq-1', timestamp: '2026-09-01T09:00:00-04:00' });
    const second = pick({ eventId: 'mcq-2', timestamp: '2026-09-02T09:00:00-04:00' });
    const records = projectMisconceptionsFromAllSources([], [first, second]);
    expect(records).toHaveLength(1);
    expect(records[0]?.occurrenceCount).toBe(2);
    expect(records[0]?.firstSeen).toBe('2026-09-01T09:00:00-04:00');
    expect(records[0]?.lastSeen).toBe('2026-09-02T09:00:00-04:00');
  });

  it('a DIFFERENT distractor text on the same instrument, with no embeddings supplied, stays a separate record — no false merge', () => {
    const first = pick({ eventId: 'mcq-1' });
    const second = pick({
      eventId: 'mcq-2',
      distractor: {
        text: 'a different plausible wrong option',
        believes: 'a different wrong belief entirely',
        source_says: 'the source corrects this different belief',
      },
    });
    const records = projectMisconceptionsFromAllSources([], [first, second]);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.occurrenceCount === 1)).toBe(true);
  });

  it('the same distractor on a DIFFERENT instrument is a separate record', () => {
    const first = pick({ eventId: 'mcq-1', instrumentId: 'mcq:concept-alpha:1' });
    const second = pick({ eventId: 'mcq-2', instrumentId: 'mcq:concept-alpha:2' });
    const records = projectMisconceptionsFromAllSources([], [first, second]);
    expect(records).toHaveLength(2);
  });
});

describe('projectMisconceptionsFromAllSources — status computed the same way for either origin (M2)', () => {
  it('a Stream A resolution-evidence event downgrades an MCQ-origin record on the same concept', () => {
    const mcqAt = pick({ timestamp: '2026-09-01T09:00:00-04:00' });
    const resolutionAfter = streamAResolution({ timestamp: '2026-09-02T09:00:00-04:00' });
    const records = projectMisconceptionsFromAllSources([resolutionAfter], [mcqAt]);
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('fading');
  });

  it('an MCQ pick recurring after resolution reactivates the record to active', () => {
    const first = pick({ eventId: 'mcq-1', timestamp: '2026-09-01T09:00:00-04:00' });
    const resolution = streamAResolution({ timestamp: '2026-09-02T09:00:00-04:00' });
    const second = pick({ eventId: 'mcq-2', timestamp: '2026-09-03T09:00:00-04:00' });
    const records = projectMisconceptionsFromAllSources([resolution], [first, second]);
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('active');
    expect(records[0]?.occurrenceCount).toBe(2);
  });
});

describe('projectMisconceptionsFromAllSources — M1 cross-stream match (tier 1 of identity resolution)', () => {
  const SAME: EmbeddingVector = [1, 0, 0];
  const DIFFERENT: EmbeddingVector = [0, 1, 0];

  it('reabsorbs an MCQ pick into an EXISTING Stream A record when the believes embedding matches', () => {
    const streamA = streamAObserved({ misconceptionId: 'm-explain-back-1' });
    const mcqPick = pick({ eventId: 'mcq-1', timestamp: '2026-08-25T09:00:00-04:00' });
    const key = mcqObservationKey(mcqPick, 'concept-alpha');

    const records = projectMisconceptionsFromAllSources([streamA], [mcqPick], {
      believesEmbeddings: new Map([[key, SAME]]),
      candidateEmbeddings: new Map([['m-explain-back-1', SAME]]),
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('m-explain-back-1');
    expect(records[0]?.occurrenceCount).toBe(2);
  });

  it("STICKY MERGE: reabsorbing an MCQ pick preserves the Stream A record's confusedWithConceptId and citation, even though the MCQ entry itself carries neither", () => {
    const streamA = streamAObserved({
      misconceptionId: 'm-explain-back-1',
      confusedWithConceptId: 'concept-beta',
      citation: { path: 'Courses/Sample/notes.md', blockIndex: 2 },
    });
    const mcqPick = pick({ eventId: 'mcq-1', timestamp: '2026-08-25T09:00:00-04:00' });
    const key = mcqObservationKey(mcqPick, 'concept-alpha');

    const [record] = projectMisconceptionsFromAllSources([streamA], [mcqPick], {
      believesEmbeddings: new Map([[key, SAME]]),
      candidateEmbeddings: new Map([['m-explain-back-1', SAME]]),
    });

    expect(record?.confusedWithConceptId).toBe('concept-beta');
    expect(record?.citation).toEqual({ path: 'Courses/Sample/notes.md', blockIndex: 2 });
  });

  it('does NOT reabsorb when the embedding does not clear the threshold — stays a separate record', () => {
    const streamA = streamAObserved({ misconceptionId: 'm-explain-back-1' });
    const mcqPick = pick({ eventId: 'mcq-1' });
    const key = mcqObservationKey(mcqPick, 'concept-alpha');

    const records = projectMisconceptionsFromAllSources([streamA], [mcqPick], {
      believesEmbeddings: new Map([[key, DIFFERENT]]),
      candidateEmbeddings: new Map([['m-explain-back-1', SAME]]),
    });

    expect(records).toHaveLength(2);
  });

  it('without any embeddings supplied at all, an MCQ pick never cross-merges into a Stream A record', () => {
    const streamA = streamAObserved({ misconceptionId: 'm-explain-back-1' });
    const mcqPick = pick({ eventId: 'mcq-1' });
    const records = projectMisconceptionsFromAllSources([streamA], [mcqPick]);
    expect(records).toHaveLength(2);
  });
});

describe('reachability: a Stream B event reaches the judge digest (C7.9/F5.6, digest.ts)', () => {
  it('an MCQ-origin record appears in buildMisconceptionDigest, with its real occurrenceCount', () => {
    const first = pick({ eventId: 'mcq-1', timestamp: '2026-09-01T09:00:00-04:00' });
    const second = pick({ eventId: 'mcq-2', timestamp: '2026-09-02T09:00:00-04:00' });
    const records = projectMisconceptionsFromAllSources([], [first, second]);

    const digest = buildMisconceptionDigest(records, { conceptIds: ['concept-alpha'] });
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({
      conceptId: 'concept-alpha',
      statement: 'she believes the wrong thing this option encodes',
      status: 'active',
      occurrenceCount: 2,
    });
  });
});

describe('reachability: a Stream B event reaches the encouragement fold (F6.8, framing.ts)', () => {
  it('an MCQ-origin record with occurrenceCount > 1 gets the recurring-active line', () => {
    const first = pick({ eventId: 'mcq-1', timestamp: '2026-09-01T09:00:00-04:00' });
    const second = pick({ eventId: 'mcq-2', timestamp: '2026-09-02T09:00:00-04:00' });
    const records = projectMisconceptionsFromAllSources([], [first, second]);
    const record = expectRecordAt(records);
    expect(misconceptionFramingLine(record)).toBe(
      'This one keeps coming back — worth ten minutes with the source.',
    );
  });

  it('an MCQ-origin record resolved by a later Stream A resolution-evidence event gets the quiet resolved line', () => {
    const mcqAt = pick({ timestamp: '2026-09-01T09:00:00-04:00' });
    const firstResolution = streamAResolution({
      eventId: 'r1',
      timestamp: '2026-09-02T09:00:00-04:00',
    });
    const secondResolution = streamAResolution({
      eventId: 'r2',
      timestamp: '2026-09-03T09:00:00-04:00',
    });
    const records = projectMisconceptionsFromAllSources(
      [firstResolution, secondResolution],
      [mcqAt],
    );
    const record = expectRecordAt(records);
    expect(record.status).toBe('resolved');
    expect(misconceptionFramingLine(record)).toBe(
      'This one settled — no need to revisit unless it resurfaces.',
    );
  });
});

describe('reachability: a Stream B event reaches contrasts-with corroboration (C7.10, corroboration.ts)', () => {
  function anchor(sourcePath: string, start = 0, end = 10): Provenance {
    return { sourcePath, location: { page: 1, charRange: { start, end } } };
  }

  function contrastsWith(from: string, to: string): ConceptRelation {
    return {
      type: 'contrasts-with',
      from,
      to,
      provenance: 'model-proposed',
      confidence: 0.7,
      introducingPassages: { from: anchor(`${from}.md`), to: anchor(`${to}.md`) },
    };
  }

  function concept(name: string): ConfusionPairingConcept {
    return { name, aliases: [] };
  }

  function setOf(...relations: readonly ConceptRelation[]): RelationSet {
    return deriveRelationSet(relations);
  }

  it('an MCQ pick reabsorbed into an evidence-bearing Stream A record still corroborates the edge, with the incremented occurrence count', () => {
    const streamA = streamAObserved({
      misconceptionId: 'm-explain-back-1',
      conceptId: 'concept-alpha',
      confusedWithConceptId: 'concept-beta',
    });
    const mcqPick = pick({ eventId: 'mcq-1', timestamp: '2026-08-25T09:00:00-04:00' });
    const key = mcqObservationKey(mcqPick, 'concept-alpha');
    const SAME: EmbeddingVector = [1, 0, 0];

    const records = projectMisconceptionsFromAllSources([streamA], [mcqPick], {
      believesEmbeddings: new Map([[key, SAME]]),
      candidateEmbeddings: new Map([['m-explain-back-1', SAME]]),
    });

    const verdicts = corroborateConfusionPairings(
      setOf(contrastsWith('concept-alpha', 'concept-beta')),
      records,
      [concept('concept-alpha'), concept('concept-beta')],
    );

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.verdict).toBe('corroborated');
    expect(verdicts[0]?.misconceptionOccurrenceCount).toBe(2);
  });
});
