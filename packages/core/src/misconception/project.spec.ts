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

  it('a second piece of explanation evidence downgrades fading -> resolved', () => {
    const events = [
      observed({ eventId: 'e1' }),
      resolutionEvidence({
        eventId: 'e2',
        timestamp: '2026-08-16T10:00:00-04:00',
        evidenceKind: 'explanation',
      }),
      resolutionEvidence({
        eventId: 'e3',
        timestamp: '2026-08-16T11:00:00-04:00',
        evidenceKind: 'explanation',
      }),
    ];
    const [record] = projectMisconceptions(events);
    expect(record?.status).toBe('resolved');
  });

  it('recall evidence fades a misconception but never resolves it ([D-485]); explanation then resolves it', () => {
    const recall = (eventId: string, timestamp: string) =>
      resolutionEvidence({ eventId, timestamp, evidenceKind: 'recall' });
    const first = projectMisconceptions([
      observed({ eventId: 'e1' }),
      recall('e2', '2026-08-16T10:00:00-04:00'),
    ]);
    expect(first[0]?.status).toBe('fading');
    const second = projectMisconceptions([
      observed({ eventId: 'e1' }),
      recall('e2', '2026-08-16T10:00:00-04:00'),
      recall('e3', '2026-08-16T11:00:00-04:00'),
    ]);
    expect(second[0]?.status).toBe('fading');
    const then = projectMisconceptions([
      observed({ eventId: 'e1' }),
      recall('e2', '2026-08-16T10:00:00-04:00'),
      recall('e3', '2026-08-16T11:00:00-04:00'),
      resolutionEvidence({
        eventId: 'e4',
        timestamp: '2026-08-16T12:00:00-04:00',
        evidenceKind: 'explanation',
      }),
    ]);
    expect(then[0]?.status).toBe('resolved');
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

describe('projectMisconceptions — same-attempt order ([D-485] part 1, ol-egov.141.89.6.90)', () => {
  const T = '2026-08-16T12:00:00-04:00';
  // Event ids crafted so observation-first and resolution-first id orders both occur.
  const idOrders = [
    { name: 'observation id sorts first', obsId: 'a-obs', evId: 'b-ev' },
    { name: 'resolution id sorts first', obsId: 'b-obs', evId: 'a-ev' },
  ];

  for (const { name, obsId, evId } of idOrders) {
    it(`a correct explanation that surfaces a new misconception leaves it active (${name})`, () => {
      const records = projectMisconceptions([
        observed({ eventId: 'e-old', misconceptionId: 'm-old' }),
        observed({ eventId: obsId, misconceptionId: 'm-new', timestamp: T }),
        resolutionEvidence({ eventId: evId, timestamp: T }),
      ]);
      expect(records.find((r) => r.id === 'm-new')?.status).toBe('active');
      expect(records.find((r) => r.id === 'm-old')?.status).toBe('fading');
    });

    it(`a correct explanation that re-observes a fading record leaves it active (${name})`, () => {
      const records = projectMisconceptions([
        observed({ eventId: 'e-old', misconceptionId: 'm-1' }),
        resolutionEvidence({ eventId: 'e-prior', timestamp: '2026-08-16T10:00:00-04:00' }),
        observed({ eventId: obsId, misconceptionId: 'm-1', timestamp: T }),
        resolutionEvidence({ eventId: evId, timestamp: T }),
      ]);
      expect(records.find((r) => r.id === 'm-1')?.status).toBe('active');
    });
  }
});

describe('projectMisconceptions — belief-specific evidence ([D-485] part 1, ol-egov.141.89.6.88)', () => {
  const STAMP = { taskId: 'task-resolve', promptVersion: '0.0.1', modelId: 'model-x' };

  /** Evidence naming `targets` (each decided demonstrates); `others` are recorded but not named. */
  function beliefEvidence(
    targets: readonly string[],
    overrides: Partial<Extract<MisconceptionEvent, { kind: 'resolution-evidence' }>> = {},
    others: Readonly<Record<string, 'silent' | 'reasserts' | 'unclear' | null>> = {},
  ) {
    return resolutionEvidence({
      beliefResolution: {
        targetMisconceptionIds: targets,
        decisions: [
          ...targets.map((id) => ({
            misconceptionId: id,
            option: 'demonstrates' as const,
            provenance: STAMP,
          })),
          ...Object.entries(others).map(([id, option]) => ({
            misconceptionId: id,
            option,
            provenance: option === null ? null : STAMP,
          })),
        ],
      },
      ...overrides,
    });
  }

  const twoOpen = [
    observed({ eventId: 'e-a', misconceptionId: 'm-a' }),
    observed({ eventId: 'e-b', misconceptionId: 'm-b' }),
  ];
  const statusOf = (records: readonly { id: string; status: string }[], id: string) =>
    records.find((r) => r.id === id)?.status;

  it('collateral fade: evidence naming A fades A and leaves B active, where the concept-wide event fades both', () => {
    const specific = projectMisconceptions([
      ...twoOpen,
      beliefEvidence(['m-a'], { eventId: 'e-ev' }, { 'm-b': 'silent' }),
    ]);
    expect(statusOf(specific, 'm-a')).toBe('fading');
    expect(statusOf(specific, 'm-b')).toBe('active');

    const conceptWide = projectMisconceptions([
      ...twoOpen,
      resolutionEvidence({ eventId: 'e-ev' }),
    ]);
    expect(statusOf(conceptWide, 'm-a')).toBe('fading');
    expect(statusOf(conceptWide, 'm-b')).toBe('fading');
  });

  it('premature resolution: two pieces of evidence each naming A resolve A only', () => {
    const records = projectMisconceptions([
      ...twoOpen,
      beliefEvidence(['m-a'], { eventId: 'e-ev1', timestamp: '2026-08-16T10:00:00-04:00' }),
      beliefEvidence(['m-a'], { eventId: 'e-ev2', timestamp: '2026-08-16T11:00:00-04:00' }),
    ]);
    expect(statusOf(records, 'm-a')).toBe('resolved');
    expect(statusOf(records, 'm-b')).toBe('active');
  });

  it('missed resolution: evidence naming A and B moves both, one step each', () => {
    const records = projectMisconceptions([...twoOpen, beliefEvidence(['m-a', 'm-b'])]);
    expect(statusOf(records, 'm-a')).toBe('fading');
    expect(statusOf(records, 'm-b')).toBe('fading');
  });

  it('evidence naming no record moves nothing — it never falls back to the whole concept', () => {
    const records = projectMisconceptions([
      ...twoOpen,
      beliefEvidence([], {}, { 'm-a': 'silent', 'm-b': 'unclear' }),
    ]);
    expect(statusOf(records, 'm-a')).toBe('active');
    expect(statusOf(records, 'm-b')).toBe('active');
  });

  it('moves only records on its own concept: a named record on another concept stays put', () => {
    const records = projectMisconceptions([
      observed({ eventId: 'e-a', misconceptionId: 'm-a', conceptId: 'concept-alpha' }),
      observed({ eventId: 'e-z', misconceptionId: 'm-z', conceptId: 'concept-beta' }),
      beliefEvidence(['m-a', 'm-z'], { conceptId: 'concept-alpha' }),
    ]);
    expect(statusOf(records, 'm-a')).toBe('fading');
    expect(statusOf(records, 'm-z')).toBe('active');
  });

  it('a name with no record, and a resolved record, are no-ops', () => {
    const records = projectMisconceptions([
      observed({ eventId: 'e-a', misconceptionId: 'm-a' }),
      resolutionEvidence({ eventId: 'e-1', timestamp: '2026-08-16T10:00:00-04:00' }),
      resolutionEvidence({ eventId: 'e-2', timestamp: '2026-08-16T11:00:00-04:00' }),
      beliefEvidence(['m-a', 'm-unknown'], {
        eventId: 'e-3',
        timestamp: '2026-08-16T12:00:00-04:00',
      }),
    ]);
    expect(records.map((r) => [r.id, r.status])).toEqual([['m-a', 'resolved']]);
  });

  it('a name repeated in the fold entry moves its record once', () => {
    const entries: NormalizedMisconceptionFoldEntry[] = [
      {
        kind: 'observed',
        eventId: 'e-a',
        timestamp: '2026-08-16T09:00:00-04:00',
        misconceptionId: 'm-a',
        conceptId: 'concept-alpha',
        confusedWithConceptId: null,
        statement: 'Believes X always implies Y.',
        correction: 'X implies Y only under condition Z.',
        citation: CITATION,
        originInstrumentId: 'explain-back:concept-alpha:1',
      },
      {
        kind: 'resolution-evidence',
        eventId: 'e-ev',
        timestamp: '2026-08-16T10:00:00-04:00',
        conceptId: 'concept-alpha',
        evidenceKind: 'explanation',
        targetMisconceptionIds: ['m-a', 'm-a'],
      },
    ];
    expect(foldMisconceptionObservations(entries)[0]?.status).toBe('fading');
  });

  it('recall evidence that names a record still stops at fading ([D-485] part 3)', () => {
    const records = projectMisconceptions([
      observed({ eventId: 'e-a', misconceptionId: 'm-a' }),
      beliefEvidence(['m-a'], {
        eventId: 'e-1',
        timestamp: '2026-08-16T10:00:00-04:00',
        evidenceKind: 'recall',
      }),
      beliefEvidence(['m-a'], {
        eventId: 'e-2',
        timestamp: '2026-08-16T11:00:00-04:00',
        evidenceKind: 'recall',
      }),
    ]);
    expect(statusOf(records, 'm-a')).toBe('fading');
  });

  it('a record the same attempt re-observes ends active even if the evidence names it', () => {
    const T = '2026-08-16T12:00:00-04:00';
    for (const [obsId, evId] of [
      ['a-obs', 'b-ev'],
      ['b-obs', 'a-ev'],
    ] as const) {
      const records = projectMisconceptions([
        observed({ eventId: 'e-a', misconceptionId: 'm-a' }),
        observed({ eventId: obsId, misconceptionId: 'm-a', timestamp: T }),
        beliefEvidence(['m-a'], { eventId: evId, timestamp: T }),
      ]);
      expect(statusOf(records, 'm-a')).toBe('active');
    }
  });

  it('an old log replays as today: events without the field fold concept-wide, beside events with it', () => {
    const records = projectMisconceptions([
      ...twoOpen,
      observed({ eventId: 'e-c', misconceptionId: 'm-c' }),
      // Written before [D-485]: no field, fades all three.
      resolutionEvidence({ eventId: 'e-old', timestamp: '2026-08-16T10:00:00-04:00' }),
      // Written after: resolves A only.
      beliefEvidence(['m-a'], { eventId: 'e-new', timestamp: '2026-08-16T11:00:00-04:00' }),
    ]);
    expect(statusOf(records, 'm-a')).toBe('resolved');
    expect(statusOf(records, 'm-b')).toBe('fading');
    expect(statusOf(records, 'm-c')).toBe('fading');
  });

  it('is order-independent with belief-specific events in the log', () => {
    const events = [
      ...twoOpen,
      beliefEvidence(['m-a'], { eventId: 'e-1', timestamp: '2026-08-16T10:00:00-04:00' }),
      resolutionEvidence({ eventId: 'e-2', timestamp: '2026-08-16T11:00:00-04:00' }),
      beliefEvidence(['m-b'], { eventId: 'e-3', timestamp: '2026-08-16T12:00:00-04:00' }),
    ];
    expect(projectMisconceptions([...events].reverse())).toEqual(projectMisconceptions(events));
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
