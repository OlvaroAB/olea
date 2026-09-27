/**
 * `readCourseSetupRecognitions` (`ol-egov.141.89.9.49`, F8.7, `[D-058]`/
 * `[D-274]`) — the proposal-time seam that assembles the review log and the
 * concept-to-course join (F1.3) and folds them through `olea-core`'s
 * `buildEarlierCourseRecognitions`.
 *
 * Fixture shape: two notes under `01 Courses/<CODE>/` whose `topic:` links one
 * concept note she wrote give a single concept whose `courses` names both —
 * the note, not the shared wording, is what makes it one concept (`[D-402]`:
 * identical wording alone in two courses is two concepts until she confirms a
 * same-as link; the last case below). INV-3: every course code and concept
 * name below is invented for this suite.
 */

import { appendReviewLogRecord, type CalendarDay, calendarDayFromLocalDate } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import { readCourseSetupRecognitions } from '../../src/course-setup/recognition-source.js';
import { memoryVault, unreadableVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const TODAY: CalendarDay = calendarDayFromLocalDate(new Date('2026-09-25T12:00:00-04:00'));

function twoCourseVault(topic = '[[Shared concept]]') {
  return memoryVault({
    'Concepts/Shared concept.md': ['---', 'type: concept', '---', '', '# Shared concept', ''].join(
      '\n',
    ),
    '01 Courses/TESTCA1/Note A.md': [
      '---',
      `topic: ${topic}`,
      'course: TESTCA1',
      '---',
      '',
      '# A',
      '',
    ].join('\n'),
    '01 Courses/TESTCB2/Note B.md': [
      '---',
      `topic: ${topic}`,
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

  it('does not recognise identical wording alone across two courses ([D-402]): two concepts until she confirms a same-as link', async () => {
    // Bare wording, no concept note: one identity per course.
    const vault = twoCourseVault('[Shared concept]');
    const extracted = await extractConceptsFromVault(vault, {});
    const inA = extracted.find((r) => r.name === 'Shared concept' && r.courses.includes('TESTCA1'));
    if (inA === undefined) throw new Error('expected the TESTCA1 concept to be extracted');
    expect(inA.courses).toEqual(['TESTCA1']);

    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-08-01T09:00:00-04:00',
        instrumentId: `qa:${inA.key}:1`,
        instrumentType: 'qa',
        conceptIds: [inA.key],
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
