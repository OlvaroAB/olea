/**
 * `ol-egov.141.89.3.20` (`[D-402]`): `readCourseSetupRecognitions` follows a same-as link she
 * CONFIRMED between two courses' identities for one wording, and does nothing on a proposal.
 *
 * Fixture: two course notes whose `topic:` names the same bare wording, so extraction mints one
 * identity per course and the mint-collision seam proposes one same-as link between them — the
 * production path, end to end over a memory vault. INV-3: every course code and concept name
 * below is invented for this suite.
 */

import {
  appendReviewLogRecord,
  type CalendarDay,
  calendarDayFromLocalDate,
  confirmSameAsLink,
  declineSameAsLink,
  listConceptKeyRecords,
  listSameAsLinkRecords,
  proposeSameAsFromMintCollisions,
  severSameAsLink,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import { readCourseSetupRecognitions } from '../../src/course-setup/recognition-source.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const TODAY: CalendarDay = calendarDayFromLocalDate(new Date('2026-09-25T12:00:00-04:00'));

function note(course: string, title: string): string {
  return ['---', 'topic: [Shared concept]', `course: ${course}`, '---', '', `# ${title}`, ''].join(
    '\n',
  );
}

/** Two course identities for one wording, evidence on the earlier one, and the proposed link. */
async function recurringConceptVault(): Promise<{
  vault: VaultSource;
  keyA: string;
  keyB: string;
}> {
  const vault = memoryVault({
    '01 Courses/TESTCA1/Note A.md': note('TESTCA1', 'A'),
    '01 Courses/TESTCB2/Note B.md': note('TESTCB2', 'B'),
  });
  const extracted = await extractConceptsFromVault(vault, {});
  const inA = extracted.find((r) => r.courses.includes('TESTCA1'));
  const inB = extracted.find((r) => r.courses.includes('TESTCB2'));
  if (inA === undefined || inB === undefined) throw new Error('expected one identity per course');
  expect(inA.key).not.toBe(inB.key);

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

  // The ingestion tick's own step: the mint collision becomes one proposed link.
  await proposeSameAsFromMintCollisions(vault, await listConceptKeyRecords(vault));
  const links = await listSameAsLinkRecords(vault);
  expect(links.map(({ record }) => record.status)).toEqual(['proposed']);
  return { vault, keyA: inA.key, keyB: inB.key };
}

function recognise(vault: VaultSource) {
  return readCourseSetupRecognitions('TESTCB2', { vault, deviceId: DEVICE, today: TODAY });
}

describe('readCourseSetupRecognitions follows confirmed same-as links ([D-402])', () => {
  it('does nothing while the link is only proposed', async () => {
    const { vault } = await recurringConceptVault();
    expect(await recognise(vault)).toEqual([]);
  });

  it('recognises the recurring concept once she confirms the link', async () => {
    const { vault, keyA, keyB } = await recurringConceptVault();
    await confirmSameAsLink(vault, keyA, keyB);

    const recognitions = await recognise(vault);

    expect(recognitions).toHaveLength(1);
    expect(recognitions[0]?.conceptId).toBe(keyA < keyB ? keyA : keyB);
    expect(recognitions[0]?.newCourse).toBe('TESTCB2');
    expect(recognitions[0]?.earlierCourses).toEqual(['TESTCA1']);
    expect(recognitions[0]?.evidence.reviewCount).toBe(1);
  });

  it('stops again when she declines, or severs a confirmed link', async () => {
    const declined = await recurringConceptVault();
    await declineSameAsLink(declined.vault, declined.keyA, declined.keyB);
    expect(await recognise(declined.vault)).toEqual([]);

    const severed = await recurringConceptVault();
    await confirmSameAsLink(severed.vault, severed.keyA, severed.keyB);
    await severSameAsLink(severed.vault, severed.keyA, severed.keyB);
    expect(await recognise(severed.vault)).toEqual([]);
  });
});
