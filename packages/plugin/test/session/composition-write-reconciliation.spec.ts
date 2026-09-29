/**
 * `ol-egov.141.89.10.97` (David's ruling, row 52 of the 2026-09-29 decision sheet): a composition
 * record whose write cannot land leaves an explicit unresolved write, never a review id that
 * resolves to nothing; a restart finds the unresolved writes and reconciles them idempotently; and
 * the reviews served meanwhile keep the one reference they were stamped with. The session is
 * hand-built, the fixture shape `open-session-record-retry.spec.ts` uses. Course codes and concept
 * names are invented (INV-3).
 */

import { type ComposedStudySession, calendarDayFromLocalDate } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_LOG_FOLDER,
  compositionLogPath,
  readCompositionLog,
  resolveCompositionRecord,
} from '../../../core/src/study-session/composition-log.js';
import {
  type CompositionRecord,
  parseCompositionLog,
  serializeCompositionRecord,
} from '../../../core/src/study-session/composition-record.js';
import { createVaultReviewLogPort, isoWithLocalOffset } from '../../src/review/ports.js';
import type { ReviewInstrument } from '../../src/review/types.js';
import {
  compositionIdentityOf,
  createCompositionRecorder,
  MAX_COMPOSITION_WRITE_ATTEMPTS,
  unresolvedCompositionWritesOf,
} from '../../src/session/composition-recorder.js';
import {
  readUnresolvedCompositionWrites,
  reconcileUnresolvedCompositionWrites,
  resolveCompositionReference,
  unresolvedCompositionWritesPath,
} from '../../src/session/composition-write-reconciliation.js';
import { type MemoryVault, memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');
const LATER = new Date('2026-08-10T15:00:00-04:00');
const DAILY_PATH = compositionLogPath(isoWithLocalOffset(NOW).slice(0, 10), DEVICE);
const JOURNAL_PATH = unresolvedCompositionWritesPath(DEVICE);

const DAILY_FILE_RE = /\/\d{4}-\d{2}-\d{2}\.[^/]+\.jsonl$/;

function item(position: number, instrumentId: string) {
  return {
    position,
    instrumentId,
    instrumentType: 'qa' as const,
    notePath: `Courses/TEST101/Week ${position}.md`,
    noteTitle: `Week ${position}`,
    conceptName: 'Alpha',
    conceptKey: 'key-alpha',
    course: 'TEST101',
    gapClass: 'coverage-gap' as const,
    gapRank: position,
    gapScore: 1,
    estimatedSeconds: 60,
    durationSource: 'assumed' as const,
    formatMatch: 'no-preference' as const,
  };
}

function sessionOf(instrumentIds: readonly string[]): ComposedStudySession {
  return {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: 60 * instrumentIds.length,
      items: instrumentIds.map((id, index) => item(index + 1, id)),
      leftOut: [],
      leftOutInstrumentCount: 0,
      consideredRowCount: instrumentIds.length,
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
    focusReason: 'because it is behind its share from your recent sessions',
    groupingSignal: 'relatedness',
    setAside: { courses: [], concepts: [], instruments: [] },
    provenance: { planVersion: 'plan-v-opaque', reentry: false },
  };
}

/** The session grown by a keep going: one more served item, and a new set-aside account object. */
function grownFrom(previous: ComposedStudySession): ComposedStudySession {
  const items = [...previous.model.items, item(previous.model.items.length + 1, 'inst-extra')];
  return {
    ...previous,
    model: { ...previous.model, items, plannedSeconds: 60 * items.length },
    setAside: { courses: [], concepts: [], instruments: [] },
  };
}

type Step = 'fail' | 'land-then-fail' | 'ok';

interface ScriptedVault extends MemoryVault {
  readonly dailyWriteCalls: () => number;
  /** Refuse every write from here on, journal included: the whole layer is unwritable. */
  readonly refuseEverything: (refuse: boolean) => void;
  /** Replace what the daily file's next writes do. */
  readonly script: (plan: readonly Step[]) => void;
}

/**
 * A vault over `inner` whose DAILY composition-log writes follow a script, one entry per write
 * call (writes past the end succeed); the unresolved-writes journal and everything else pass
 * through, so a test models "the daily file refuses" without also refusing its own bookkeeping.
 */
function scriptedVault(inner: MemoryVault, initial: readonly Step[]): ScriptedVault {
  let plan = initial;
  let calls = 0;
  let refuseAll = false;
  return {
    ...inner,
    read: (path) => inner.read(path),
    exists: (path) => inner.exists(path),
    async write(path, content) {
      if (refuseAll) throw new Error('write refused');
      if (!path.startsWith(`${COMPOSITION_LOG_FOLDER}/`) || !DAILY_FILE_RE.test(path)) {
        return inner.write(path, content);
      }
      const step = plan[calls] ?? 'ok';
      calls += 1;
      if (step === 'fail') throw new Error('write refused');
      await inner.write(path, content);
      if (step === 'land-then-fail') throw new Error('write reported failure after landing');
    },
    dailyWriteCalls: () => calls,
    refuseEverything: (refuse) => {
      refuseAll = refuse;
    },
    script: (next) => {
      plan = next;
      calls = 0;
    },
  };
}

function recorderFor(vault: MemoryVault, prefix: string) {
  let minted = 0;
  const writer = createCompositionRecorder({
    vault,
    deviceId: DEVICE,
    mintCompositionId: () => `composition-key1:${prefix}-${++minted}`,
  });
  return { writer, minted: () => minted };
}

/** Runs `occasions` recordStart occasions over `session`, returning the session last handed back. */
async function occasions(
  writer: ReturnType<typeof recorderFor>['writer'],
  session: ComposedStudySession,
  count: number,
): Promise<ComposedStudySession> {
  let held = session;
  for (let occasion = 0; occasion < count; occasion += 1) {
    held = (await writer.recordStart(held, NOW)).session;
  }
  return held;
}

function journalLines(vault: MemoryVault): readonly string[] {
  return (vault.contentOf(JOURNAL_PATH) ?? '').split('\n').filter((line) => line !== '');
}

describe('exhausted retries leave an explicit unresolved write, never a dangling id (ol-egov.141.89.10.97)', () => {
  it(`the first failure is journaled as retrying and the ${MAX_COMPOSITION_WRITE_ATTEMPTS}rd as exhausted; the id names that unresolved write`, async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail', 'fail', 'fail', 'fail', 'fail']);
    const { writer, minted } = recorderFor(vault, 'exhaust');
    let held = sessionOf(['inst-a']);

    held = await occasions(writer, held, 1);
    const id = compositionIdentityOf(held);
    expect(id).toBe('composition-key1:exhaust-1');
    let read = await readUnresolvedCompositionWrites(inner, DEVICE);
    expect(read.open.map((write) => [write.compositionId, write.state])).toEqual([
      [id, 'retrying'],
    ]);

    held = await occasions(writer, held, MAX_COMPOSITION_WRITE_ATTEMPTS - 1);
    read = await readUnresolvedCompositionWrites(inner, DEVICE);
    expect(read.open.map((write) => [write.compositionId, write.state])).toEqual([
      [id, 'exhausted'],
    ]);
    // One identity throughout, the bound held, and the daily file never received a line.
    expect(minted()).toBe(1);
    expect(vault.dailyWriteCalls()).toBe(MAX_COMPOSITION_WRITE_ATTEMPTS);
    expect(inner.contentOf(DAILY_PATH)).toBeUndefined();

    // A further occasion changes nothing: no attempt, no new journal line.
    const linesBefore = journalLines(inner);
    await occasions(writer, held, 2);
    expect(vault.dailyWriteCalls()).toBe(MAX_COMPOSITION_WRITE_ATTEMPTS);
    expect(journalLines(inner)).toEqual(linesBefore);
    expect(minted()).toBe(1);

    // The id resolves to the explicit unresolved write, and to no record.
    const reference = await resolveCompositionReference(inner, DEVICE, id ?? '');
    expect(reference).toMatchObject({
      status: 'unresolved',
      write: { compositionId: id, state: 'exhausted' },
    });
    const { records } = await readCompositionLog(inner);
    expect(resolveCompositionRecord(records, id ?? '')).toBeNull();
  });

  it('the unresolved write the session carries is data only and says whether it reached the vault', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail', 'fail', 'fail']);
    const { writer } = recorderFor(vault, 'view');
    const first = await writer.recordStart(sessionOf(['inst-a']), NOW);
    expect(unresolvedCompositionWritesOf(first.session)).toEqual([
      {
        compositionId: 'composition-key1:view-1',
        sessionId: 'composition-key1:view-1',
        kind: 'compose',
        composedAt: isoWithLocalOffset(NOW),
        state: 'retrying',
        persisted: true,
      },
    ]);
    const exhausted = await occasions(writer, first.session, MAX_COMPOSITION_WRITE_ATTEMPTS - 1);
    expect(unresolvedCompositionWritesOf(exhausted).map((write) => write.state)).toEqual([
      'exhausted',
    ]);
    // A session with nothing pending reports nothing.
    expect(unresolvedCompositionWritesOf(sessionOf(['inst-a']))).toEqual([]);
  });

  it('when the journal cannot be written either, the state is still explicit in memory and says it is not persisted; nothing throws', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, []);
    vault.refuseEverything(true);
    const { writer } = recorderFor(vault, 'nojournal');
    const first = await writer.recordStart(sessionOf(['inst-a']), NOW);
    expect(first).toMatchObject({ status: 'not-recorded', reason: 'write-failed' });
    expect(unresolvedCompositionWritesOf(first.session)).toMatchObject([
      { compositionId: 'composition-key1:nojournal-1', state: 'retrying', persisted: false },
    ]);
    const exhausted = await occasions(writer, first.session, MAX_COMPOSITION_WRITE_ATTEMPTS - 1);
    expect(unresolvedCompositionWritesOf(exhausted)).toMatchObject([
      { state: 'exhausted', persisted: false },
    ]);
    expect(inner.writes).toEqual([]);
  });

  it('a journal that could not be written is tried again at the next failure, and the entry then says it is persisted', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, []);
    vault.refuseEverything(true);
    const { writer } = recorderFor(vault, 'healing');
    const first = await writer.recordStart(sessionOf(['inst-a']), NOW);
    expect(unresolvedCompositionWritesOf(first.session)).toMatchObject([{ persisted: false }]);

    // The layer accepts the journal again (the daily file still refuses).
    vault.refuseEverything(false);
    vault.script(['fail', 'fail']);
    const second = await writer.recordStart(first.session, NOW);
    expect(unresolvedCompositionWritesOf(second.session)).toMatchObject([
      { state: 'retrying', persisted: true },
    ]);
    const third = await writer.recordStart(second.session, NOW);
    expect(third).toMatchObject({ status: 'not-recorded', reason: 'write-failed' });
    expect(unresolvedCompositionWritesOf(third.session)).toMatchObject([
      { state: 'exhausted', persisted: true },
    ]);
    expect((await readUnresolvedCompositionWrites(inner, DEVICE)).open.map((w) => w.state)).toEqual(
      ['exhausted'],
    );
  });

  it('a journal line that is torn (an interrupted append) is skipped, counted, and never rewritten', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail', 'fail', 'fail']);
    const { writer } = recorderFor(vault, 'torn');
    await writer.recordStart(sessionOf(['inst-a']), NOW);
    const intact = inner.contentOf(JOURNAL_PATH) ?? '';
    // An interrupted append: a partial trailing line with no newline.
    await inner.write(JOURNAL_PATH, `${intact}{"schemaVersion":1,"entry":"unre`);
    const read = await readUnresolvedCompositionWrites(inner, DEVICE);
    expect(read.open).toHaveLength(1);
    expect(read.invalidLineCount).toBe(1);

    // The next journal append closes the torn line off with its own newline; nothing is rewritten.
    const before = inner.contentOf(JOURNAL_PATH) ?? '';
    vault.script(['ok']);
    const report = await reconcileUnresolvedCompositionWrites({ vault, deviceId: DEVICE });
    expect(report).toMatchObject({ written: 1, invalidLines: 1 });
    const after = inner.contentOf(JOURNAL_PATH) ?? '';
    expect(after.startsWith(before)).toBe(true);
    expect((await readUnresolvedCompositionWrites(inner, DEVICE)).open).toEqual([]);
  });
});

describe('a restart finds unresolved writes and reconciles them idempotently (ol-egov.141.89.10.97)', () => {
  it('lands the record under the identity it was first built with, and a second run leaves every byte where it was', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail', 'fail', 'fail']);
    const { writer } = recorderFor(vault, 'restart');
    const held = await occasions(writer, sessionOf(['inst-a']), MAX_COMPOSITION_WRITE_ATTEMPTS + 1);
    const id = compositionIdentityOf(held);
    expect((await readUnresolvedCompositionWrites(inner, DEVICE)).open).toHaveLength(1);

    // The plugin restarts: the held session and its in-memory queue are gone; the vault remains,
    // and the daily file now accepts writes.
    const restarted = scriptedVault(inner, []);
    const first = await reconcileUnresolvedCompositionWrites({
      vault: restarted,
      deviceId: DEVICE,
    });
    expect(first).toEqual({
      examined: 1,
      alreadyLanded: 0,
      written: 1,
      stillUnresolved: 0,
      invalidLines: 0,
    });
    const { records } = await readCompositionLog(inner);
    expect(records.map((record) => record.compositionId)).toEqual([id]);
    expect(records[0]?.composedAt).toBe(isoWithLocalOffset(NOW));
    expect(resolveCompositionRecord(records, id ?? '')).toEqual(records[0]);
    expect((await readUnresolvedCompositionWrites(inner, DEVICE)).open).toEqual([]);
    expect(await resolveCompositionReference(inner, DEVICE, id ?? '')).toMatchObject({
      status: 'recorded',
      record: { compositionId: id },
    });

    // Reconciling again is the same state: nothing examined, no write issued, no byte changed.
    const dailyBefore = inner.contentOf(DAILY_PATH);
    const journalBefore = inner.contentOf(JOURNAL_PATH);
    const writesBefore = inner.writes.length;
    const second = await reconcileUnresolvedCompositionWrites({
      vault: restarted,
      deviceId: DEVICE,
    });
    expect(second).toEqual({
      examined: 0,
      alreadyLanded: 0,
      written: 0,
      stillUnresolved: 0,
      invalidLines: 0,
    });
    expect(inner.contentOf(DAILY_PATH)).toBe(dailyBefore);
    expect(inner.contentOf(JOURNAL_PATH)).toBe(journalBefore);
    expect(inner.writes).toHaveLength(writesBefore);
  });

  it('a write that landed but reported failure is found landed at restart and never appended twice', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['land-then-fail']);
    const { writer } = recorderFor(vault, 'landed');
    const failed = await writer.recordStart(sessionOf(['inst-a']), NOW);
    expect(failed).toMatchObject({ status: 'not-recorded', reason: 'write-failed' });
    expect((await readCompositionLog(inner)).records).toHaveLength(1);

    const report = await reconcileUnresolvedCompositionWrites({
      vault: scriptedVault(inner, []),
      deviceId: DEVICE,
    });
    expect(report).toMatchObject({ examined: 1, alreadyLanded: 1, written: 0, stillUnresolved: 0 });
    expect((await readCompositionLog(inner)).records).toHaveLength(1);
    expect(parseCompositionLog(inner.contentOf(DAILY_PATH) ?? '').invalidLines).toEqual([]);
    expect((await readUnresolvedCompositionWrites(inner, DEVICE)).open).toEqual([]);
  });

  it('a crash between landing the record and marking it resolved is completed by the next run, still without a second copy', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail']);
    const { writer } = recorderFor(vault, 'crash');
    await writer.recordStart(sessionOf(['inst-a']), NOW);
    // A run that landed the record and died before it could mark the journal.
    const [journaled] = (await readUnresolvedCompositionWrites(inner, DEVICE)).open;
    if (journaled === undefined) throw new Error('expected one unresolved write');
    const restarted = scriptedVault(inner, []);
    await restarted.write(DAILY_PATH, serializeCompositionRecord(journaled.record));
    const report = await reconcileUnresolvedCompositionWrites({
      vault: restarted,
      deviceId: DEVICE,
    });
    expect(report).toMatchObject({ examined: 1, alreadyLanded: 1, written: 0 });
    expect((await readCompositionLog(inner)).records).toHaveLength(1);
    expect((await readUnresolvedCompositionWrites(inner, DEVICE)).open).toEqual([]);
  });

  it('a reconciliation that fails again leaves the write unresolved and explicit, and a later start lands it under the same id', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail', 'fail', 'fail']);
    const { writer } = recorderFor(vault, 'again');
    const held = await occasions(writer, sessionOf(['inst-a']), MAX_COMPOSITION_WRITE_ATTEMPTS);
    const id = compositionIdentityOf(held);

    const stillFailing = scriptedVault(inner, ['fail']);
    const failed = await reconcileUnresolvedCompositionWrites({
      vault: stillFailing,
      deviceId: DEVICE,
    });
    expect(failed).toMatchObject({ examined: 1, written: 0, stillUnresolved: 1 });
    expect(
      (await readUnresolvedCompositionWrites(inner, DEVICE)).open.map(
        (write) => write.compositionId,
      ),
    ).toEqual([id]);
    expect(await resolveCompositionReference(inner, DEVICE, id ?? '')).toMatchObject({
      status: 'unresolved',
    });

    const healed = await reconcileUnresolvedCompositionWrites({
      vault: scriptedVault(inner, []),
      deviceId: DEVICE,
    });
    expect(healed).toMatchObject({ examined: 1, written: 1, stillUnresolved: 0 });
    expect((await readCompositionLog(inner)).records.map((record) => record.compositionId)).toEqual(
      [id],
    );
  });

  it('a session and its keep-going extension reconcile in order, and a parent that will not land holds its extension back', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail', 'fail', 'fail', 'fail']);
    const { writer } = recorderFor(vault, 'chain');
    const first = await writer.recordStart(sessionOf(['inst-a']), NOW);
    const grown = await writer.recordExtension(first.session, grownFrom(first.session), LATER);
    expect(grown).toMatchObject({ status: 'not-recorded', reason: 'write-failed' });
    const journaled = (await readUnresolvedCompositionWrites(inner, DEVICE)).open;
    expect(journaled.map((write) => [write.compositionId, write.kind])).toEqual([
      ['composition-key1:chain-1', 'compose'],
      ['composition-key1:chain-2', 'extend'],
    ]);

    // The parent refuses again: the extension is not written ahead of it.
    const parentRefuses = scriptedVault(inner, ['fail']);
    const held = await reconcileUnresolvedCompositionWrites({
      vault: parentRefuses,
      deviceId: DEVICE,
    });
    expect(held).toMatchObject({ examined: 2, written: 0, stillUnresolved: 2 });
    expect(inner.contentOf(DAILY_PATH)).toBeUndefined();

    const healed = await reconcileUnresolvedCompositionWrites({
      vault: scriptedVault(inner, []),
      deviceId: DEVICE,
    });
    expect(healed).toMatchObject({ examined: 2, written: 2, stillUnresolved: 0 });
    const { records } = await readCompositionLog(inner);
    expect(
      records.map((record: CompositionRecord) => [
        record.compositionId,
        record.parentCompositionId,
      ]),
    ).toEqual([
      ['composition-key1:chain-1', null],
      ['composition-key1:chain-2', 'composition-key1:chain-1'],
    ]);
  });

  it('a record the live session lands after reconciliation already wrote it is found landed, not appended again', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail']);
    const { writer } = recorderFor(vault, 'both');
    const failed = await writer.recordStart(sessionOf(['inst-a']), NOW);
    await reconcileUnresolvedCompositionWrites({
      vault: scriptedVault(inner, []),
      deviceId: DEVICE,
    });
    const retried = await writer.recordStart(failed.session, LATER);
    expect(retried.status).toBe('recorded');
    expect((await readCompositionLog(inner)).records).toHaveLength(1);
    expect((await readUnresolvedCompositionWrites(inner, DEVICE)).open).toEqual([]);
  });

  it('a retry that lands inside the running process marks its journaled write resolved', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail']);
    const { writer } = recorderFor(vault, 'live');
    const failed = await writer.recordStart(sessionOf(['inst-a']), NOW);
    expect((await readUnresolvedCompositionWrites(inner, DEVICE)).open).toHaveLength(1);
    const retried = await writer.recordStart(failed.session, LATER);
    expect(retried.status).toBe('recorded');
    expect((await readUnresolvedCompositionWrites(inner, DEVICE)).open).toEqual([]);
    expect(unresolvedCompositionWritesOf(retried.session)).toEqual([]);
  });

  it('with nothing unresolved, and with no journal file at all, reconciliation writes nothing and never throws', async () => {
    const inner = memoryVault({ 'Notes/one.md': '# one\n' });
    const report = await reconcileUnresolvedCompositionWrites({ vault: inner, deviceId: DEVICE });
    expect(report).toEqual({
      examined: 0,
      alreadyLanded: 0,
      written: 0,
      stillUnresolved: 0,
      invalidLines: 0,
    });
    expect(inner.writes).toEqual([]);
    const unreadable = memoryVault();
    const refusing = {
      ...unreadable,
      exists: async () => {
        throw new Error('vault unavailable');
      },
    };
    await expect(
      reconcileUnresolvedCompositionWrites({ vault: refusing, deviceId: DEVICE }),
    ).resolves.toMatchObject({ examined: 0 });
  });

  it('two starts at once share one pass: the record lands once', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail']);
    await recorderFor(vault, 'shared').writer.recordStart(sessionOf(['inst-a']), NOW);
    const restarted = scriptedVault(inner, []);
    const [a, b] = await Promise.all([
      reconcileUnresolvedCompositionWrites({ vault: restarted, deviceId: DEVICE }),
      reconcileUnresolvedCompositionWrites({ vault: restarted, deviceId: DEVICE }),
    ]);
    expect(a).toEqual(b);
    expect((await readCompositionLog(inner)).records).toHaveLength(1);
  });
});

describe('reviews keep their stable reference to the planning record throughout (ol-egov.141.89.10.97)', () => {
  const INSTRUMENT: ReviewInstrument = {
    instrumentId: 'inst-a',
    conceptIds: ['concept-a'],
    courseCode: 'TEST101',
    noteTitle: 'Week 1',
    sourcePath: 'Courses/TEST101/Week 1.md',
    blockId: null,
    draftId: null,
    type: 'qa',
    question: 'What is it?',
    answer: 'It is this.',
  };

  it('a review stamped while the record is pending is never rewritten, through exhaustion and restart, and resolves once reconciliation lands the record', async () => {
    const inner = memoryVault();
    const vault = scriptedVault(inner, ['fail', 'fail', 'fail']);
    const { writer } = recorderFor(vault, 'stable');
    let held = (await writer.recordStart(sessionOf(['inst-a']), NOW)).session;
    const stamped = compositionIdentityOf(held);
    expect(stamped).toBe('composition-key1:stable-1');

    // She answers while the record is pending: the review carries the pending id.
    await createVaultReviewLogPort(vault, DEVICE).recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
        planVersion: null,
      },
      ...(stamped !== undefined ? { compositionId: stamped } : {}),
    });
    const reviewPath = inner.writes.find((path) => path.startsWith('.olea/reviews/')) ?? '';
    const reviewLog = inner.contentOf(reviewPath);
    expect(reviewLog).toContain(`"compositionId":"${stamped}"`);

    // Every occasion up to and past the bound serves the same reference.
    for (let occasion = 0; occasion < MAX_COMPOSITION_WRITE_ATTEMPTS + 1; occasion += 1) {
      held = (await writer.recordStart(held, NOW)).session;
      expect(compositionIdentityOf(held)).toBe(stamped);
    }
    expect(await resolveCompositionReference(inner, DEVICE, stamped ?? '')).toMatchObject({
      status: 'unresolved',
    });

    // Restart: the reference resolves to the record; the review line is byte-identical.
    await reconcileUnresolvedCompositionWrites({
      vault: scriptedVault(inner, []),
      deviceId: DEVICE,
    });
    expect(await resolveCompositionReference(inner, DEVICE, stamped ?? '')).toMatchObject({
      status: 'recorded',
      record: { compositionId: stamped },
    });
    expect(inner.contentOf(reviewPath)).toBe(reviewLog);
  });

  it('an id nobody minted resolves to unknown, never to a guess', async () => {
    const inner = memoryVault();
    expect(await resolveCompositionReference(inner, DEVICE, 'composition-key1:nobody')).toEqual({
      status: 'unknown',
    });
  });

  it('nothing outside Olea’s own layer is ever written (INV-6)', async () => {
    const inner = memoryVault({ 'Courses/TEST101/Week 1.md': 'Front::Back\n' });
    const vault = scriptedVault(inner, ['fail', 'fail', 'fail']);
    const { writer } = recorderFor(vault, 'inv6');
    await occasions(writer, sessionOf(['inst-a']), MAX_COMPOSITION_WRITE_ATTEMPTS);
    await reconcileUnresolvedCompositionWrites({
      vault: scriptedVault(inner, []),
      deviceId: DEVICE,
    });
    expect(inner.writes.length).toBeGreaterThan(0);
    expect(inner.writes.every((path) => path.startsWith(`${COMPOSITION_LOG_FOLDER}/`))).toBe(true);
    expect(inner.contentOf('Courses/TEST101/Week 1.md')).toBe('Front::Back\n');
  });
});
