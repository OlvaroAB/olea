/**
 * `[D-603]` (`ol-egov.141.89.6.129`): a practice explanation is graded by nothing. Submitting
 * sends no task request of any kind; a practice attempt writes no grade, correctness verdict,
 * misconception record or scheduling observation; and no reading of what she knows moves.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), the block "F5.2 / F5.3 / F5.4 /
 * [D-603], [D-611]", the three tagged `plugin/explain-back/practice-no-grading.spec`.
 *
 * The real `ExplainBackModal` renders into `./practice-view-harness.ts`'s stand-in (`obsidian`
 * mocked). The record tests wire the very writers the composition root wires
 * (`createRecordFeedbackShown`, `createRecordPracticeExplanation`) over an in-memory vault and read
 * her log back through `olea-core`, so what is checked is what lands. Coined ids only (INV-3).
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import {
  buildSupportLevelHistory,
  CONTENT_STORE_FOLDER,
  computeAllConceptMastery,
  createFsrsScheduler,
  projectInstrumentValidity,
  REVIEW_LOG_FOLDER,
  readAllConceptReadiness,
  readReviewLogHistory,
  reviewLogPath,
} from 'olea-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_SUBMIT_LABEL,
} from '../../src/explain-back/copy.js';
import { createRecordFeedbackShown } from '../../src/explain-back/feedback-exposure.js';
import { createRecordPracticeExplanation } from '../../src/explain-back/practice-record.js';
import { memoryVault } from '../review/memory-vault.js';
import {
  INSTRUMENT,
  introducingPassageFor,
  NEIGHBOUR_KEY,
  NOW,
  relationPartner,
  retrieveFor,
  SUBJECT_KEY,
  SUBJECT_PASSAGES,
  submit,
  type ViewInternals,
} from './practice-view-harness.js';

const requestUrl = vi.hoisted(() => vi.fn());
vi.mock('obsidian', async () => ({
  ...(await import('./practice-view-harness.js')).fakeObsidian(),
  requestUrl,
}));
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

// The first import of the view (and `olea-core` behind it) can outlast a test's own timeout on a
// loaded machine; it is made once, here, so each test times only its own work.
beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

const DEVICE = 'device-a';
type Deps = Record<string, unknown>;

async function openView(deps: Deps, seed: 'concept' | 'relation' = 'concept') {
  const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
  const ids = ['attempt-1', 'attempt-2', 'attempt-3'];
  let clock = NOW.getTime();
  const modal = new ExplainBackModal(
    {} as never,
    {
      retrieveSourceBlocks: retrieveFor,
      generateInstrumentId: () => ids.shift() ?? 'extra',
      now: () => {
        clock += 60_000;
        return new Date(clock);
      },
      ...(seed === 'relation'
        ? {
            resolveCausesPartner: (subject: string) =>
              subject === SUBJECT_KEY ? relationPartner() : undefined,
            resolveIntroducingPassage: introducingPassageFor,
          }
        : {}),
      ...deps,
    } as never,
    { kind: 'instrument', instrument: INSTRUMENT },
  ) as unknown as ViewInternals;
  modal.onOpen();
  await vi.waitFor(() => expect(modal.state.phase).toBe('answering'));
  return modal;
}

async function answer(modal: ViewInternals, text: string): Promise<void> {
  submit(modal.contentEl, text, EXPLAIN_BACK_SUBMIT_LABEL);
  await vi.waitFor(() => expect(modal.state.phase).toBe('passages'));
}

/** Answer, read the passages, "Try again", answer again, read them, "Done". */
async function practiseTwice(modal: ViewInternals): Promise<void> {
  await answer(modal, 'A first explanation.');
  modal.contentEl.button(EXPLAIN_BACK_DISCARD_LABEL).click();
  await answer(modal, 'A second explanation.');
  modal.contentEl.button(EXPLAIN_BACK_DONE_LABEL).click();
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    throw new Error('no network in this spec');
  });
  vi.stubGlobal('fetch', fetchSpy);
  requestUrl.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submit sends no task request of any kind', () => {
  it.each(['concept', 'relation'] as const)(
    'a %s prompt: answering, reading the passages, "Try again" and "Done" reach no route to the Worker',
    async (seed) => {
      const grade = vi.fn(async () => null);
      const acceptWithObservation = vi.fn(async () => null);
      const buildObservationContext = vi.fn();
      const recordSoloGradeAndReview = vi.fn(async () => undefined);
      const loadMisconceptionDigest = vi.fn(async () => []);
      const recordSetAsideAttempt = vi.fn(async () => {});
      const readLoggedAttemptState = vi.fn(async () => ({
        exposure: 'not-shown' as const,
        lastAttemptId: null,
      }));
      const retrieveSourceBlocks = vi.fn(retrieveFor);
      const resolveIntroducingPassage = vi.fn(introducingPassageFor);
      const practice = vi.fn(async () => ({ written: false as const, record: {} as never }));
      const modal = await openView(
        {
          grade,
          acceptWithObservation,
          buildObservationContext,
          recordSoloGradeAndReview,
          loadMisconceptionDigest,
          recordSetAsideAttempt,
          readLoggedAttemptState,
          retrieveSourceBlocks,
          recordFeedbackShown: vi.fn(async () => {}),
          recordPracticeExplanation: practice,
          ...(seed === 'relation' ? { resolveIntroducingPassage } : {}),
        },
        seed,
      );
      const lookupsAtOpen =
        retrieveSourceBlocks.mock.calls.length + resolveIntroducingPassage.mock.calls.length;

      await practiseTwice(modal);
      await vi.waitFor(() => expect(practice).toHaveBeenCalledTimes(2));

      // Not the correctness judge, not the depth pass, not the misconception resolution task
      // (which rides the accept step), and nothing else the graded path reached.
      expect(grade).not.toHaveBeenCalled();
      expect(recordSoloGradeAndReview).not.toHaveBeenCalled();
      expect(acceptWithObservation).not.toHaveBeenCalled();
      expect(buildObservationContext).not.toHaveBeenCalled();
      expect(loadMisconceptionDigest).not.toHaveBeenCalled();
      expect(recordSetAsideAttempt).not.toHaveBeenCalled();
      expect(readLoggedAttemptState).not.toHaveBeenCalled();
      // No lookup after she submits (the passages are already on her device), and no network.
      expect(
        retrieveSourceBlocks.mock.calls.length + resolveIntroducingPassage.mock.calls.length,
      ).toBe(lookupsAtOpen);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(requestUrl).not.toHaveBeenCalled();
    },
  );

  it('the spy is live: a call through the judge dependency would have been seen', async () => {
    const grade = vi.fn(async (_input: unknown) => null);
    await grade({});
    expect(grade).toHaveBeenCalledTimes(1);
  });
});

/** The writers production wires, over one in-memory vault. */
function realWriters(vault: ReturnType<typeof memoryVault>) {
  return {
    recordFeedbackShown: createRecordFeedbackShown({ vault, deviceId: async () => DEVICE }),
    recordPracticeExplanation: createRecordPracticeExplanation({
      vault,
      deviceId: async () => DEVICE,
      trigger: 'on-demand',
    }),
  };
}

async function practiseInto(vault: ReturnType<typeof memoryVault>): Promise<void> {
  const modal = await openView(realWriters(vault));
  await practiseTwice(modal);
  await vi.waitFor(async () => {
    const { entries } = await readReviewLogHistory(vault);
    expect(entries.filter((e) => e.kind === 'practice-explanation')).toHaveLength(2);
  });
}

describe('a practice attempt writes no grade, correctness, misconception or scheduling record', () => {
  it('her log holds the two markers and the two practice explanations, and nothing graded', async () => {
    const vault = memoryVault();
    await practiseInto(vault);
    const { entries } = await readReviewLogHistory(vault);

    expect(entries.map((e) => e.kind).sort()).toEqual([
      'explain-back-feedback-shown',
      'explain-back-feedback-shown',
      'practice-explanation',
      'practice-explanation',
    ]);
    const logText = JSON.stringify(entries);
    for (const key of [
      'explainBackGrade',
      'explainBackCorrectness',
      'schedulingObservation',
      'rating',
      'verdict',
    ]) {
      expect(logText).not.toContain(`"${key}"`);
    }
    // Her text went to the content store only, never onto the log.
    expect(logText).not.toContain('A first explanation.');
  });

  it('nothing is written outside her review log and the content store: no misconception record', async () => {
    const vault = memoryVault();
    await practiseInto(vault);
    expect(vault.writes.length).toBeGreaterThan(0);
    for (const path of vault.writes) {
      expect(
        path.startsWith(`${REVIEW_LOG_FOLDER}/`) || path.startsWith(`${CONTENT_STORE_FOLDER}/`),
      ).toBe(true);
    }
  });

  it('"Try again" kept the exposure: the second entry names the passages shown after the first', async () => {
    const vault = memoryVault();
    await practiseInto(vault);
    const { entries } = await readReviewLogHistory(vault);
    const practice = entries.filter(
      (e): e is Extract<ReviewLogEntry, { kind: 'practice-explanation' }> =>
        e.kind === 'practice-explanation',
    );
    const first = practice.find((e) => e.attemptId === 'attempt-1');
    const second = practice.find((e) => e.attemptId === 'attempt-2');
    expect(first?.supportLevelShown).toBe('independent');
    expect(second?.supportLevelShown).toBe('guided');
    expect(second?.passageFingerprints).toHaveLength(SUBJECT_PASSAGES.length);
  });
});

// ---------------------------------------------------------------------------
// No reading of what she knows moves
// ---------------------------------------------------------------------------

const CONCEPTS = [SUBJECT_KEY, NEIGHBOUR_KEY] as const;

function review(eventId: string, timestamp: string, overrides: Partial<ReviewLogRecord> = {}) {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId: `qa:${SUBJECT_KEY}:1`,
    instrumentType: 'qa',
    conceptIds: [SUBJECT_KEY],
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
    supportLevelShown: 'independent',
    ...overrides,
  } satisfies ReviewLogRecord;
}

const BASE_REVIEWS: readonly ReviewLogRecord[] = [
  review('r-1', '2026-10-01T09:00:00-04:00'),
  review('r-2', '2026-10-04T09:00:00-04:00'),
  review('r-3', '2026-10-09T09:00:00-04:00', { rating: 'easy' }),
  review('r-4', '2026-10-02T09:00:00-04:00', {
    instrumentId: `qa:${NEIGHBOUR_KEY}:1`,
    conceptIds: [NEIGHBOUR_KEY],
    rating: 'hard',
  }),
];

function vaultWith(reviews: readonly ReviewLogRecord[]) {
  const byDay = new Map<string, string[]>();
  for (const r of reviews) {
    const path = reviewLogPath(r.timestamp.slice(0, 10), DEVICE);
    byDay.set(path, [...(byDay.get(path) ?? []), JSON.stringify(r)]);
  }
  return memoryVault(
    Object.fromEntries([...byDay].map(([path, lines]) => [path, `${lines.join('\n')}\n`])),
  );
}

function readings(entries: readonly ReviewLogEntry[]) {
  const history = buildSupportLevelHistory(entries);
  return {
    stage: computeAllConceptMastery(entries, CONCEPTS),
    readiness: readAllConceptReadiness(
      entries,
      CONCEPTS,
      createFsrsScheduler(),
      NOW,
      projectInstrumentValidity(entries),
    ),
    support: CONCEPTS.flatMap((id) =>
      (['recall', 'explanation'] as const).map((tier) => history.outcomesFor(id, tier)),
    ),
  };
}

describe('a practice attempt moves no reading of what she knows', () => {
  it('the growth stage, readiness and support level are identical with and without the attempt', async () => {
    const without = vaultWith(BASE_REVIEWS);
    const withPractice = vaultWith(BASE_REVIEWS);
    await practiseInto(withPractice);

    const plain = (await readReviewLogHistory(without)).entries;
    const practised = (await readReviewLogHistory(withPractice)).entries;
    expect(practised.length).toBeGreaterThan(plain.length);
    expect(readings(practised)).toEqual(readings(plain));
  });

  it('the comparison can fail: one more graded recall on the concept moves the readings', async () => {
    const plain = (await readReviewLogHistory(vaultWith(BASE_REVIEWS))).entries;
    const moved = (
      await readReviewLogHistory(
        vaultWith([
          ...BASE_REVIEWS,
          review('r-5', '2026-10-12T09:00:00-04:00', { rating: 'again' }),
        ]),
      )
    ).entries;
    expect(readings(moved)).not.toEqual(readings(plain));
  });
});
