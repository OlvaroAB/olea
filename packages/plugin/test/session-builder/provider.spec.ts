/**
 * `createLocalSessionBuilderProvider` tests (RANK-3, `ol-v7r5.4`).
 *
 * Every fixture string here is INVENTED — course codes, concept names,
 * question text — per INV-3; nothing below is drawn from a real vault. The
 * base fixture is `test/gap/provider.spec.ts`'s own, since both compose over
 * `composeOracleRanking` and this suite is not re-testing that module's own
 * acceptance criteria (`packages/core/src/oracle/compose.spec.ts` already
 * covers the retrievability arithmetic itself).
 *
 * What this suite tests is the WIRING RANK-3 adds: that `provider.ts` now
 * passes `{ scheduler: deps.scheduler, now }` into `composeOracleRanking`
 * rather than omitting the field, and that the effect reaches all the way to
 * the composed session's `StudySessionItem.gapScore` (`priorityScore ×
 * readiness.weight`, `gap/build.ts`) — not merely that `compose.ts`'s own
 * blend arithmetic is correct, which is already covered elsewhere.
 *
 * The isolation trick: two providers share the same vault, review log and
 * `now`, and differ ONLY in what their `Scheduler.retrievability()` reports
 * for the one instrument in play. `Scheduler.schedule()` is identical between
 * them, so SESS-2's obligation classifier and the FSRS due-state it reads are
 * unaffected — the only channel that can make the two providers disagree is
 * the retrievability thread this bead adds. A recall reading of exactly `1`
 * is the numeric twin of the neutral default `RankOracleInput.retrievability`
 * documents for an omitted field (`resolveRetrievabilityWeight`, `rank.ts`),
 * so comparing against it stands in for "the neutral-default ranking" without
 * this suite having to reconstruct the pre-bead call itself.
 */
import type { ReviewLogRecord } from 'olea-contracts';
import type { Scheduler, SchedulerState } from 'olea-core';
import { enumerateVaultInstruments, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createLocalSessionBuilderProvider } from '../../src/session-builder/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = new Date('2026-08-10T09:00:00-04:00');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function hostWithBasePath(basePath: string): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: basePath },
  };
  return host;
}

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

const QUIZ =
  '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n';

/** `test/gap/provider.spec.ts`'s own fixture: one course, one cited concept, one note carrying both the topic binding and a real (recall-tier) instrument. */
const BASE_FILES: Readonly<Record<string, string>> = {
  '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
  'Notes/one.md': [
    '---',
    'topic: [Widget theory]',
    'course: TESTC101',
    '---',
    '',
    'Front::Back',
    '',
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
    'Explain the core mechanism behind Widget theory and why it matters.',
    '',
  ].join('\n'),
  [BASE_PATH]: BASE_FILE,
  '02 Assignments/Quiz 1.md': QUIZ,
};

/**
 * A `Scheduler` whose recall probability is fixed per instrument id, same
 * technique `oracle/compose.spec.ts`'s own `stubScheduler` uses — `schedule`
 * returns a real-shaped state (SESS-2's replay, and `readAllConceptVitality`
 * internally, both need something to fold) and is IDENTICAL across every
 * scheduler this suite builds, so `schedule`-derived state (due day,
 * obligation class) can never be the thing that differs between two runs.
 */
function stubScheduler(byInstrument: Readonly<Record<string, number>>): Scheduler {
  return {
    schedule({ instrumentId, now }) {
      const state: SchedulerState = {
        schemaVersion: 1,
        due: now.toISOString(),
        stability: 1,
        difficulty: 5,
        scheduledDays: 1,
        learningStepIndex: 0,
        reps: 1,
        lapses: 0,
        learningState: 'review',
        lastReview: now.toISOString(),
      };
      return { instrumentId, state, intervalDays: 1 };
    },
    retrievability({ instrumentId }) {
      const recallProbability = byInstrument[instrumentId];
      if (recallProbability === undefined) {
        throw new Error(
          `stubScheduler: retrievability queried for ${instrumentId} with no recall-tier review — should never happen with an empty review log`,
        );
      }
      return { instrumentId, recallProbability };
    },
  };
}

function reviewRecord(
  conceptId: string,
  instrumentId: string,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-08-05T09:00:00-04:00',
    instrumentId,
    instrumentType: 'qa',
    conceptIds: [conceptId],
    rating: 'again',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

/**
 * The real `(conceptKey, instrumentId)` pair `session/enumerate.ts` would
 * mint for `Notes/one.md`'s card — resolved by actually walking the base
 * fixture once, rather than hand-guessing the opaque id format (`ol-63e1`).
 */
async function widgetIdentity(): Promise<{ conceptKey: string; instrumentId: string }> {
  const enumeration = await enumerateVaultInstruments(memoryVault(BASE_FILES));
  const record = enumeration.records.find((r) => r.notePath === 'Notes/one.md');
  if (record === undefined) throw new Error('expected an instrument on Notes/one.md');
  const [conceptKey] = record.conceptIds;
  if (conceptKey === undefined) throw new Error('expected the instrument to be concept-bound');
  return { conceptKey, instrumentId: record.instrumentId };
}

function vaultWithReviewLog(reviewLog: readonly ReviewLogRecord[]) {
  const logPath = reviewLogPath('2026-08-05', DEVICE);
  return memoryVault({
    ...BASE_FILES,
    ...(reviewLog.length > 0
      ? { [logPath]: reviewLog.map((r) => JSON.stringify(r)).join('\n') }
      : {}),
  });
}

function findWidgetItem(model: { items: readonly { conceptName: string; gapScore: number }[] }) {
  const item = model.items.find((i) => i.conceptName === 'Widget theory');
  if (item === undefined) throw new Error('expected "Widget theory" in the composed session');
  return item;
}

describe('createLocalSessionBuilderProvider — retrievability threading (RANK-3, ol-v7r5.4)', () => {
  it('with recall-tier review history, a degraded recall reading changes the composed gapScore from the neutral (recall = 1) reading', async () => {
    const { conceptKey, instrumentId } = await widgetIdentity();
    const vault = vaultWithReviewLog([reviewRecord(conceptKey, instrumentId)]);

    const neutralProvider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      // Recall = 1 is the numeric twin of `RankOracleInput.retrievability`'s
      // documented neutral default for an omitted field — see module doc.
      scheduler: stubScheduler({ [instrumentId]: 1 }),
    });
    const degradedProvider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({ [instrumentId]: 0.3 }),
    });

    const [neutralState, degradedState] = await Promise.all([
      neutralProvider.load({ budgetMinutes: 60 }),
      degradedProvider.load({ budgetMinutes: 60 }),
    ]);
    if (neutralState.kind !== 'model') throw new Error('expected a model (neutral)');
    if (degradedState.kind !== 'model') throw new Error('expected a model (degraded)');

    const neutralItem = findWidgetItem(neutralState.model);
    const degradedItem = findWidgetItem(degradedState.model);

    // The ONLY thing that differs between the two providers is what
    // `Scheduler.retrievability()` reports for this instrument —
    // `schedule()` (and therefore SESS-2's obligation class and due state)
    // is byte-identical across both. So a difference here can only be the
    // retrievability thread this bead adds reaching the composed session.
    expect(degradedItem.gapScore).not.toBe(neutralItem.gapScore);
  });

  it('without review history for the concept, the composed gapScore is identical no matter what the scheduler would report — the fresh-install case is unchanged', async () => {
    const { instrumentId } = await widgetIdentity();
    const vault = vaultWithReviewLog([]); // no review-log file at all

    // `stubScheduler({})` throws if `retrievability()` is ever queried — a
    // concept with no recall-tier instrument read is left OUT of the map
    // entirely (`oracle/compose.ts`'s `resolveRetrievabilityScores`), so a
    // scheduler that would report something wildly different if asked must
    // never actually be asked, and the two runs must agree regardless.
    const providerA = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({}),
    });
    const providerB = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({ [instrumentId]: 0.05 }),
    });

    const [stateA, stateB] = await Promise.all([
      providerA.load({ budgetMinutes: 60 }),
      providerB.load({ budgetMinutes: 60 }),
    ]);
    if (stateA.kind !== 'model') throw new Error('expected a model (A)');
    if (stateB.kind !== 'model') throw new Error('expected a model (B)');

    const itemA = findWidgetItem(stateA.model);
    const itemB = findWidgetItem(stateB.model);
    expect(itemA.gapScore).toBe(itemB.gapScore);
  });
});
