/**
 * `createLocalHomeProvider` wiring tests (F8.8, `[D-134]` Q1, `ol-0r92.17`).
 *
 * Every fixture string below is INVENTED — course codes, assessment titles —
 * per INV-3; nothing here is drawn from a real vault. This suite tests the
 * WIRING this bead adds (assessments read + offer-event read →
 * `resolveOfferCards`, and the dismiss round trip through `data.json`), not
 * `resolveOfferCards`'s own acceptance criteria — that is `test/
 * retrospective/offer-card.spec.ts`'s job.
 */
import { describe, expect, it } from 'vitest';
import { createLocalHomeProvider } from '../../src/home/provider.js';
import type { HomeViewState } from '../../src/home/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = new Date('2026-09-01T09:00:00Z');

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

function fixtureVault() {
  return memoryVault({
    [BASE_PATH]: [
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
    ].join('\n'),
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 1\n',
  });
}

async function offersFrom(state: HomeViewState) {
  if (state.kind !== 'offers') throw new Error(`expected offers, got ${state.kind}`);
  return state.cards;
}

describe('createLocalHomeProvider — load', () => {
  it('is empty when no assignments Base is configured, rather than unavailable', async () => {
    const provider = createLocalHomeProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
    });
    const state = await provider.load();
    expect(state).toEqual({ kind: 'offers', cards: [] });
  });

  it('renders a standing card for a passed, not-yet-offered assessment, unfiltered by course', async () => {
    const provider = createLocalHomeProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const cards = await offersFrom(await provider.load());
    expect(cards).toHaveLength(1);
    expect(cards[0]?.course).toBe('TESTC101');
    expect(cards[0]?.assessmentPath).toBe('02 Assignments/Quiz 1.md');
    expect(cards[0]?.line.length).toBeGreaterThan(0);
  });

  it('never carries a percentage, ratio or fraction in the rendered line (F8.3)', async () => {
    const provider = createLocalHomeProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const cards = await offersFrom(await provider.load());
    for (const card of cards) {
      expect(card.line).not.toMatch(/%/);
    }
  });
});

describe('createLocalHomeProvider — dismiss', () => {
  it('ends the standing offer for that assessment — it never reappears', async () => {
    const host = hostWithBasePath(BASE_PATH);
    const provider = createLocalHomeProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });

    const before = await offersFrom(await provider.load());
    expect(before).toHaveLength(1);

    await provider.dismiss(before[0]?.assessmentPath ?? '');

    const after = await offersFrom(await provider.load());
    expect(after).toHaveLength(0);
  });
});
