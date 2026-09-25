// Scenario: olea-service/features/F5-explain-it-back.md — "F5.8 — what the
// top growth stage claims, and the evidence that qualifies it [D-281]" —
// item 4, instrument validity, at the ONE production caller this file owns:
// `buildRegistryModel` (ol-vrlp, [DOS-C5b]).
//
// `../mastery/rollup.spec.ts` already proves `computeConceptMastery` itself
// honours `MasteryRollupOptions.invalidInstrumentIds` (`@auto:MAT-C5-
// instrument-validity`). This file proves the WIRING: that `buildRegistryModel`
// derives that option from the registry's own withdrawn-instrument projection
// (`suspendedInstrumentIds`, F8.5) rather than leaving the fold's default
// (nothing invalidated) in place — the gap `ol-vrlp` records, where a
// withdrawn instrument's attempt kept qualifying a concept for `tree` because
// no caller passed the set at all.
//
// Concept/instrument identifiers below are structural placeholders
// ("concept-a", "qa:concept-a:1", "COURSE-A"), never fixture vocabulary — INV-3.
import type { ExplainBackGrade, ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
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

const scheduler = createFsrsScheduler();
const now = new Date('2026-02-01T12:00:00Z');
const HOLDING_CUT = 0.8;

function buildFor(entries: readonly ReviewLogEntry[], suspended: ReadonlySet<string>) {
  return buildRegistryModel({
    concepts: [concept()],
    instrumentRecords: [qaInstrument()],
    entries,
    scheduler,
    now,
    holdingCut: HOLDING_CUT,
    overrides: EMPTY_REGISTRY_OVERRIDES,
    suspendedInstrumentIds: suspended,
  });
}

describe('buildRegistryModel — [D-281] item 4 reaches the fold (ol-vrlp)', () => {
  it('a qualifying attempt on an instrument still in good standing reaches `tree`', () => {
    const model = buildFor([qualifyingExplainBack()], new Set());
    expect(model.concepts[0]?.mastery.state).toBe('tree');
  });

  it('the SAME attempt, once its instrument is withdrawn (F8.5), no longer qualifies the top stage', () => {
    const withdrawn = buildFor([qualifyingExplainBack()], new Set(['qa:concept-a:1']));
    expect(withdrawn.concepts[0]?.mastery.state).not.toBe('tree');
    expect(withdrawn.concepts[0]?.mastery.state).toBe('sprout');
    // The instrument summary itself reads `pruned` from the very same set —
    // proof this is the registry's own current-standing projection, not a
    // second, independently-tracked notion of "withdrawn".
    expect(withdrawn.concepts[0]?.instruments[0]?.pruned).toBe(true);
  });

  it('unsuspending (F8.5 is reversible) lets the same historical attempt qualify again — nothing about the past attempt itself changed', () => {
    const restored = buildFor([qualifyingExplainBack()], new Set());
    expect(restored.concepts[0]?.mastery.state).toBe('tree');
  });
});
