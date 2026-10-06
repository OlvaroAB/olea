/**
 * The session's own reading of current evidence, against the gap view's (F4.3).
 *
 * - `[D-521]` (ruled 2026-10-06): the gap view scores each row relevance × need × credit (the
 *   attainment chain spec, section 2.5); the session keeps the ranking's additive blend (C5.10).
 *   `composeStudySessionForRequest` supplies its gap view no need, so its rows carry none and
 *   score the ranking's priority × credit. Pinned here so a later change that supplies need to the
 *   session (and so reorders it) is a visible, ruled change, never an accident.
 *
 * Every string here is invented (INV-3).
 */

import type { RetrievabilityInput, RetrievabilityOutput, Scheduler } from 'olea-core';
import { createFsrsScheduler, enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalGapProvider } from '../../src/gap/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
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

class FakeDataHost implements ObsidianDataHost {
  constructor(private blob: unknown = null) {}
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function settingsHost(): FakeDataHost {
  return new FakeDataHost({
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
  });
}

/** Retrievability fixed at one value; scheduling delegates to the real FSRS scheduler. */
function fixedRetrievabilityScheduler(recallProbability: number): Scheduler {
  const real = createFsrsScheduler();
  return {
    schedule: (input) => real.schedule(input),
    retrievability: (input: RetrievabilityInput): RetrievabilityOutput => ({
      instrumentId: input.instrumentId,
      recallProbability,
    }),
  };
}

/** One course, one concept cited by one past paper, her note with one card, reviewed unaided yesterday. */
async function reviewedCardWorld() {
  const vault = memoryVault({
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
    [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
  });
  const enumeration = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const card = enumeration.records[0];
  const conceptKey = card?.conceptIds[0];
  if (card === undefined || conceptKey === undefined) throw new Error('fixture has no bound card');
  await vault.write(
    '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
    `${JSON.stringify({
      schemaVersion: 5,
      kind: 'review',
      eventId: 'r1',
      timestamp: '2026-08-09T09:00:00-04:00',
      instrumentId: card.instrumentId,
      instrumentType: 'qa',
      conceptIds: [conceptKey],
      rating: 'good',
      supportLevelShown: 'independent',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
        planVersion: null,
      },
    })}\n`,
  );
  return { vault, instrumentId: card.instrumentId, conceptKey };
}

async function sessionRows(vault: ReturnType<typeof memoryVault>, scheduler: Scheduler) {
  const result = await composeStudySessionForRequest(
    {
      vault,
      deviceId: DEVICE,
      settingsHost: settingsHost(),
      now: () => NOW,
      scheduler,
    },
    { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
    NOW,
  );
  if (result === null) throw new Error('expected an assessment source');
  return result.composedInput.rows;
}

describe('the session reads current evidence its own way, and the same evidence as the gap view', () => {
  it('PIN ([D-521]): the session rows carry no need and score the ranking priority × credit, while the gap view scores relevance × need × credit', async () => {
    const { vault } = await reviewedCardWorld();
    const scheduler = fixedRetrievabilityScheduler(0.4);
    const [sessionRow] = await sessionRows(vault, scheduler);
    if (sessionRow === undefined) throw new Error('expected a session row');
    expect(sessionRow).not.toHaveProperty('need');
    expect(sessionRow.gapScore).toBeCloseTo(
      sessionRow.priorityScore * sessionRow.readiness.weight,
      12,
    );

    const state = await createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: settingsHost(),
      now: () => NOW,
      scheduler,
    }).load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const gapRow = course.rows.find((r) => r.conceptKey === sessionRow.conceptKey);
    if (gapRow?.need === undefined) throw new Error('expected the gap row to carry need');
    expect(gapRow.gapScore).toBeCloseTo(
      (gapRow.assessmentRelevance ?? Number.NaN) * gapRow.need.value * gapRow.readiness.weight,
      12,
    );
    // The same ranking underneath: one priority for one concept on both surfaces.
    expect(gapRow.priorityScore).toBeCloseTo(sessionRow.priorityScore, 12);
  });

  /**
   * `[D-371]`/`[D-338]` item 3 (`ol-egov.141.89.9.97`, F4.3): the session removes recognition credit
   * from defective instruments only, never importing the gap view's recall threshold. A correct quiz answer on an item later
   * suspended as defective earns no recognition credit; a suspension with no defect recorded
   * (`[D-347]` as ruled) keeps it. Only which recognition counts changes, never the formula.
   */
  describe('the session credits only current recognition on a standing item ([D-371], ol-egov.141.89.9.97)', () => {
    const QUIZ_ITEM = 'mcq:widget-theory:1';
    const logLine = (conceptKey: string, line: Record<string, unknown>) =>
      `${JSON.stringify({ conceptIds: [conceptKey], ...line })}\n`;
    const quizAnswer = (conceptKey: string) =>
      logLine(conceptKey, {
        schemaVersion: 5,
        kind: 'review',
        eventId: 'q1',
        timestamp: '2026-08-09T09:30:00-04:00',
        instrumentId: QUIZ_ITEM,
        instrumentType: 'mcq',
        rating: 'good',
        supportLevelShown: 'independent',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['mcq'],
          planVersion: null,
        },
      });
    const suspension = (conceptKey: string, reason: 'defect' | 'own-choice') =>
      logLine(conceptKey, {
        schemaVersion: 6,
        kind: 'suspend',
        eventId: 's-q1',
        timestamp: '2026-08-09T10:00:00-04:00',
        instrumentId: QUIZ_ITEM,
        reason,
      });

    async function rowAfter(
      extra: (conceptKey: string) => string,
      scheduler: Scheduler = fixedRetrievabilityScheduler(1),
    ) {
      const { vault, conceptKey } = await reviewedCardWorld();
      const path = '.olea/reviews/2026-08-09.olea-testdevice1.jsonl';
      const base = await vault.read(path);
      await vault.write(path, base + extra(conceptKey));
      const [row] = await sessionRows(vault, scheduler);
      if (row === undefined) throw new Error('expected a session row');
      return row;
    }

    it('control: a correct, current quiz answer on a standing item earns the credit', async () => {
      const row = await rowAfter(quizAnswer);
      expect(row.readiness.applied).toBe(true);
    });

    it('REGRESSION (fails pre-fix): an answer on an item later suspended as defective earns no credit', async () => {
      const row = await rowAfter((key) => quizAnswer(key) + suspension(key, 'defect'));
      expect(row.readiness.applied).toBe(false);
      expect(row.readiness.weight).toBe(1);
    });

    it('PIN ([D-371], ruled 2026-10-06): a correct answer below the retention target still earns the credit; only defective instruments lose it', async () => {
      // Recall estimate 0.4, under the retention target: the gap view would not count this answer
      // as current, but importing that threshold is a separate scheduling-policy change.
      const row = await rowAfter(quizAnswer, fixedRetrievabilityScheduler(0.4));
      expect(row.readiness.applied).toBe(true);
      expect(row.readiness.weight).toBeLessThan(1);
    });

    it('PIN ([D-347] as ruled): her own-choice suspension keeps the sound answer counting', async () => {
      const row = await rowAfter((key) => quizAnswer(key) + suspension(key, 'own-choice'));
      expect(row.readiness.applied).toBe(true);
    });
  });
});
