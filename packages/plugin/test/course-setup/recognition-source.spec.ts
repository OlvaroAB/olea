/**
 * `readCourseSetupRecognitions` (`ol-egov.141.89.9.49`, F8.7, `[D-058]`/
 * `[D-274]`) — the proposal-time seam that assembles the review log and the
 * concept-to-course join (F1.3) and folds them through `olea-core`'s
 * `buildEarlierCourseRecognitions`.
 *
 * Fixture shape follows `packages/core/src/concept/extract.spec.ts`'s "course
 * association is M:N" case: two notes under `01 Courses/<CODE>/` sharing one
 * `topic:` give a single concept whose `courses` names both. INV-3: every
 * course code and concept name below is invented for this suite.
 */

import { appendReviewLogRecord, type CalendarDay, calendarDayFromLocalDate } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import { readCourseSetupRecognitions } from '../../src/course-setup/recognition-source.js';
import { memoryVault, unreadableVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const TODAY: CalendarDay = calendarDayFromLocalDate(new Date('2026-09-25T12:00:00-04:00'));

function twoCourseVault() {
  return memoryVault({
    '01 Courses/TESTCA1/Note A.md': [
      '---',
      'topic: [Shared concept]',
      'course: TESTCA1',
      '---',
      '',
      '# A',
      '',
    ].join('\n'),
    '01 Courses/TESTCB2/Note B.md': [
      '---',
      'topic: [Shared concept]',
      'course: TESTCB2',
      '---',
      '',
      '# B',
      '',
    ].join('\n'),
  });
}

describe('readCourseSetupRecognitions', () => {
  it('recognises a concept already carrying evidence from an earlier course', async () => {
    const vault = twoCourseVault();

    // Resolve the same stamped key the function's own internal
    // `extractConceptsFromVault` call will resolve back, the same technique
    // `today/data-source.spec.ts` uses throughout.
    const extracted = await extractConceptsFromVault(vault, {});
    const record = extracted.find((r) => r.name === 'Shared concept');
    if (record === undefined) throw new Error('expected the shared concept to be extracted');
    const conceptId = record.key;

    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-08-01T09:00:00-04:00',
        instrumentId: `qa:${conceptId}:1`,
        instrumentType: 'qa',
        conceptIds: [conceptId],
        rating: 'good',
        wasUnsure: false,
        durationMs: 4000,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      },
      { deviceId: DEVICE, generateEventId: () => 'evt-1' },
    );

    const recognitions = await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
    });

    expect(recognitions).toHaveLength(1);
    expect(recognitions[0]?.conceptId).toBe(conceptId);
    expect(recognitions[0]?.newCourse).toBe('TESTCB2');
    expect(recognitions[0]?.earlierCourses).toEqual(['TESTCA1']);
    expect(recognitions[0]?.evidence.reviewCount).toBe(1);
    // No vitality dependency is constructed by this seam — see the module's
    // own doc for why that is an honest omission, not a gap.
    expect(recognitions[0]?.vitality).toBeNull();
  });

  it('finds nothing to recognise when the concept has no evidence yet', async () => {
    const vault = twoCourseVault();

    const recognitions = await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
    });

    expect(recognitions).toEqual([]);
  });

  it('finds nothing to recognise when the concept sits in only the course being set up', async () => {
    const vault = memoryVault({
      '01 Courses/TESTCA1/Note A.md': [
        '---',
        'topic: [Only in A]',
        'course: TESTCA1',
        '---',
        '',
        '# A',
        '',
      ].join('\n'),
    });

    const recognitions = await readCourseSetupRecognitions('TESTCA1', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
    });

    expect(recognitions).toEqual([]);
  });

  it('fails closed to no recognition claims when the vault cannot be read, rather than throwing', async () => {
    const vault = unreadableVault();

    const recognitions = await readCourseSetupRecognitions('TESTCA1', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
    });

    expect(recognitions).toEqual([]);
  });
});
