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
import type { Scheduler, SchedulerState, StudySessionModel } from 'olea-core';
import { enumerateVaultInstruments, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import {
  createLocalSessionBuilderProvider,
  reentryCandidateBudgetMinutes,
} from '../../src/session-builder/provider.js';
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

/** Full-shape lookup — `findWidgetItem` above narrows to `{ conceptName, gapScore }` for RANK-3's own suite, so `.supportLevel` needs its own finder rather than widening a helper other tests already rely on. */
function widgetSessionItem(model: StudySessionModel) {
  const item = model.items.find((i) => i.conceptName === 'Widget theory');
  if (item === undefined) throw new Error('expected "Widget theory" in the composed session');
  return item;
}

// [SUPP-3] (`ol-lpl4`): row 3.9's chooser now reaches this F4.6 preview
// session too — `provider.ts` builds a `SupportLevelHistoryLookup` from the
// same `entries` it already reads for the mastery join and SESS-2's replay,
// and passes it to `buildComposedStudySession`, which was already forwarding
// `supportHistory` straight through to `buildStudySession` since [SUPP-2]
// (`ol-95vv.4`) — this suite is the first production caller to actually
// supply it.
describe('createLocalSessionBuilderProvider — row 3.9’s chooser reaches the composed session (ol-lpl4)', () => {
  it('an "again" recall-tier review for the concept raises the offered level off the [D-094] cold start', async () => {
    const { conceptKey, instrumentId } = await widgetIdentity();
    const vault = vaultWithReviewLog([reviewRecord(conceptKey, instrumentId)]);

    const provider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({ [instrumentId]: 1 }),
    });

    const state = await provider.load({ budgetMinutes: 60 });
    if (state.kind !== 'model') throw new Error('expected a model');
    const item = widgetSessionItem(state.model);
    expect(item.supportLevel).toEqual({ level: 'guided', provenance: 'evidence-thin' });
  });

  it('with no review history at all, the [D-094] cold start ("prompted") is still offered, never a fabricated "independent"', async () => {
    const vault = vaultWithReviewLog([]);

    const provider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({}),
    });

    const state = await provider.load({ budgetMinutes: 60 });
    if (state.kind !== 'model') throw new Error('expected a model');
    const item = widgetSessionItem(state.model);
    expect(item.supportLevel).toEqual({ level: 'prompted', provenance: 'evidence-thin' });
  });
});

// F2.19 (`ol-v7r5.11`): `resolveAssessmentGroupingContext` is now wired
// unconditionally into `provider.ts`'s `load()` — this suite proves it reaches
// a REAL composed session over a REAL vault (frontmatter, not a hand-built
// map), the same standard RANK-3's suite above holds for retrievability. Two
// concepts, both never reviewed (so both are `unmet`, tied at `overdueDays: 0`
// — `memoryVault` has no `firstSeen`, so ARRIVE-2's map is empty and both fall
// back to the same conservative 0), both cited by the same past paper for the
// same course's only assessment (so both target it, F4.2/F4.7). The ONLY
// difference between the two fixtures below is a `scope:` frontmatter line on
// the assessment note itself — never a hand-built `assessmentContext` map.
const TWO_CONCEPT_PAST_PAPER = [
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
  '## Question 2 (10 marks)',
  '',
  'Explain the core mechanism behind Gadget theory and why it matters.',
  '',
].join('\n');

function twoConceptBaseFiles(quizContent: string): Readonly<Record<string, string>> {
  return {
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
    'Notes/one.md': [
      '---',
      'topic: [Widget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/two.md': [
      '---',
      'topic: [Gadget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front2::Back2',
      '',
    ].join('\n'),
    '03 Research/TESTC101 Past Paper 2023.md': TWO_CONCEPT_PAST_PAPER,
    [BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md': quizContent,
  };
}

const QUIZ_NO_SCOPE =
  '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n';
const QUIZ_SCOPED_TO_WIDGET =
  '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\nscope: Widget theory\n---\n\n# Quiz 1\n';

function conceptNamesOf(model: StudySessionModel): readonly string[] {
  return model.items.map((item) => item.conceptName);
}

describe('createLocalSessionBuilderProvider — F2.19 assessment-scope resolver reaches a real composed session, from real frontmatter (ol-v7r5.11)', () => {
  it("baseline: with no stated scope on the assessment note, two never-reviewed, comparably-due concepts targeting the same assessment settle by overdue-first's own tiebreak", async () => {
    const provider = createLocalSessionBuilderProvider({
      vault: memoryVault(twoConceptBaseFiles(QUIZ_NO_SCOPE)),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({}),
    });

    const state = await provider.load({ budgetMinutes: 60 });
    if (state.kind !== 'model') throw new Error('expected a model');
    const names = conceptNamesOf(state.model);
    expect(names).toContain('Widget theory');
    expect(names).toContain('Gadget theory');
  });

  it('a real "scope:" frontmatter property on the assessment note — read through assessment/read.ts, resolved to a conceptKey by resolveAssessmentGroupingContext, never a hand-built map — moves the concept it names ahead of its (otherwise comparably-due) peer', async () => {
    const baseline = await createLocalSessionBuilderProvider({
      vault: memoryVault(twoConceptBaseFiles(QUIZ_NO_SCOPE)),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({}),
    }).load({ budgetMinutes: 60 });
    const scoped = await createLocalSessionBuilderProvider({
      vault: memoryVault(twoConceptBaseFiles(QUIZ_SCOPED_TO_WIDGET)),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({}),
    }).load({ budgetMinutes: 60 });
    if (baseline.kind !== 'model') throw new Error('expected a model (baseline)');
    if (scoped.kind !== 'model') throw new Error('expected a model (scoped)');

    // The ONLY input difference between the two runs is the `scope:` line on
    // the assessment note. If the resolver were not wired (or silently a
    // no-op, `study-session/compose.ts`'s own proven equivalence), the two
    // orders would be byte-identical. Widget theory — the concept the scope
    // names — must be ahead of Gadget theory once it is, regardless of which
    // way the tie originally fell.
    const baselineNames = conceptNamesOf(baseline.model);
    const scopedNames = conceptNamesOf(scoped.model);
    expect(scopedNames).not.toEqual(baselineNames);
    expect(scopedNames.indexOf('Widget theory')).toBeLessThan(scopedNames.indexOf('Gadget theory'));
  });
});

// F6.6 (`ol-v7r5.18`, discovered from `ol-blwb` / `[BKLG-1]`): `provider.ts`'s
// `load()` now composes through `composeReentrySession` rather than calling
// `buildComposedStudySession` directly — this suite is the production-caller
// proof that a genuine absence (a review logged long before `now`) actually
// reaches the branch, and that a recent one does not.
// RBLD-2 (`ol-e228`), component register row 3.6: `load()`'s rebuild
// controller. `retrievability` is queried once per in-play concept on every
// REAL composition, so counting its calls is a cheap, direct proxy for
// "did the whole oracle chain actually run again" — the same observable
// `provider.ts`'s own module doc names as the double-`load()` this wiring
// now avoids (`onOpen`'s `refresh()` immediately followed by
// `revealSessionBuilderView`'s `setFocusConcept` call on a brand-new leaf).
describe('createLocalSessionBuilderProvider — the freeze contract (RBLD-2, ol-e228)', () => {
  function countingScheduler(byInstrument: Readonly<Record<string, number>>): {
    scheduler: Scheduler;
    calls: () => number;
  } {
    const base = stubScheduler(byInstrument);
    let calls = 0;
    return {
      scheduler: {
        schedule: base.schedule,
        retrievability(input) {
          calls += 1;
          return base.retrievability(input);
        },
      },
      calls: () => calls,
    };
  }

  it('a second load() call with the same request, while the sitting is still open, reuses the frozen composition instead of recomputing', async () => {
    const { conceptKey, instrumentId } = await widgetIdentity();
    const vault = vaultWithReviewLog([reviewRecord(conceptKey, instrumentId)]);
    const { scheduler, calls } = countingScheduler({ [instrumentId]: 1 });

    const provider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler,
    });

    const first = await provider.load({ budgetMinutes: 60 });
    const callsAfterFirst = calls();
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Same request, no `endSitting()` in between — exactly the shape of the
    // real double-call this bead's own module doc names.
    const second = await provider.load({ budgetMinutes: 60 });

    expect(calls()).toBe(callsAfterFirst); // no second composition ran
    expect(second).toBe(first); // the identical frozen object, not a coincidentally-equal rebuild
  });

  it('a budget change — an explicit new ask — always rebuilds, even mid-sitting: the frozen-sitting contract does not apply to a request she changed herself', async () => {
    const { conceptKey, instrumentId } = await widgetIdentity();
    const vault = vaultWithReviewLog([reviewRecord(conceptKey, instrumentId)]);
    const { scheduler, calls } = countingScheduler({ [instrumentId]: 1 });

    const provider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler,
    });

    const first = await provider.load({ budgetMinutes: 20 });
    const callsAfterFirst = calls();
    const second = await provider.load({ budgetMinutes: 45 });

    expect(calls()).toBeGreaterThan(callsAfterFirst);
    expect(second).not.toBe(first);
  });

  it('endSitting() releases the freeze: the next load() with the same request rebuilds rather than reusing what was frozen', async () => {
    const { conceptKey, instrumentId } = await widgetIdentity();
    const vault = vaultWithReviewLog([reviewRecord(conceptKey, instrumentId)]);
    const { scheduler, calls } = countingScheduler({ [instrumentId]: 1 });

    const provider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler,
    });
    if (provider.endSitting === undefined) throw new Error('expected endSitting to be wired');

    const first = await provider.load({ budgetMinutes: 60 });
    const callsAfterFirst = calls();
    provider.endSitting();
    const second = await provider.load({ budgetMinutes: 60 });

    expect(calls()).toBeGreaterThan(callsAfterFirst);
    expect(second).not.toBe(first);
  });

  it('the hold cap: past an hour into the same sitting, an otherwise-identical request rebuilds rather than holding indefinitely — [D-162] is proposed, not ruled, so this is treated as ending the sitting, the lower-risk option, until it is', async () => {
    const { conceptKey, instrumentId } = await widgetIdentity();
    const vault = vaultWithReviewLog([reviewRecord(conceptKey, instrumentId)]);
    const { scheduler, calls } = countingScheduler({ [instrumentId]: 1 });
    let now = NOW;

    const provider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => now,
      scheduler,
    });

    const first = await provider.load({ budgetMinutes: 60 });
    const callsAfterFirst = calls();

    // 61 minutes later, same request — still well within a plausible single
    // open tab, but past `DEFAULT_SESSION_HOLD_CAP_MINUTES`.
    now = new Date(NOW.getTime() + 61 * 60_000);
    const second = await provider.load({ budgetMinutes: 60 });

    expect(calls()).toBeGreaterThan(callsAfterFirst);
    expect(second).not.toBe(first);
  });
});

describe('createLocalSessionBuilderProvider — F6.6 re-entry composition wiring (ol-v7r5.18)', () => {
  it('a review logged three weeks before "now" produces a reentry state, never a plain model', async () => {
    const { conceptKey, instrumentId } = await widgetIdentity();
    const vault = vaultWithReviewLog([
      reviewRecord(conceptKey, instrumentId, { timestamp: '2026-07-20T09:00:00-04:00' }),
    ]);

    const provider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW, // 2026-08-10 — 21 days after the review above
      scheduler: stubScheduler({ [instrumentId]: 1 }),
    });

    const state = await provider.load({ budgetMinutes: 60 });
    expect(state.kind).toBe('reentry');
    if (state.kind !== 'reentry') throw new Error('expected a reentry state');

    // F6.6's own structural guarantee: a re-entry view cannot carry the two
    // counts the clause forbids, regardless of what the underlying model held.
    expect('leftOutInstrumentCount' in state.view).toBe(false);
    expect('consideredRowCount' in state.view).toBe(false);

    // The candidate budget this file offers is half the ordinary request
    // (reentryCandidateBudgetMinutes), well above the size floor at 60
    // minutes — so the composed session's own budget should reflect that
    // shrink rather than the ordinary 60.
    expect(state.view.budgetMinutes).toBe(reentryCandidateBudgetMinutes(60));
    expect(state.view.budgetMinutes).toBeLessThan(60);
    expect(findWidgetItem(state.view).conceptName).toBe('Widget theory');
  });

  it('a review logged two days before "now" stays an ordinary model — an ordinary gap is not an absence', async () => {
    const { conceptKey, instrumentId } = await widgetIdentity();
    const vault = vaultWithReviewLog([
      reviewRecord(conceptKey, instrumentId, { timestamp: '2026-08-08T09:00:00-04:00' }),
    ]);

    const provider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({ [instrumentId]: 1 }),
    });

    const state = await provider.load({ budgetMinutes: 60 });
    expect(state.kind).toBe('model');
    if (state.kind !== 'model') throw new Error('expected an ordinary model');
    expect(state.model.budgetMinutes).toBe(60);
  });

  it('no review history at all stays an ordinary model — never reviewed is not "returning after an absence"', async () => {
    const vault = vaultWithReviewLog([]);

    const provider = createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({}),
    });

    const state = await provider.load({ budgetMinutes: 60 });
    expect(state.kind).toBe('model');
  });
});

// F4.6 / STEER-2 (`ol-ijms`): the "course or topic" steering input's plugin
// wiring. `study-session/compose.ts`'s own suite already proves the engine
// arithmetic (courses/conceptIds narrow the ranking, AND semantics, undefined
// means no restriction — [STEER-1], `ol-imqy`); what this suite proves is
// that `provider.ts` (a) always offers a real, whole-vault course/topic
// option list regardless of the request, (b) resolves a chosen option back
// into the exact filter the engine expects, over a REAL two-concept vault
// (`twoConceptBaseFiles`, defined above for the F2.19 suite) rather than a
// hand-built map, and (c) never silently drops a stale choice.
/** `createLocalSessionBuilderProvider` always sets this on a buildable state (see `provider.ts`'s own `buildFresh`); this narrows the type the same way `SessionBuilderState`'s doc says a caller like the workbench's, which never sets it, may not. */
function optionsOf(state: {
  readonly courseOrTopicOptions?: readonly { kind: 'course' | 'topic'; label: string }[];
}) {
  if (state.courseOrTopicOptions === undefined) {
    throw new Error('expected courseOrTopicOptions to be set by createLocalSessionBuilderProvider');
  }
  return state.courseOrTopicOptions;
}

describe('createLocalSessionBuilderProvider — F4.6/STEER-2 course-or-topic wiring (ol-ijms)', () => {
  function provider() {
    return createLocalSessionBuilderProvider({
      vault: memoryVault(twoConceptBaseFiles(QUIZ_NO_SCOPE)),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
      scheduler: stubScheduler({}),
    });
  }

  it('offers every course and every topic the vault has, regardless of whether a filter is applied', async () => {
    const state = await provider().load({ budgetMinutes: 60 });
    if (state.kind !== 'model') throw new Error('expected a model');
    expect(state.courseOrTopicOptions).toEqual(
      expect.arrayContaining([
        { kind: 'course', label: 'TESTC101' },
        { kind: 'topic', label: 'Widget theory' },
        { kind: 'topic', label: 'Gadget theory' },
      ]),
    );
  });

  it('a topic choice narrows the composed session to that one concept', async () => {
    const p = provider();
    const first = await p.load({ budgetMinutes: 60 });
    if (first.kind !== 'model') throw new Error('expected a model');
    const gadget = optionsOf(first).find((o) => o.kind === 'topic' && o.label === 'Gadget theory');
    if (gadget === undefined) throw new Error('expected a "Gadget theory" topic option');

    // A different, unfrozen sitting — `endSitting()` between calls, same as
    // a real "she closed the leaf and reopened it" boundary, so this reads
    // as a fresh composition rather than the RBLD-2 freeze reusing the first.
    p.endSitting?.();
    const filtered = await p.load({ budgetMinutes: 60, courseOrTopic: gadget });
    if (filtered.kind !== 'model') throw new Error('expected a model');

    const names = conceptNamesOf(filtered.model);
    expect(names).toEqual(['Gadget theory']);
  });

  it('a course choice matching the only course present leaves both its concepts in — a real filter, not an accidental exclusion', async () => {
    const p = provider();
    const first = await p.load({ budgetMinutes: 60 });
    if (first.kind !== 'model') throw new Error('expected a model');
    const course = optionsOf(first).find((o) => o.kind === 'course' && o.label === 'TESTC101');
    if (course === undefined) throw new Error('expected a "TESTC101" course option');

    p.endSitting?.();
    const filtered = await p.load({ budgetMinutes: 60, courseOrTopic: course });
    if (filtered.kind !== 'model') throw new Error('expected a model');

    const names = conceptNamesOf(filtered.model);
    expect(names).toContain('Widget theory');
    expect(names).toContain('Gadget theory');
  });

  it('a choice naming a course or topic the vault no longer has resolves to no restriction, never an emptied session', async () => {
    const p = provider();
    const stale = await p.load({
      budgetMinutes: 60,
      courseOrTopic: { kind: 'topic', label: 'A concept that does not exist' },
    });
    if (stale.kind !== 'model') throw new Error('expected a model');

    const names = conceptNamesOf(stale.model);
    expect(names).toContain('Widget theory');
    expect(names).toContain('Gadget theory');
    // And the stale label is not among the options offered back — this is
    // the signal `./copy.ts`'s `courseOrTopicNotFoundLine` reads to tell her
    // the choice could not be honoured, rather than silently dropping it.
    expect(stale.courseOrTopicOptions).not.toEqual(
      expect.arrayContaining([{ kind: 'topic', label: 'A concept that does not exist' }]),
    );
  });

  it('the freeze contract (RBLD-2) treats a course-or-topic change as an explicit new ask, same as a budget change', async () => {
    const p = provider();
    const first = await p.load({ budgetMinutes: 60 });
    if (first.kind !== 'model') throw new Error('expected a model');
    const gadget = optionsOf(first).find((o) => o.kind === 'topic' && o.label === 'Gadget theory');
    if (gadget === undefined) throw new Error('expected a "Gadget theory" topic option');

    // NO `endSitting()` here — the sitting from `first` is still open, so
    // this proves the freeze itself (not just a fresh leaf) treats the
    // steering change as a real new ask.
    const second = await p.load({ budgetMinutes: 60, courseOrTopic: gadget });
    expect(second).not.toBe(first);
    if (second.kind !== 'model') throw new Error('expected a model');
    expect(conceptNamesOf(second.model)).toEqual(['Gadget theory']);
  });
});
