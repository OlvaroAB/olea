/**
 * `[D-395]` (`ol-egov.141.89.10.65`): `openReviewSession` is the door that records a composed
 * session as it becomes actual — opening review onto an idle session, Start on Home (which enters
 * the shared holder in `main.ts` and reveals this tab), and a keep going that changed the list.
 * The session is hand-built, the fixture shape `open-session-ranked-reason.spec.ts` uses, with the
 * composition account and provenance the composer and its door set. Course codes and concept names
 * are invented (INV-3).
 */

import {
  type ComposedStudySession,
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
  type VaultInstrumentRecord,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_LOG_FOLDER,
  readCompositionLog,
} from '../../../core/src/study-session/composition-log.js';
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
import { createCompositionRecorder } from '../../src/session/composition-recorder.js';
import { createStudySessionHolder, type StudySessionHolder } from '../../src/session/holder.js';
import { type MemoryVault, memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');
const ENTERED = new Date('2026-08-10T13:59:00-04:00');

function qaVault(): MemoryVault {
  const note = (front: string) =>
    ['---', 'topic: [Alpha]', 'course: TEST101', '---', `${front}::The back`, ''].join('\n');
  return memoryVault({
    'Concepts/Alpha.md': [
      '---',
      'title: Alpha',
      'course: TEST101',
      '---',
      '',
      'A concept.',
      '',
    ].join('\n'),
    'Courses/TEST101/Week one.md': note('Front one'),
    'Courses/TEST101/Week two.md': note('Front two'),
  });
}

function ports(vault: MemoryVault): ReviewSessionPorts {
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

function item(record: VaultInstrumentRecord, position: number) {
  return {
    position,
    instrumentId: record.instrumentId,
    instrumentType: record.instrumentType,
    notePath: record.notePath,
    noteTitle: record.noteTitle,
    conceptName: 'Alpha',
    conceptKey: 'key-alpha',
    course: 'TEST101',
    gapClass: 'coverage-gap' as const,
    gapRank: 1,
    gapScore: 1,
    estimatedSeconds: 60,
    durationSource: 'assumed' as const,
    formatMatch: 'no-preference' as const,
  };
}

/** A composed session over `records`, with the account and (optionally) the provenance the composer's door sets. */
function session(
  records: readonly VaultInstrumentRecord[],
  options: { readonly provenance?: boolean; readonly budgetMinutes?: number } = {},
): ComposedStudySession {
  return {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: options.budgetMinutes ?? 20,
      budgetSeconds: (options.budgetMinutes ?? 20) * 60,
      plannedSeconds: 60 * records.length,
      items: records.map((record, index) => item(record, index + 1)),
      leftOut: [],
      leftOutInstrumentCount: 0,
      consideredRowCount: 1,
      formatPreference: 'unknown',
      nextAssessment: null,
      durationBasis: 'assumed',
      focusConcept: null,
    },
    overflow: [],
    courseShares: new Map([['TEST101', 1]]),
    forcedCourses: [],
    obligationClasses: new Map(),
    citationRecheckQueued: new Set(),
    citationRevalidationPending: new Set(),
    focusPolicy: 'single',
    dominantCourse: 'TEST101',
    focusBranch: 'deficit',
    groupingSignal: 'none',
    setAside: { courses: [], concepts: [], instruments: [] },
    ...(options.provenance === false
      ? {}
      : { provenance: { planVersion: 'plan-v-opaque', reentry: false } }),
  };
}

async function qaRecords(vault: MemoryVault): Promise<readonly VaultInstrumentRecord[]> {
  const records = (await enumerateVaultInstruments(vault)).records.filter(
    (record) => record.instrumentType === 'qa',
  );
  if (records.length !== 2) throw new Error('expected the fixture to enumerate two qa instruments');
  return records;
}

function input(
  vault: MemoryVault,
  holder: StudySessionHolder,
  extra: Partial<OpenReviewSessionInput> = {},
): OpenReviewSessionInput {
  let n = 0;
  return {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports(vault),
    probeDays: 30,
    studySessionHolder: holder,
    compositionRecorder: createCompositionRecorder({
      vault,
      deviceId: DEVICE,
      mintCompositionId: () => `composition-key1:open-${++n}`,
    }),
    composeDefaultStudySession: () => {
      throw new Error('not expected to compose in this case');
    },
    ...extra,
  };
}

const compositionWrites = (vault: MemoryVault) =>
  vault.writes.filter((path) => path.startsWith(`${COMPOSITION_LOG_FOLDER}/`));
const reviewWrites = (vault: MemoryVault) =>
  vault.writes.filter((path) => path.startsWith('.olea/reviews/'));

describe('[D-395] openReviewSession records the session as it becomes actual', () => {
  it('opening review onto an idle session writes its record before any answer, and the held session carries it', async () => {
    const vault = qaVault();
    const [first] = await qaRecords(vault);
    if (first === undefined) throw new Error('unreachable');
    const holder = createStudySessionHolder();
    const outcome = await openReviewSession(
      input(vault, holder, { composeDefaultStudySession: async () => session([first]) }),
    );
    if (!outcome.ok) throw new Error('expected a composed session');

    const { records } = await readCompositionLog(vault);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'compose', sessionId: 'composition-key1:open-1' });
    expect(reviewWrites(vault)).toEqual([]);
    const sitting = holder.getSitting();
    if (sitting.status !== 'active') throw new Error('expected an active sitting');
    expect(sitting.items.compositionRecord).toEqual(records[0]);
  });

  it('Start on Home (the holder entered without a record) is recorded as the tab opens, once, keeping the sitting', async () => {
    const vault = qaVault();
    const [first] = await qaRecords(vault);
    if (first === undefined) throw new Error('unreachable');
    const holder = createStudySessionHolder();
    holder.enter(ENTERED, session([first]));

    const recorder = input(vault, holder);
    const opened = await openReviewSession(recorder);
    if (!opened.ok) throw new Error('expected a composed session');
    const sitting = holder.getSitting();
    if (sitting.status !== 'active') throw new Error('expected an active sitting');
    expect(sitting.enteredAt).toEqual(ENTERED);
    expect(sitting.items.compositionRecord?.kind).toBe('compose');
    expect(compositionWrites(vault)).toHaveLength(1);

    const reopened = await openReviewSession(recorder);
    if (!reopened.ok) throw new Error('expected a composed session');
    expect(compositionWrites(vault)).toHaveLength(1);
    expect((await readCompositionLog(vault)).records).toHaveLength(1);
  });

  it('a session not composed through the composition door is served unrecorded, and nothing is written', async () => {
    const vault = qaVault();
    const [first] = await qaRecords(vault);
    if (first === undefined) throw new Error('unreachable');
    const holder = createStudySessionHolder();
    holder.enter(ENTERED, session([first], { provenance: false }));
    const outcome = await openReviewSession(input(vault, holder));
    expect(outcome.ok).toBe(true);
    expect(compositionWrites(vault)).toEqual([]);
  });

  it('a keep going that changed the list appends an extension record under the same session; one that changed nothing appends nothing', async () => {
    const vault = qaVault();
    const [first, second] = await qaRecords(vault);
    if (first === undefined || second === undefined) throw new Error('unreachable');
    const holder = createStudySessionHolder();
    const opening = input(vault, holder, {
      composeDefaultStudySession: async () => session([first]),
    });
    const opened = await openReviewSession(opening);
    if (!opened.ok) throw new Error('expected a composed session');
    const heldAfterOpen = holder.getSitting();
    if (heldAfterOpen.status !== 'active') throw new Error('expected an active sitting');
    const parent = heldAfterOpen.items.compositionRecord;
    if (parent === undefined) throw new Error('expected the opening record');

    // Unchanged: the "extension" serves the identical list.
    await openReviewSession({
      ...opening,
      frozenQueueMode: 'extend',
      extendDefaultStudySession: async (previous) => ({
        ...previous,
        setAside: { courses: [], concepts: [], instruments: [] },
      }),
    });
    expect(compositionWrites(vault)).toHaveLength(1);

    // Changed: one more instrument, its account recomputed (a fresh set-aside object).
    await openReviewSession({
      ...opening,
      frozenQueueMode: 'extend',
      extendDefaultStudySession: async (previous) => ({
        ...session([first, second], { budgetMinutes: 40 }),
        ...(previous.compositionRecord !== undefined
          ? { compositionRecord: previous.compositionRecord }
          : {}),
      }),
    });
    const { records } = await readCompositionLog(vault);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(parent);
    expect(records[1]).toMatchObject({
      kind: 'extend',
      sessionId: parent.sessionId,
      parentCompositionId: parent.compositionId,
    });
    const held = holder.getSitting();
    if (held.status !== 'active') throw new Error('expected an active sitting');
    expect(held.items.compositionRecord).toEqual(records[1]);
    expect(reviewWrites(vault)).toEqual([]);
  });
});
