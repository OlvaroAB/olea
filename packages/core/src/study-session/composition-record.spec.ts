/**
 * `[D-331]` (`ol-egov.141.89.10.65`, phase 1): the composition's own account on the composed
 * session (`./compose.ts`) and the durable composition record built from it
 * (`./composition-record.ts`). Pure parts only: nothing here reads or writes a vault.
 *
 * INV-3: every course, concept and note name below is coined for the test.
 */

import type { StudyPlanAllocationEntry } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptRelation } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import type { OracleMasteryState } from '../oracle/types.js';
import { parseReviewLog } from '../review-log/parse.js';
import type { ReplayResult } from '../session/replay.js';
import type { McqInstrumentRecord, QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import {
  type AssessmentGroupingContext,
  type BuildComposedStudySessionInput,
  buildComposedStudySession,
  composeSessionRows,
  extendComposedStudySession,
  extendComposedStudySessionWithAccount,
  MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS,
  URGENCY_OVERRIDE_THRESHOLD,
  WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS,
} from './compose.js';
import {
  buildCompositionRecord,
  buildExtendedCompositionRecord,
  COMPOSITION_RECORD_SCHEMA_VERSION,
  type CompositionRecord,
  mintOpaqueCompositionId,
  OPAQUE_COMPOSITION_ID_PREFIX,
  parseCompositionLog,
  parseCompositionRecord,
  serializeCompositionRecord,
} from './composition-record.js';
import type { DurationModel } from './duration.js';
import { buildConceptInstrumentIndex } from './instrument-index.js';

const AS_OF = '2026-09-14';
const COMPOSED_AT = '2026-09-14T18:30:00.000+10:00';

// ---------------------------------------------------------------------------
// Fixtures (compose.spec.ts's shapes, restated: a spec exports nothing)
// ---------------------------------------------------------------------------

interface RowSpec {
  readonly conceptName: string;
  readonly conceptKey?: string;
  readonly course?: string;
  readonly gapScore?: number;
  readonly masteryState?: OracleMasteryState;
  readonly targetAssessmentPath?: VaultPath | null;
  readonly notePaths?: readonly VaultPath[];
}

function row(spec: RowSpec, rank: number): GapRow {
  return {
    conceptName: spec.conceptName,
    conceptKey: spec.conceptKey ?? `key-${spec.conceptName.toLowerCase()}`,
    course: spec.course ?? 'CRS101',
    gapClass: 'mastery-gap' as GapClass,
    rank,
    oracleRank: rank,
    priorityScore: spec.gapScore ?? 5,
    gapScore: spec.gapScore ?? 5,
    readiness: {
      assessmentFormat: 'unknown' as AssessmentFormat,
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: spec.masteryState ?? 'seed',
    targetAssessmentPath: spec.targetAssessmentPath ?? null,
    assessmentFormat: 'unknown' as AssessmentFormat,
    citations: [],
    distinctSourceCount: 1,
    reasoning: 'Because the evidence says so.',
    notePaths: spec.notePaths ?? [],
    instrumentCount: 1,
    affordances: ['open-concept', 'build-session'],
  };
}

function rows(specs: readonly RowSpec[]): readonly GapRow[] {
  return specs.map((spec, index) => row(spec, index + 1));
}

function qa(instrumentId: string, conceptIds: readonly string[]): QaInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds,
    courses: ['CRS101'],
    notePath: `Coined notes/${instrumentId} note.md` as VaultPath,
    noteTitle: `${instrumentId} note`,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    card: {
      type: 'qa',
      style: 'single-line',
      front: 'Front?',
      back: 'Back.',
      reversed: false,
      raw: 'Front?::Back.',
      span: { start: 0, end: 13 },
      blockId: null,
      foreignScheduling: null,
    },
  };
}

function mcq(instrumentId: string, conceptIds: readonly string[]): McqInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'mcq',
    conceptIds,
    courses: ['CRS101'],
    notePath: `Coined notes/${instrumentId} note.md` as VaultPath,
    noteTitle: `${instrumentId} note`,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    mcq: {
      type: 'mcq',
      id: instrumentId,
      predecessor: null,
      stem: 'Which?',
      answer: 'This one.',
      distractors: ['a', 'b', 'c'],
      feedback: null,
      raw: '```mcq\n```',
      span: { start: 0, end: 10 },
      fence: '```',
      terminator: '\n',
    },
  };
}

function durations(seconds: Readonly<Record<'qa' | 'cloze' | 'mcq', number>>): DurationModel {
  const estimates = (['qa', 'cloze', 'mcq'] as const).map((instrumentType) => ({
    instrumentType,
    seconds: seconds[instrumentType],
    source: 'assumed' as const,
    sampleCount: 0,
  }));
  return {
    estimates,
    basis: 'assumed',
    totalSampleCount: 0,
    // No explain-back is priced in these fixtures; it reads as the recall price if one ever is.
    secondsFor: (instrumentType) =>
      instrumentType === 'explain-back' ? seconds.qa : seconds[instrumentType],
    sourceFor: () => 'assumed',
  };
}

const FLAT = durations({ qa: 60, cloze: 60, mcq: 60 });

function emptyReplay(): ReplayResult {
  return { states: new Map(), replayedCount: 0, skippedCount: 0 };
}

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

function partOf(part: string, whole: string): ConceptRelation {
  return {
    type: 'part-of',
    from: part,
    to: whole,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: { from: passage(`${part}.md`), to: passage(`${whole}.md`) },
  };
}

/** Three unmet, equally-scored concepts in one course, one cheap instrument each: one tie band. */
function threeInOneBand(extra: Partial<Record<'Alpha' | 'Beta' | 'Gamma', Partial<RowSpec>>> = {}) {
  const theRows = rows(
    (['Alpha', 'Beta', 'Gamma'] as const).map((conceptName) => ({
      conceptName,
      ...(extra[conceptName] ?? {}),
    })),
  );
  const instruments = buildConceptInstrumentIndex(
    theRows.map((r) => qa(`i-${r.conceptName.toLowerCase()}`, [r.conceptKey])),
  );
  return { theRows, instruments };
}

function baseInput(
  theRows: readonly GapRow[],
  instruments: BuildComposedStudySessionInput['instruments'],
  overrides: Partial<BuildComposedStudySessionInput> = {},
): BuildComposedStudySessionInput {
  return {
    rows: theRows,
    instruments,
    replay: emptyReplay(),
    durations: FLAT,
    asOf: AS_OF,
    budgetMinutes: 10,
    ...overrides,
  };
}

function orderOf(input: BuildComposedStudySessionInput): readonly string[] {
  return buildComposedStudySession(input).model.items.map((item) => item.conceptName);
}

// ---------------------------------------------------------------------------
// The grouping signal: retained as a discrete value, order unchanged
// ---------------------------------------------------------------------------

describe('[D-331] groupingSignal — which F2.19 signal decided the presented grouping', () => {
  it("reads 'none' when no F2.19 signal is supplied, and the order is the urgency order alone", () => {
    const { theRows, instruments } = threeInOneBand();
    const input = baseInput(theRows, instruments);
    expect(orderOf(input)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(buildComposedStudySession(input).groupingSignal).toBe('none');
  });

  it("reads 'none' when signals are supplied but every score in the band ties", () => {
    const { theRows, instruments } = threeInOneBand();
    const input = baseInput(theRows, instruments, { relatedConceptKeys: new Map() });
    expect(orderOf(input)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(buildComposedStudySession(input).groupingSignal).toBe('none');
  });

  it("reads 'relatedness' when concept relatedness decided an adjacency (order pinned)", () => {
    const { theRows, instruments } = threeInOneBand();
    const input = baseInput(theRows, instruments, {
      relatedConceptKeys: new Map([
        ['key-beta', new Set(['key-gamma'])],
        ['key-gamma', new Set(['key-beta'])],
      ]),
    });
    expect(orderOf(input)).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(buildComposedStudySession(input).groupingSignal).toBe('relatedness');
  });

  it("reads 'assessment-scope' when an approaching assessment's scope decided it (order pinned)", () => {
    const target = { targetAssessmentPath: 'Coined/Test one.md' as VaultPath };
    const { theRows, instruments } = threeInOneBand({ Alpha: target, Beta: target, Gamma: target });
    const context: AssessmentGroupingContext = {
      dueDay: '2026-09-15',
      scopeConceptKeys: new Set(['key-gamma']),
    };
    const input = baseInput(theRows, instruments, {
      assessmentContext: new Map([['Coined/Test one.md' as VaultPath, context]]),
    });
    expect(orderOf(input)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(buildComposedStudySession(input).groupingSignal).toBe('assessment-scope');
  });

  it("reads 'arrival-cohort' when freshly arrived material from one note decided it (order pinned)", () => {
    const shared = { notePaths: ['Coined/Lecture one.md' as VaultPath] };
    const { theRows, instruments } = threeInOneBand({
      Alpha: { notePaths: ['Coined/Other.md' as VaultPath] },
      Beta: shared,
      Gamma: shared,
    });
    const input = baseInput(theRows, instruments, {
      arrivalDays: new Map([
        ['key-beta', AS_OF],
        ['key-gamma', AS_OF],
      ]),
    });
    expect(orderOf(input)).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(buildComposedStudySession(input).groupingSignal).toBe('arrival-cohort');
  });

  it('breaks an equal count by F2.19 precedence: an assessment scope over relatedness', () => {
    // Alpha is in the coming test's scope and related to Beta; Gamma is neither. (Alpha, Beta) is
    // decided by the scope, (Beta, Gamma) by relatedness: one adjacency each.
    const target = { targetAssessmentPath: 'Coined/Test one.md' as VaultPath };
    const { theRows, instruments } = threeInOneBand({ Alpha: target, Beta: target, Gamma: target });
    const input = baseInput(theRows, instruments, {
      assessmentContext: new Map([
        [
          'Coined/Test one.md' as VaultPath,
          { dueDay: '2026-09-15', scopeConceptKeys: new Set(['key-alpha']) },
        ],
      ]),
      relatedConceptKeys: new Map([
        ['key-alpha', new Set(['key-beta'])],
        ['key-beta', new Set(['key-alpha'])],
      ]),
    });
    expect(orderOf(input)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(buildComposedStudySession(input).groupingSignal).toBe('assessment-scope');
  });

  it('composeSessionRows carries the same value, and the value never reorders anything', () => {
    const { theRows, instruments } = threeInOneBand();
    const related = new Map([
      ['key-beta', new Set(['key-gamma'])],
      ['key-gamma', new Set(['key-beta'])],
    ]);
    const rowsResult = composeSessionRows({
      rows: theRows,
      instruments,
      replay: emptyReplay(),
      durations: FLAT,
      asOf: AS_OF,
      budgetSeconds: 600,
      relatedConceptKeys: related,
    });
    expect(rowsResult.groupingSignal).toBe('relatedness');
    expect(rowsResult.orderedRows.map((r) => r.conceptName)).toEqual(['Beta', 'Gamma', 'Alpha']);
  });
});

// ---------------------------------------------------------------------------
// The set-asides and the item attribution
// ---------------------------------------------------------------------------

describe('[D-331] setAside — what the composition weighed and did not serve, with why, by id', () => {
  it('names the other eligible course at course grain, sorted by id', () => {
    const theRows = rows([
      { conceptName: 'Alpha', course: 'CRS101' },
      { conceptName: 'Beta', course: 'CRS103' },
      { conceptName: 'Gamma', course: 'CRS102' },
    ]);
    const instruments = buildConceptInstrumentIndex(
      theRows.map((r) => qa(`i-${r.conceptName.toLowerCase()}`, [r.conceptKey])),
    );
    const composed = buildComposedStudySession(baseInput(theRows, instruments));
    expect(composed.dominantCourse).toBe('CRS101');
    expect(composed.setAside?.courses).toEqual([
      { courseId: 'CRS102', reason: 'another-course-chosen' },
      { courseId: 'CRS103', reason: 'another-course-chosen' },
    ]);
  });

  it("names a concept whose group did not fit the selection as 'did-not-fit'", () => {
    const { theRows, instruments } = threeInOneBand();
    const composed = buildComposedStudySession(
      baseInput(theRows, instruments, { budgetMinutes: 2 }),
    );
    expect(composed.model.items.map((i) => i.conceptName)).toEqual(['Alpha', 'Beta']);
    expect(composed.setAside?.concepts).toEqual([
      { conceptKey: 'key-gamma', reason: 'did-not-fit' },
    ]);
  });

  it("names selected concepts the fill could not reach as 'did-not-fit', and agrees with the fill's own leftOut", () => {
    // Selection prices each concept at its cheapest instrument (60 s), so all three fit 180 s;
    // the fill serves Alpha's first instrument (a 300 s recall card) and reaches the target.
    const theRows = rows([
      { conceptName: 'Alpha' },
      { conceptName: 'Beta' },
      { conceptName: 'Gamma' },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('i-alpha-recall', ['key-alpha']),
      mcq('i-alpha-choice', ['key-alpha']),
      mcq('i-beta', ['key-beta']),
      mcq('i-gamma', ['key-gamma']),
    ]);
    const composed = buildComposedStudySession(
      baseInput(theRows, instruments, {
        budgetMinutes: 3,
        durations: durations({ qa: 300, cloze: 300, mcq: 60 }),
      }),
    );
    expect(composed.model.items.map((i) => i.instrumentId)).toEqual(['i-alpha-recall']);
    expect(composed.setAside?.concepts).toEqual([
      { conceptKey: 'key-beta', reason: 'did-not-fit' },
      { conceptKey: 'key-gamma', reason: 'did-not-fit' },
    ]);
    expect(composed.model.leftOut.map((o) => [o.conceptName, o.reason])).toEqual([
      ['Beta', 'did-not-fit'],
      ['Gamma', 'did-not-fit'],
    ]);
  });

  it("names a selected concept with nothing to practise as 'no-instruments'", () => {
    const theRows = rows([{ conceptName: 'Alpha' }, { conceptName: 'Beta' }]);
    const instruments = buildConceptInstrumentIndex([qa('i-alpha', ['key-alpha'])]);
    const composed = buildComposedStudySession(baseInput(theRows, instruments));
    expect(composed.setAside?.concepts).toEqual([
      { conceptKey: 'key-beta', reason: 'no-instruments' },
    ]);
  });

  it("names a broad concept that yielded to its own part as 'yields-to-part'", () => {
    const theRows = rows([{ conceptName: 'Part' }, { conceptName: 'Whole' }]);
    const instruments = buildConceptInstrumentIndex([
      qa('i-part', ['key-part']),
      qa('i-whole', ['key-whole']),
    ]);
    const composed = buildComposedStudySession(
      baseInput(theRows, instruments, { relations: [partOf('Part', 'Whole')] }),
    );
    expect(composed.model.items.map((i) => i.instrumentId)).toEqual(['i-part']);
    expect(composed.setAside?.concepts).toEqual([
      { conceptKey: 'key-whole', reason: 'yields-to-part' },
    ]);
  });

  it("names a withheld instrument at instrument grain as 'cited-passage-changed', never its concept", () => {
    const { theRows, instruments } = threeInOneBand();
    const composed = buildComposedStudySession(
      baseInput(theRows, instruments, { citationFreshness: new Map([['i-beta', 'stale']]) }),
    );
    expect(composed.model.items.map((i) => i.instrumentId)).toEqual(['i-alpha', 'i-gamma']);
    expect(composed.setAside?.instruments).toEqual([
      { instrumentId: 'i-beta', conceptKey: 'key-beta', reason: 'cited-passage-changed' },
    ]);
    expect(composed.setAside?.concepts).toEqual([]);
  });

  it('lists nothing when everything was served', () => {
    const { theRows, instruments } = threeInOneBand();
    const composed = buildComposedStudySession(baseInput(theRows, instruments));
    expect(composed.setAside).toEqual({ courses: [], concepts: [], instruments: [] });
  });
});

describe("[D-331] each item's own conceptKey — a plain read off StudySessionItem, no reconstruction (ol-egov.141.89.10.4/.65)", () => {
  it('is read straight off the served item, for two same-named concepts each with their own instrument', () => {
    const theRows = rows([
      { conceptName: 'Alpha', conceptKey: 'key-alpha-one' },
      { conceptName: 'Alpha', conceptKey: 'key-alpha-two' },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('i-one', ['key-alpha-one']),
      qa('i-two', ['key-alpha-two']),
    ]);
    const composed = buildComposedStudySession(baseInput(theRows, instruments));
    expect(composed.model.items.map((item) => [item.instrumentId, item.conceptKey])).toEqual([
      ['i-one', 'key-alpha-one'],
      ['i-two', 'key-alpha-two'],
    ]);
  });

  it("an instrument naming two concepts is claimed by whichever row's queue reaches it first — never left unattributed (build.ts's fill, ol-egov.141.89.10.4)", () => {
    const theRows = rows([
      { conceptName: 'Alpha', conceptKey: 'key-alpha-one' },
      { conceptName: 'Alpha', conceptKey: 'key-alpha-two' },
    ]);
    const instruments = buildConceptInstrumentIndex([
      qa('i-shared', ['key-alpha-one', 'key-alpha-two']),
    ]);
    const composed = buildComposedStudySession(baseInput(theRows, instruments));
    expect(composed.model.items.map((i) => i.instrumentId)).toEqual(['i-shared']);
    expect(['key-alpha-one', 'key-alpha-two']).toContain(composed.model.items[0]?.conceptKey);
  });

  it('maps a chosen item with no conceptKey of its own to null in the record, never guessing one', () => {
    const { session } = composedFixture();
    const [firstItem, ...restItems] = session.model.items;
    if (firstItem === undefined) throw new Error('fixture has no items');
    const { conceptKey: _k, ...itemWithoutKey } = firstItem;
    const strippedSession = {
      ...session,
      model: { ...session.model, items: [itemWithoutKey, ...restItems] },
    };
    const record = buildCompositionRecord(strippedSession, {
      compositionId: 'composition-key1:nonce-null-concept-key',
      composedAt: COMPOSED_AT,
      planVersion: null,
      reentry: false,
    });
    expect(record.chosen[0]?.conceptKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Extension: the account carried through, the items byte-identical
// ---------------------------------------------------------------------------

describe('[D-331] extendComposedStudySessionWithAccount', () => {
  function sixConcepts() {
    const theRows = rows(
      ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map((conceptName) => ({
        conceptName,
      })),
    );
    const instruments = buildConceptInstrumentIndex(
      theRows.map((r) => qa(`i-${r.conceptName.toLowerCase()}`, [r.conceptKey])),
    );
    return { theRows, instruments };
  }

  it('returns exactly the items extendComposedStudySession returns, with the account kept true', () => {
    const { theRows, instruments } = sixConcepts();
    const previous = buildComposedStudySession(
      baseInput(theRows, instruments, { budgetMinutes: 2 }),
    );
    const wider = baseInput(theRows, instruments, { budgetMinutes: 4 });
    const extended = extendComposedStudySessionWithAccount(wider, previous);
    expect(extended.model.items).toEqual(extendComposedStudySession(wider, previous));
    // Every concept ties on urgency and score, so the stated residual order (by name) applies.
    expect(extended.model.items.map((i) => i.conceptName)).toEqual([
      'Alpha',
      'Beta',
      'Delta',
      'Epsilon',
    ]);
    // What main.ts builds today from the item list, plus the account and nothing else.
    const { setAside, ...rest } = extended;
    const { setAside: _s, ...previousRest } = previous;
    expect(rest).toEqual({
      ...previousRest,
      model: { ...previous.model, items: extended.model.items },
    });
    // Each item's own conceptKey travelled with it — no separate map to read.
    expect(extended.model.items.find((i) => i.instrumentId === 'i-delta')?.conceptKey).toBe(
      'key-delta',
    );
    expect(setAside?.concepts).toEqual([
      { conceptKey: 'key-gamma', reason: 'did-not-fit' },
      { conceptKey: 'key-zeta', reason: 'did-not-fit' },
    ]);
    expect(extended.groupingSignal).toBe(previous.groupingSignal);
  });

  it('returns previous itself when the extension changes nothing', () => {
    const { theRows, instruments } = threeInOneBand();
    const previous = buildComposedStudySession(baseInput(theRows, instruments));
    const extended = extendComposedStudySessionWithAccount(
      baseInput(theRows, instruments, { budgetMinutes: 20 }),
      previous,
    );
    expect(extended).toBe(previous);
    expect(
      extendComposedStudySession(baseInput(theRows, instruments, { budgetMinutes: 20 }), previous),
    ).toBe(previous.model.items);
  });

  it("lists an already-served item the extension dropped under [D-330] as 'cited-passage-changed'", () => {
    const { theRows, instruments } = sixConcepts();
    const previous = buildComposedStudySession(
      baseInput(theRows, instruments, { budgetMinutes: 2 }),
    );
    const extended = extendComposedStudySessionWithAccount(
      baseInput(theRows, instruments, {
        budgetMinutes: 4,
        citationFreshness: new Map([['i-alpha', 'stale']]),
      }),
      previous,
    );
    expect(extended.model.items.map((i) => i.instrumentId)).not.toContain('i-alpha');
    expect(extended.setAside?.instruments).toContainEqual({
      instrumentId: 'i-alpha',
      conceptKey: 'key-alpha',
      reason: 'cited-passage-changed',
    });
  });
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

const ALLOCATION: readonly StudyPlanAllocationEntry[] = [
  {
    courseId: 'CRS101',
    share: 0.6,
    minBlockSeconds: 300,
    contributions: [
      { name: 'risk', value: 0.02 },
      { name: 'floor', value: 0.2 },
    ],
    reason: 'A coined sentence the record does not keep.',
  },
  {
    courseId: 'CRS102',
    share: 0.4,
    minBlockSeconds: 300,
    contributions: [{ name: 'floor', value: 0.2 }],
    reason: 'Another coined sentence.',
  },
];

function composedFixture() {
  const theRows = rows([
    { conceptName: 'Alpha', course: 'CRS101' },
    { conceptName: 'Beta', course: 'CRS101' },
    { conceptName: 'Gamma', course: 'CRS101' },
    { conceptName: 'Delta', course: 'CRS102' },
  ]);
  const instruments = buildConceptInstrumentIndex(
    theRows.map((r) => qa(`i-${r.conceptName.toLowerCase()}`, [r.conceptKey])),
  );
  const input = baseInput(theRows, instruments, {
    budgetMinutes: 2,
    allocation: [...ALLOCATION],
    rankedReasons: new Map([['key-alpha', 'A coined one-clause reason.']]),
  });
  return { input, session: buildComposedStudySession(input) };
}

function recordFixture(): CompositionRecord {
  const { input, session } = composedFixture();
  return buildCompositionRecord(session, {
    compositionId: mintOpaqueCompositionId(() => 'nonce-1'),
    composedAt: COMPOSED_AT,
    planVersion: 'plan-v-opaque',
    policyVersions: { 'rank-weights': 'rw-v-opaque' },
    reentry: false,
    ...(input.allocation !== undefined ? { allocation: input.allocation } : {}),
  });
}

describe('[D-331] buildCompositionRecord', () => {
  it('records course, branch, plan, shares, policy versions, chosen items with reasons, set-asides and the grouping signal', () => {
    const record = recordFixture();
    expect(record).toEqual({
      schemaVersion: COMPOSITION_RECORD_SCHEMA_VERSION,
      kind: 'compose',
      compositionId: `${OPAQUE_COMPOSITION_ID_PREFIX}:nonce-1`,
      sittingId: `${OPAQUE_COMPOSITION_ID_PREFIX}:nonce-1`,
      parentCompositionId: null,
      composedAt: COMPOSED_AT,
      asOf: AS_OF,
      reentry: false,
      focusPolicy: 'single',
      course: 'CRS101',
      branch: 'deficit',
      groupingSignal: 'none',
      steering: { courses: null, conceptIds: null },
      budgetMinutes: 2,
      planVersion: 'plan-v-opaque',
      policyVersions: { 'rank-weights': 'rw-v-opaque' },
      planAllocation: [
        {
          courseId: 'CRS101',
          share: 0.6,
          minBlockSeconds: 300,
          contributions: [
            { name: 'risk', value: 0.02 },
            { name: 'floor', value: 0.2 },
          ],
        },
        {
          courseId: 'CRS102',
          share: 0.4,
          minBlockSeconds: 300,
          contributions: [{ name: 'floor', value: 0.2 }],
        },
      ],
      declaredConstants: {
        urgencyOverrideThreshold: URGENCY_OVERRIDE_THRESHOLD,
        withinBlockProximityHalfLifeDays: WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS,
        materialArrivalCohortHalfLifeDays: MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS,
      },
      chosen: [
        {
          instrumentId: 'i-alpha',
          conceptKey: 'key-alpha',
          obligationClass: 'unmet',
          formatMatch: 'no-preference',
          dedupeReason: null,
          rankedReason: 'A coined one-clause reason.',
        },
        {
          instrumentId: 'i-beta',
          conceptKey: 'key-beta',
          obligationClass: 'unmet',
          formatMatch: 'no-preference',
          dedupeReason: null,
          rankedReason: null,
        },
      ],
      setAside: {
        courses: [{ courseId: 'CRS102', reason: 'another-course-chosen' }],
        concepts: [{ conceptKey: 'key-gamma', reason: 'did-not-fit' }],
        instruments: [],
      },
    });
  });

  it('adds no concept name, note title or note path beside the ids it carries', () => {
    const line = serializeCompositionRecord(recordFixture());
    for (const content of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Coined notes', ' note', '.md']) {
      expect(line).not.toContain(content);
    }
    expect(line).not.toContain('A coined sentence the record does not keep.');
  });

  it("records steering by id, and the harness's every-course baseline with no course and no branch", () => {
    const { input } = composedFixture();
    const session = buildComposedStudySession({ ...input, focusPolicy: 'every-course' });
    const record = buildCompositionRecord(session, {
      compositionId: 'composition-key1:nonce-2',
      composedAt: COMPOSED_AT,
      planVersion: null,
      reentry: true,
      courses: ['CRS101', 'CRS102'],
    });
    expect(record.course).toBeNull();
    expect(record.branch).toBeNull();
    expect(record.focusPolicy).toBe('every-course');
    expect(record.reentry).toBe(true);
    expect(record.steering).toEqual({ courses: ['CRS101', 'CRS102'], conceptIds: null });
    expect(record.planAllocation).toEqual([]);
    expect(record.policyVersions).toEqual({});
  });

  it('refuses a session with no composition account rather than recording facts nobody computed', () => {
    const { session } = composedFixture();
    const { groupingSignal: _g, ...withoutAccount } = session;
    expect(() =>
      buildCompositionRecord(withoutAccount, {
        compositionId: 'composition-key1:nonce-3',
        composedAt: COMPOSED_AT,
        planVersion: null,
        reentry: false,
      }),
    ).toThrow(/no composition account/);
  });

  it("refuses a malformed instant, and a policy version filed under the study plan's own kind", () => {
    const { session } = composedFixture();
    const context = {
      compositionId: 'composition-key1:nonce-4',
      composedAt: COMPOSED_AT,
      planVersion: null,
      reentry: false,
    };
    expect(() =>
      buildCompositionRecord(session, { ...context, composedAt: '2026-09-14 18:30' }),
    ).toThrow();
    expect(() =>
      buildCompositionRecord(session, { ...context, composedAt: '2026-09-14T18:30:00.000' }),
    ).toThrow();
    expect(() =>
      buildCompositionRecord(session, { ...context, policyVersions: { 'study-plan': 'x' } }),
    ).toThrow();
  });
});

describe('[D-331] buildExtendedCompositionRecord', () => {
  it("carries the parent's frozen facts and records what the extension changed", () => {
    const { input, session } = composedFixture();
    const parent = recordFixture();
    const wider = { ...input, budgetMinutes: 4 };
    const extended = extendComposedStudySessionWithAccount(wider, session);
    const record = buildExtendedCompositionRecord(parent, extended, {
      compositionId: 'composition-key1:nonce-5',
      composedAt: '2026-09-14T19:00:00.000+10:00',
      asOf: AS_OF,
      budgetMinutes: 4,
    });
    const {
      kind,
      compositionId,
      parentCompositionId,
      composedAt,
      budgetMinutes,
      chosen,
      setAside,
      ...frozen
    } = record;
    const {
      kind: _k,
      compositionId: _c,
      parentCompositionId: _p,
      composedAt: _a,
      budgetMinutes: _b,
      chosen: _ch,
      setAside: _s,
      ...parentFrozen
    } = parent;
    expect(frozen).toEqual(parentFrozen);
    expect(kind).toBe('extend');
    expect(compositionId).toBe('composition-key1:nonce-5');
    expect(parentCompositionId).toBe(parent.compositionId);
    expect(record.sittingId).toBe(parent.sittingId);
    expect(composedAt).toBe('2026-09-14T19:00:00.000+10:00');
    expect(budgetMinutes).toBe(4);
    expect(chosen.map((c) => c.instrumentId)).toEqual(['i-alpha', 'i-beta', 'i-gamma']);
    expect(chosen.map((c) => c.conceptKey)).toEqual(['key-alpha', 'key-beta', 'key-gamma']);
    expect(setAside.concepts).toEqual([]);
    expect(setAside.courses).toEqual(parent.setAside.courses);
  });

  it("refuses a session that is not the parent's course", () => {
    const parent = recordFixture();
    const { input } = composedFixture();
    const other = buildComposedStudySession({ ...input, courses: ['CRS102'] });
    expect(() =>
      buildExtendedCompositionRecord(parent, other, {
        compositionId: 'composition-key1:nonce-6',
        composedAt: COMPOSED_AT,
        asOf: AS_OF,
        budgetMinutes: 4,
      }),
    ).toThrow(/not the parent composition's course/);
  });
});

// ---------------------------------------------------------------------------
// INV-2: serialization and parsing
// ---------------------------------------------------------------------------

describe('[D-331] serialize and parse — byte-identical round trips (INV-2)', () => {
  it('writes one newline-terminated line, and serialize(parse(line)) reproduces it byte for byte', () => {
    const record = recordFixture();
    const line = serializeCompositionRecord(record);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    const parsed = parseCompositionRecord(JSON.parse(line));
    expect(parsed).toEqual(record);
    expect(parsed === null ? null : serializeCompositionRecord(parsed)).toBe(line);
  });

  it('is canonical whatever order the fields were assembled in, and sorts policy versions by kind', () => {
    const record = recordFixture();
    const reversed = Object.fromEntries(
      Object.entries(record).reverse(),
    ) as unknown as CompositionRecord;
    const withTwo = { ...record, policyVersions: { 'rank-weights': 'b', 'depth-gate': 'a' } };
    expect(serializeCompositionRecord(reversed)).toBe(serializeCompositionRecord(record));
    const line = serializeCompositionRecord(withTwo);
    expect(line.indexOf('"depth-gate"')).toBeLessThan(line.indexOf('"rank-weights"'));
  });

  it('writes -0 as 0, so a record still equals its own round trip', () => {
    const record = recordFixture();
    const withNegativeZero = {
      ...record,
      planAllocation: [
        {
          courseId: 'CRS101',
          share: -0,
          minBlockSeconds: 300,
          contributions: [{ name: 'risk', value: -0 }],
        },
      ],
    };
    const line = serializeCompositionRecord(withNegativeZero);
    expect(line).not.toMatch(/:-0[,}]/);
    expect(line).toContain('"share":0,');
    const again = parseCompositionRecord(JSON.parse(line));
    expect(again === null ? null : serializeCompositionRecord(again)).toBe(line);
  });

  it('reads the version first and never guesses: a missing, newer or non-numeric schemaVersion is unreadable', () => {
    const json = JSON.parse(serializeCompositionRecord(recordFixture()));
    expect(parseCompositionRecord({ ...json, schemaVersion: 2 })).toBeNull();
    expect(parseCompositionRecord({ ...json, schemaVersion: '1' })).toBeNull();
    const { schemaVersion: _v, ...noVersion } = json;
    expect(parseCompositionRecord(noVersion)).toBeNull();
  });

  it('refuses an unknown or missing field, an unknown enum value, and an inconsistent sitting', () => {
    const json = JSON.parse(serializeCompositionRecord(recordFixture()));
    expect(parseCompositionRecord({ ...json, rating: 'good' })).toBeNull();
    const { setAside: _s, ...missing } = json;
    expect(parseCompositionRecord(missing)).toBeNull();
    expect(parseCompositionRecord({ ...json, groupingSignal: 'exam-season' })).toBeNull();
    expect(parseCompositionRecord({ ...json, branch: null })).toBeNull();
    expect(
      parseCompositionRecord({ ...json, parentCompositionId: 'composition-key1:x' }),
    ).toBeNull();
    expect(parseCompositionRecord({ ...json, kind: 'extend' })).toBeNull();
    expect(parseCompositionRecord({ ...json, composedAt: '2026-09-14T18:30:00' })).toBeNull();
    expect(
      parseCompositionRecord({
        ...json,
        chosen: [{ ...json.chosen[0], durationMs: 1200 }],
      }),
    ).toBeNull();
  });

  it('parses a log line by line: a partial trailing line from an interrupted append costs only itself', () => {
    const one = serializeCompositionRecord(recordFixture());
    // Line 1 ends CRLF, line 2 is blank, line 3 is whole, line 4 is half a record with no newline.
    const content = `${one.slice(0, -1)}\r\n\n${one}${one.slice(0, 40)}`;
    const { records, invalidLines } = parseCompositionLog(content);
    expect(records).toEqual([recordFixture(), recordFixture()]);
    expect(invalidLines).toEqual([{ lineNumber: 4, reason: 'invalid JSON' }]);
  });
});

// ---------------------------------------------------------------------------
// The two guards the ruling and F2.19 put on it
// ---------------------------------------------------------------------------

describe('[D-331] never accrues attention; F2.19 holds', () => {
  it('a composition line is never readable as a review-log event, even if one were misfiled into that log', () => {
    const line = serializeCompositionRecord(recordFixture());
    const parsed = parseReviewLog(line);
    expect(parsed.records).toEqual([]);
    expect(parsed.invalidLines).toHaveLength(1);
  });

  it('no key anywhere in the record names a phase, stage or term position', () => {
    const FORBIDDEN = ['phase', 'stage', 'termposition', 'term_position'];
    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) {
          keys.push(key);
          walk(inner);
        }
      }
    };
    walk(recordFixture());
    expect(keys.filter((key) => FORBIDDEN.some((f) => key.toLowerCase().includes(f)))).toEqual([]);
  });
});
