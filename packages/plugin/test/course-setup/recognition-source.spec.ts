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

import {
  addManualAssessmentEntry,
  appendReviewLogRecord,
  appendVerdictRecord,
  type CalendarDay,
  calendarDayFromLocalDate,
} from 'olea-core';
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
    // `ol-egov.141.89.9.62`: this seam now constructs the vitality reading
    // itself (module doc, "Vitality is computed here") — a real review
    // exists, so the claim carries a real reading, never the `null` "not
    // read" placeholder this used to show unconditionally.
    expect(recognitions[0]?.vitality).not.toBeNull();
    expect(recognitions[0]?.vitality?.value).toMatch(/^(holding|tending|early)$/);
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

/**
 * `ol-egov.141.89.9.62` (discovered from `ol-egov.141.89.9.60`): this seam
 * now constructs the vitality reading itself (module doc, "Vitality is
 * computed here"). Metamorphic, matching `readAllConceptVitality`'s own spec
 * style (`packages/core/src/mastery/rollup.spec.ts`): the SAME single review
 * is read once with its instrument standing, once after a `rejected`
 * verdict proves it invalid — the reading must move, never the evidence
 * count `evidence.reviewCount` (a raw log tally, unaffected by standing).
 */
describe('readCourseSetupRecognitions: vitality (ol-egov.141.89.9.62)', () => {
  it('a rejected instrument no longer counts toward the claim it is the only evidence for', async () => {
    const vault = twoCourseVault();
    const extracted = await extractConceptsFromVault(vault, {});
    const record = extracted.find((r) => r.name === 'Shared concept');
    if (record === undefined) throw new Error('expected the shared concept to be extracted');
    const conceptId = record.key;
    const instrumentId = `qa:${conceptId}:1`;

    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-08-01T09:00:00-04:00',
        instrumentId,
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

    const [before] = await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
    });
    expect(before?.evidence.reviewCount).toBe(1);
    expect(before?.vitality?.instrumentsRead).toBe(1);
    expect(before?.vitality?.value).not.toBe('early');

    await appendVerdictRecord(
      vault,
      {
        instrumentId,
        instrumentType: 'qa',
        conceptIds: [conceptId],
        timestamp: '2026-08-02T09:00:00-04:00',
        verdict: 'rejected',
        artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
      },
      { deviceId: DEVICE, generateEventId: () => 'verdict-1' },
    );

    const [after] = await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
    });
    // The rejected instrument's evidence still exists in the log (the raw
    // tally is unaffected — `evidence.reviewCount` reads the log directly,
    // never a validity fold), but no longer counts toward vitality: the
    // ONLY instrument is now proven invalid, so the reading falls to the
    // sufficiency floor.
    expect(after?.evidence.reviewCount).toBe(1);
    expect(after?.vitality).toStrictEqual({ value: 'early', weakest: null, instrumentsRead: 0 });
  });
});

/**
 * `[D-387]` / `[D-411]` (`ol-v7r5.66`): the proposal-time seam takes each
 * earlier course's cutoff the first time and records it in Olea's own layer;
 * the dated line is read from that record alone. Assessments here are manual
 * entries (blank Base path), invented for this suite.
 */
describe('readCourseSetupRecognitions: the cutoff record ([D-387], [D-411])', () => {
  const CUTOFF_FOLDER = '.olea/course-cutoffs/';

  async function vaultWithEvidence() {
    const vault = twoCourseVault();
    const extracted = await extractConceptsFromVault(vault, {});
    const record = extracted.find((r) => r.name === 'Shared concept');
    if (record === undefined) throw new Error('expected the shared concept to be extracted');
    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-05-01T09:00:00-04:00',
        instrumentId: `qa:${record.key}:1`,
        instrumentType: 'qa',
        conceptIds: [record.key],
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
    return vault;
  }

  function cutoffFiles(vault: { readonly writes: readonly string[] }) {
    return [...new Set(vault.writes.filter((path) => path.startsWith(CUTOFF_FOLDER)))];
  }

  it('a course with a passed assessment and no leaving gesture gets a provisional dated line, recorded once', async () => {
    const vault = await vaultWithEvidence();
    await addManualAssessmentEntry(
      vault,
      { course: 'TESTCA1', type: 'exam', due: '2026-06-12' },
      { generateId: () => 'a1', now: () => '2026-04-01' },
    );

    const [rec] = await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
      assignmentsBasePath: '',
    });

    expect(rec?.state).toBe('sprout');
    expect(rec?.historical).toHaveLength(1);
    expect(rec?.historical[0]).toMatchObject({
      course: 'TESTCA1',
      cutoffDay: '2026-06-12',
      source: 'provisional-last-passed-assessment',
      provisional: true,
      state: 'sprout',
    });
    const files = cutoffFiles(vault);
    expect(files).toEqual([`${CUTOFF_FOLDER}${TODAY}.${DEVICE}.jsonl`]);
    const written = vault.contentOf(files[0] ?? '') ?? '';
    expect(written.trim().split('\n')).toHaveLength(1);
    // No leaving reason, completion or archive can be recorded: the record has no such field.
    expect(written).not.toMatch(/reason|finish|complet|archiv/i);
  });

  it('an edit to the assessment date after the cutoff was first taken does not move the dated line', async () => {
    const vault = await vaultWithEvidence();
    const { path } = await addManualAssessmentEntry(
      vault,
      { course: 'TESTCA1', type: 'exam', due: '2026-06-12' },
      { generateId: () => 'a1', now: () => '2026-04-01' },
    );
    await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
      assignmentsBasePath: '',
    });
    const firstFiles = cutoffFiles(vault);
    const firstContent = vault.contentOf(firstFiles[0] ?? '');

    // She moves the assessment's date, and the course comes up again days later.
    const moved = JSON.parse(vault.contentOf(path) ?? '{}');
    await vault.write(path, `${JSON.stringify({ ...moved, due: '2026-08-20' }, null, 2)}\n`);
    const later: CalendarDay = '2026-10-05';
    const [rec] = await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: later,
      assignmentsBasePath: '',
    });

    expect(rec?.historical[0]?.cutoffDay).toBe('2026-06-12');
    expect(cutoffFiles(vault)).toEqual(firstFiles);
    expect(vault.contentOf(firstFiles[0] ?? '')).toBe(firstContent);
  });

  it('with neither a leaving gesture nor a passed assessment, no dated line and nothing written', async () => {
    const vault = await vaultWithEvidence();
    await addManualAssessmentEntry(
      vault,
      { course: 'TESTCA1', type: 'exam', due: '2026-12-01' },
      { generateId: () => 'a1', now: () => '2026-04-01' },
    );

    const [rec] = await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
      assignmentsBasePath: '',
    });

    expect(rec?.state).toBe('sprout');
    expect(rec?.historical).toEqual([]);
    expect(cutoffFiles(vault)).toEqual([]);
  });

  it('records no cutoff when the caller names no assignments Base, or the configured Base could not be read', async () => {
    for (const assignmentsBasePath of [undefined, 'Missing/Assignments.base']) {
      const vault = await vaultWithEvidence();
      await addManualAssessmentEntry(
        vault,
        { course: 'TESTCA1', type: 'exam', due: '2026-06-12' },
        { generateId: () => 'a1', now: () => '2026-04-01' },
      );

      const [rec] = await readCourseSetupRecognitions('TESTCB2', {
        vault,
        deviceId: DEVICE,
        today: TODAY,
        ...(assignmentsBasePath !== undefined ? { assignmentsBasePath } : {}),
      });

      expect(rec?.state).toBe('sprout');
      expect(rec?.historical).toEqual([]);
      expect(cutoffFiles(vault)).toEqual([]);
    }
  });

  it('the cutoff bounds the dated line alone — vitality stays a current reading, unbounded by it (ol-egov.141.89.9.62)', async () => {
    const vault = await vaultWithEvidence();
    const extracted = await extractConceptsFromVault(vault, {});
    const record = extracted.find((r) => r.name === 'Shared concept');
    if (record === undefined) throw new Error('expected the shared concept to be extracted');
    await addManualAssessmentEntry(
      vault,
      { course: 'TESTCA1', type: 'exam', due: '2026-06-12' },
      { generateId: () => 'a1', now: () => '2026-04-01' },
    );

    // First call takes and records the cutoff (module doc, "The cutoff is
    // taken and recorded here").
    const [firstRec] = await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
      assignmentsBasePath: '',
    });
    expect(firstRec?.historical[0]).toMatchObject({ cutoffDay: '2026-06-12', state: 'sprout' });
    expect(firstRec?.vitality?.instrumentsRead).toBe(1);
    const filesAfterFirstCall = cutoffFiles(vault);

    // A second review lands on a NEW instrument, well after the recorded
    // cutoff day — evidence the dated line (bounded to the cutoff) must
    // never see, but vitality (the current reading) must.
    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-08-01T09:00:00-04:00',
        instrumentId: `qa:${record.key}:2`,
        instrumentType: 'qa',
        conceptIds: [record.key],
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
      { deviceId: DEVICE, generateEventId: () => 'evt-2' },
    );

    const [rec] = await readCourseSetupRecognitions('TESTCB2', {
      vault,
      deviceId: DEVICE,
      today: TODAY,
      assignmentsBasePath: '',
    });

    // The dated line is exactly as it stood at the cutoff — the second
    // review changes nothing there.
    expect(rec?.historical[0]).toMatchObject({ cutoffDay: '2026-06-12', state: 'sprout' });
    // No re-take on a course already recorded (module doc, "A course that
    // already has a record is never written again").
    expect(cutoffFiles(vault)).toEqual(filesAfterFirstCall);
    // Vitality, the current reading, sees BOTH instruments — the cutoff
    // bounds the dated line alone, never this one (module doc).
    expect(rec?.vitality?.instrumentsRead).toBe(2);
  });
});
