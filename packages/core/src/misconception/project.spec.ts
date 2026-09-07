import { describe, expect, it } from 'vitest';
import {
  foldMisconceptionObservations,
  type NormalizedMisconceptionFoldEntry,
  projectMisconceptions,
} from './project.js';
import type { MisconceptionEvent } from './types.js';

// Synthetic events only (INV-3): invented concept/instrument ids and
// wording, never real vault content.

const CITATION = { path: 'Courses/Sample/notes.md', blockIndex: 2 };

function observed(overrides: Partial<Extract<MisconceptionEvent, { kind: 'observed' }>>) {
  return {
    schemaVersion: 1 as const,
    kind: 'observed' as const,
    eventId: 'e-observed-default',
    timestamp: '2026-08-16T09:00:00-04:00',
    originInstrumentId: 'explain-back:concept-alpha:1',
    originReviewEventId: null,
    misconceptionId: 'm-1',
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement: 'Believes X always implies Y.',
    correction: 'X implies Y only under condition Z.',
    citation: CITATION,
    ...overrides,
  };
}

function resolutionEvidence(
  overrides: Partial<Extract<MisconceptionEvent, { kind: 'resolution-evidence' }>>,
) {
  return {
    schemaVersion: 1 as const,
    kind: 'resolution-evidence' as const,
    eventId: 'e-evidence-default',
    timestamp: '2026-08-16T09:10:00-04:00',
    originInstrumentId: 'explain-back:concept-alpha:2',
    originReviewEventId: null,
    conceptId: 'concept-alpha',
    evidenceKind: 'explanation' as const,
    ...overrides,
  };
}

describe('projectMisconceptions — empty log', () => {
  it('returns an empty array for an empty event list, without throwing', () => {
    expect(projectMisconceptions([])).toEqual([]);
  });
});

describe('projectMisconceptions — observation folding', () => {
  it('creates a new active record from a single observed event, occurrenceCount 1', () => {
    const [record] = projectMisconceptions([observed({ eventId: 'e1' })]);
    expect(record).toMatchObject({
      id: 'm-1',
      conceptId: 'concept-alpha',
      status: 'active',
      occurrenceCount: 1,
      firstSeen: '2026-08-16T09:00:00-04:00',
      lastSeen: '2026-08-16T09:00:00-04:00',
    });
  });

  it('increments occurrenceCount and advances lastSeen on a later occurrence of the same id', () => {
    const events = [
      observed({ eventId: 'e1', timestamp: '2026-08-16T09:00:00-04:00' }),
      observed({ eventId: 'e2', timestamp: '2026-08-17T09:00:00-04:00', misconceptionId: 'm-1' }),
    ];
    const [record] = projectMisconceptions(events);
    expect(record).toBeDefined();
    expect(record?.occurrenceCount).toBe(2);
    expect(record?.firstSeen).toBe('2026-08-16T09:00:00-04:00');
    expect(record?.lastSeen).toBe('2026-08-17T09:00:00-04:00');
  });

  it('is order-independent: feeding events in reverse array order produces the identical record', () => {
    const inOrder = [
      observed({ eventId: 'e1', timestamp: '2026-08-16T09:00:00-04:00' }),
      observed({
        eventId: 'e2',
        timestamp: '2026-08-17T09:00:00-04:00',
        misconceptionId: 'm-1',
        statement: 'Refined statement after a second occurrence.',
      }),
    ];
    const forward = projectMisconceptions(inOrder);
    const reversed = projectMisconceptions([...inOrder].reverse());
    expect(reversed).toEqual(forward);
  });

  it('two distinct concepts stay two distinct records, even with the same statement text', () => {
    const events = [
      observed({ eventId: 'e1', misconceptionId: 'm-1', conceptId: 'concept-alpha' }),
      observed({ eventId: 'e2', misconceptionId: 'm-2', conceptId: 'concept-beta' }),
    ];
    const records = projectMisconceptions(events);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.conceptId).sort()).toEqual(['concept-alpha', 'concept-beta']);
  });
});

describe('projectMisconceptions — sticky citation/confusedWithConceptId (ol-2zfj.70)', () => {
  it('a later occurrence with confusedWithConceptId: null never erases an earlier non-null value', () => {
    const events = [
      observed({
        eventId: 'e1',
        misconceptionId: 'm-1',
        confusedWithConceptId: 'concept-beta',
        timestamp: '2026-08-16T09:00:00-04:00',
      }),
      observed({
        eventId: 'e2',
        misconceptionId: 'm-1',
        confusedWithConceptId: null,
        timestamp: '2026-08-17T09:00:00-04:00',
      }),
    ];
    const [record] = projectMisconceptions(events);
    expect(record?.confusedWithConceptId).toBe('concept-beta');
    expect(record?.occurrenceCount).toBe(2);
  });

  it('a later occurrence with a non-null confusedWithConceptId still overwrites, as before', () => {
    const events = [
      observed({
        eventId: 'e1',
        misconceptionId: 'm-1',
        confusedWithConceptId: 'concept-beta',
        timestamp: '2026-08-16T09:00:00-04:00',
      }),
      observed({
        eventId: 'e2',
        misconceptionId: 'm-1',
        confusedWithConceptId: 'concept-gamma',
        timestamp: '2026-08-17T09:00:00-04:00',
      }),
    ];
    const [record] = projectMisconceptions(events);
    expect(record?.confusedWithConceptId).toBe('concept-gamma');
  });

  it('a later occurrence with citation: null (only reachable via a Stream B pick, ./store.js) never erases an earlier real citation', () => {
    // A pure Stream A event always carries a real citation (the persisted
    // schema requires one) — a null citation is only ever produced by
    // ./store.js's Stream B normalization. This test exercises the shared
    // `foldMisconceptionObservations` directly with a synthetic normalized
    // entry, the same shape `./store.js` feeds it, rather than forcing an
    // invalid `MisconceptionEvent`.
    const laterCitation = { path: 'Courses/Sample/other.md', blockIndex: 5 };
    const withCitation: Extract<NormalizedMisconceptionFoldEntry, { kind: 'observed' }> = {
      kind: 'observed',
      eventId: 'e1',
      timestamp: '2026-08-16T09:00:00-04:00',
      misconceptionId: 'm-1',
      conceptId: 'concept-alpha',
      confusedWithConceptId: null,
      statement: 'Believes X always implies Y.',
      correction: 'X implies Y only under condition Z.',
      citation: CITATION,
      originInstrumentId: 'explain-back:concept-alpha:1',
    };
    const withNullCitation: Extract<NormalizedMisconceptionFoldEntry, { kind: 'observed' }> = {
      kind: 'observed',
      eventId: 'e2',
      timestamp: '2026-08-17T09:00:00-04:00',
      misconceptionId: 'm-1',
      conceptId: 'concept-alpha',
      confusedWithConceptId: null,
      statement: 'she believes the wrong thing this option encodes',
      correction: 'what the source material actually says instead',
      citation: null,
      originInstrumentId: 'mcq:concept-alpha:1',
    };
    const [record] = foldMisconceptionObservations([withCitation, withNullCitation]);
    expect(record?.citation).toEqual(CITATION);
    expect(record?.occurrenceCount).toBe(2);

    // Sanity: a real, non-null later citation still overwrites, as before.
    const overwritten = foldMisconceptionObservations([
      { ...withCitation, misconceptionId: 'm-2' },
      { ...withNullCitation, eventId: 'e3', misconceptionId: 'm-2', citation: laterCitation },
    ]);
    expect(overwritten[0]?.citation).toEqual(laterCitation);
  });
});

describe('projectMisconceptions — resolution folding (M2)', () => {
  it('one resolution-evidence event downgrades active -> fading, not straight to resolved', () => {
    const events = [
      observed({ eventId: 'e1' }),
      resolutionEvidence({ eventId: 'e2', timestamp: '2026-08-16T10:00:00-04:00' }),
    ];
    const [record] = projectMisconceptions(events);
    expect(record?.status).toBe('fading');
  });

  it('a second resolution-evidence event downgrades fading -> resolved', () => {
    const events = [
      observed({ eventId: 'e1' }),
      resolutionEvidence({ eventId: 'e2', timestamp: '2026-08-16T10:00:00-04:00' }),
      resolutionEvidence({ eventId: 'e3', timestamp: '2026-08-16T11:00:00-04:00' }),
    ];
    const [record] = projectMisconceptions(events);
    expect(record?.status).toBe('resolved');
  });

  it('resolution-evidence on a resolved record is a no-op, not an error', () => {
    const events = [
      observed({ eventId: 'e1' }),
      resolutionEvidence({ eventId: 'e2', timestamp: '2026-08-16T10:00:00-04:00' }),
      resolutionEvidence({ eventId: 'e3', timestamp: '2026-08-16T11:00:00-04:00' }),
      resolutionEvidence({ eventId: 'e4', timestamp: '2026-08-16T12:00:00-04:00' }),
    ];
    const [record] = projectMisconceptions(events);
    expect(record?.status).toBe('resolved');
  });

  it('a recurring observation reactivates a resolved record to active — "keeps coming back," not silently ignored', () => {
    const events = [
      observed({ eventId: 'e1' }),
      resolutionEvidence({ eventId: 'e2', timestamp: '2026-08-16T10:00:00-04:00' }),
      resolutionEvidence({ eventId: 'e3', timestamp: '2026-08-16T11:00:00-04:00' }),
      observed({ eventId: 'e4', timestamp: '2026-08-16T12:00:00-04:00' }),
    ];
    const [record] = projectMisconceptions(events);
    expect(record?.status).toBe('active');
    expect(record?.occurrenceCount).toBe(2);
  });

  it('resolution evidence only touches records on the named concept', () => {
    const events = [
      observed({ eventId: 'e1', misconceptionId: 'm-1', conceptId: 'concept-alpha' }),
      observed({ eventId: 'e2', misconceptionId: 'm-2', conceptId: 'concept-beta' }),
      resolutionEvidence({
        eventId: 'e3',
        timestamp: '2026-08-16T10:00:00-04:00',
        conceptId: 'concept-alpha',
      }),
    ];
    const records = projectMisconceptions(events);
    const alpha = records.find((r) => r.conceptId === 'concept-alpha');
    const beta = records.find((r) => r.conceptId === 'concept-beta');
    expect(alpha?.status).toBe('fading');
    expect(beta?.status).toBe('active');
  });

  it('recognition evidence is unrepresentable — evidenceKind excludes it by type, not by a runtime check', () => {
    // Compile-time proof: this assignment would not typecheck if uncommented,
    // because ResolutionEvidenceKind = 'recall' | 'explanation'.
    //   resolutionEvidence({ evidenceKind: 'recognition' });
    // Runtime companion: the two values the type does allow both take effect.
    const recall = projectMisconceptions([
      observed({ eventId: 'e1' }),
      resolutionEvidence({ eventId: 'e2', evidenceKind: 'recall' }),
    ]);
    expect(recall[0]?.status).toBe('fading');
  });
});

describe('projectMisconceptions — idempotency on replay', () => {
  it('a duplicated event (same eventId twice) is folded once, not twice', () => {
    const event = observed({ eventId: 'e1' });
    const once = projectMisconceptions([event]);
    const duplicated = projectMisconceptions([event, { ...event }]);
    expect(duplicated).toEqual(once);
    expect(duplicated[0]?.occurrenceCount).toBe(1);
  });

  it('projecting the same event list twice yields byte-identical results (no hidden mutation)', () => {
    const events = [
      observed({ eventId: 'e1' }),
      resolutionEvidence({ eventId: 'e2', timestamp: '2026-08-16T10:00:00-04:00' }),
    ];
    const first = projectMisconceptions(events);
    const second = projectMisconceptions(events);
    expect(second).toEqual(first);
    // The input itself must be untouched by projecting it.
    expect(events).toHaveLength(2);
  });
});

describe('projectMisconceptions — rebuild-from-log equivalence', () => {
  it('discarding a projection and re-projecting the same log produces an identical result', () => {
    const events: MisconceptionEvent[] = [
      observed({ eventId: 'e1', misconceptionId: 'm-1', conceptId: 'concept-alpha' }),
      observed({
        eventId: 'e2',
        misconceptionId: 'm-1',
        conceptId: 'concept-alpha',
        timestamp: '2026-08-17T09:00:00-04:00',
      }),
      observed({
        eventId: 'e3',
        misconceptionId: 'm-2',
        conceptId: 'concept-beta',
        timestamp: '2026-08-17T09:05:00-04:00',
      }),
      resolutionEvidence({
        eventId: 'e4',
        timestamp: '2026-08-18T09:00:00-04:00',
        conceptId: 'concept-alpha',
      }),
    ];

    // 1. Project once — this is the "cache" a caller might hold.
    let projection: unknown = projectMisconceptions(events);

    // 2. Discard it entirely (simulate a deleted plugin-data cache).
    projection = undefined;
    expect(projection).toBeUndefined();

    // 3. Rebuild from nothing but the event log.
    const rebuilt = projectMisconceptions(events);

    // 4. It must match a fresh projection computed independently.
    const independent = projectMisconceptions([...events]);
    expect(rebuilt).toEqual(independent);
    expect(rebuilt.map((r) => r.id).sort()).toEqual(['m-1', 'm-2']);
  });
});
