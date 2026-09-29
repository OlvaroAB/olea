/**
 * `ol-egov.141.89.7.35` — the gap-view provider forwards her registered documents to the ranking
 * (F1.5, F4.2). Written and run failing first.
 *
 * The same two things `plan/registered-files.ol-egov.141.89.7.35.spec.ts` pins for the plan, at
 * this provider: the input is exactly `projectRegisteredFiles` over the log it already read, and
 * the effect is that the same vault, differing only by the "source registered" event, ranks the
 * concept on the PDF past paper's question when registered and does not when not. Because this
 * provider also hands `edges.tier3.sourceCoverage` to the view's scope statement, the registered
 * PDF now appears among the sources that were read — the statement of what the gap view covered
 * changes with the ranking, in step.
 */
import { allGapRows, composeOracleRanking } from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalGapProvider } from '../../src/gap/provider.js';
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

async function loadGapFor(registered: boolean) {
  const provider = createLocalGapProvider({
    vault: await pastPaperPdfVault({ registered }),
    deviceId: DEVICE,
    settingsHost: new FakeSettingsHost(),
    now: () => NOW,
  });
  const state = await provider.load();
  if (state.kind !== 'model') throw new Error(`expected a gap model, got ${state.kind}`);
  return state.model;
}

describe('createLocalGapProvider — forwards registered documents to the ranking (ol-egov.141.89.7.35)', () => {
  beforeEach(() => {
    vi.mocked(composeOracleRanking).mockClear();
  });

  it('passes registeredFiles from the "source registered" events in her log', async () => {
    await loadGapFor(true);

    expect(composeOracleRanking).toHaveBeenCalledTimes(1);
    const input = vi.mocked(composeOracleRanking).mock.calls[0]?.[0];
    expect(input?.registeredFiles).toEqual([
      { path: PAST_PAPER_PDF, role: 'past-paper', course: COURSE },
    ]);
  });

  it('passes an empty registeredFiles when nothing is registered', async () => {
    await loadGapFor(false);

    const input = vi.mocked(composeOracleRanking).mock.calls[0]?.[0];
    expect(input?.registeredFiles).toEqual([]);
  });

  it('a registered past-paper PDF ranks its concept with its question as the citation; the same vault unregistered ranks nothing', async () => {
    const without = await loadGapFor(false);
    expect(allGapRows(without)).toEqual([]);
    expect(without.scope.sources.map((s) => s.sourcePath)).not.toContain(PAST_PAPER_PDF);

    const withEvent = await loadGapFor(true);
    const rows = allGapRows(withEvent);
    expect(rows.map((r) => r.conceptName)).toEqual([CONCEPT]);
    expect(rows[0]?.citations.map((c) => [c.sourcePath, c.questionLabel])).toEqual([
      [PAST_PAPER_PDF, '1'],
    ]);
    expect(rows[0]?.distinctSourceCount).toBe(1);
    // The scope statement reads the same PDF the ranking does: it was read, and it yielded a question.
    expect(withEvent.scope.sources.map((s) => [s.sourcePath, s.readState])).toEqual([
      [PAST_PAPER_PDF, 'read'],
    ]);
  });
});
