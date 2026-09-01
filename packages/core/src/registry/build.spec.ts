// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 — Browsing
// the concept and instrument registry" and "F8.5 — Pruning withdraws,
// never deletes", tagged `@auto:core/registry/build.spec`.
//
// Concept/instrument/course identifiers below are structural placeholders
// ("concept-a", "COURSE-A", "qa:concept-a:1"), never fixture vocabulary —
// INV-3.
import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import { buildRegistryModel } from './build.js';
import { EMPTY_REGISTRY_OVERRIDES, pruneConcept, renameConcept } from './overrides.js';
import type { RegistryOverrides } from './types.js';

function concept(overrides: Partial<ConceptRecord> = {}): ConceptRecord {
  return {
    key: 'concept-a',
    name: 'Concept A',
    tier: 2,
    courses: ['COURSE-A'],
    sourcePaths: ['01 Courses/COURSE-A/note.md'],
    ...overrides,
  };
}

function qaInstrument(overrides: Partial<VaultInstrumentRecord> = {}): VaultInstrumentRecord {
  return {
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    courses: ['COURSE-A'],
    notePath: '01 Courses/COURSE-A/note.md',
    noteTitle: 'note',
    noteUid: null,
    blockId: 'abc123',
    heading: null,
    ordinal: 1,
    card: {
      raw: 'Q: x\nA: y',
      span: { start: 0, end: 10 },
      blockId: 'abc123',
      foreignScheduling: null,
      type: 'qa',
      style: 'single-line',
      front: 'x',
      back: 'y',
      reversed: false,
    },
    ...overrides,
  } as VaultInstrumentRecord;
}

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

const scheduler = createFsrsScheduler();
const now = new Date('2026-02-01T12:00:00Z');
const HOLDING_CUT = 0.8;

function buildFor(
  overrides: Partial<{
    concepts: readonly ConceptRecord[];
    instrumentRecords: readonly VaultInstrumentRecord[];
    entries: readonly ReviewLogEntry[];
    overridesState: RegistryOverrides;
    suspended: ReadonlySet<string>;
  }> = {},
) {
  return buildRegistryModel({
    concepts: overrides.concepts ?? [concept()],
    instrumentRecords: overrides.instrumentRecords ?? [qaInstrument()],
    entries: overrides.entries ?? [],
    scheduler,
    now,
    holdingCut: HOLDING_CUT,
    overrides: overrides.overridesState ?? EMPTY_REGISTRY_OVERRIDES,
    suspendedInstrumentIds: overrides.suspended ?? new Set(),
  });
}

describe('buildRegistryModel — browse (F8.4)', () => {
  it('lists every concept, with its courses, tier, and instrument mix', () => {
    const model = buildFor();
    expect(model.concepts).toHaveLength(1);
    const row = model.concepts[0];
    if (row === undefined) throw new Error('missing row');
    expect(row.key).toBe('concept-a');
    expect(row.displayName).toBe('Concept A');
    expect(row.courses).toEqual(['COURSE-A']);
    expect(row.tier).toBe(2);
    expect(row.instruments).toHaveLength(1);
    expect(row.instruments[0]?.instrumentId).toBe('qa:concept-a:1');
    expect(row.pruned).toBe(false);
  });

  it('a concept with no instruments is still included — a browsable inventory, not a filtered one', () => {
    const model = buildFor({ instrumentRecords: [] });
    expect(model.concepts).toHaveLength(1);
    expect(model.concepts[0]?.instruments).toEqual([]);
  });

  it('an instrument shared by two concepts appears in both mixes (D-031, M:N)', () => {
    const shared = qaInstrument({ conceptIds: ['concept-a', 'concept-b'] });
    const model = buildFor({
      concepts: [concept(), concept({ key: 'concept-b', name: 'Concept B' })],
      instrumentRecords: [shared],
    });
    const a = model.concepts.find((c) => c.key === 'concept-a');
    const b = model.concepts.find((c) => c.key === 'concept-b');
    expect(a?.instruments.map((i) => i.instrumentId)).toEqual(['qa:concept-a:1']);
    expect(b?.instruments.map((i) => i.instrumentId)).toEqual(['qa:concept-a:1']);
  });

  it('sorts by display name, then key', () => {
    const model = buildFor({
      concepts: [concept({ key: 'k2', name: 'Zeta' }), concept({ key: 'k1', name: 'Alpha' })],
      instrumentRecords: [],
    });
    expect(model.concepts.map((c) => c.displayName)).toEqual(['Alpha', 'Zeta']);
  });

  it('mastery and vitality come from the review log — a never-reviewed concept reads seed / too early to say', () => {
    const model = buildFor({ entries: [] });
    const row = model.concepts[0];
    expect(row?.mastery.state).toBe('seed');
    expect(row?.vitality.value).toBe('early');
  });

  it('a reviewed concept reads a real stage from the same rollup the mastery surfaces already use', () => {
    const entries = [review(), review({ eventId: 'r2' })];
    const model = buildFor({ entries });
    expect(model.concepts[0]?.mastery.evidence.scoredEventCount).toBe(2);
  });

  it('explain-back attempts are counted, never treated as a browsable instrument', () => {
    const entries = [
      review({
        eventId: 'r-eb',
        instrumentId: 'explain:concept-a:1',
        instrumentType: 'explain-back',
        rating: null,
      }),
    ];
    const model = buildFor({ entries, instrumentRecords: [] });
    const row = model.concepts[0];
    expect(row?.explainBack).toEqual({ attempted: true, attemptCount: 1 });
    expect(row?.instruments).toEqual([]);
  });
});

describe('buildRegistryModel — rename overlay (F8.4)', () => {
  it('a rename override changes displayName without touching the underlying key or evidence', () => {
    const renamed = renameConcept(EMPTY_REGISTRY_OVERRIDES, 'concept-a', 'Concept A', 'Renamed A');
    const model = buildFor({ overridesState: renamed });
    const row = model.concepts[0];
    expect(row?.key).toBe('concept-a');
    expect(row?.displayName).toBe('Renamed A');
    expect(row?.aliases).toEqual(['Concept A']);
  });
});

describe('buildRegistryModel — prune, never delete (F8.5)', () => {
  it('a pruned concept is still listed, marked pruned, with its evidence intact', () => {
    const pruned = pruneConcept(EMPTY_REGISTRY_OVERRIDES, 'concept-a');
    const entries = [review()];
    const model = buildFor({ overridesState: pruned, entries });
    const row = model.concepts[0];
    expect(row?.pruned).toBe(true);
    expect(row?.key).toBe('concept-a');
    expect(row?.mastery.evidence.scoredEventCount).toBe(1);
    expect(row?.instruments).toHaveLength(1);
  });

  it('a pruned instrument is still listed in its concept mix, marked pruned', () => {
    const model = buildFor({ suspended: new Set(['qa:concept-a:1']) });
    const row = model.concepts[0];
    expect(row?.instruments[0]?.pruned).toBe(true);
    expect(row?.instruments[0]?.instrumentId).toBe('qa:concept-a:1');
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-171] —
// The registry carries source provenance", tagged `@auto:core/registry/build.spec`.
describe('buildRegistryModel — source provenance (F8.4 / [D-171])', () => {
  it("a concept's entry lists the vault location(s) it was derived from", () => {
    const model = buildFor({
      concepts: [
        concept({
          sourcePaths: ['01 Courses/COURSE-A/note.md', '01 Courses/COURSE-A/other.md'],
          boundNotePath: 'Zettelkasten/Concept A.md',
        }),
      ],
    });
    const row = model.concepts[0];
    expect(row?.sourceLocations).toEqual([
      { sourcePath: '01 Courses/COURSE-A/note.md' },
      { sourcePath: '01 Courses/COURSE-A/other.md' },
      { sourcePath: 'Zettelkasten/Concept A.md' },
    ]);
  });

  it('a concept with no bound note and one source note lists exactly that one location, never invented', () => {
    const model = buildFor({ concepts: [concept()] });
    const row = model.concepts[0];
    expect(row?.sourceLocations).toEqual([{ sourcePath: '01 Courses/COURSE-A/note.md' }]);
  });

  it('an instrument in the mix carries its own note/heading/block as a source location', () => {
    const model = buildFor({
      instrumentRecords: [qaInstrument({ heading: 'Worked example', blockId: 'abc123' })],
    });
    const row = model.concepts[0];
    expect(row?.instruments[0]?.sourceLocations).toEqual([
      {
        sourcePath: '01 Courses/COURSE-A/note.md',
        heading: 'Worked example',
        blockId: 'abc123',
      },
    ]);
  });

  it('an instrument with no heading recorded reports an absent heading, never a guessed one', () => {
    const model = buildFor({ instrumentRecords: [qaInstrument({ heading: null })] });
    const row = model.concepts[0];
    expect(row?.instruments[0]?.sourceLocations[0]?.heading).toBeNull();
  });
});
