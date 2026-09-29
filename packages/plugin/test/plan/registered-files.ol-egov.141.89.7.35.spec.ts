/**
 * `ol-egov.141.89.7.35` — the study-plan provider forwards her registered documents to the
 * ranking (F1.5, F4.2).
 *
 * Before this bead `createLocalStudyPlanProvider` called `composeOracleRanking` without
 * `registeredFiles`, so a past-paper PDF she registered reached the grove and never a ranking
 * evidence edge: with the shipped call shape she had zero past-paper edges whatever she
 * registered. Written and run failing first.
 *
 * Two things pinned, both directly at the provider:
 * - the input: `registeredFiles` is exactly `projectRegisteredFiles` over the log the provider
 *   already read (the grove's own source, never a second one); and
 * - the effect: the same vault, differing only by the "source registered" event, plans the course
 *   on the PDF past paper's question when registered and does not when not.
 *
 * The D-450 opt-in (`admitPractisedUnlinkedConcepts`) is deliberately NOT touched here: the plan
 * still cannot pass it (`practised-unlinked-agreement.d-447.spec.ts` holds that line).
 */
import { studyPlanEnvelope } from 'olea-contracts';
import { composeOracleRanking } from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import {
  CONCEPT,
  COURSE,
  DEVICE,
  FakeSettingsHost,
  NOW,
  PAST_PAPER_PDF,
  pastPaperPdfVault,
} from '../oracle/registered-past-paper-fixture.js';

vi.mock('olea-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('olea-core')>();
  return { ...actual, composeOracleRanking: vi.fn(actual.composeOracleRanking) };
});

async function fetchPlanFor(registered: boolean) {
  const provider = createLocalStudyPlanProvider({
    vault: await pastPaperPdfVault({ registered }),
    deviceId: DEVICE,
    settingsHost: new FakeSettingsHost(),
    now: () => NOW,
  });
  return studyPlanEnvelope.parse(await provider.fetchPlan());
}

describe('createLocalStudyPlanProvider — forwards registered documents to the ranking (ol-egov.141.89.7.35)', () => {
  beforeEach(() => {
    vi.mocked(composeOracleRanking).mockClear();
  });

  it('passes registeredFiles from the "source registered" events in her log', async () => {
    await fetchPlanFor(true);

    expect(composeOracleRanking).toHaveBeenCalledTimes(1);
    const input = vi.mocked(composeOracleRanking).mock.calls[0]?.[0];
    expect(input?.registeredFiles).toEqual([
      { path: PAST_PAPER_PDF, role: 'past-paper', course: COURSE },
    ]);
  });

  it('passes an empty registeredFiles when nothing is registered, never an omitted or invented one', async () => {
    await fetchPlanFor(false);

    const input = vi.mocked(composeOracleRanking).mock.calls[0]?.[0];
    expect(input?.registeredFiles).toEqual([]);
  });

  it('a registered past-paper PDF ranks its concept, cited to the paper and its question; the same vault unregistered ranks nothing', async () => {
    const withoutEvent = await fetchPlanFor(false);
    const withoutCourse = withoutEvent.body.courses.find((c) => c.course === COURSE);
    // No registered source of any kind: nothing evidences the concept, so the course is not ranked.
    expect(withoutCourse?.status).not.toBe('ranked');

    const withEvent = await fetchPlanFor(true);
    const course = withEvent.body.courses.find((c) => c.course === COURSE);
    if (course?.status !== 'ranked') throw new Error('expected the registered course to rank');
    // `conceptId` is the concept's opaque key (D-357), so the concept is found by what the reason says.
    expect(course.concepts).toHaveLength(1);
    const concept = course.concepts[0];
    expect(concept?.reasoning).toContain(`${CONCEPT} (${COURSE})`);
    expect(concept?.citations).toEqual([{ sourcePath: PAST_PAPER_PDF, questionLabel: '1' }]);
    // The approved history sentence (row 33), never a claim about the assessment ahead.
    expect(concept?.reasoning).toContain('It appears in past papers.');
  });
});
