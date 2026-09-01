/**
 * Scenario: `docs/dev/verdict-seam-design.md` §5 (olea-service) — "nothing
 * composes the actual `ReviewLogRecordInput` write". Covers both the pure
 * composer and the one impure production-shaped write this module adds for
 * `ol-95vv.3`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AcceptedSoloGrading } from '../grading/explainBackSolo.js';
import { readContentRecord } from '../review-log/content-store.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  composeGradedExplainBackReviewRecord,
  type GradedExplainBackReviewSubject,
  recordGradedExplainBackReview,
} from './explain-back-grade-write.js';

const ACCEPTED: AcceptedSoloGrading = {
  status: 'accepted',
  soloLevel: 'relational',
  rationale: 'Connects both mechanisms under one principle.',
  citedBlockIds: ['blk-1'],
};

const ACCEPTED_WITH_NEIGHBOUR: AcceptedSoloGrading = {
  ...ACCEPTED,
  neighbourUseDemonstrated: true,
};

function subject(
  overrides: Partial<GradedExplainBackReviewSubject> = {},
): GradedExplainBackReviewSubject {
  return {
    instrumentId: 'explain-back:permeability:1',
    conceptIds: ['permeability'],
    timestamp: '2026-08-31T09:05:00-04:00',
    wasUnsure: false,
    durationMs: 45_000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    ...overrides,
  };
}

describe('composeGradedExplainBackReviewRecord (pure)', () => {
  it("spreads explainBackGrade onto the subject's own base review fields, with rating always null (F2.16)", () => {
    const record = composeGradedExplainBackReviewRecord({
      subject: subject(),
      accepted: ACCEPTED,
      contentRef: 'content-ref-1',
      revisionOf: null,
      artifactProvenance: {
        taskId: 'explain-back.solo.v1',
        promptVersion: '1.0.0',
        modelId: 'test-model',
      },
    });

    expect(record).toEqual({
      timestamp: '2026-08-31T09:05:00-04:00',
      instrumentId: 'explain-back:permeability:1',
      instrumentType: 'explain-back',
      conceptIds: ['permeability'],
      rating: null,
      wasUnsure: false,
      durationMs: 45_000,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['explain-back'],
        planVersion: null,
      },
      explainBackGrade: {
        soloLevel: 'relational',
        contentRef: 'content-ref-1',
        revisionOf: null,
        artifactProvenance: {
          taskId: 'explain-back.solo.v1',
          promptVersion: '1.0.0',
          modelId: 'test-model',
        },
      },
    });
    // Absent, never a fabricated null/undefined-holding key.
    expect(Object.hasOwn(record, 'schedulingObservation')).toBe(false);
    expect(Object.hasOwn(record, 'masteryAtTime')).toBe(false);
    expect(Object.hasOwn(record, 'supportLevelShown')).toBe(false);
  });

  it('merges schedulingObservation only when neighbourUseDemonstrated was true, with the neighbour concept id supplied', () => {
    const record = composeGradedExplainBackReviewRecord({
      subject: subject(),
      accepted: ACCEPTED_WITH_NEIGHBOUR,
      contentRef: 'content-ref-2',
      revisionOf: null,
      artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
      neighbourConceptId: 'porosity',
    });

    expect(record.schedulingObservation).toEqual({ neighbourConceptId: 'porosity' });
  });

  it('carries masteryAtTime and supportLevelShown through only when the subject supplies them', () => {
    const record = composeGradedExplainBackReviewRecord({
      subject: subject({
        masteryAtTime: { attribution: 'per-concept', byConcept: { permeability: 'sapling' } },
        supportLevelShown: 'guided',
      }),
      accepted: ACCEPTED,
      contentRef: 'content-ref-3',
      revisionOf: null,
      artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
    });

    expect(record.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { permeability: 'sapling' },
    });
    expect(record.supportLevelShown).toBe('guided');
  });

  it('carries revisionOf through as an explicit backward pointer, never omitted', () => {
    const record = composeGradedExplainBackReviewRecord({
      subject: subject(),
      accepted: ACCEPTED,
      contentRef: 'content-ref-4',
      revisionOf: 'prior-event-id',
      artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
    });

    expect(record.explainBackGrade?.revisionOf).toBe('prior-event-id');
  });

  it('throws (via buildExplainBackGradeReviewFields) when neighbourUseDemonstrated is true but no neighbourConceptId was supplied', () => {
    expect(() =>
      composeGradedExplainBackReviewRecord({
        subject: subject(),
        accepted: ACCEPTED_WITH_NEIGHBOUR,
        contentRef: 'content-ref-5',
        revisionOf: null,
        artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
      }),
    ).toThrow(/neighbourConceptId/);
  });
});

describe('recordGradedExplainBackReview (the one impure export)', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-explain-back-grade-write-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('mints a real [D-077] contentRef, writes it to the content store, and appends a complete v5 review event naming it', async () => {
    const vault = new FolderSource(tempRoot);

    const result = await recordGradedExplainBackReview(
      vault,
      {
        subject: subject(),
        accepted: ACCEPTED,
        studentAnswer: 'Answer text — never logged, only ever written to the content store.',
        revisionOf: null,
        artifactProvenance: {
          taskId: 'explain-back.solo.v1',
          promptVersion: '1.0.0',
          modelId: 'test-model',
        },
      },
      {
        deviceId: 'desktop-1',
        generateContentId: () => 'desktop-1.fixed-content',
        generateEventId: () => 'fixed-event-1',
      },
    );

    expect(result.record.schemaVersion).toBe(5);
    expect(result.record.kind).toBe('review');
    expect(result.record.eventId).toBe('fixed-event-1');
    expect(result.record.instrumentType).toBe('explain-back');
    expect(result.record.rating).toBeNull();
    expect(result.record.explainBackGrade?.contentRef).toBe('desktop-1.fixed-content');
    expect(result.record.explainBackGrade?.soloLevel).toBe('relational');

    // The content store actually holds the evidence the grade points at.
    const stored = await readContentRecord(vault, 'desktop-1.fixed-content');
    expect(stored).toEqual({
      status: 'found',
      record: {
        contentId: 'desktop-1.fixed-content',
        studentAnswer: 'Answer text — never logged, only ever written to the content store.',
        feedback: 'Connects both mechanisms under one principle.',
      },
    });
  });

  it('also writes schedulingObservation when the grading demonstrated neighbour use', async () => {
    const vault = new FolderSource(tempRoot);

    const result = await recordGradedExplainBackReview(
      vault,
      {
        subject: subject(),
        accepted: ACCEPTED_WITH_NEIGHBOUR,
        studentAnswer: 'x',
        revisionOf: null,
        artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
        neighbourConceptId: 'porosity',
      },
      { deviceId: 'desktop-1' },
    );

    expect(result.record.schedulingObservation).toEqual({ neighbourConceptId: 'porosity' });
  });

  it('writes misconceptionDetail into the content store only when supplied', async () => {
    const vault = new FolderSource(tempRoot);

    const result = await recordGradedExplainBackReview(
      vault,
      {
        subject: subject(),
        accepted: ACCEPTED,
        studentAnswer: 'x',
        misconceptionDetail: 'confused cause with correlation',
        revisionOf: null,
        artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
      },
      { deviceId: 'desktop-1' },
    );

    const stored = await readContentRecord(vault, result.record.explainBackGrade?.contentRef ?? '');
    expect(stored.status === 'found' && stored.record.misconceptionDetail).toBe(
      'confused cause with correlation',
    );
  });

  it("rejects a record that would fail the frozen v5 schema before any write completes the append (belt-and-braces over appendReviewLogRecord's own gate)", async () => {
    const vault = new FolderSource(tempRoot);

    await expect(
      recordGradedExplainBackReview(
        vault,
        {
          subject: subject({ conceptIds: [] }), // frozen schema requires non-empty conceptIds
          accepted: ACCEPTED,
          studentAnswer: 'x',
          revisionOf: null,
          artifactProvenance: { taskId: 't', promptVersion: 'v', modelId: 'm' },
        },
        { deviceId: 'desktop-1' },
      ),
    ).rejects.toThrow(/record failed schema validation/);
  });
});
