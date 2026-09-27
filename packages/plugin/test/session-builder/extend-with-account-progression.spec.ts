/**
 * `ol-egov.141.89.10.65`'s main.ts splice: `extendDefaultStudySession` (`main.ts:3590`ish) must
 * call `extendComposedStudySessionWithAccount` and return that session with `widerBudgetMinutes`
 * on its model — not the plain `extendComposedStudySession`/`{ ...previous, model: { ...
 * previous.model, items } }` spread this method used before. Until this lands, every list-
 * changing "keep going" carries the PARENT session's own `setAside` object forward unchanged
 * (same reference), and `session/composition-recorder.ts`'s `recordExtension` reads that as
 * `'account-not-carried'` and writes no extension record — D-395 condition 2 unmet in production,
 * even though the session itself still grows and serves correctly.
 *
 * `main.ts` cannot be imported under Vitest (`test/main-wiring.spec.ts`'s own module doc: `main.ts`
 * imports `obsidian`, whose `package.json` `main` is `""`), so — mirroring
 * `outrun-extend-budget-progression.spec.ts`'s own precedent — this suite drives the exact
 * production functions `extendDefaultStudySession` calls (`composeStudySessionForRequest`,
 * `extendComposedStudySessionWithAccount`) the same way, with the same inputs, and feeds the
 * result through the real `createCompositionRecorder` to prove the fixed reconstruction actually
 * appends an extension record end to end. `test/main-wiring.spec.ts`'s own
 * `ol-egov.141.89.10.65`-updated `ol-egov.141.89.10.4` block pins the source-level shape;
 * `test/session/composition-recorder.spec.ts` proves the recorder side in isolation. This file is
 * the seam between the two: main.ts's OWN reconstruction, fed to the real recorder.
 *
 * Course codes and concept names are invented (INV-3).
 */
import {
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  type StudyPlanEnvelope,
} from 'olea-contracts';
import { type ComposedStudySession, createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
// Not in the `olea-core` barrel (another live lane's file this round, per this bead's own close
// notes): imported by module path, the same stance `session/composition-recorder.ts` and its own
// test take.
import { extendComposedStudySessionWithAccount } from '../../../core/src/study-session/compose.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createCompositionRecorder } from '../../src/session/composition-recorder.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { type MemoryVault, memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const LATER = new Date('2026-08-10T15:00:00-04:00');
const COURSE = 'OUTRUNC201';
const PLAN_VERSION = 'sp1-bbbbbbbbbbbbbbbb';
const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';
const BASE_FILE = [
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
].join('\n');

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
        courseId: COURSE,
        share: 1,
        minBlockSeconds: 1,
        contributions: [{ name: 'risk', value: 0.01 }],
        reason: `${COURSE} gets its share.`,
      },
    ],
  },
};

/** Enough never-reviewed Q&A cards, all in one course, that a wider budget always has real, eligible material left to add (`outrun-extend-budget-progression.spec.ts`'s own reasoning). */
function manyConceptVault(count: number): MemoryVault {
  const files: Record<string, string> = {
    [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md': `---\nclass: ${COURSE}\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n`,
  };
  const questions: string[] = [];
  for (let i = 0; i < count; i++) {
    const concept = `Extend-account concept ${i}`;
    files[`05 Zettelkasten/${concept}.md`] = `# ${concept}\n`;
    files[`Notes/extend-account-note-${i}.md`] = [
      '---',
      `topic: [${concept}]`,
      `course: ${COURSE}`,
      '---',
      '',
      `Extend front ${i}::Extend back ${i}`,
      '',
    ].join('\n');
    questions.push(
      `## Question ${i + 1} (10 marks)\n\nExplain the core mechanism behind ${concept} and why it matters.\n`,
    );
  }
  files[`03 Research/${COURSE} Past Paper 2023.md`] = [
    '---',
    'role: past-paper',
    `course: ${COURSE}`,
    '---',
    '',
    `# ${COURSE} Past Paper — 2023`,
    '',
    ...questions,
  ].join('\n');
  return memoryVault(files);
}

class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function composeDeps(vault: MemoryVault) {
  return {
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeSettingsHost(),
    now: () => NOW,
    scheduler: createFsrsScheduler(),
    plan: () => PLAN,
  };
}

async function composeInitial(vault: MemoryVault): Promise<ComposedStudySession> {
  const result = await composeStudySessionForRequest(
    composeDeps(vault),
    { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
    NOW,
  );
  if (result === null) throw new Error('expected a composed session (study plan not configured?)');
  const composed = result.composed.full;
  if (composed === null) throw new Error('expected a non-empty composed session');
  return composed;
}

/**
 * `main.ts`'s `extendDefaultStudySession`, reproduced line for line as it stands after
 * `ol-egov.141.89.10.65`'s splice — `useAccount: false` reproduces the OLD, pre-splice shape
 * instead, for the contrast test below. `courseOrTopic` is pinned inline to
 * `previous.dominantCourse` rather than through `frozenCourseOrTopicFilter`, the same
 * simplification `outrun-extend-budget-progression.spec.ts` takes for its own single-course
 * fixture.
 */
async function simulateExtend(
  vault: MemoryVault,
  previous: ComposedStudySession,
  useAccount: boolean,
): Promise<ComposedStudySession | null> {
  const courseOrTopic =
    previous.dominantCourse === undefined
      ? undefined
      : ({ kind: 'course', label: previous.dominantCourse } as const);
  const result = await composeStudySessionForRequest(
    composeDeps(vault),
    {
      budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES,
      ...(courseOrTopic !== undefined ? { courseOrTopic } : {}),
    },
    NOW,
  );
  if (result === null) return null;

  const widerBudgetMinutes = previous.model.budgetMinutes + DEFAULT_SESSION_BUDGET_MINUTES;
  if (!useAccount) {
    // The shape `extendDefaultStudySession` used BEFORE this bead's splice: a plain item-list
    // extend, spread onto `previous` — `setAside` travels by reference, unchanged.
    const { extendComposedStudySession } = await import('olea-core');
    const items = extendComposedStudySession(
      { ...result.composedInput, budgetMinutes: widerBudgetMinutes },
      previous,
    );
    return { ...previous, model: { ...previous.model, budgetMinutes: widerBudgetMinutes, items } };
  }
  const extended = extendComposedStudySessionWithAccount(
    { ...result.composedInput, budgetMinutes: widerBudgetMinutes },
    previous,
  );
  return { ...extended, model: { ...extended.model, budgetMinutes: widerBudgetMinutes } };
}

function recorder(vault: MemoryVault) {
  let n = 0;
  return createCompositionRecorder({
    vault,
    deviceId: DEVICE,
    mintCompositionId: () => `composition-key1:test-${++n}`,
  });
}

describe("ol-egov.141.89.10.65: extendDefaultStudySession's splice, fed through the real composition recorder", () => {
  it('a list-changing keep going, reproduced as main.ts now builds it, succeeds and appends its own extension record', async () => {
    const vault = manyConceptVault(100);
    const session0 = await composeInitial(vault);
    const writer = recorder(vault);
    const started = await writer.recordStart(session0, NOW);
    if (started.status !== 'recorded')
      throw new Error(`expected a start record, got ${started.status}`);

    const extended = await simulateExtend(vault, started.session, true);
    if (extended === null) throw new Error('expected the extend to widen the session');
    expect(extended.model.items.length).toBeGreaterThan(started.session.model.items.length);
    // The property `recordExtension` actually reads: a genuinely NEW `setAside` object, not the
    // parent's own by reference — this is what the pre-splice plain spread never produced.
    expect(extended.setAside).not.toBe(started.session.setAside);

    const grown = await writer.recordExtension(started.session, extended, LATER);
    expect(grown.status).toBe('recorded');
    if (grown.status !== 'recorded') throw new Error('unreachable');
    expect(grown.record).toMatchObject({
      kind: 'extend',
      sessionId: started.record.sessionId,
      parentCompositionId: started.record.compositionId,
    });
    expect(grown.session.compositionRecord).toEqual(grown.record);
  });

  it('the SAME extension, reproduced as main.ts built it BEFORE this splice, still widens the session but writes no extension record (the defect this bead fixes)', async () => {
    const vault = manyConceptVault(100);
    const session0 = await composeInitial(vault);
    const writer = recorder(vault);
    const started = await writer.recordStart(session0, NOW);
    if (started.status !== 'recorded')
      throw new Error(`expected a start record, got ${started.status}`);

    const extendedPreSplice = await simulateExtend(vault, started.session, false);
    if (extendedPreSplice === null) throw new Error('expected the extend to widen the session');
    expect(extendedPreSplice.model.items.length).toBeGreaterThan(
      started.session.model.items.length,
    );
    // The parent's own `setAside` object, carried by reference — the exact condition
    // `recordExtension` reads as `'account-not-carried'`.
    expect(extendedPreSplice.setAside).toBe(started.session.setAside);

    const grown = await writer.recordExtension(started.session, extendedPreSplice, LATER);
    expect(grown).toMatchObject({ status: 'not-recorded', reason: 'account-not-carried' });
  });
});
