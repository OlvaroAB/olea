/**
 * `ol-egov.141.89.8.44` ([D-445], [D-448]) — the gap provider supplies the durable unit manifest to
 * the coverage fold. Every string is invented (INV-3).
 */
import type { UnitManifest, VaultPath } from 'olea-core';
import { newPendingEntry } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  coverageClosingLine,
  coverageScopeStatement,
  scopeSourceLine,
} from '../../src/gap/copy.js';
import { createLocalGapProvider } from '../../src/gap/provider.js';
import {
  DEVICE,
  FakeSettingsHost,
  NOW,
  PAST_PAPER_PDF,
  pastPaperPdfVault,
} from '../oracle/registered-past-paper-fixture.js';

const pending: UnitManifest = {
  sourcePath: PAST_PAPER_PDF as VaultPath,
  revisionDigest: 'rev-1',
  entries: [newPendingEntry(PAST_PAPER_PDF as VaultPath, 1)],
};

async function loadWith(
  unitManifests?: (paths: readonly VaultPath[]) => Promise<ReadonlyMap<VaultPath, UnitManifest>>,
) {
  const provider = createLocalGapProvider({
    vault: await pastPaperPdfVault({ registered: true }),
    deviceId: DEVICE,
    settingsHost: new FakeSettingsHost(),
    now: () => NOW,
    ...(unitManifests !== undefined ? { unitManifests } : {}),
  });
  const state = await provider.load();
  if (state.kind !== 'model') throw new Error(`expected a gap model, got ${state.kind}`);
  return state.model;
}

describe('createLocalGapProvider — the unit manifest (ol-egov.141.89.8.44)', () => {
  it('asks the supplier for the extractor-format sources the scope lists, and a waiting page reads not fully read yet', async () => {
    const supplier = vi.fn(async () => new Map([[pending.sourcePath, pending]]));
    const model = await loadWith(supplier);

    expect(supplier).toHaveBeenCalledTimes(1);
    expect(supplier).toHaveBeenCalledWith([PAST_PAPER_PDF]);
    const source = model.scope.sources.find((s) => s.sourcePath === PAST_PAPER_PDF);
    expect(source).toMatchObject({ readState: 'not-attempted', readingCompleteness: 'unsettled' });
    expect(scopeSourceLine(source as NonNullable<typeof source>)).toBe(
      `${PAST_PAPER_PDF} — not fully read yet`,
    );
    const statement = coverageScopeStatement(model.scope).join(' ');
    expect(statement).toContain('One of your sources is not fully read yet');
    expect(statement).not.toContain('no reader');
    expect(model.scope.canStateExhaustiveness).toBe(false);
    expect(coverageClosingLine(model.scope)).toBeNull();
  });

  it('with no supplier the scope is today: the extractor verdict, read', async () => {
    const model = await loadWith();
    expect(model.scope.sources.map((s) => s.readState)).toEqual(['read']);
  });

  it('a supplier that throws keeps the extractor verdict rather than an empty or complete record', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const model = await loadWith(async () => {
      throw new Error('store unavailable');
    });
    quiet.mockRestore();
    expect(model.scope.sources.map((s) => [s.readState, s.readingCompleteness])).toEqual([
      ['read', 'not-recorded'],
    ]);
  });
});
