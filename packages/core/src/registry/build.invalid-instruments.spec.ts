// Scenario: olea-service/features/F5-explain-it-back.md — "F5.8 — what the
// top growth stage claims, and the evidence that qualifies it [D-281]" — at
// the ONE production caller this file owns: `buildRegistryModel`.
//
// `[D-338]` (ruled 2026-09-25, `olea-service`'s `ol-egov.141.89.9.7`): the
// displayed stage is corrected only on PROVEN-invalid evidence; forgetting
// and a source merely acquiring a new revision never retract it, and
// (item 2 of the interim fix, `olea-service`'s `ol-egov.141.89.9.14`) neither
// does her own suspension or withdrawal. `ol-vrlp`'s `[D-281]` item 4 wiring
// read the registry's `suspendedInstrumentIds` (F8.5's withdrawn-instrument
// projection) straight into the mastery fold's `invalidInstrumentIds` — but
// a plain `suspend` record cannot say WHY (the citation-revision tick, her
// own withdrawal, and a confirmed defect all write the identical event, per
// `docs/dev/intelligence-build/att.md` items 1 and 2 in `olea-service`), so
// that wiring retracted an earned top stage on a revision or a withdrawal,
// which `[D-338]` forbids. This file proves the reversal: suspension alone
// (whatever wrote it) no longer touches the fold, while a `verdict: 'rejected'`
// record — already unambiguous, no reason field needed — still does.
//
// `../mastery/rollup.spec.ts` already proves `computeConceptMastery` itself
// honours `MasteryRollupOptions.invalidInstrumentIds`
// (`@auto:MAT-C5-instrument-validity`); this file proves the WIRING only.
//
// Concept/instrument identifiers below are structural placeholders
// ("concept-a", "qa:concept-a:1", "COURSE-A"), never fixture vocabulary — INV-3.
import type { ExplainBackGrade, ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import { contestClaim, type DisputeLogRecord, resolveDispute } from '../review-log/contest.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import { buildRegistryModel } from './build.js';
import { EMPTY_REGISTRY_OVERRIDES } from './overrides.js';

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

/**
 * A `[D-281]`-qualifying explain-back attempt against `qaInstrument()`'s own
 * id — correctness `correct`, depth at the `relational` gate, an admitted
 * support level — the same "all four pieces travel together" default
 * `../mastery/rollup.spec.ts`'s own `gradedExplainBack` fixture establishes.
 */
function qualifyingExplainBack(overrides: Partial<ExplainBackGrade> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'eb-1',
    timestamp: '2026-01-20T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'explain-back',
    conceptIds: ['concept-a'],
    rating: null,
    wasUnsure: false,
    durationMs: 4000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    supportLevelShown: 'independent',
    explainBackGrade: {
      soloLevel: 'relational',
      correctness: 'correct',
      contentRef: 'content-ref-1',
      revisionOf: null,
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
      ...overrides,
    },
  };
}

/**
 * The one `suspend` shape the log has — written identically by the
 * citation-revision tick, her own withdrawal in the registry, and (until
 * `[D-345]` rules a reason field) a confirmed defect. `[D-338]`'s interim
 * fix reads none of them as proof of invalidity.
 */
function suspendRecord(overrides: Partial<ReviewLogEntry> = {}): ReviewLogEntry {
  return {
    schemaVersion: 3,
    kind: 'suspend',
    eventId: 'suspend-1',
    timestamp: '2026-01-25T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    conceptIds: ['concept-a'],
    ...overrides,
  } as ReviewLogEntry;
}

/** A `'rejected'` verdict — a real refusal, unlike a mere suspend, and proven invalid without waiting on a reason field. */
function rejectedVerdict(overrides: Partial<ReviewLogEntry> = {}): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'verdict',
    eventId: 'verdict-1',
    timestamp: '2026-01-26T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    verdict: 'rejected',
    artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
    ...overrides,
  } as ReviewLogEntry;
}

const scheduler = createFsrsScheduler();
const now = new Date('2026-02-01T12:00:00Z');
const HOLDING_CUT = 0.8;

function buildFor(
  entries: readonly ReviewLogEntry[],
  suspended: ReadonlySet<string> = new Set(),
  disputes: readonly DisputeLogRecord[] = [],
) {
  return buildRegistryModel({
    concepts: [concept()],
    instrumentRecords: [qaInstrument()],
    entries,
    scheduler,
    now,
    holdingCut: HOLDING_CUT,
    overrides: EMPTY_REGISTRY_OVERRIDES,
    suspendedInstrumentIds: suspended,
    disputes,
  });
}

/**
 * A resolved `[D-095]` dispute against `qaInstrument()`'s own grade —
 * `outcome` defaults to `corrected`, `[D-338]` item 2's grade-half signal
 * (`ol-egov.141.89.9.23`). Both the opening and its resolution, in the shape
 * `buildRegistryModel`'s `disputes` input reads.
 */
function contestedGradeDisputes(
  outcome: 'upheld' | 'corrected' = 'corrected',
): readonly DisputeLogRecord[] {
  const opening = contestClaim({
    claim: {
      rendering: 'explain-back-grade',
      conceptIds: ['concept-a'],
      instrumentId: 'qa:concept-a:1',
      evidenceBasis: 'evidence-fingerprint-1',
    },
    timestamp: '2026-01-21T09:00:00-04:00',
  });
  const openingRecord: DisputeLogRecord = {
    schemaVersion: 5,
    kind: 'dispute',
    eventId: 'dispute-1',
    ...opening.record,
  };
  const resolution = resolveDispute({
    dispute: openingRecord,
    outcome,
    timestamp: '2026-01-22T09:00:00-04:00',
  });
  const resolutionRecord: DisputeLogRecord = {
    schemaVersion: 5,
    kind: 'dispute',
    eventId: 'dispute-2',
    ...resolution,
  };
  return [openingRecord, resolutionRecord];
}

describe('buildRegistryModel — [D-338]: suspension alone never retracts the top stage', () => {
  it('a qualifying attempt on an instrument still in good standing reaches `tree`', () => {
    const model = buildFor([qualifyingExplainBack()]);
    expect(model.concepts[0]?.mastery.state).toBe('tree');
  });

  it('the SAME attempt, once its instrument is suspended — as the citation-revision tick writes, or as her own withdrawal writes; the log cannot tell the two apart — KEEPS the top stage', () => {
    const suspended = new Set(['qa:concept-a:1']);
    const model = buildFor([qualifyingExplainBack(), suspendRecord()], suspended);
    expect(model.concepts[0]?.mastery.state).toBe('tree');
    // The instrument summary itself still reads `pruned` from the registry's
    // own withdrawn-instrument projection — display and the fold are
    // deliberately decoupled now, not the same read.
    expect(model.concepts[0]?.instruments[0]?.pruned).toBe(true);
  });

  it('the SAME attempt, once its instrument carries a `rejected` verdict — a real refusal, not a mere suspend — no longer qualifies the top stage', () => {
    const model = buildFor([qualifyingExplainBack(), rejectedVerdict()]);
    expect(model.concepts[0]?.mastery.state).not.toBe('tree');
    expect(model.concepts[0]?.mastery.state).toBe('sprout');
  });

  it('the SAME attempt, once a `[D-095]` dispute against its grade resolves `corrected` — the identical today-unambiguous "found defective" shape a `rejected` verdict already is (`[D-338]` item 2, `ol-egov.141.89.9.23`) — no longer qualifies the top stage', () => {
    const model = buildFor(
      [qualifyingExplainBack()],
      new Set(),
      contestedGradeDisputes('corrected'),
    );
    expect(model.concepts[0]?.mastery.state).not.toBe('tree');
    expect(model.concepts[0]?.mastery.state).toBe('sprout');
  });

  it('the SAME contest resolved `upheld` instead — the grading was checked and held, nothing found defective — KEEPS the top stage', () => {
    const model = buildFor([qualifyingExplainBack()], new Set(), contestedGradeDisputes('upheld'));
    expect(model.concepts[0]?.mastery.state).toBe('tree');
  });
});
