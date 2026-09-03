// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 — Browsing
// the concept and instrument registry" and "F8.5 — Pruning withdraws,
// never deletes", tagged `@auto:core/registry/build.spec`.
//
// Concept/instrument/course identifiers below are structural placeholders
// ("concept-a", "COURSE-A", "qa:concept-a:1"), never fixture vocabulary —
// INV-3.
import type { ExplainBackGrade, ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import type { ConceptPriority, CourseOracleRanking } from '../oracle/types.js';
import { contestClaim, type DisputeLogRecord, resolveDispute } from '../review-log/contest.js';
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
    disputes: readonly DisputeLogRecord[];
    courseRankings: readonly CourseOracleRanking[];
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
    // `exactOptionalPropertyTypes`: an explicit `disputes`/`courseRankings:
    // undefined` is a type error on an optional field, so the key is
    // omitted entirely rather than set to `undefined` when a test does not
    // supply one.
    ...(overrides.disputes === undefined ? {} : { disputes: overrides.disputes }),
    ...(overrides.courseRankings === undefined ? {} : { courseRankings: overrides.courseRankings }),
  });
}

/** A graded explain-back attempt for `qaInstrument()`'s id — F8.4b fixtures. Fixture strings are structural placeholders, never fixture vocabulary — INV-3. */
function explainBackReview(
  overrides: Partial<Omit<ReviewLogRecord, 'explainBackGrade'>> & {
    readonly explainBackGrade?: Partial<ExplainBackGrade>;
  } = {},
): ReviewLogRecord {
  const { explainBackGrade, ...rest } = overrides;
  return review({
    eventId: 'r-eb-1',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'explain-back',
    rating: null,
    explainBackGrade: {
      soloLevel: 'relational',
      contentRef: 'content-ref-1',
      revisionOf: null,
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
      ...explainBackGrade,
    },
    ...rest,
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

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-203] —
// a duplicate-title state on the concept row (ol-2zfj.60)", tagged
// `@auto:core/registry/build.spec`.
describe('buildRegistryModel — duplicate-title state (F8.4 / [D-203])', () => {
  it('two of her notes share one title and the binder refuses: the row carries state duplicate-title with the structural reason, and no note is bound', () => {
    const model = buildFor({
      concepts: [
        concept({
          ambiguousNotePaths: [
            '05 Zettelkasten/Concept A.md',
            '05 Zettelkasten/Outcrop/Concept A.md',
          ],
        }),
      ],
    });
    const row = model.concepts[0];
    expect(row?.duplicateTitle).toEqual({
      notePaths: ['05 Zettelkasten/Concept A.md', '05 Zettelkasten/Outcrop/Concept A.md'],
    });
  });

  it('an ordinary concept (no duplicated title) carries no duplicateTitle field at all', () => {
    const model = buildFor({ concepts: [concept()] });
    expect(model.concepts[0]?.duplicateTitle).toBeUndefined();
  });

  it('renaming one of the notes clears the state: the next build binds the remaining match and the state is gone', () => {
    const ambiguous = buildFor({
      concepts: [
        concept({
          ambiguousNotePaths: [
            '05 Zettelkasten/Concept A.md',
            '05 Zettelkasten/Outcrop/Concept A.md',
          ],
        }),
      ],
    });
    expect(ambiguous.concepts[0]?.duplicateTitle).toBeDefined();

    // The next build after she renames one of the two notes: the binder
    // (`../concept/extract.ts`) now resolves the remaining match and mints a
    // `ConceptRecord` with no `ambiguousNotePaths` at all — this module does
    // no title comparison of its own, so a fresh `ConceptRecord` with a
    // resolved `boundNotePath` is exactly what a real re-extraction produces.
    const resolved = buildFor({
      concepts: [concept({ boundNotePath: '05 Zettelkasten/Concept A.md' })],
    });
    expect(resolved.concepts[0]?.duplicateTitle).toBeUndefined();
    expect(resolved.concepts[0]?.sourceLocations.map((l) => l.sourcePath)).toContain(
      '05 Zettelkasten/Concept A.md',
    );
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-214] —
// a thin-note structural-reason state on the concept row (ol-2zfj.61)",
// tagged `@auto:core/registry/build.spec`.
describe('buildRegistryModel — thin-note state (F8.4 / [D-214])', () => {
  it('a concept bound to a note whose captured body is under the declared word floor carries state thin-note with the measured word count', () => {
    const model = buildFor({
      concepts: [
        concept({
          boundNotePath: '05 Zettelkasten/Concept A.md',
          definition: 'A short thought, not yet finished.',
        }),
      ],
    });
    expect(model.concepts[0]?.thinNote).toEqual({ wordCount: 6 });
  });

  it('a concept bound to a note with no captured body at all (empty once her heading is set aside) carries state thin-note with wordCount 0', () => {
    // No `definition` key at all — `exactOptionalPropertyTypes` treats an
    // explicit `definition: undefined` as a type error on this optional
    // field, matching this file's own `disputes`/`courseRankings` convention
    // in `buildFor` above.
    const model = buildFor({
      concepts: [concept({ boundNotePath: '05 Zettelkasten/Concept A.md' })],
    });
    expect(model.concepts[0]?.thinNote).toEqual({ wordCount: 0 });
  });

  it('a concept bound to a note whose captured body clears the declared word floor carries no thinNote field at all', () => {
    const longEnough = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');
    const model = buildFor({
      concepts: [
        concept({ boundNotePath: '05 Zettelkasten/Concept A.md', definition: longEnough }),
      ],
    });
    expect(model.concepts[0]?.thinNote).toBeUndefined();
  });

  it('an unbound concept (no note of hers to be thin) carries no thinNote field, regardless of definition', () => {
    const model = buildFor({ concepts: [concept()] });
    expect(model.concepts[0]?.thinNote).toBeUndefined();
  });

  it('a duplicate-title concept never also carries thinNote — the two states are mutually exclusive by construction', () => {
    const model = buildFor({
      concepts: [
        concept({
          ambiguousNotePaths: [
            '05 Zettelkasten/Concept A.md',
            '05 Zettelkasten/Outcrop/Concept A.md',
          ],
        }),
      ],
    });
    expect(model.concepts[0]?.duplicateTitle).toBeDefined();
    expect(model.concepts[0]?.thinNote).toBeUndefined();
  });

  it('writing more into the note clears the state: the next build reflects the fresher, longer captured body', () => {
    const thin = buildFor({
      concepts: [
        concept({ boundNotePath: '05 Zettelkasten/Concept A.md', definition: 'One short line.' }),
      ],
    });
    expect(thin.concepts[0]?.thinNote).toBeDefined();

    const longEnough = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');
    const grown = buildFor({
      concepts: [
        concept({ boundNotePath: '05 Zettelkasten/Concept A.md', definition: longEnough }),
      ],
    });
    expect(grown.concepts[0]?.thinNote).toBeUndefined();
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

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-171] —
// The registry carries source provenance", the passage-grain scenarios added
// by `ol-2zfj.48`, tagged `@auto:core/registry/build.spec`.
describe('buildRegistryModel — passage-grain provenance (ol-2zfj.48)', () => {
  it('a concept derived from a PDF-backed passage lists the page it was read from', () => {
    const model = buildFor({
      concepts: [
        concept({
          sourcePaths: [],
          anchor: {
            sourcePath: '01 Courses/COURSE-A/lecture.pdf',
            location: { page: 4, charRange: { start: 0, end: 10 } },
          },
        }),
      ],
    });
    const row = model.concepts[0];
    expect(row?.sourceLocations).toEqual([
      { sourcePath: '01 Courses/COURSE-A/lecture.pdf', page: 4 },
    ]);
  });

  it('a concept derived from a note passage lists the heading, never a page', () => {
    const model = buildFor({
      concepts: [
        concept({
          anchor: {
            sourcePath: '01 Courses/COURSE-A/note.md',
            location: { page: 1, charRange: { start: 0, end: 10 }, section: 'Worked example' },
          },
        }),
      ],
    });
    const row = model.concepts[0];
    const location = row?.sourceLocations.find(
      (loc) => loc.sourcePath === '01 Courses/COURSE-A/note.md',
    );
    expect(location?.section).toBe('Worked example');
  });

  it('absent passage grain is omitted, never fabricated', () => {
    const model = buildFor({
      concepts: [
        concept({
          sourcePaths: ['01 Courses/COURSE-A/note.md', '01 Courses/COURSE-A/other.md'],
          boundNotePath: 'Zettelkasten/Concept A.md',
        }),
      ],
    });
    const row = model.concepts[0];
    for (const location of row?.sourceLocations ?? []) {
      expect(location.page).toBeUndefined();
      expect(location.section).toBeUndefined();
    }
  });

  it('carries only page and section from a PDF-sourced passage — never document metadata (ol-pdfmeta)', () => {
    const model = buildFor({
      concepts: [
        concept({
          sourcePaths: [],
          anchor: {
            sourcePath: '01 Courses/COURSE-A/lecture.pdf',
            location: { page: 7, charRange: { start: 0, end: 5 } },
          },
        }),
      ],
    });
    const row = model.concepts[0];
    const location = row?.sourceLocations.find(
      (loc) => loc.sourcePath === '01 Courses/COURSE-A/lecture.pdf',
    );
    expect(location).toEqual({ sourcePath: '01 Courses/COURSE-A/lecture.pdf', page: 7 });
    expect(Object.keys(location ?? {}).sort()).toEqual(['page', 'sourcePath']);
  });

  it("an instrument's own generation-time provenance carries page grain onto its source location", () => {
    const model = buildFor({
      instrumentRecords: [
        qaInstrument({
          heading: null,
          sourceProvenance: {
            sourcePath: '01 Courses/COURSE-A/deck.pptx',
            location: { page: 3, charRange: { start: 0, end: 5 }, section: 'Introduction' },
          },
        }),
      ],
    });
    const row = model.concepts[0];
    expect(row?.instruments[0]?.sourceLocations).toEqual([
      {
        sourcePath: '01 Courses/COURSE-A/note.md',
        heading: null,
        blockId: 'abc123',
        page: 3,
        section: 'Introduction',
      },
    ]);
  });

  it('an instrument with no generation-time provenance omits page/section, never fabricating them', () => {
    const model = buildFor({ instrumentRecords: [qaInstrument({ heading: 'H' })] });
    const row = model.concepts[0];
    const location = row?.instruments[0]?.sourceLocations[0];
    expect(location?.page).toBeUndefined();
    expect(location?.section).toBeUndefined();
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4b — The
// explain-back history surface", tagged `@auto:core/registry/build.spec`.
describe('buildRegistryModel — per-instrument explain-back history (F8.4b, [D-175])', () => {
  it('an instrument never explained back carries an empty history, not an absent field', () => {
    const model = buildFor();
    expect(model.concepts[0]?.instruments[0]?.explainBackHistory).toEqual([]);
  });

  it('a graded explain-back attempt appears as a history row on the ORIGINATING instrument, keyed by the review event, never scored into the instrument mix', () => {
    const model = buildFor({ entries: [explainBackReview()] });
    const row = model.concepts[0];
    expect(row?.instruments).toHaveLength(1); // still exactly the one qa instrument — no second row invented
    expect(row?.instruments[0]?.explainBackHistory).toEqual([
      {
        eventId: 'r-eb-1',
        timestamp: '2026-01-10T09:00:00-04:00',
        soloLevel: 'relational',
        contested: false,
      },
    ]);
  });

  it('never carries the student answer text, the grader feedback, or a raw scalar/percentage — only eventId, timestamp and the SOLO enum value', () => {
    const model = buildFor({ entries: [explainBackReview()] });
    const row = model.concepts[0]?.instruments[0]?.explainBackHistory[0];
    expect(row && Object.keys(row).sort()).toEqual([
      'contested',
      'eventId',
      'soloLevel',
      'timestamp',
    ]);
  });

  it('multiple attempts are oldest first, and the fold never treats a superseded attempt as current', () => {
    const model = buildFor({
      entries: [
        explainBackReview({
          eventId: 'r-eb-1',
          timestamp: '2026-01-10T09:00:00-04:00',
          explainBackGrade: { soloLevel: 'unistructural' },
        }),
        explainBackReview({
          eventId: 'r-eb-2',
          timestamp: '2026-01-15T09:00:00-04:00',
          explainBackGrade: { soloLevel: 'relational' },
        }),
      ],
    });
    const history = model.concepts[0]?.instruments[0]?.explainBackHistory;
    expect(history?.map((row) => row.eventId)).toEqual(['r-eb-1', 'r-eb-2']);
    expect(history?.map((row) => row.soloLevel)).toEqual(['unistructural', 'relational']);
  });

  it('no `disputes` supplied — every row reads not-contested, never a fabricated guess either way', () => {
    const model = buildFor({ entries: [explainBackReview()] });
    expect(model.concepts[0]?.instruments[0]?.explainBackHistory[0]?.contested).toBe(false);
  });

  it('a `[D-095]` dispute against the CURRENT grade marks that row contested', () => {
    const dispute = contestClaim({
      claim: {
        rendering: 'explain-back-grade',
        conceptIds: ['concept-a'],
        instrumentId: 'qa:concept-a:1',
        evidenceBasis: 'evidence-fingerprint-1',
      },
      timestamp: '2026-01-20T09:00:00-04:00',
    });
    const disputeRecord: DisputeLogRecord = {
      schemaVersion: 5,
      kind: 'dispute',
      eventId: 'dispute-1',
      ...dispute.record,
    };
    const model = buildFor({ entries: [explainBackReview()], disputes: [disputeRecord] });
    expect(model.concepts[0]?.instruments[0]?.explainBackHistory[0]?.contested).toBe(true);
  });

  it('an OLDER, already-superseded attempt never carries the contested marker even when a dispute exists — only the current row can', () => {
    const dispute = contestClaim({
      claim: {
        rendering: 'explain-back-grade',
        conceptIds: ['concept-a'],
        instrumentId: 'qa:concept-a:1',
        evidenceBasis: 'evidence-fingerprint-1',
      },
      timestamp: '2026-01-20T09:00:00-04:00',
    });
    const disputeRecord: DisputeLogRecord = {
      schemaVersion: 5,
      kind: 'dispute',
      eventId: 'dispute-1',
      ...dispute.record,
    };
    const model = buildFor({
      entries: [
        explainBackReview({ eventId: 'r-eb-1', timestamp: '2026-01-10T09:00:00-04:00' }),
        explainBackReview({ eventId: 'r-eb-2', timestamp: '2026-01-15T09:00:00-04:00' }),
      ],
      disputes: [disputeRecord],
    });
    const history = model.concepts[0]?.instruments[0]?.explainBackHistory;
    expect(history?.[0]).toMatchObject({ eventId: 'r-eb-1', contested: false });
    expect(history?.[1]).toMatchObject({ eventId: 'r-eb-2', contested: true });
  });

  it('a resolved dispute (upheld or corrected) clears the marker on the same row — it never becomes a second, separate entry', () => {
    const opening = contestClaim({
      claim: {
        rendering: 'explain-back-grade',
        conceptIds: ['concept-a'],
        instrumentId: 'qa:concept-a:1',
        evidenceBasis: 'evidence-fingerprint-1',
      },
      timestamp: '2026-01-20T09:00:00-04:00',
    });
    const openingRecord: DisputeLogRecord = {
      schemaVersion: 5,
      kind: 'dispute',
      eventId: 'dispute-1',
      ...opening.record,
    };
    const resolution = resolveDispute({
      dispute: openingRecord,
      outcome: 'upheld',
      timestamp: '2026-01-22T09:00:00-04:00',
    });
    const resolutionRecord: DisputeLogRecord = {
      schemaVersion: 5,
      kind: 'dispute',
      eventId: 'dispute-2',
      ...resolution,
    };
    const model = buildFor({
      entries: [explainBackReview()],
      disputes: [openingRecord, resolutionRecord],
    });
    const history = model.concepts[0]?.instruments[0]?.explainBackHistory;
    expect(history).toHaveLength(1); // still exactly one row for this one attempt
    expect(history?.[0]).toMatchObject({ eventId: 'r-eb-1', contested: false });
  });

  it('a freeform/topic-seeded explain-back attempt (a synthetic instrument id, no vault instrument) never appears in any instrument row', () => {
    const model = buildFor({
      entries: [
        explainBackReview(),
        explainBackReview({ eventId: 'r-eb-freeform', instrumentId: 'explain-back:concept-a:1' }),
      ],
    });
    const row = model.concepts[0];
    expect(row?.instruments).toHaveLength(1); // the one real qa instrument, unaffected
    expect(row?.instruments[0]?.explainBackHistory.map((h) => h.eventId)).toEqual(['r-eb-1']);
    // Still counted at the CONCEPT grain, which matches by conceptIds rather than instrumentId:
    expect(row?.explainBack).toEqual({ attempted: true, attemptCount: 2 });
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4a / [D-176] —
// The offer-to-create-a-note gate", the wiring half: `noteOfferEligible`
// itself (all three conditions, individually) is proven at
// `../concept/note-offer.spec.ts`; these tests prove `buildRegistryModel`
// actually reaches it with the right per-concept evidence, including the
// multi-course rule that module's own doc leaves to this bead.
describe('buildRegistryModel — the note-offer gate (F8.4a, [D-176])', () => {
  /** A minimal, valid `ConceptPriority` — every field beyond `conceptKey`/`rank` is filler these tests never inspect, mirroring `note-offer.spec.ts`'s own fixture. */
  function rankedEntry(conceptKey: string, rank: number, course = 'COURSE-A'): ConceptPriority {
    return {
      conceptName: conceptKey,
      conceptKey,
      course,
      rank,
      priorityScore: 1 / rank,
      factors: {
        citations: [],
        distinctSourceCount: 0,
        contributions: [],
        preMasteryScore: 1 / rank,
        masteryState: 'sprout',
        masteryNeedWeight: 1,
        priorityScore: 1 / rank,
      },
      citations: [],
      reasoning: `Ranked ${rank}.`,
    };
  }

  /** Three-entry ranking — `TOP_BAND_DIVISOR = 3` puts rank 1 alone in the top band. */
  function threeWayRanking(course = 'COURSE-A'): CourseOracleRanking {
    return {
      course,
      status: 'ranked',
      ranked: [
        rankedEntry('concept-a', 1, course),
        rankedEntry('concept-other-1', 2, course),
        rankedEntry('concept-other-2', 3, course),
      ],
    };
  }

  it('is eligible when the concept has an accepted instrument, a scored review, and top-band rank in its own course', () => {
    const model = buildFor({
      concepts: [concept({ tier: 2 })],
      entries: [review()],
      courseRankings: [threeWayRanking()],
    });
    expect(model.concepts[0]?.noteOffer).toEqual({ eligible: true });
  });

  it('is never eligible for a tier-1 concept, even with every other condition satisfied — the gate is not reached for it', () => {
    const model = buildFor({
      concepts: [concept({ tier: 1 })],
      entries: [review()],
      courseRankings: [threeWayRanking()],
    });
    expect(model.concepts[0]?.noteOffer).toEqual({ eligible: false });
  });

  it('is not eligible with no scored review — explain-back attempts alone do not count (mirrors note-offer.ts)', () => {
    const model = buildFor({
      concepts: [concept({ tier: 2 })],
      entries: [explainBackReview()],
      courseRankings: [threeWayRanking()],
    });
    expect(model.concepts[0]?.noteOffer).toEqual({ eligible: false });
  });

  it("is not eligible with no ranking composed for any of the concept's courses", () => {
    const model = buildFor({
      concepts: [concept({ tier: 2 })],
      entries: [review()],
    });
    expect(model.concepts[0]?.noteOffer).toEqual({ eligible: false });
  });

  it('multi-course rule: eligible when top band in ANY one of its courses, not necessarily every course', () => {
    // Top band in COURSE-B (rank 1 of 3) but well outside it in COURSE-A
    // (rank 3 of 3, `TOP_BAND_DIVISOR = 3` puts only rank 1 in the top band).
    const model = buildFor({
      concepts: [concept({ tier: 2, courses: ['COURSE-A', 'COURSE-B'] })],
      entries: [review()],
      courseRankings: [
        {
          course: 'COURSE-A',
          status: 'ranked',
          ranked: [
            rankedEntry('concept-other-1', 1, 'COURSE-A'),
            rankedEntry('concept-other-2', 2, 'COURSE-A'),
            rankedEntry('concept-a', 3, 'COURSE-A'),
          ],
        },
        threeWayRanking('COURSE-B'),
      ],
    });
    expect(model.concepts[0]?.noteOffer).toEqual({ eligible: true });
  });

  it('a pruned instrument still counts toward "has accepted instruments" — pruning is a queue-visibility flag, never an un-accept', () => {
    const model = buildFor({
      concepts: [concept({ tier: 2 })],
      entries: [review()],
      courseRankings: [threeWayRanking()],
      suspended: new Set(['qa:concept-a:1']),
    });
    expect(model.concepts[0]?.instruments[0]?.pruned).toBe(true);
    expect(model.concepts[0]?.noteOffer).toEqual({ eligible: true });
  });
});
