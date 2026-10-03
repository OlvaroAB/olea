// `[D-483]` (`ol-egov.141.89.6.87.1`): the attempt id, the restatement finding and digests-only
// grading provenance as ADDITIVE OPTIONAL fields on the v6 explain-back review. No version bump,
// no text. Each is proved written, read back byte for byte, and absent-is-byte-identical.
import { describe, expect, it } from 'vitest';
import {
  explainBackGradingProvenance,
  restatementFindingOf,
  reviewLogEntryV6,
  reviewLogRecordV6,
} from './review-log.js';

const stamp = { taskId: 'explain-back.judge.v1', promptVersion: '1.5.0', modelId: 'model-x' };

function line(over: Record<string, unknown> = {}, instrumentType = 'explain-back') {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'review-1',
    timestamp: '2026-10-03T10:15:00-04:00',
    instrumentId: 'explain-back:concept-a',
    instrumentType,
    rating: null,
    wasUnsure: false,
    durationMs: 100,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrumentType],
      planVersion: null,
    },
    conceptIds: ['concept-a'],
    ...over,
  };
}

describe('[D-483] additive optional fields on the v6 explain-back review', () => {
  it('a record without any of them re-serialises byte-identically, with no new key (INV-2)', () => {
    const text = JSON.stringify(
      line({ explainBackCorrectness: { verdict: 'correct', artifactProvenance: stamp } }),
    );
    const parsed = reviewLogRecordV6.parse(JSON.parse(text));
    expect(JSON.stringify(parsed)).toBe(text);
    expect(Object.hasOwn(parsed, 'attemptId')).toBe(false);
    expect(Object.hasOwn(parsed, 'gradingProvenance')).toBe(false);
    expect(restatementFindingOf(parsed)).toBeUndefined();
  });

  it('a record carrying all three reads back byte for byte through the union', () => {
    const text = JSON.stringify(
      line({
        explainBackCorrectness: {
          verdict: 'correct',
          artifactProvenance: stamp,
          restatement: { sourceBlockIds: ['b1', 'b2'], spanCount: 2 },
        },
        attemptId: 'attempt-1',
        gradingProvenance: {
          requestVersion: 'req-1',
          instrumentVersion: 'inst-3',
          targetVersion: 'tgt-2',
          passageFingerprints: ['fp-a'],
        },
      }),
    );
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(text)))).toBe(text);
    expect(restatementFindingOf(reviewLogRecordV6.parse(JSON.parse(text)))).toEqual({
      sourceBlockIds: ['b1', 'b2'],
      spanCount: 2,
    });
  });

  it('the finding carries ids and a count, never wording: a spans array is dropped on parse', () => {
    const parsed = reviewLogRecordV6.parse(
      line({
        explainBackCorrectness: {
          verdict: 'correct',
          artifactProvenance: stamp,
          restatement: { sourceBlockIds: ['b1'], spanCount: 1, answerSpans: ['invented words'] },
        },
      }),
    );
    expect(JSON.stringify(parsed)).not.toContain('invented words');
  });

  it('refuses an empty finding, and attemptId or provenance off an explain-back review', () => {
    expect(
      reviewLogRecordV6.safeParse(
        line({
          explainBackCorrectness: {
            verdict: 'correct',
            artifactProvenance: stamp,
            restatement: { sourceBlockIds: [], spanCount: 0 },
          },
        }),
      ).success,
    ).toBe(false);
    expect(reviewLogRecordV6.safeParse(line({ attemptId: 'a' }, 'qa')).success).toBe(false);
    expect(
      reviewLogRecordV6.safeParse(line({ gradingProvenance: { requestVersion: 'r' } }, 'qa'))
        .success,
    ).toBe(false);
  });

  it('provenance holds only versions and fingerprints', () => {
    expect(Object.keys(explainBackGradingProvenance.shape).sort()).toEqual([
      'instrumentVersion',
      'passageFingerprints',
      'requestVersion',
      'targetVersion',
    ]);
  });
});
