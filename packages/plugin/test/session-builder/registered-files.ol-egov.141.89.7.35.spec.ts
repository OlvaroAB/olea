/**
 * `ol-egov.141.89.7.35` — the session builder's assembly forwards her registered documents to the
 * ranking (F1.5, F4.2). Written and run failing first.
 *
 * The same two things `plan/registered-files.ol-egov.141.89.7.35.spec.ts` pins for the plan, at
 * `composeStudySessionForRequest` (the one place a plugin assembles the composer's input): the
 * input is exactly `projectRegisteredFiles` over the log it already read, and the effect is that
 * the same vault, differing only by the "source registered" event, considers the concept for
 * today's sitting when a past-paper PDF names it and does not when the PDF is not registered.
 *
 * The session's own admission option (`serveCoursesWithoutAssessmentsOnNeed`) is untouched: a
 * course with assessment records but no evidence is still not served on need alone; what changes
 * is that the registered paper is now evidence.
 */
import { composeOracleRanking, createFsrsScheduler } from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import {
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

async function composeFor(registered: boolean) {
  const result = await composeStudySessionForRequest(
    {
      vault: await pastPaperPdfVault({ registered }),
      deviceId: DEVICE,
      settingsHost: new FakeSettingsHost(),
      now: () => NOW,
      scheduler: createFsrsScheduler(),
    },
    { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
    NOW,
  );
  if (result === null) throw new Error('expected the study plan to be configured');
  return result;
}

describe('composeStudySessionForRequest — forwards registered documents to the ranking (ol-egov.141.89.7.35)', () => {
  beforeEach(() => {
    vi.mocked(composeOracleRanking).mockClear();
  });

  it('passes registeredFiles from the "source registered" events in her log', async () => {
    await composeFor(true);

    expect(composeOracleRanking).toHaveBeenCalledTimes(1);
    const input = vi.mocked(composeOracleRanking).mock.calls[0]?.[0];
    expect(input?.registeredFiles).toEqual([
      { path: PAST_PAPER_PDF, role: 'past-paper', course: COURSE },
    ]);
    // The session's own admission option is unchanged by this bead.
    expect(input?.serveCoursesWithoutAssessmentsOnNeed).toBe(true);
  });

  it('passes an empty registeredFiles when nothing is registered', async () => {
    await composeFor(false);

    const input = vi.mocked(composeOracleRanking).mock.calls[0]?.[0];
    expect(input?.registeredFiles).toEqual([]);
  });

  it("a registered past-paper PDF puts its concept among today's candidates; the same vault unregistered has none", async () => {
    const without = await composeFor(false);
    expect(without.frozenScope.concepts).toEqual([]);

    const withEvent = await composeFor(true);
    expect(withEvent.frozenScope.concepts).toHaveLength(1);
    expect(withEvent.frozenScope.assessments.map((a) => a.path)).toEqual([
      '02 Assignments/Quiz 1.md',
    ]);
  });
});
