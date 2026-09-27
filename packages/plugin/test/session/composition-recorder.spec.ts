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
import { extendComposedStudySessionWithAccount } from '../../../core/src/study-session/compose.js';
import {
  COMPOSITION_LOG_FOLDER,
  readCompositionLog,
} from '../../../core/src/study-session/composition-log.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createCompositionRecorder } from '../../src/session/composition-recorder.js';
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
