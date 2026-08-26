// PERMANENT SUITE (`ol-tka5`, ratified `[D-117]`, implementing David's six-item
// ruling of 2026-08-22 plus MAT-4's `schedulingObservation`). Schema version
// 5 — the grading verdict gets a home, the support ladder gets an objective
// record, and a re-grade gets a backward pointer.
//
// Replaces `review-log-v4.spec.ts` outright rather than sitting beside it
// (`[D-109]`'s migrate-in-place ruling: v4 is not retained as a frozen,
// readable historical version, so there is no v4 shape left to test a
// crossing against — see `review-log.ts`'s header for the full argument).
// v1, v2 and v3 are untouched and keep their own permanent suites.
//
// What v5 has to prove, and none of it is "does zod work" trivia:
//
//   1. v5 is v4 plus three fields — `supportLevelShown`, `explainBackGrade`,
//      `schedulingObservation` — all optional, and nothing else moved,
//      appeared or vanished;
//   2. the two new fields are gated to explain-back reviews only
//      (`refineExplainBackGradeInstrumentType`);
//   3. `schedulingObservation.neighbourConceptId` can never be one of the
//      record's own `conceptIds` (`refineSchedulingObservationNotSubject`);
//   4. `explainBackGrade.soloLevel` is the five-level SOLO enum, never a
//      binary or a number (R9/GLOSSARY);
//   5. `explainBackGrade.revisionOf` is a plain nullable backward pointer,
//      not a discriminated "supersession" shape — §4 of the design settles
//      this as derived-at-read-time, not stored;
//   6. the versions never silently cross, in both directions;
//   7. `suspendLogRecordV5`/`verdictLogRecordV5` moved version with no shape
//      change at all.
import { describe, expect, it } from 'vitest';
import {
  type ExplainBackGrade,
  explainBackGrade,
  REVIEW_LOG_SCHEMA_VERSION,
  reviewLogEntry,
  reviewLogEntryV3,
  reviewLogEntryV5,
  reviewLogRecord,
  reviewLogRecordV3,
  reviewLogRecordV5,
  type SchedulingObservation,
  schedulingObservation,
  soloLevel,
  suspendLogRecord,
  suspendLogRecordV3,
  suspendLogRecordV5,
  supportLevel,
} from './review-log.js';

const SELECTION_CONTEXT_V4 = {
  dueState: 'due',
  examProximity: null,
  yieldRank: null,
  instrumentTypesOffered: ['qa'],
  planVersion: null,
} as const;

const PROVENANCE = {
  taskId: 'grade.explain-back.v1',
  promptVersion: '2026-08-26',
  modelId: 'workers-ai:test-model',
} as const;

function v3ReviewLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3,
    kind: 'review',
    eventId: 'e1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: { ...SELECTION_CONTEXT_V4, masteryAtTime: 'sprout' },
    conceptIds: ['imbrication'],
    ...over,
  };
}

function v5ReviewLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'e1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    instrumentType: 'qa',
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: SELECTION_CONTEXT_V4,
    conceptIds: ['imbrication'],
    ...over,
  };
}

function explainBackLine(over: Record<string, unknown> = {}) {
  return v5ReviewLine({
    instrumentId: 'explain-back:imbrication:1',
    instrumentType: 'explain-back',
    rating: null,
    durationMs: null,
    ...over,
  });
}

const GRADE: ExplainBackGrade = {
  soloLevel: 'relational',
  contentRef: 'content:grade-1',
  revisionOf: null,
  artifactProvenance: PROVENANCE,
};

const OBSERVATION: SchedulingObservation = { neighbourConceptId: 'bioturbation' };

function v3SuspendLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3,
    kind: 'suspend',
    eventId: 's1',
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:imbrication:1',
    conceptIds: ['imbrication'],
    ...over,
  };
}

function v5SuspendLine(over: Record<string, unknown> = {}) {
  return { ...v3SuspendLine(), schemaVersion: 5, ...over };
}

describe('review-log schema version 5 is the current one', () => {
  it('the version writers stamp is 5', () => {
    expect(REVIEW_LOG_SCHEMA_VERSION).toBe(5);
  });

  it('`reviewLogRecord` and `suspendLogRecord` alias the v5 shapes', () => {
    expect(reviewLogRecord).toBe(reviewLogRecordV5);
    expect(suspendLogRecord).toBe(suspendLogRecordV5);
    expect(reviewLogEntry).toBe(reviewLogEntryV5);
  });
});

describe('v5 is v4 plus three optional fields — nothing else changed', () => {
  it('the record gains exactly three keys, all the ones this bead adds', () => {
    // `reviewLogRecordV4` no longer exists as a symbol (`[D-109]`'s
    // migrate-in-place rename), so the comparison is against v3 plus every
    // key v4 ever added: `masteryAtTime` (`ol-g6zg`) and the three from this
    // bead.
    const v3Keys = Object.keys(reviewLogRecordV3.shape).sort();
    const v5Keys = Object.keys(reviewLogRecordV5.shape).sort();
    expect(v5Keys).toEqual(
      [...v3Keys, 'masteryAtTime', 'supportLevelShown', 'explainBackGrade', 'schedulingObservation'].sort(),
    );
  });

  it('the suspend record gains nothing at all — only its version moved (twice now)', () => {
    expect(Object.keys(suspendLogRecordV5.shape).sort()).toEqual(
      Object.keys(suspendLogRecordV3.shape).sort(),
    );
    expect(suspendLogRecordV5.parse(v5SuspendLine()).schemaVersion).toBe(5);
  });

  it('a record with none of the three new fields parses, and acquires none of the keys', () => {
    const parsed = reviewLogRecordV5.parse(v5ReviewLine());
    expect(parsed.supportLevelShown).toBeUndefined();
    expect(parsed.explainBackGrade).toBeUndefined();
    expect(parsed.schedulingObservation).toBeUndefined();
    expect(Object.hasOwn(parsed, 'supportLevelShown')).toBe(false);
    expect(Object.hasOwn(parsed, 'explainBackGrade')).toBe(false);
    expect(Object.hasOwn(parsed, 'schedulingObservation')).toBe(false);
  });
});

describe('supportLevelShown — objective, never her self-rating', () => {
  it('accepts every ladder tier on any review kind', () => {
    for (const level of supportLevel.options) {
      expect(reviewLogRecordV5.safeParse(v5ReviewLine({ supportLevelShown: level })).success).toBe(
        true,
      );
    }
  });

  it('rejects a value outside the three-tier ladder', () => {
    expect(
      reviewLogRecordV5.safeParse(v5ReviewLine({ supportLevelShown: 'reduced-difficulty' })).success,
    ).toBe(false);
  });

  it('is exactly the three D-094 tiers, in D-094 order', () => {
    expect(supportLevel.options).toEqual(['independent', 'prompted', 'guided']);
  });
});

describe('explainBackGrade and schedulingObservation are gated to explain-back reviews', () => {
  it('accepts explainBackGrade on an explain-back review', () => {
    const parsed = reviewLogRecordV5.parse(explainBackLine({ explainBackGrade: GRADE }));
    expect(parsed.explainBackGrade).toEqual(GRADE);
  });

  it('rejects explainBackGrade on a qa review — SOLO grades a response, and only explain-back is gradable', () => {
    expect(
      reviewLogRecordV5.safeParse(v5ReviewLine({ explainBackGrade: GRADE })).success,
    ).toBe(false);
  });

  it('accepts schedulingObservation on an explain-back review naming a different concept', () => {
    const parsed = reviewLogRecordV5.parse(
      explainBackLine({ schedulingObservation: OBSERVATION }),
    );
    expect(parsed.schedulingObservation).toEqual(OBSERVATION);
  });

  it('rejects schedulingObservation on a qa review', () => {
    expect(
      reviewLogRecordV5.safeParse(v5ReviewLine({ schedulingObservation: OBSERVATION })).success,
    ).toBe(false);
  });

  it('the refinement fires through the union too, not only on the bare record', () => {
    expect(
      reviewLogEntryV5.safeParse(v5ReviewLine({ explainBackGrade: GRADE })).success,
    ).toBe(false);
  });

  it('both fields can compose on the same explain-back review', () => {
    const parsed = reviewLogRecordV5.parse(
      explainBackLine({ explainBackGrade: GRADE, schedulingObservation: OBSERVATION }),
    );
    expect(parsed.explainBackGrade).toEqual(GRADE);
    expect(parsed.schedulingObservation).toEqual(OBSERVATION);
  });
});

describe('schedulingObservation.neighbourConceptId is never the record’s own subject (C5.11)', () => {
  it('rejects the record’s own single conceptId as its neighbour', () => {
    expect(
      reviewLogRecordV5.safeParse(
        explainBackLine({ schedulingObservation: { neighbourConceptId: 'imbrication' } }),
      ).success,
    ).toBe(false);
  });

  it('rejects a neighbour that is any one of several named concepts', () => {
    expect(
      reviewLogRecordV5.safeParse(
        explainBackLine({
          conceptIds: ['imbrication', 'bioturbation'],
          schedulingObservation: { neighbourConceptId: 'bioturbation' },
        }),
      ).success,
    ).toBe(false);
  });

  it('accepts a neighbour genuinely outside the record’s conceptIds', () => {
    expect(
      reviewLogRecordV5.safeParse(
        explainBackLine({
          conceptIds: ['imbrication', 'bioturbation'],
          schedulingObservation: { neighbourConceptId: 'cementation' },
        }),
      ).success,
    ).toBe(true);
  });
});

describe('explainBackGrade.soloLevel — the five-level SOLO enum, never a binary field', () => {
  it('is exactly the five GLOSSARY levels, low to high', () => {
    expect(soloLevel.options).toEqual([
      'prestructural',
      'unistructural',
      'multistructural',
      'relational',
      'extended-abstract',
    ]);
  });

  it('accepts every level', () => {
    for (const level of soloLevel.options) {
      const parsed = reviewLogRecordV5.parse(
        explainBackLine({ explainBackGrade: { ...GRADE, soloLevel: level } }),
      );
      expect(parsed.explainBackGrade?.soloLevel).toBe(level);
    }
  });

  it('rejects a boolean or numeric stand-in for depth', () => {
    expect(
      explainBackGrade.safeParse({ ...GRADE, soloLevel: true }).success,
    ).toBe(false);
    expect(
      explainBackGrade.safeParse({ ...GRADE, soloLevel: 3 }).success,
    ).toBe(false);
  });
});

describe('explainBackGrade.revisionOf — a backward pointer, not a supersession event', () => {
  it('null means a fresh attempt, not a re-grade', () => {
    const parsed = reviewLogRecordV5.parse(
      explainBackLine({ explainBackGrade: { ...GRADE, revisionOf: null } }),
    );
    expect(parsed.explainBackGrade?.revisionOf).toBeNull();
  });

  it('a non-null value names the eventId of the graded record being re-graded', () => {
    const parsed = reviewLogRecordV5.parse(
      explainBackLine({ eventId: 'e2', explainBackGrade: { ...GRADE, revisionOf: 'e1' } }),
    );
    expect(parsed.explainBackGrade?.revisionOf).toBe('e1');
  });

  it('is required (nullable, not optional) — a real grading write path always decides one way or the other', () => {
    const { revisionOf: _drop, ...withoutRevisionOf } = GRADE;
    expect(explainBackGrade.safeParse(withoutRevisionOf).success).toBe(false);
  });

  it('rejects an empty string — an opaque id is non-empty like every other id in this file', () => {
    expect(explainBackGrade.safeParse({ ...GRADE, revisionOf: '' }).success).toBe(false);
  });
});

describe('explainBackGrade.contentRef and artifactProvenance carry no content (D-005)', () => {
  it('contentRef is a bare non-empty identifier', () => {
    expect(explainBackGrade.safeParse({ ...GRADE, contentRef: '' }).success).toBe(false);
    expect(explainBackGrade.parse(GRADE).contentRef).toBe('content:grade-1');
  });

  it('artifactProvenance is required and carries exactly the three D-005-permitted identifiers', () => {
    const { artifactProvenance: _drop, ...withoutProvenance } = GRADE;
    expect(explainBackGrade.safeParse(withoutProvenance).success).toBe(false);
    expect(Object.keys(explainBackGrade.parse(GRADE).artifactProvenance).sort()).toEqual(
      ['taskId', 'promptVersion', 'modelId'].sort(),
    );
  });
});

describe('schedulingObservation is its own object, never a bare concept id', () => {
  it('parses a well-formed observation', () => {
    expect(schedulingObservation.safeParse(OBSERVATION).success).toBe(true);
  });

  it('rejects a bare string in place of the object', () => {
    expect(schedulingObservation.safeParse('bioturbation').success).toBe(false);
  });

  it('rejects an empty neighbourConceptId', () => {
    expect(schedulingObservation.safeParse({ neighbourConceptId: '' }).success).toBe(false);
  });
});

describe('the four versions never silently cross', () => {
  it('v5 rejects a v3 line and v3 rejects a v5 line', () => {
    expect(reviewLogRecordV5.safeParse(v3ReviewLine()).success).toBe(false);
    expect(reviewLogRecordV3.safeParse(v5ReviewLine()).success).toBe(false);
  });

  it('the v3 union still parses v3 lines, and refuses v5 ones', () => {
    expect(reviewLogEntryV3.safeParse(v3ReviewLine()).success).toBe(true);
    expect(reviewLogEntryV3.safeParse(v5ReviewLine()).success).toBe(false);
    expect(reviewLogEntryV3.safeParse(v5SuspendLine()).success).toBe(false);
  });

  it('the current union parses v5 lines of every kind, and refuses v3 ones', () => {
    expect(reviewLogEntry.safeParse(v5ReviewLine()).success).toBe(true);
    expect(reviewLogEntry.safeParse(v5SuspendLine()).success).toBe(true);
    expect(reviewLogEntry.safeParse(v5SuspendLine({ kind: 'unsuspend' })).success).toBe(true);
    expect(reviewLogEntry.safeParse(v3ReviewLine()).success).toBe(false);
    expect(reviewLogEntry.safeParse(v3SuspendLine()).success).toBe(false);
  });

  it('conceptIds keeps every guarantee it had at v3', () => {
    expect(reviewLogRecordV5.safeParse(v5ReviewLine({ conceptIds: [] })).success).toBe(false);
    expect(reviewLogRecordV5.safeParse(v5ReviewLine({ conceptIds: [''] })).success).toBe(false);
    expect(suspendLogRecordV5.safeParse(v5SuspendLine({ conceptIds: [] })).success).toBe(false);
  });
});
