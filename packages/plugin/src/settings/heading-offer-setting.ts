/**
 * `ObsidianHeadingOfferSettingStore` — persists F2.10's "toggleable in
 * settings" clause (`docs/Olea_alpha_functional_scope.md`, `olea-service`;
 * `ol-0r92.29`) in the plugin's `data.json`, under its own top-level key.
 * Modelled on `explain-back-audit-gate.ts`'s exact shape: a narrow
 * `ObsidianDataHost` port, one owned key, read-modify-write on save, a
 * default that is never absent or `null`.
 *
 * **Default is `true` (on).** `heading-offer-wiring.ts`'s own module doc
 * already treats an omitted `enabled` thunk as "on," calling that "the
 * correct default-on behaviour" — this store's default keeps that promise
 * for a fresh install and for any install that predates this bead.
 *
 * ## The live seam this store does NOT provide, and why
 *
 * `HeadingOfferWiringDeps.enabled` (`review/heading-offer-wiring.ts`) is a
 * synchronous thunk, read fresh on every note check, deliberately never
 * captured once — the same "never captured once" reasoning that module's
 * doc gives for `draftDeps`. A `Promise`-returning `load()` cannot back a
 * synchronous thunk directly. `main.ts` is where that gap is closed: it
 * keeps one plain, mutable `HeadingOfferSettingSnapshot` object, seeds it
 * from this store's `load()` at startup (fire-and-forget — the default
 * above is correct until that resolves), and hands the SAME object
 * reference to both `OleaSettingTab` (which updates it the instant she
 * toggles, alongside persisting through this store) and the `enabled`
 * thunk (which reads it). That is what makes a mid-session toggle take
 * effect immediately, with no restart, while this file stays a plain
 * store like every sibling here.
 */

import type { ObsidianDataHost } from '../worker/config-store.js';

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const HEADING_OFFER_SETTING_STORAGE_KEY = 'headingOfferSetting';

export interface PersistedHeadingOfferSetting {
  readonly version: 1;
  readonly enabled: boolean;
}

/** Nothing set yet — a fresh install, or an install that predates this bead. Default ON, per this module's doc. */
export const DEFAULT_HEADING_OFFER_SETTING: PersistedHeadingOfferSetting = {
  version: 1,
  enabled: true,
};

function isPersistedHeadingOfferSetting(value: unknown): value is PersistedHeadingOfferSetting {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && typeof candidate.enabled === 'boolean';
}

/**
 * The shared, mutable live value `main.ts` threads through both
 * `OleaSettingTab` and the `enabled` thunk it builds — see this module's
 * doc, "the live seam this store does NOT provide." A plain object rather
 * than a class: nothing here needs behaviour, only a stable reference two
 * independent call sites can both read and write.
 */
export interface HeadingOfferSettingSnapshot {
  enabled: boolean;
}

export class ObsidianHeadingOfferSettingStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns `DEFAULT_HEADING_OFFER_SETTING` — never `null`, never a throw — for a fresh, absent or corrupted value, same posture every sibling store in this plugin takes. */
  async load(): Promise<PersistedHeadingOfferSetting> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return DEFAULT_HEADING_OFFER_SETTING;
    const candidate = (blob as Record<string, unknown>)[HEADING_OFFER_SETTING_STORAGE_KEY];
    return isPersistedHeadingOfferSetting(candidate) ? candidate : DEFAULT_HEADING_OFFER_SETTING;
  }

  /**
   * Read-modify-write: this plugin keeps several stores under sibling keys
   * in one `data.json` blob and none may clobber another (same reasoning
   * `ObsidianWorkerConfigStore.save`/`ObsidianExplainBackAuditGateStore
   * .setSustainedFailure` give for their own setters).
   */
  async setEnabled(value: boolean): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    const setting: PersistedHeadingOfferSetting = { version: 1, enabled: value };
    blob[HEADING_OFFER_SETTING_STORAGE_KEY] = setting;
    await this.host.saveData(blob);
  }
}
