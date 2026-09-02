/**
 * `heading-offer-setting.ts` tests (F2.10's toggle, `ol-0r92.29`). Pure
 * store logic against a fake `ObsidianDataHost` — no `obsidian` import, no
 * DOM — following `explain-back-audit-gate.spec.ts`'s pattern for the
 * identical shape.
 *
 * What this proves: the default is ON (F2.10's own default-on framing,
 * also relied on by `heading-offer-wiring.spec.ts`'s "toggle off" and
 * "toggle on, or omitted entirely" cases), the setter round-trips both
 * ways, and it never clobbers a sibling key in the same `data.json` blob.
 * The live, no-restart half of the toggle (the shared
 * `HeadingOfferSettingSnapshot` object `main.ts` and `OleaSettingTab` both
 * read/write) is plain object mutation with no logic of its own, so it is
 * not separately unit-tested here — same posture `settings-tab.ts`'s own
 * module doc takes for everything DOM-adjacent in that file.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEADING_OFFER_SETTING,
  HEADING_OFFER_SETTING_STORAGE_KEY,
  ObsidianHeadingOfferSettingStore,
} from '../../src/settings/heading-offer-setting.js';

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

describe('ObsidianHeadingOfferSettingStore — load()', () => {
  it('defaults to enabled on a fresh install (nothing saved yet)', async () => {
    const store = new ObsidianHeadingOfferSettingStore(new FakeDataHost());
    expect(await store.load()).toEqual(DEFAULT_HEADING_OFFER_SETTING);
    expect((await store.load()).enabled).toBe(true);
  });

  it('defaults to enabled on a corrupted or unrecognised value under its key', async () => {
    const host = new FakeDataHost();
    host.blob = { [HEADING_OFFER_SETTING_STORAGE_KEY]: { garbage: true } };
    const store = new ObsidianHeadingOfferSettingStore(host);
    expect(await store.load()).toEqual(DEFAULT_HEADING_OFFER_SETTING);
  });
});

describe('ObsidianHeadingOfferSettingStore — setEnabled()', () => {
  it('round-trips false — the toggle turned off', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianHeadingOfferSettingStore(host);

    await store.setEnabled(false);

    expect((await store.load()).enabled).toBe(false);
  });

  it('round-trips true — turned back on after being off', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianHeadingOfferSettingStore(host);

    await store.setEnabled(false);
    await store.setEnabled(true);

    expect((await store.load()).enabled).toBe(true);
  });

  it('never clobbers a sibling key already present in the same data.json blob', async () => {
    const host = new FakeDataHost();
    host.blob = { workerConfig: { version: 1, baseUrl: 'https://worker.example', token: 't' } };

    const store = new ObsidianHeadingOfferSettingStore(host);
    await store.setEnabled(false);

    expect(host.blob).toMatchObject({
      workerConfig: { version: 1, baseUrl: 'https://worker.example', token: 't' },
      [HEADING_OFFER_SETTING_STORAGE_KEY]: { version: 1, enabled: false },
    });
  });
});
