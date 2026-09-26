/**
 * F2.22's `rankedReason` closes `queue-adapter.ts`'s own named strip point
 * (`ol-3ux7.5.57.14.58`'s report; `[D-331]`/`[D-374]`) — the other half of
 * that lane's own follow-up. `queue-adapter.spec.ts` and `session.spec.ts`
 * already prove the two IN-PACKAGE hops (`adaptExecutedReviewQueue` ->
 * `rankedReason`, `ReviewSession`'s 'front' view model -> `rankedReason`)
 * against a hand-built adapter input; neither touches `open-session.ts`,
 * where `rankedReasonsById` is actually built from the composed session's
 * own `StudySessionItem[]` and handed to that adapter (`open-session.ts`'s
 * own module doc, "F2.22's `rankedReason` closes `queue-adapter.ts`'s named
 * strip point"). This file is that missing half: does `openReviewSession`
 * itself carry a composed item's real `rankedReason` all the way to the
 * screen she is actually asked to answer, and leave it genuinely absent
 * (never generated) when the composed item carries none?
 */

import {
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type OpenReviewSessionInput,
  openReviewSession,
  type ReviewSessionPorts,
} from '../../src/review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
} from '../../src/review/ports.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');

const CONCEPT_NOTE = ['---', 'title: Alpha', 'course: TEST101', '---', '', 'A concept.', ''].join(
  '\n',
);

/** One concept, one `qa` instrument — `rankedReason` only ever reaches the `'front'` phase, which `qa`/`cloze` reach and `mcq` never does. */
function qaVault() {
  return memoryVault({
    'Concepts/Alpha.md': CONCEPT_NOTE,
    'Courses/TEST101/Week one.md': [
      '---',
      'topic: [Alpha]',
      'course: TEST101',
      '---',
      '## A question?',
      '',
      'The front::The back ^blk1',
      '',
    ].join('\n'),
  });
}

function ports(vault: ReturnType<typeof memoryVault>): ReviewSessionPorts {
  return {
    reviewLog: createVaultReviewLogPort(vault, DEVICE),
    suspendPort: createVaultSuspendPort(vault, DEVICE),
    editPort: { async edit() {} },
    noteExists: createVaultNoteExistsPort(vault),
    clock: { now: () => NOW },
    draftAcceptPort: {
      accept() {
        throw new Error('unused in this suite');
      },
      reject() {
        throw new Error('unused in this suite');
      },
    },
  };
}

/**
 * Seeds a holder with one composed item over the enumerated `qa` instrument,
 * carrying `rankedReason` when `rankedReason` is supplied — a plain,
 * hand-built `StudySessionItem`, the same fixture shape `open-session.spec.ts`'s
 * own `composedSessionFixture` and `open-session-misconception.spec.ts`'s
 * `sessionInputFor` already use for this exact purpose.
 */
async function sessionInputFor(
  vault: ReturnType<typeof memoryVault>,
  rankedReason?: string,
): Promise<OpenReviewSessionInput> {
  const enumeration = await enumerateVaultInstruments(vault);
  const qa = enumeration.records.find((r) => r.instrumentType === 'qa');
  if (qa === undefined) throw new Error('expected the fixture to enumerate one qa instrument');

  const holder = createStudySessionHolder();
  holder.enter(NOW, {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: 60,
      items: [
        {
          position: 1,
          instrumentId: qa.instrumentId,
          instrumentType: qa.instrumentType,
          notePath: qa.notePath,
          noteTitle: qa.noteTitle,
          conceptName: 'Alpha',
          course: 'TEST101',
          gapClass: 'coverage-gap',
          gapRank: 1,
          gapScore: 1,
          estimatedSeconds: 60,
          durationSource: 'assumed',
          formatMatch: 'no-preference',
          ...(rankedReason !== undefined ? { rankedReason } : {}),
        },
      ],
      leftOut: [],
      leftOutInstrumentCount: 0,
      consideredRowCount: 1,
      formatPreference: 'unknown',
      nextAssessment: null,
      durationBasis: 'assumed',
      focusConcept: null,
    },
    overflow: [],
    courseShares: new Map(),
    forcedCourses: [],
    obligationClasses: new Map(),
    citationRecheckQueued: new Set(),
    citationRevalidationPending: new Set(),
  });
  return {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports(vault),
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: () => {
      throw new Error('sessionInputFor: holder is pre-seeded active; should not be reached');
    },
  };
}

describe('openReviewSession — F2.22 rankedReason reaches the front phase (ol-egov.141.89.10.45, ol-3ux7.5.57.14.58)', () => {
  it("a composed item's recorded rankedReason reaches the front view model", async () => {
    const vault = qaVault();
    const outcome = await openReviewSession(
      await sessionInputFor(vault, 'oracle.rank.v1: the decisive factor, one clause'),
    );
    if (!outcome.ok) throw new Error('expected a composed session');

    await outcome.session.start();
    const vm = outcome.session.getViewModel();
    if (vm.phase !== 'front') throw new Error(`expected the front phase, got ${vm.phase}`);

    expect(vm.rankedReason).toBe('oracle.rank.v1: the decisive factor, one clause');
  });

  it('a composed item with no recorded rankedReason carries none — never a generated one', async () => {
    const vault = qaVault();
    // No `rankedReason` argument: the composed item carries no such field,
    // exactly today's every real composition (oracle.rank.v1 has no
    // production caller yet — `study-session/build.ts`'s own doc).
    const outcome = await openReviewSession(await sessionInputFor(vault));
    if (!outcome.ok) throw new Error('expected a composed session');

    await outcome.session.start();
    const vm = outcome.session.getViewModel();
    if (vm.phase !== 'front') throw new Error(`expected the front phase, got ${vm.phase}`);

    // The key itself must be absent, not merely `undefined` — the same
    // discipline `ol-3ux7.5.57.14.58`'s own `queue-adapter.spec.ts`/
    // `session.spec.ts` tests already hold `rankedReason` and `dedupeReason`
    // to.
    expect(Object.hasOwn(vm, 'rankedReason')).toBe(false);
  });
});
