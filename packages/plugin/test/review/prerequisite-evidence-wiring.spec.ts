/**
 * F2.12's prerequisite-aware branch, joined to a real review log
 * (`src/review/prerequisite-evidence-wiring.ts`, `ol-egov.141.51.1.1`
 * [INTERV-16]).
 *
 * `../misconception/confusion-routing.spec.ts` (olea-core) covers the
 * DECISION over an already-classified `PrerequisiteEvidenceReading`. This
 * file covers the join the plugin owns: that a direct prerequisite is
 * resolved from `resolvePrerequisiteConceptKeys`'s own name→key fold, that
 * its evidence is classified into one of the six readings from the SAME log
 * the session was composed from, and that a stale-endpoint relation never
 * reaches this module at all (rel.md §3, Default 4).
 *
 * Feature: F2-review.md, "F2.12 — the prerequisite-aware offer rides the
 * confusion-routing trigger, read fresh each time [D-265]".
 */
import type { ReviewLogEntry } from 'olea-contracts';
import type { ConceptRecord, ConceptRelation, RelationSet, Scheduler } from 'olea-core';
import { createFsrsScheduler, servedRelations } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createPrerequisiteEvidenceReader } from '../../src/review/prerequisite-evidence-wiring.js';

const NOW = new Date('2026-08-20T09:00:00Z');

function concept(name: string, key: string): ConceptRecord {
  return {
    key,
    name,
    aliases: [],
    courses: [],
    sources: [],
    firstSeen: '2026-08-01T00:00:00.000Z',
  } as unknown as ConceptRecord;
}

function edge(type: ConceptRelation['type'], from: string, to: string): ConceptRelation {
  return {
    type,
    from,
    to,
    confidence: 0.9,
    provenance: 'hers',
    introducingPassages: {
      from: { sourcePath: 'a.md', location: { page: 1, charRange: { start: 0, end: 5 } } },
      to: { sourcePath: 'b.md', location: { page: 1, charRange: { start: 0, end: 5 } } },
    },
  } as unknown as ConceptRelation;
}

function review(overrides: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly conceptIds: readonly string[];
  readonly instrumentId?: string;
  readonly instrumentType?: 'qa' | 'cloze' | 'mcq' | 'explain-back';
  readonly rating?: 'again' | 'hard' | 'good' | 'easy' | null;
}): ReviewLogEntry {
  const instrumentType = overrides.instrumentType ?? 'qa';
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: overrides.eventId,
    timestamp: overrides.timestamp,
    instrumentId: overrides.instrumentId ?? `inst-${overrides.eventId}`,
    instrumentType,
    rating: overrides.rating === undefined ? 'good' : overrides.rating,
    wasUnsure: false,
    durationMs: null,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrumentType],
      planVersion: null,
    },
    conceptIds: [...overrides.conceptIds],
  } as unknown as ReviewLogEntry;
}

function rejectedVerdict(instrumentId: string, timestamp: string, eventId: string): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'verdict',
    eventId,
    timestamp,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['irrelevant-to-the-verdict-itself'],
    verdict: 'rejected',
    artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
  } as unknown as ReviewLogEntry;
}

/** Four distinct successful days, recent enough that vitality reads `holding` at `NOW` (mirrors `strong-recall-wiring.spec.ts`'s identical fixture). */
function fourSpacedSuccesses(conceptId: string, instrumentId: string): ReviewLogEntry[] {
  return ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'].map((day, index) =>
    review({
      eventId: `e-${conceptId}-${index}`,
      timestamp: `${day}T08:00:00+00:00`,
      conceptIds: [conceptId],
      instrumentId,
    }),
  );
}

describe('createPrerequisiteEvidenceReader — resolving the direct edge (ol-egov.141.51.1.1)', () => {
  it('resolves nothing when neither relations nor concepts are supplied — the real no-op every optional relation input documents', () => {
    const read = createPrerequisiteEvidenceReader({
      entries: [],
      scheduler: createFsrsScheduler(),
      now: NOW,
      relations: [],
      concepts: [],
    });

    expect(read(['key-dependent'])).toBeUndefined();
  });

  it('resolves nothing for a dependent with no recorded prerequisite edge', () => {
    const read = createPrerequisiteEvidenceReader({
      entries: [],
      scheduler: createFsrsScheduler(),
      now: NOW,
      relations: [edge('prerequisite', 'Alpha', 'Beta')],
      concepts: [concept('Alpha', 'key-alpha'), concept('Beta', 'key-beta')],
    });

    expect(read(['key-alpha'])).toBeUndefined(); // key-alpha is the PREREQUISITE, not a dependent
  });

  it('returns the FIRST dependent concept id that resolves a prerequisite (D-031: an instrument may be evidence for several)', () => {
    const read = createPrerequisiteEvidenceReader({
      entries: [],
      scheduler: createFsrsScheduler(),
      now: NOW,
      relations: [edge('prerequisite', 'Alpha', 'Beta')],
      concepts: [concept('Alpha', 'key-alpha'), concept('Beta', 'key-beta')],
    });

    const evidence = read(['key-nowhere', 'key-beta', 'key-alpha']);

    expect(evidence).toEqual({ conceptId: 'key-alpha', reading: 'unknown' });
  });

  it('picks the lexicographically smallest prerequisite key deterministically when a dependent has more than one direct edge (undecided by [D-265]; a proposed default, not a ruling)', () => {
    const read = createPrerequisiteEvidenceReader({
      entries: [],
      scheduler: createFsrsScheduler(),
      now: NOW,
      relations: [
        edge('prerequisite', 'Zeta', 'Dependent'),
        edge('prerequisite', 'Alpha', 'Dependent'),
      ],
      concepts: [
        concept('Zeta', 'key-zeta'),
        concept('Alpha', 'key-alpha'),
        concept('Dependent', 'key-dependent'),
      ],
    });

    expect(read(['key-dependent'])).toEqual({ conceptId: 'key-alpha', reading: 'unknown' });
  });
});

describe('createPrerequisiteEvidenceReader — classifying the prerequisite’s evidence (six [D-265] readings)', () => {
  function readerOver(entries: readonly ReviewLogEntry[]) {
    return createPrerequisiteEvidenceReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
      relations: [edge('prerequisite', 'Prereq', 'Dependent')],
      concepts: [concept('Prereq', 'key-prereq'), concept('Dependent', 'key-dependent')],
    });
  }

  it('unknown — no review evidence names the prerequisite concept at all', () => {
    const read = readerOver([]);
    expect(read(['key-dependent'])).toEqual({ conceptId: 'key-prereq', reading: 'unknown' });
  });

  it('weak — some evidence, below the sapling line', () => {
    const entries = [
      review({
        eventId: 'e-1',
        timestamp: '2026-08-20T08:00:00+00:00',
        conceptIds: ['key-prereq'],
      }),
    ];
    expect(readerOver(entries)(['key-dependent'])).toEqual({
      conceptId: 'key-prereq',
      reading: 'weak',
    });
  });

  it('weak — past the sapling line but currently tending (fading despite a past demonstration)', () => {
    // The same four-spaced-successes shape `fourSpacedSuccesses` builds,
    // clears the sapling line — but placed a year and a half before `NOW`
    // rather than ending on it, so retrievability at `NOW` has decayed well
    // past the holding cut while the high-water-mark stage (never
    // regresses) still reads sapling or above.
    const entries = ['2025-01-15', '2025-01-16', '2025-01-17', '2025-01-18'].map((day, index) =>
      review({
        eventId: `e-old-${index}`,
        timestamp: `${day}T08:00:00+00:00`,
        conceptIds: ['key-prereq'],
        instrumentId: 'inst-prereq',
      }),
    );
    const result = readerOver(entries)(['key-dependent']);
    expect(result?.reading).toBe('weak');
  });

  it('strong — sapling or above, and current vitality holds', () => {
    const entries = fourSpacedSuccesses('key-prereq', 'inst-prereq');
    expect(readerOver(entries)(['key-dependent'])).toEqual({
      conceptId: 'key-prereq',
      reading: 'strong',
    });
  });

  it('defective — every instrument that is evidence for the prerequisite has been proven invalid', () => {
    const entries = [
      review({
        eventId: 'e-1',
        timestamp: '2026-08-18T08:00:00+00:00',
        conceptIds: ['key-prereq'],
        instrumentId: 'inst-defective',
      }),
      rejectedVerdict('inst-defective', '2026-08-19T08:00:00+00:00', 'v-1'),
    ];
    expect(readerOver(entries)(['key-dependent'])).toEqual({
      conceptId: 'key-prereq',
      reading: 'defective',
    });
  });

  it('defective is distinct from unknown — SOME proven-invalid evidence beats having none at all', () => {
    const noEvidence = readerOver([])(['key-dependent']);
    const allInvalid = readerOver([
      review({
        eventId: 'e-1',
        timestamp: '2026-08-18T08:00:00+00:00',
        conceptIds: ['key-prereq'],
        instrumentId: 'inst-defective',
      }),
      rejectedVerdict('inst-defective', '2026-08-19T08:00:00+00:00', 'v-1'),
    ])(['key-dependent']);

    expect(noEvidence?.reading).toBe('unknown');
    expect(allInvalid?.reading).toBe('defective');
    expect(noEvidence?.reading).not.toBe(allInvalid?.reading);
  });
});

describe('createPrerequisiteEvidenceReader — Default 4 (rel.md §3): a stale endpoint never reaches this module', () => {
  it('a prerequisite edge whose evidence read stale is invisible here; a current one beside it still resolves', () => {
    const staleEdge = edge('prerequisite', 'Alpha', 'Beta');
    const currentEdge = edge('prerequisite', 'Gamma', 'Delta');
    // Hand-built RelationSet: production's `deriveRelationSet` always sets
    // `evidence: 'current'` today (rel.md §3, Default 4 — the revision
    // records it would compare against do not exist yet), so a genuine
    // `'stale'` entry can only be constructed directly, exactly as this
    // fixture does, to prove the gate holds once one exists.
    const relationSet = {
      entries: [
        {
          key: 'prerequisite\u0000Alpha\u0000Beta',
          stage: 'corpus',
          edge: staleEdge,
          triageStanding: 'candidate',
          evidence: 'stale',
          attestations: [staleEdge],
        },
        {
          key: 'prerequisite\u0000Gamma\u0000Delta',
          stage: 'corpus',
          edge: currentEdge,
          triageStanding: 'candidate',
          evidence: 'current',
          attestations: [currentEdge],
        },
      ],
      mergedDuplicates: 0,
      contradictions: 0,
      droppedUnemittable: 0,
    } as unknown as RelationSet;

    const read = createPrerequisiteEvidenceReader({
      entries: [],
      scheduler: createFsrsScheduler(),
      now: NOW,
      relations: servedRelations(relationSet),
      concepts: [
        concept('Alpha', 'key-alpha'),
        concept('Beta', 'key-beta'),
        concept('Gamma', 'key-gamma'),
        concept('Delta', 'key-delta'),
      ],
    });

    // Beta's prerequisite (Alpha) was judged on a stale endpoint: never resolves.
    expect(read(['key-beta'])).toBeUndefined();
    // Delta's prerequisite (Gamma) read current: resolves normally.
    expect(read(['key-delta'])).toEqual({ conceptId: 'key-gamma', reading: 'unknown' });
  });
});

describe('createPrerequisiteEvidenceReader — cost and failure posture', () => {
  it('replays the scheduler and folds instrument validity once for the whole session, not once per grade', () => {
    const real = createFsrsScheduler();
    const retrievability = vi.fn(real.retrievability.bind(real));
    const scheduler: Scheduler = { schedule: real.schedule.bind(real), retrievability };
    const read = createPrerequisiteEvidenceReader({
      entries: fourSpacedSuccesses('key-prereq', 'inst-prereq'),
      scheduler,
      now: NOW,
      relations: [edge('prerequisite', 'Prereq', 'Dependent')],
      concepts: [concept('Prereq', 'key-prereq'), concept('Dependent', 'key-dependent')],
    });

    read(['key-dependent']);
    const callsAfterFirst = retrievability.mock.calls.length;
    read(['key-dependent']);
    read(['key-dependent']);

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(retrievability.mock.calls).toHaveLength(callsAfterFirst);
  });

  it('never runs a fold at all for a dependent with no prerequisite edge — cheapest possible no-op', () => {
    const real = createFsrsScheduler();
    const retrievability = vi.fn(real.retrievability.bind(real));
    const scheduler: Scheduler = { schedule: real.schedule.bind(real), retrievability };
    const read = createPrerequisiteEvidenceReader({
      entries: fourSpacedSuccesses('key-prereq', 'inst-prereq'),
      scheduler,
      now: NOW,
      relations: [],
      concepts: [],
    });

    read(['key-dependent']);

    expect(retrievability).not.toHaveBeenCalled();
  });

  it('a scheduler that throws is a diagnostic, never a broken review — reads as "no resolution"', () => {
    const scheduler: Scheduler = {
      schedule: () => {
        throw new Error('boom');
      },
      retrievability: () => {
        throw new Error('boom');
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = createPrerequisiteEvidenceReader({
      entries: fourSpacedSuccesses('key-prereq', 'inst-prereq'),
      scheduler,
      now: NOW,
      relations: [edge('prerequisite', 'Prereq', 'Dependent')],
      concepts: [concept('Prereq', 'key-prereq'), concept('Dependent', 'key-dependent')],
    });

    expect(read(['key-dependent'])).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('an empty conceptIds list is not an error', () => {
    const read = createPrerequisiteEvidenceReader({
      entries: [],
      scheduler: createFsrsScheduler(),
      now: NOW,
      relations: [],
      concepts: [],
    });

    expect(read([])).toBeUndefined();
  });
});
