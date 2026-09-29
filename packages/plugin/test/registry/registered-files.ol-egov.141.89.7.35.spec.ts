/**
 * `ol-egov.141.89.7.35` — the registry provider's note-offer ranking forwards her registered
 * documents (F1.5, F4.2, F8.4a). Written and run failing first.
 *
 * `courseRankingsForNoteOffer` is this provider's own `composeOracleRanking` caller: the note-offer
 * gate (`[D-176]`) needs a concept to sit in its course's top band, and that band is the same
 * ranking every other screen reads. Called without `registeredFiles` it ranked without the past
 * papers she registered, so a concept only a registered PDF evidences could never reach the band.
 *
 * Pinned at the call: the input is exactly `projectRegisteredFiles` over the log the provider
 * already read, and the ranking that call returns carries the PDF's question as evidence for the
 * concept when registered and no ranked course when not.
 */
import type { RankOracleResult, RegistryInstrumentSummary } from 'olea-core';
import { composeOracleRanking } from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObsidianDataHost } from '../../src/registry/overrides-store.js';
import type { EditInstrumentPort } from '../../src/registry/provider.js';
import { createLocalRegistryProvider } from '../../src/registry/provider.js';
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

class FakeEditPort implements EditInstrumentPort {
  opened: RegistryInstrumentSummary[] = [];

  async edit(instrument: RegistryInstrumentSummary): Promise<void> {
    this.opened.push(instrument);
  }
}

/** The registry's own `data.json` host and the study-plan settings share one blob in production. */
class SharedSettingsHost extends FakeSettingsHost implements ObsidianDataHost {}

async function loadRegistryFor(registered: boolean): Promise<RankOracleResult> {
  const state = await createLocalRegistryProvider({
    vault: await pastPaperPdfVault({ registered }),
    deviceId: DEVICE,
    settingsHost: new SharedSettingsHost(),
    now: () => NOW,
    editPort: new FakeEditPort(),
  }).load();
  if (state.kind !== 'model') throw new Error(`expected a registry model, got ${state.kind}`);
  const call = vi.mocked(composeOracleRanking).mock.results[0];
  if (call === undefined) throw new Error('expected composeOracleRanking to have been called');
  return (await call.value).ranking;
}

describe('createLocalRegistryProvider — the note-offer ranking forwards registered documents (ol-egov.141.89.7.35)', () => {
  beforeEach(() => {
    vi.mocked(composeOracleRanking).mockClear();
  });

  it('passes registeredFiles from the "source registered" events in her log', async () => {
    await loadRegistryFor(true);

    expect(composeOracleRanking).toHaveBeenCalledTimes(1);
    const input = vi.mocked(composeOracleRanking).mock.calls[0]?.[0];
    expect(input?.registeredFiles).toEqual([
      { path: PAST_PAPER_PDF, role: 'past-paper', course: COURSE },
    ]);
  });

  it('passes an empty registeredFiles when nothing is registered', async () => {
    await loadRegistryFor(false);

    const input = vi.mocked(composeOracleRanking).mock.calls[0]?.[0];
    expect(input?.registeredFiles).toEqual([]);
  });

  it('the ranking it reads cites the registered PDF for the concept; the same vault unregistered ranks no course', async () => {
    const without = await loadRegistryFor(false);
    expect(without.courses.filter((c) => c.status === 'ranked')).toEqual([]);

    vi.mocked(composeOracleRanking).mockClear();
    const withEvent = await loadRegistryFor(true);
    const course = withEvent.courses.find((c) => c.course === COURSE);
    if (course?.status !== 'ranked') throw new Error('expected the registered course to rank');
    expect(course.ranked.map((entry) => entry.conceptName)).toEqual([CONCEPT]);
    expect(course.ranked[0]?.citations.map((c) => [c.sourcePath, c.questionLabel])).toEqual([
      [PAST_PAPER_PDF, '1'],
    ]);
  });
});
