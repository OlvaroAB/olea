/**
 * `ol-egov.141.89.10.93` (David's ruling 2026-09-28 on `ol-egov.141.89.10.65`): through the review
 * tab's real door (`review/open-session.ts`'s `openReviewSession`), a composition record whose
 * write failed is retried at the next opening under the identity it was first built with, the
 * reviews served meanwhile carry that identity, and the explanation both screens read never
 * depends on the write. The session is hand-built, the fixture shape
 * `test/review/open-session-composition-record.spec.ts` uses (restated, not imported: a spec is
 * not a module). Course codes and concept names are invented (INV-3).
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
import {
  compositionIdentityOf,
  createCompositionRecorder,
  explainActiveSession,
  MAX_COMPOSITION_WRITE_ATTEMPTS,
  recordedSessionReason,
} from '../../src/session/composition-recorder.js';
import {
  readUnresolvedCompositionWrites,
  reconcileUnresolvedCompositionWrites,
  resolveCompositionReference,
} from '../../src/session/composition-write-reconciliation.js';
import { createStudySessionHolder, type StudySessionHolder } from '../../src/session/holder.js';
import { groupingWhySentence } from '../../src/session-builder/copy.js';
import { type MemoryVault, memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');
const ENTERED = new Date('2026-08-10T13:59:00-04:00');
/** The composer's sentence body for this hand-built composition; the read passes it through. */
const REASON = 'because it is behind its share from your recent sessions';

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
  });
}

/**
 * Daily composition-log writes refused while `refuse()` is true; every other write goes through,
 * the unresolved-writes journal beside the daily files included (`ol-egov.141.89.10.97`).
 */
function refusingVault(inner: MemoryVault, refuse: () => boolean): MemoryVault {
  return {
    ...inner,
    read: (path) => inner.read(path),
    exists: (path) => inner.exists(path),
    async write(path, content) {
      if (
        path.startsWith(`${COMPOSITION_LOG_FOLDER}/`) &&
        /\/\d{4}-\d{2}-\d{2}\.[^/]+\.jsonl$/.test(path) &&
        refuse()
      ) {
        throw new Error('write refused');
      }
      await inner.write(path, content);
    },
  };
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

function session(record: VaultInstrumentRecord): ComposedStudySession {
  return {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: 60,
      items: [
        {
          position: 1,
          instrumentId: record.instrumentId,
          instrumentType: record.instrumentType,
          notePath: record.notePath,
          noteTitle: record.noteTitle,
          conceptName: 'Alpha',
          conceptKey: 'key-alpha',
          course: 'TEST101',
          gapClass: 'coverage-gap',
          gapRank: 1,
          gapScore: 1,
          estimatedSeconds: 60,
          durationSource: 'assumed',
          formatMatch: 'no-preference',
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
    courseShares: new Map([['TEST101', 1]]),
    forcedCourses: [],
    obligationClasses: new Map(),
    citationRecheckQueued: new Set(),
    citationRevalidationPending: new Set(),
    focusPolicy: 'single',
    dominantCourse: 'TEST101',
    focusBranch: 'deficit',
    focusReason: REASON,
    groupingSignal: 'relatedness',
    setAside: { courses: [], concepts: [], instruments: [] },
    provenance: { planVersion: 'plan-v-opaque', reentry: false },
  };
}

async function onlyQa(vault: MemoryVault): Promise<VaultInstrumentRecord> {
  const records = (await enumerateVaultInstruments(vault)).records.filter(
    (record) => record.instrumentType === 'qa',
  );
  const [first] = records;
  if (records.length !== 1 || first === undefined) throw new Error('expected one qa instrument');
  return first;
}

let opens = 0;

function input(vault: MemoryVault, holder: StudySessionHolder): OpenReviewSessionInput {
  // Each open mints under its own prefix, so a retry that minted afresh could never pass for one
  // that kept the first identity.
  const open = ++opens;
  let n = 0;
  return {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports(vault),
    probeDays: 30,
    studySessionHolder: holder,
    // A fresh recorder per open, as production builds one per call: the retry must not depend
    // on recorder instance state.
    compositionRecorder: createCompositionRecorder({
      vault,
      deviceId: DEVICE,
      mintCompositionId: () => `composition-key1:open${open}-${++n}`,
    }),
    composeDefaultStudySession: () => {
      throw new Error('not expected to compose in this case');
    },
  };
}

function held(holder: StudySessionHolder): ComposedStudySession {
  const sitting = holder.getSitting();
  if (sitting.status !== 'active') throw new Error('expected an active sitting');
  return sitting.items;
}

describe('openReviewSession retries a failed composition record under the same identity (ol-egov.141.89.10.93)', () => {
  it('a failed write is retried at the next opening with the same id, and the reviews served meanwhile carry that id', async () => {
    const inner = qaVault();
    const record = await onlyQa(inner);
    let refuse = true;
    const vault = refusingVault(inner, () => refuse);
    const holder = createStudySessionHolder();
    holder.enter(ENTERED, session(record));

    const first = await openReviewSession(input(vault, holder));
    if (!first.ok) throw new Error('expected a composed session');
    expect((await readCompositionLog(inner)).records).toEqual([]);
    const pendingId = compositionIdentityOf(held(holder));
    expect(pendingId).toMatch(/^composition-key1:open\d+-1$/);
    // Served, stamped with the identity the record will be written under.
    expect(first.scheduledQueue.map((item) => item.compositionId)).toEqual([pendingId]);
    // The explanation both screens read does not wait on the write.
    expect(recordedSessionReason(holder.getSitting())).toBe(REASON);
    expect(explainActiveSession(holder.getSitting())).toEqual({
      status: 'available',
      courseReason: REASON,
      groupingSentence: groupingWhySentence('relatedness'),
    });

    refuse = false;
    const second = await openReviewSession(input(vault, holder));
    if (!second.ok) throw new Error('expected a composed session');
    const { records } = await readCompositionLog(inner);
    expect(records).toHaveLength(1);
    expect(records[0]?.compositionId).toBe(pendingId);
    expect(held(holder).compositionRecord).toEqual(records[0]);
    expect(holder.getSitting().status === 'active' && holder.getSitting()).toMatchObject({
      enteredAt: ENTERED,
    });
    expect(second.scheduledQueue.map((item) => item.compositionId)).toEqual([pendingId]);

    // Recorded, nothing queued: a third opening writes nothing more.
    await openReviewSession(input(vault, holder));
    expect((await readCompositionLog(inner)).records).toHaveLength(1);
  });
});

describe('a spent retry bound leaves an explicit unresolved write, and the next start reconciles it (ol-egov.141.89.10.97)', () => {
  it('every opening serves the same reference; the id names the unresolved write until a restart lands the record under it', async () => {
    const inner = qaVault();
    const record = await onlyQa(inner);
    const vault = refusingVault(inner, () => true);
    const holder = createStudySessionHolder();
    holder.enter(ENTERED, session(record));

    let pendingId: string | undefined;
    for (let opening = 0; opening < MAX_COMPOSITION_WRITE_ATTEMPTS + 1; opening += 1) {
      const opened = await openReviewSession(input(vault, holder));
      if (!opened.ok) throw new Error('expected a composed session');
      pendingId ??= compositionIdentityOf(held(holder));
      // Never a fresh identity, never none: the reviews keep the one reference they started with.
      expect(compositionIdentityOf(held(holder))).toBe(pendingId);
      expect(opened.scheduledQueue.map((item) => item.compositionId)).toEqual([pendingId]);
    }
    expect((await readCompositionLog(inner)).records).toEqual([]);
    const [unresolved] = (await readUnresolvedCompositionWrites(inner, DEVICE)).open;
    expect(unresolved).toMatchObject({ compositionId: pendingId, state: 'exhausted' });
    expect(await resolveCompositionReference(inner, DEVICE, pendingId ?? '')).toMatchObject({
      status: 'unresolved',
    });
    // Still served and explained from memory while unresolved.
    expect(recordedSessionReason(holder.getSitting())).toBe(REASON);

    // The plugin restarts: a fresh holder (idle), and the vault accepts the daily file again. The
    // one startup call reconciles.
    const restarted = await reconcileUnresolvedCompositionWrites({
      vault: inner,
      deviceId: DEVICE,
    });
    expect(restarted).toMatchObject({ examined: 1, written: 1, stillUnresolved: 0 });
    const { records } = await readCompositionLog(inner);
    expect(records.map((entry) => entry.compositionId)).toEqual([pendingId]);
    expect(await resolveCompositionReference(inner, DEVICE, pendingId ?? '')).toMatchObject({
      status: 'recorded',
    });
  });
});
