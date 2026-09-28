/**
 * `[D-395]` (`ol-egov.141.89.10.65`): the composition recorder over the real composition door
 * (`session-builder/provider.ts`'s `composeStudySessionForRequest`), and the review log's folds
 * after a record is written. The vault fixture restates `extend-outrun-course-filter.spec.ts`'s
 * pattern (one course here, three concepts, one card each) rather than importing it. Course codes
 * and concept names are invented (INV-3).
 */
import {
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  type StudyPlanEnvelope,
} from 'olea-contracts';
import {
  type ComposedStudySession,
  clusterReviewSessions,
  createFsrsScheduler,
  readReviewLogHistory,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
// Not in the `olea-core` barrel (another live lane's file this round): imported by module path.
import {
  extendComposedStudySessionWithAccount,
  FOCUS_BRANCH_SENTENCE,
} from '../../../core/src/study-session/compose.js';
import {
  COMPOSITION_LOG_FOLDER,
  readCompositionLog,
} from '../../../core/src/study-session/composition-log.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';
import {
  compositionIdentityOf,
  createCompositionRecorder,
  explainActiveSession,
  MAX_COMPOSITION_WRITE_ATTEMPTS,
  recordedSessionReason,
} from '../../src/session/composition-recorder.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { groupingWhySentence } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { localToday, readReviewHistory } from '../../src/today/data-source.js';
import { type MemoryVault, memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const LATER = new Date('2026-08-10T15:00:00-04:00');
const BASE_PATH = '02 Assignments/Assignments.base';
const PLAN_VERSION = 'sp1-aaaaaaaaaaaaaaaa';

function card(concept: string, front: string): string {
  return ['---', `topic: [${concept}]`, 'course: TESTC101', '---', '', `${front}::Back`, ''].join(
    '\n',
  );
}

function oneCourseFiles(): Readonly<Record<string, string>> {
  return {
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
    '05 Zettelkasten/Sprocket theory.md': '# Sprocket theory\n',
    'Notes/one.md': card('Widget theory', 'Front one'),
    'Notes/two.md': card('Gadget theory', 'Front two'),
    'Notes/three.md': card('Sprocket theory', 'Front three'),
    [BASE_PATH]: [
      'filters:',
      '  and:',
      '    - file.inFolder("02 Assignments")',
      '    - file.ext == "md"',
      'properties:',
      '  class:',
      '  type:',
      '  weight:',
      '  due:',
      '  status:',
    ].join('\n'),
    '03 Research/TESTC101 Past Paper 2023.md': [
      '---',
      'role: past-paper',
      'course: TESTC101',
      '---',
      '',
      '# TESTC101 Past Paper — 2023',
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain Widget theory, Gadget theory and Sprocket theory, and why they matter.',
      '',
    ].join('\n'),
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
  };
}

class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const PLAN: StudyPlanEnvelope = {
  envelopeVersion: 1,
  kind: 'study-plan',
  bodyVersion: 1,
  policyVersion: PLAN_VERSION,
  computedAt: NOW.toISOString(),
  freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
  governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
  body: {
    asOf: '2026-08-10',
    courses: [],
    allocation: [
      {
        courseId: 'TESTC101',
        share: 1,
        minBlockSeconds: 1,
        contributions: [{ name: 'risk', value: 0.01 }],
        reason: 'TESTC101 gets its share.',
      },
    ],
  },
};

async function compose(vault: MemoryVault, budgetMinutes: number, now: Date = NOW) {
  const result = await composeStudySessionForRequest(
    {
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeSettingsHost(),
      now: () => now,
      scheduler: createFsrsScheduler(),
      plan: () => PLAN,
    },
    { budgetMinutes },
    now,
  );
  if (result === null) throw new Error('expected a composed result (plan configured)');
  return result;
}

function compositionPaths(vault: MemoryVault): readonly string[] {
  return vault.writes.filter((path) => path.startsWith(`${COMPOSITION_LOG_FOLDER}/`));
}

function recorder(vault: MemoryVault) {
  let n = 0;
  return createCompositionRecorder({
    vault,
    deviceId: DEVICE,
    mintCompositionId: () => `composition-key1:test-${++n}`,
  });
}

async function started(vault: MemoryVault, budgetMinutes = 1, now: Date = NOW) {
  const { composed, composedInput } = await compose(vault, budgetMinutes, now);
  const writer = recorder(vault);
  const outcome = await writer.recordStart(composed.full, now);
  if (outcome.status !== 'recorded') throw new Error(`expected a record, got ${outcome.status}`);
  return { outcome, composedInput, writer };
}

describe('[D-395] a preview writes nothing', () => {
  it('composing through the door Home and the session builder preview through carries provenance and writes no record', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { composed } = await compose(vault, 20);
    expect(composed.full.provenance).toMatchObject({ planVersion: PLAN_VERSION, reentry: false });
    expect(composed.full.provenance?.allocation).toEqual(PLAN.body.allocation);
    expect(composed.full.compositionRecord).toBeUndefined();
    expect(compositionPaths(vault)).toEqual([]);
  });

  it('a session with no provenance (not composed through the door) is served unrecorded, and nothing is written', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { composed } = await compose(vault, 20);
    const { provenance: _dropped, ...handBuilt } = composed.full;
    const outcome = await recorder(vault).recordStart(handBuilt, NOW);
    expect(outcome).toMatchObject({ status: 'not-recorded', reason: 'no-provenance' });
    expect(compositionPaths(vault)).toEqual([]);
  });
});

describe('[D-395] starting a session appends its own record', () => {
  it('writes one record to the day-and-device file, carrying its own session id, and hands the session back carrying it', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { outcome } = await started(vault);
    if (outcome.status !== 'recorded') throw new Error('unreachable');
    expect(outcome.path).toBe(`${COMPOSITION_LOG_FOLDER}/2026-08-10.${DEVICE}.jsonl`);
    expect(outcome.record.kind).toBe('compose');
    expect(outcome.record.sessionId).toBe(outcome.record.compositionId);
    expect(outcome.record.planVersion).toBe(PLAN_VERSION);
    expect(outcome.record.chosen.map((c) => c.instrumentId)).toEqual(
      outcome.session.model.items.map((item) => item.instrumentId),
    );
    expect(outcome.session.compositionRecord).toEqual(outcome.record);
    expect((await readCompositionLog(vault)).records).toEqual([outcome.record]);
  });

  it('two sessions on the same day and device are two records with two session ids', async () => {
    const vault = memoryVault(oneCourseFiles());
    const first = await started(vault);
    const { composed } = await compose(vault, 1, LATER);
    const second = await createCompositionRecorder({
      vault,
      deviceId: DEVICE,
      mintCompositionId: () => 'composition-key1:second',
    }).recordStart(composed.full, LATER);
    if (second.status !== 'recorded' || first.outcome.status !== 'recorded') {
      throw new Error('expected two records');
    }
    expect(second.path).toBe(first.outcome.path);
    const { records } = await readCompositionLog(vault);
    expect(records.map((r) => r.sessionId)).toEqual([
      first.outcome.record.sessionId,
      'composition-key1:second',
    ]);
  });

  it('a session already carrying its record is never recorded twice', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { outcome } = await started(vault);
    const again = await recorder(vault).recordStart(outcome.session, NOW);
    expect(again.status).toBe('unchanged');
    expect(compositionPaths(vault)).toHaveLength(1);
  });

  it('a failed write leaves the session served and unrecorded, never thrown', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { composed } = await compose(vault, 1);
    const failing = createCompositionRecorder({
      vault: {
        ...vault,
        write: async () => {
          throw new Error('disk full');
        },
      },
      deviceId: DEVICE,
    });
    const outcome = await failing.recordStart(composed.full, NOW);
    expect(outcome).toMatchObject({ status: 'not-recorded', reason: 'write-failed' });
    expect(outcome.session.compositionRecord).toBeUndefined();
    expect(outcome.session.model.items).toEqual(composed.full.model.items);
  });
});

describe('[D-395] a keep going that changed the list appends an extension record', () => {
  it('appends a record naming the same session and its parent, leaving the first record byte-identical', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { outcome, composedInput, writer } = await started(vault, 1);
    if (outcome.status !== 'recorded') throw new Error('unreachable');
    const before = vault.contentOf(outcome.path) ?? '';

    const extended = extendComposedStudySessionWithAccount(
      { ...composedInput, budgetMinutes: 30 },
      outcome.session,
    );
    // Precondition: the wider budget really does serve more than the first composition did.
    expect(extended.model.items.length).toBeGreaterThan(outcome.session.model.items.length);

    const grown = await writer.recordExtension(outcome.session, extended, LATER);
    if (grown.status !== 'recorded') throw new Error(`expected a record, got ${grown.status}`);
    expect(grown.record).toMatchObject({
      kind: 'extend',
      sessionId: outcome.record.sessionId,
      parentCompositionId: outcome.record.compositionId,
    });
    expect(grown.record.compositionId).not.toBe(outcome.record.compositionId);
    expect(grown.session.compositionRecord).toEqual(grown.record);
    const after = vault.contentOf(outcome.path) ?? '';
    expect(after.startsWith(before)).toBe(true);
    expect((await readCompositionLog(vault)).records).toEqual([outcome.record, grown.record]);
  });

  it('an extend that changed nothing appends nothing, and the session stays under its record', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { outcome, composedInput } = await started(vault, 1);
    const same = extendComposedStudySessionWithAccount(
      { ...composedInput, budgetMinutes: outcome.session.model.budgetMinutes },
      outcome.session,
    );
    const result = await recorder(vault).recordExtension(outcome.session, same, LATER);
    expect(result.status).toBe('unchanged');
    expect(result.session.compositionRecord).toEqual(outcome.session.compositionRecord);
    expect(compositionPaths(vault)).toHaveLength(1);
  });

  it("an extension grown without its account (the parent's set-asides kept by a plain spread) writes nothing rather than a wrong record", async () => {
    const vault = memoryVault(oneCourseFiles());
    const { outcome, composedInput } = await started(vault, 1);
    const widened = extendComposedStudySessionWithAccount(
      { ...composedInput, budgetMinutes: 30 },
      outcome.session,
    );
    const plainSpread: ComposedStudySession = {
      ...outcome.session,
      model: { ...outcome.session.model, items: widened.model.items },
    };
    const result = await recorder(vault).recordExtension(outcome.session, plainSpread, LATER);
    expect(result).toMatchObject({ status: 'not-recorded', reason: 'account-not-carried' });
    expect(compositionPaths(vault)).toHaveLength(1);
  });
});

describe('[D-395] writing a record is never study activity', () => {
  it('a session started and left with no answer leaves no review event, no clustered session and no received time', async () => {
    const vault = memoryVault(oneCourseFiles());
    await started(vault);
    expect(compositionPaths(vault)).toHaveLength(1);
    expect(vault.writes.filter((path) => path.startsWith('.olea/reviews/'))).toEqual([]);

    const history = await readReviewHistory(vault, DEVICE, { today: localToday(NOW) });
    expect(history.entries).toEqual([]);
    const { entries } = await readReviewLogHistory(vault);
    expect(entries).toEqual([]);
    expect(clusterReviewSessions(entries)).toEqual([]);
  });
});

/**
 * A vault over `inner` whose composition-log writes follow `plan`, one entry per write call:
 * `'fail'` throws without writing, `'land-then-fail'` writes and then throws (a write that landed
 * but reported failure), `'ok'` writes. Writes past the end of `plan` succeed. Counts every
 * composition-log write call, attempted or not.
 */
function scriptedVault(
  inner: MemoryVault,
  plan: readonly ('fail' | 'land-then-fail' | 'ok')[],
): MemoryVault & { readonly compositionWriteCalls: () => number } {
  let calls = 0;
  return {
    ...inner,
    read: (path) => inner.read(path),
    exists: (path) => inner.exists(path),
    async write(path, content) {
      if (!path.startsWith(`${COMPOSITION_LOG_FOLDER}/`)) return inner.write(path, content);
      const step = plan[calls] ?? 'ok';
      calls += 1;
      if (step === 'fail') throw new Error('write refused');
      await inner.write(path, content);
      if (step === 'land-then-fail') throw new Error('write reported failure after landing');
    },
    compositionWriteCalls: () => calls,
  };
}

/** A recorder whose minted ids are counted, so a test can prove no second identity was minted. */
function countingRecorder(vault: MemoryVault, prefix: string) {
  let minted = 0;
  const writer = createCompositionRecorder({
    vault,
    deviceId: DEVICE,
    mintCompositionId: () => `composition-key1:${prefix}-${++minted}`,
  });
  return { writer, minted: () => minted };
}

describe('[D-331]/[D-382] the active session explains itself from its frozen composition (ol-egov.141.89.10.93)', () => {
  it('no session active: no explanation, no sentence', () => {
    const idle = createStudySessionHolder().getSitting();
    expect(explainActiveSession(idle)).toBeUndefined();
    expect(recordedSessionReason(idle)).toBeUndefined();
  });

  it("an active recorded session states its composition's branch through the one sentence table, equal to its record's", async () => {
    const vault = memoryVault(oneCourseFiles());
    const { outcome } = await started(vault);
    if (outcome.status !== 'recorded') throw new Error('unreachable');
    const branch = outcome.record.branch;
    if (branch === null) throw new Error('expected the one-course fixture to name a branch');
    expect(outcome.session.focusBranch).toBe(branch);
    const holder = createStudySessionHolder();
    holder.enter(NOW, outcome.session);
    expect(recordedSessionReason(holder.getSitting())).toBe(FOCUS_BRANCH_SENTENCE[branch]);
    holder.exit();
    expect(recordedSessionReason(holder.getSitting())).toBeUndefined();
  });

  it('a failed record write never suppresses the explanation: both screens state the frozen composition’s sentence', async () => {
    const inner = memoryVault(oneCourseFiles());
    const { composed } = await compose(inner, 20);
    const branch = composed.full.focusBranch;
    if (branch === undefined) throw new Error('expected the one-course fixture to name a branch');
    const vault = scriptedVault(inner, ['fail']);
    const outcome = await recorder(vault).recordStart(composed.full, NOW);
    expect(outcome).toMatchObject({ status: 'not-recorded', reason: 'write-failed' });
    expect(outcome.session.compositionRecord).toBeUndefined();

    const holder = createStudySessionHolder();
    holder.enter(NOW, outcome.session);
    // Home (`home/provider.ts`) and the review tab (`main.ts`) both call this one read.
    expect(recordedSessionReason(holder.getSitting())).toBe(FOCUS_BRANCH_SENTENCE[branch]);
  });

  it('Start before the review tab opened (nothing written yet) states the same sentence', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { composed } = await compose(vault, 20);
    const holder = createStudySessionHolder();
    holder.enter(NOW, composed.full);
    expect(composed.full.focusReason).toBeDefined();
    expect(recordedSessionReason(holder.getSitting())).toBe(composed.full.focusReason);
    expect(compositionPaths(vault)).toEqual([]);
  });

  it('reads the frozen composition, not the log: a record copy that disagrees is not consulted', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { outcome } = await started(vault);
    if (outcome.status !== 'recorded') throw new Error('unreachable');
    const branch = outcome.session.focusBranch;
    if (branch === undefined) throw new Error('expected the one-course fixture to name a branch');
    const other = branch === 'filter' ? 'deficit' : 'filter';
    const holder = createStudySessionHolder();
    holder.enter(NOW, {
      ...outcome.session,
      compositionRecord: { ...outcome.record, branch: other },
    });
    expect(recordedSessionReason(holder.getSitting())).toBe(FOCUS_BRANCH_SENTENCE[branch]);
  });

  it('a composition that chose no course (the every-course baseline) states no course sentence', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { composed } = await compose(vault, 20);
    const { focusBranch: _b, focusReason: _r, dominantCourse: _c, ...noCourse } = composed.full;
    const holder = createStudySessionHolder();
    holder.enter(NOW, noCourse);
    expect(recordedSessionReason(holder.getSitting())).toBeUndefined();
    expect(explainActiveSession(holder.getSitting())?.status).toBe('available');
  });

  it('a held session with no composer account is reported unavailable, and no sentence is reconstructed', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { composed } = await compose(vault, 20);
    // A hand-built session: the composer always sets `groupingSignal`; this one does not carry it,
    // though it still carries a free-text reason that must not be restated.
    const { groupingSignal: _g, ...handBuilt } = composed.full;
    const holder = createStudySessionHolder();
    holder.enter(NOW, handBuilt);
    expect(explainActiveSession(holder.getSitting())).toEqual({ status: 'unavailable' });
    expect(recordedSessionReason(holder.getSitting())).toBeUndefined();
  });

  it('[D-421] the grouping sentence is given for a deciding signal and omitted when no grouping decision occurred', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { composed } = await compose(vault, 20);
    const holder = createStudySessionHolder();
    for (const signal of ['assessment-scope', 'arrival-cohort', 'relatedness'] as const) {
      holder.enter(NOW, { ...composed.full, groupingSignal: signal });
      const explanation = explainActiveSession(holder.getSitting());
      expect(explanation).toEqual({
        status: 'available',
        courseReason: composed.full.focusReason,
        groupingSentence: groupingWhySentence(signal),
      });
      expect(explanation?.status === 'available' && explanation.groupingSentence).toBeTruthy();
    }
    holder.enter(NOW, { ...composed.full, groupingSignal: 'none' });
    const none = explainActiveSession(holder.getSitting());
    expect(none).toEqual({ status: 'available', courseReason: composed.full.focusReason });
    expect(none !== undefined && 'groupingSentence' in none).toBe(false);
  });

  it('a keep going that appended an extension record states the same sentences as before it', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { outcome, composedInput, writer } = await started(vault, 1);
    if (outcome.status !== 'recorded') throw new Error('unreachable');
    const holder = createStudySessionHolder();
    holder.enter(NOW, outcome.session);
    const before = explainActiveSession(holder.getSitting());
    const extended = extendComposedStudySessionWithAccount(
      { ...composedInput, budgetMinutes: 30 },
      outcome.session,
    );
    const grown = await writer.recordExtension(outcome.session, extended, LATER);
    if (grown.status !== 'recorded') throw new Error(`expected a record, got ${grown.status}`);
    holder.growActiveSitting(NOW, grown.session);
    expect(before?.status === 'available' && before.courseReason).toBeTruthy();
    expect(explainActiveSession(holder.getSitting())).toEqual(before);
  });
});

describe('a failed record write is retried under the same composition identity, bounded (ol-egov.141.89.10.93)', () => {
  it('the retry writes the record first built — same id, same composition time — and mints nothing new', async () => {
    const inner = memoryVault(oneCourseFiles());
    const { composed } = await compose(inner, 20);
    const vault = scriptedVault(inner, ['fail']);
    const first = countingRecorder(vault, 'first');
    const failed = await first.writer.recordStart(composed.full, NOW);
    expect(failed).toMatchObject({ status: 'not-recorded', reason: 'write-failed' });
    const identity = compositionIdentityOf(failed.session);
    expect(identity).toBe('composition-key1:first-1');

    // The next occasion runs through a different recorder instance (the review tab builds one per
    // open) and a later clock: neither may change the record.
    const second = countingRecorder(vault, 'second');
    const retried = await second.writer.recordStart(failed.session, LATER);
    if (retried.status !== 'recorded') throw new Error(`expected a record, got ${retried.status}`);
    expect(second.minted()).toBe(0);
    expect(first.minted()).toBe(1);
    expect(retried.record.compositionId).toBe(identity);
    expect(retried.record.composedAt).toBe(isoWithLocalOffset(NOW));
    expect(retried.session.compositionRecord).toEqual(retried.record);
    expect(compositionIdentityOf(retried.session)).toBe(identity);
    expect((await readCompositionLog(inner)).records).toEqual([retried.record]);

    // Recorded, nothing queued: a further occasion writes nothing.
    const again = await second.writer.recordStart(retried.session, LATER);
    expect(again.status).toBe('unchanged');
    expect(vault.compositionWriteCalls()).toBe(2);
  });

  it('a write that landed but reported failure is never appended twice', async () => {
    const inner = memoryVault(oneCourseFiles());
    const { composed } = await compose(inner, 20);
    const vault = scriptedVault(inner, ['land-then-fail']);
    const failed = await recorder(vault).recordStart(composed.full, NOW);
    expect(failed).toMatchObject({ status: 'not-recorded', reason: 'write-failed' });
    const retried = await recorder(vault).recordStart(failed.session, NOW);
    expect(retried.status).toBe('recorded');
    const { records } = await readCompositionLog(inner);
    expect(records).toHaveLength(1);
    expect(records[0]?.compositionId).toBe(compositionIdentityOf(failed.session));
    expect(vault.compositionWriteCalls()).toBe(1);
  });

  it(`gives up after ${MAX_COMPOSITION_WRITE_ATTEMPTS} failed attempts: nothing more is tried, the session is still explained, and no new identity is minted`, async () => {
    const inner = memoryVault(oneCourseFiles());
    const { composed } = await compose(inner, 20);
    const vault = scriptedVault(inner, ['fail', 'fail', 'fail', 'fail', 'fail']);
    const { writer, minted } = countingRecorder(vault, 'bound');
    let session = composed.full;
    const reasons: string[] = [];
    for (let occasion = 0; occasion < MAX_COMPOSITION_WRITE_ATTEMPTS + 2; occasion += 1) {
      const outcome = await writer.recordStart(session, NOW);
      if (outcome.status !== 'not-recorded') throw new Error(`unexpected ${outcome.status}`);
      reasons.push(outcome.reason);
      session = outcome.session;
    }
    expect(MAX_COMPOSITION_WRITE_ATTEMPTS).toBe(3);
    expect(reasons).toEqual([
      'write-failed',
      'write-failed',
      'write-failed',
      'retries-exhausted',
      'retries-exhausted',
    ]);
    expect(vault.compositionWriteCalls()).toBe(MAX_COMPOSITION_WRITE_ATTEMPTS);
    expect(minted()).toBe(1);
    expect(compositionIdentityOf(session)).toBe('composition-key1:bound-1');
    const holder = createStudySessionHolder();
    holder.enter(NOW, session);
    expect(recordedSessionReason(holder.getSitting())).toBe(composed.full.focusReason);
  });

  it('a keep going over a session whose record is still pending writes the pending record first, then the extension naming it', async () => {
    const inner = memoryVault(oneCourseFiles());
    const { composed, composedInput } = await compose(inner, 1);
    const vault = scriptedVault(inner, ['fail']);
    const { writer, minted } = countingRecorder(vault, 'chain');
    const failed = await writer.recordStart(composed.full, NOW);
    expect(failed.status).toBe('not-recorded');
    const pendingId = compositionIdentityOf(failed.session);

    const extended = extendComposedStudySessionWithAccount(
      { ...composedInput, budgetMinutes: 30 },
      failed.session,
    );
    expect(extended.model.items.length).toBeGreaterThan(failed.session.model.items.length);
    const grown = await writer.recordExtension(failed.session, extended, LATER);
    if (grown.status !== 'recorded') throw new Error(`expected a record, got ${grown.status}`);
    expect(minted()).toBe(2);
    const { records } = await readCompositionLog(inner);
    expect(records.map((record) => record.kind)).toEqual(['compose', 'extend']);
    expect(records[0]?.compositionId).toBe(pendingId);
    expect(records[1]).toMatchObject({
      compositionId: 'composition-key1:chain-2',
      sessionId: pendingId,
      parentCompositionId: pendingId,
    });
    expect(grown.session.compositionRecord).toEqual(records[1]);
    expect(compositionIdentityOf(grown.session)).toBe('composition-key1:chain-2');
  });

  it('an extension that changed nothing is still an occasion: the pending record is retried under its own id', async () => {
    const inner = memoryVault(oneCourseFiles());
    const { composed, composedInput } = await compose(inner, 1);
    const vault = scriptedVault(inner, ['fail']);
    const failed = await recorder(vault).recordStart(composed.full, NOW);
    const pendingId = compositionIdentityOf(failed.session);
    const same = extendComposedStudySessionWithAccount(
      { ...composedInput, budgetMinutes: failed.session.model.budgetMinutes },
      failed.session,
    );
    const result = await recorder(vault).recordExtension(failed.session, same, LATER);
    expect(result.status).toBe('recorded');
    const { records } = await readCompositionLog(inner);
    expect(records.map((record) => record.compositionId)).toEqual([pendingId]);
  });

  it('two occasions at once share one write: the record lands once', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { composed } = await compose(vault, 20);
    const writer = recorder(vault);
    const [a, b] = await Promise.all([
      writer.recordStart(composed.full, NOW),
      writer.recordStart(composed.full, NOW),
    ]);
    expect(a).toBe(b);
    expect((await readCompositionLog(vault)).records).toHaveLength(1);
  });

  it('a session never started (a preview) carries no identity', async () => {
    const vault = memoryVault(oneCourseFiles());
    const { composed } = await compose(vault, 20);
    expect(compositionIdentityOf(composed.full)).toBeUndefined();
  });
});
