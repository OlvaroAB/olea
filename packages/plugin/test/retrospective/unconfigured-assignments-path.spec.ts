/**
 * `createLocalRetrospectiveProvider` — an unconfigured `assignmentsBasePath`
 * resolves honestly (`ol-3ux7.64.19` follow-up [WBX-19], the ruling half of
 * the simulator's rich-states work: `docs/dev/simulator-design.md` §6-§7).
 *
 * Before this fix, `retrospective/provider.ts`'s `load()` called
 * `readAssessments(deps.vault, assignmentsBasePath)` with no `try`/`catch`,
 * unlike `home/provider.ts`'s `safeAssessmentRecords`, which wraps the
 * identical call. `assignmentsBasePath === ''` (the ordinary state for an
 * install that has never set the setting — every simulator world before
 * this fix) makes `vault.read('')` throw; that throw propagated past this
 * provider, through `main.ts`'s outer `try`/`catch`, and surfaced as
 * `{ kind: 'unavailable' }` — the alarming "Olea could not read your vault
 * just now" message — even though nothing was actually unreadable. This
 * suite proves the fix: an unconfigured or unreadable Base path now
 * resolves to `load()` returning `null` (no assessment has passed), which
 * `main.ts` reports as the honest `{ kind: 'none' }`, exactly the state
 * `retrospective/view.ts`'s own module doc reserves for "nothing has passed
 * yet" as opposed to a genuine vault-read failure.
 *
 * INV-3: no real vault content anywhere in this file.
 */
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createLocalRetrospectiveProvider } from '../../src/retrospective/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-09-02T09:00:00-04:00');

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

const emptyOfferStore = { load: async () => [], append: async () => {} };

describe('createLocalRetrospectiveProvider — unconfigured/unreadable assignments path resolves honestly', () => {
  it('never configured (assignmentsBasePath "") resolves load() to null, not a thrown exception', async () => {
    const vault = memoryVault({});
    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(''),
      now: () => NOW,
    });

    await expect(provider.load()).resolves.toBeNull();
  });

  it('a configured path pointing at a Base file that does not exist ALSO resolves to null, not a thrown exception', async () => {
    const vault = memoryVault({});
    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath('02 Assignments/Missing.base'),
      now: () => NOW,
    });

    await expect(provider.load()).resolves.toBeNull();
  });
});
