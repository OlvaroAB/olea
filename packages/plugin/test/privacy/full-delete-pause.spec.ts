/**
 * `[D-406]` (`ol-egov.141.8.11`): after the reload that follows a full delete, Olea is paused.
 * Nothing is read, built or sent until she chooses Start, a one-line explanation is shown, and no
 * store reappears. `holdIfPausedAfterFullDelete` (`src/privacy/full-delete.ts`) is the check at the
 * top of `main.ts`'s `onload`; these tests drive it the way that `onload` does, with each plugin
 * instance built as `main.ts` builds it (one `FullDeleteWriteSeal` over one `SerializingDataHost`,
 * one `OleaLayerWriteSeal` over the vault), and the delete run from the real settings-pane button.
 *
 * `obsidian` has no runtime under Vitest, so `Setting` and `Notice` are stood in for, exactly as
 * in `settings-section.spec.ts`. All data is synthetic.
 */

import type { App } from 'obsidian';
import type { ListOptions, VaultPath, VaultSource } from 'olea-core';
import { reviewLogPath } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

interface FakeButton {
  label: string;
  disabled: boolean;
  click: () => void;
}

const ui = vi.hoisted(() => ({
  buttons: new Map<string, FakeButton>(),
  notices: [] as string[],
}));

vi.mock('obsidian', () => {
  class Setting {
    private name = '';
    setName(name: string): this {
      this.name = name;
      return this;
    }
    setDesc(): this {
      return this;
    }
    setHeading(): this {
      return this;
    }
    addButton(build: (button: unknown) => void): this {
      const record: FakeButton = { label: '', disabled: false, click: () => {} };
      const button = {
        setButtonText(text: string) {
          record.label = text;
          return button;
        },
        setDisabled(disabled: boolean) {
          record.disabled = disabled;
          return button;
        },
        onClick(handler: () => void) {
          record.click = handler;
          return button;
        },
      };
      build(button);
      ui.buttons.set(this.name, record);
      return this;
    }
  }
  class Notice {
    constructor(message: string) {
      ui.notices.push(message);
    }
  }
  return {
    Setting,
    Notice,
    requestUrl: () => Promise.reject(new Error('no network in this test')),
  };
});

import { DEVICE_ID_STORAGE_KEY } from '../../src/device/device-id.js';
import { FULL_DELETE_PAUSE_LINE, FULL_DELETE_START_LABEL } from '../../src/privacy/copy.js';
import {
  CONTENT_DERIVED_SETTINGS_KEYS,
  FULL_DELETE_PAUSE_STORAGE_KEY,
  isPausedAfterFullDelete,
  KEPT_SETTINGS_KEYS,
  SETTINGS_KEY_MANIFEST,
  settingsKeyEntry,
} from '../../src/privacy/data-manifest.js';
import { buildPrivacyExportBundle } from '../../src/privacy/export-bundle.js';
import {
  type FullDeletePauseHost,
  holdIfPausedAfterFullDelete,
  runFullDelete,
} from '../../src/privacy/full-delete.js';
import { OleaLayerWriteSeal } from '../../src/privacy/olea-layer-write-seal.js';
import {
  FullDeleteWriteSeal,
  renderPrivacySection,
  type SealedFullDeleteHost,
} from '../../src/privacy/settings-section.js';
import type { ObsidianDataHost } from '../../src/privacy/types.js';
import { GateStagePersistence } from '../../src/retrieval/gate-stage-persistence.js';
import { ObsidianGateStageStore } from '../../src/retrieval/gate-stage-store.js';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import { FakeDataHost, MemoryVaultSource } from './fakes.js';

const DEVICE_ID = 'device-1';
const TODAY = '2026-09-27';
const NOW = new Date('2026-09-27T10:00:00Z');
const HER_NOTE = '01 Courses/SYN101/Lecture 1.md';
const SYNTHETIC_TOKEN = 'synthetic-worker-token-5c1e';

/** Her disk: one note of hers and Olea's layer beside it. */
function seededVault(): MemoryVaultSource {
  return new MemoryVaultSource({
    [HER_NOTE]: 'What is X?::X is Y.\n',
    [reviewLogPath(TODAY, DEVICE_ID)]: '{"kind":"review"}\n',
    '.olea/concepts/concept-key1-synthetic.json': '{"synthetic":true}\n',
  });
}

/** A settings file with a synthetic value under every listed key (the pause marker excepted). */
function seededSettings(): Record<string, unknown> {
  const blob: Record<string, unknown> = {};
  for (const { key } of SETTINGS_KEY_MANIFEST) {
    if (key !== FULL_DELETE_PAUSE_STORAGE_KEY) blob[key] = { synthetic: key };
  }
  blob[WORKER_CONFIG_STORAGE_KEY] = { version: 1, baseUrl: '', token: SYNTHETIC_TOKEN };
  blob[DEVICE_ID_STORAGE_KEY] = DEVICE_ID;
  return blob;
}

/** Counts every call the instance makes on her vault, so "nothing is read" is checkable. */
class CountingVault implements VaultSource {
  calls = 0;
  readonly delete: (path: VaultPath) => Promise<void>;

  constructor(private readonly inner: MemoryVaultSource) {
    this.delete = (path) => {
      this.calls += 1;
      return inner.delete(path);
    };
  }

  list(options?: ListOptions) {
    this.calls += 1;
    return this.inner.list(options);
  }
  read(path: VaultPath) {
    this.calls += 1;
    return this.inner.read(path);
  }
  readBinary(): Promise<Uint8Array> {
    this.calls += 1;
    return this.inner.readBinary();
  }
  write(path: VaultPath, content: string) {
    this.calls += 1;
    return this.inner.write(path, content);
  }
  exists(path: VaultPath) {
    this.calls += 1;
    return this.inner.exists(path);
  }
  watch() {
    this.calls += 1;
    return () => {};
  }
}

/**
 * One plugin instance, as `main.ts` builds it: its vault source is an `OleaLayerWriteSeal`, its
 * settings host a `FullDeleteWriteSeal` over a `SerializingDataHost`, and its gate-stage counts
 * live in memory behind a `GateStagePersistence` that `onunload` flushes when `retire` allows.
 * `onload` is `holdIfPausedAfterFullDelete` first, then (only when not held) `startupWork`: the
 * cold-start work that rebuilds Olea's layer and caches from her notes.
 */
class FakePluginInstance implements ObsidianDataHost {
  readonly vault: CountingVault;
  readonly vaultSeal: OleaLayerWriteSeal;
  readonly host: FullDeleteWriteSeal;
  readonly gateStage: GateStagePersistence<Record<string, number>>;
  readonly explained: string[] = [];
  offered: { label: string; start: () => Promise<void> } | null = null;
  held: boolean | null = null;
  startupRan = false;
  reloads = 0;

  constructor(
    readonly file: FakeDataHost,
    disk: MemoryVaultSource,
    private readonly reloadImpl: () => Promise<void> = async () => {},
  ) {
    this.vault = new CountingVault(disk);
    this.vaultSeal = new OleaLayerWriteSeal(this.vault);
    this.host = new FullDeleteWriteSeal(new SerializingDataHost(file), this.vaultSeal);
    const store = new ObsidianGateStageStore(this.host);
    this.gateStage = new GateStagePersistence({
      now: () => NOW.toISOString(),
      getCounts: () => ({ 'no-hits': 0 }),
      save: (counts, now) => store.save(counts as never, now),
    });
  }

  loadData(): Promise<unknown> {
    return this.host.loadData();
  }
  saveData(data: unknown): Promise<void> {
    return this.host.saveData(data);
  }
  readModifyWrite(mutate: (current: unknown) => unknown | Promise<unknown>): Promise<void> {
    return this.host.readModifyWrite(mutate);
  }
  sealForFullDelete(): Promise<SealedFullDeleteHost> {
    return this.host.seal();
  }

  /** The `FullDeletePauseHost` `main.ts` hands the check. */
  pauseHost(): FullDeletePauseHost {
    return {
      loadData: () => this.loadData(),
      sealForFullDelete: () => this.sealForFullDelete(),
      explain: (line) => this.explained.push(line),
      offerStart: (label, start) => {
        this.offered = { label, start };
      },
      reload: async () => {
        this.reloads += 1;
        await this.reloadImpl();
      },
    };
  }

  async onload(): Promise<void> {
    this.held = await holdIfPausedAfterFullDelete(this.pauseHost());
    if (this.held) return;
    await this.startupWork();
  }

  /**
   * What a running instance does: reads her note, writes every content-derived key and a file
   * under `.olea/`. Called by `onload` when not held; the tests also call it on a held instance to
   * stand for a periodic tick or stray writer that somehow ran anyway.
   */
  async startupWork(): Promise<void> {
    this.startupRan = true;
    await this.vault.read(HER_NOTE);
    await this.host.readModifyWrite((current) => {
      const blob = { ...(current as Record<string, unknown>) };
      for (const key of CONTENT_DERIVED_SETTINGS_KEYS) blob[key] = { rebuilt: key };
      return blob;
    });
    await this.vaultSeal.write('.olea/concepts/concept-key1-rebuilt.json', '{"rebuilt":true}\n');
    this.gateStage.schedule();
  }

  /** `onunload`'s gate-stage branch (`main.ts`). */
  onunload(): void {
    if (this.host.retire()) this.gateStage.flush();
  }
}

/** Obsidian's plugin manager: disable unloads the running instance, enable builds and loads a new one. */
function pluginManager(file: FakeDataHost, disk: MemoryVaultSource) {
  const instances: FakePluginInstance[] = [];
  let loading: Promise<void> = Promise.resolve();
  const app = {
    plugins: {
      disablePlugin: async () => instances.at(-1)?.onunload(),
      enablePlugin: async () => {
        const next = new FakePluginInstance(file, disk, async () => {
          await app.plugins.disablePlugin();
          await app.plugins.enablePlugin();
        });
        instances.push(next);
        loading = next.onload();
        await loading;
      },
    },
  };
  return {
    app: app as unknown as App,
    instances,
    enable: () => app.plugins.enablePlugin(),
    settled: () => loading,
  };
}

function renderPane(instance: FakePluginInstance, app: App): void {
  ui.buttons.clear();
  ui.notices.length = 0;
  const containerEl = { createEl: () => ({}) } as unknown as HTMLElement;
  renderPrivacySection(containerEl, {
    app,
    vault: instance.vaultSeal,
    dataHost: instance,
    deviceId: DEVICE_ID,
    now: () => NOW,
  });
}

async function clickDeleteTwiceAndWait(): Promise<void> {
  const del = ui.buttons.get('Delete everything');
  if (del === undefined) throw new Error('no delete button rendered');
  del.click();
  del.click();
  await vi.waitFor(() => expect(ui.notices.length).toBe(1));
  await vi.waitFor(() => expect(del.disabled).toBe(false));
}

function keysOf(file: FakeDataHost): string[] {
  return Object.keys(file.blob as Record<string, unknown>).sort();
}

/** What a full delete leaves in the settings file: configuration, safety, a fresh id, the pause. */
const LEFT_AFTER_DELETE = [
  ...KEPT_SETTINGS_KEYS,
  DEVICE_ID_STORAGE_KEY,
  FULL_DELETE_PAUSE_STORAGE_KEY,
].sort();

describe('after a full delete, Olea is paused until she acts ([D-406], ol-egov.141.8.11)', () => {
  it('the reload that follows the delete button holds: her vault is not touched, nothing is built, the line is shown once', async () => {
    const file = new FakeDataHost();
    file.blob = seededSettings();
    const disk = seededVault();
    const obsidian = pluginManager(file, disk);
    await obsidian.enable(); // the instance she deletes from: not paused, it starts as usual
    const running = obsidian.instances[0] as FakePluginInstance;
    expect(running.held).toBe(false);

    renderPane(running, obsidian.app);
    await clickDeleteTwiceAndWait();
    await obsidian.settled();

    expect(obsidian.instances).toHaveLength(2);
    const paused = obsidian.instances[1] as FakePluginInstance;
    expect(paused.held).toBe(true);
    expect(paused.startupRan).toBe(false);
    expect(paused.vault.calls).toBe(0);
    expect(paused.explained).toEqual([FULL_DELETE_PAUSE_LINE]);
    expect(paused.offered?.label).toBe(FULL_DELETE_START_LABEL);

    expect(keysOf(file)).toEqual(LEFT_AFTER_DELETE);
    expect(disk.paths()).toEqual([HER_NOTE]);
  });

  it('no store reappears: not from the paused instance writing anyway, not from its unload flush, not across later restarts', async () => {
    const file = new FakeDataHost();
    file.blob = seededSettings();
    const disk = seededVault();
    const obsidian = pluginManager(file, disk);
    await obsidian.enable();
    renderPane(obsidian.instances[0] as FakePluginInstance, obsidian.app);
    await clickDeleteTwiceAndWait();
    await obsidian.settled();
    const afterDelete = structuredClone(file.blob);

    // A periodic tick or stray writer of the paused instance, run anyway: every write is sealed.
    const paused = obsidian.instances[1] as FakePluginInstance;
    await paused.startupWork();
    await paused.host.saveData({ ...(afterDelete as object), ingestionQueue: { jobs: [1] } });
    paused.gateStage.flush();
    paused.onunload();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(file.blob).toEqual(afterDelete);
    expect(disk.paths()).toEqual([HER_NOTE]);

    // Obsidian closed and reopened, twice, without her choosing Start: still paused, still nothing.
    for (let restart = 0; restart < 2; restart += 1) {
      await obsidian.enable();
      const again = obsidian.instances.at(-1) as FakePluginInstance;
      expect(again.held).toBe(true);
      expect(again.startupRan).toBe(false);
      expect(again.vault.calls).toBe(0);
      again.onunload();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(file.blob).toEqual(afterDelete);
    for (const key of CONTENT_DERIVED_SETTINGS_KEYS) expect(file.blob).not.toHaveProperty(key);
    expect(disk.paths()).toEqual([HER_NOTE]);
  });

  it('her Start lifts only the pause and reloads; the next instance starts as usual', async () => {
    const file = new FakeDataHost();
    file.blob = seededSettings();
    const disk = seededVault();
    const obsidian = pluginManager(file, disk);
    await obsidian.enable();
    renderPane(obsidian.instances[0] as FakePluginInstance, obsidian.app);
    await clickDeleteTwiceAndWait();
    await obsidian.settled();
    const paused = obsidian.instances[1] as FakePluginInstance;
    const afterDelete = structuredClone(file.blob) as Record<string, unknown>;

    await paused.offered?.start();
    await obsidian.settled();

    expect(paused.reloads).toBe(1);
    const started = obsidian.instances.at(-1) as FakePluginInstance;
    expect(started).not.toBe(paused);
    expect(started.held).toBe(false);
    expect(started.startupRan).toBe(true);
    // The fresh instance rebuilt from her notes, because she chose to start. The settings she kept
    // are exactly as the delete left them, and the pause is gone.
    const now = file.blob as Record<string, unknown>;
    expect(now).not.toHaveProperty(FULL_DELETE_PAUSE_STORAGE_KEY);
    for (const key of [...KEPT_SETTINGS_KEYS, DEVICE_ID_STORAGE_KEY])
      expect(now[key]).toEqual(afterDelete[key]);
  });

  it('a Start chosen twice at once lifts and reloads once', async () => {
    const file = new FakeDataHost();
    file.blob = { [FULL_DELETE_PAUSE_STORAGE_KEY]: true };
    let reloadMayFinish = () => {};
    const reloading = new Promise<void>((resolve) => {
      reloadMayFinish = resolve;
    });
    const instance = new FakePluginInstance(file, new MemoryVaultSource(), () => reloading);
    await instance.onload();

    const first = instance.offered?.start();
    const second = instance.offered?.start();
    reloadMayFinish();
    await Promise.all([first, second]);

    expect(instance.reloads).toBe(1);
  });

  it('without a reload API, Start still lifts the pause (the next start runs) and the instance stays sealed', async () => {
    const file = new FakeDataHost();
    file.blob = { [FULL_DELETE_PAUSE_STORAGE_KEY]: true, [DEVICE_ID_STORAGE_KEY]: DEVICE_ID };
    const disk = new MemoryVaultSource({ [HER_NOTE]: 'x\n' });
    const instance = new FakePluginInstance(file, disk);
    await instance.onload();
    await instance.offered?.start();

    expect(file.blob).toEqual({ [DEVICE_ID_STORAGE_KEY]: DEVICE_ID });
    await instance.startupWork();
    instance.onunload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(file.blob).toEqual({ [DEVICE_ID_STORAGE_KEY]: DEVICE_ID });
    expect(disk.paths()).toEqual([HER_NOTE]);
  });

  it('with no full delete behind it, the check reads the settings file once and holds nothing', async () => {
    const file = new FakeDataHost();
    file.blob = seededSettings();
    const loads = vi.fn(async () => file.blob);
    const seal = vi.fn();
    const explain = vi.fn();
    const offerStart = vi.fn();
    const held = await holdIfPausedAfterFullDelete({
      loadData: loads,
      sealForFullDelete: seal,
      explain,
      offerStart,
      reload: vi.fn(),
    });
    expect(held).toBe(false);
    expect(loads).toHaveBeenCalledTimes(1);
    expect(seal).not.toHaveBeenCalled();
    expect(explain).not.toHaveBeenCalled();
    expect(offerStart).not.toHaveBeenCalled();
  });

  it('a delete that stops partway still leaves the pause: the marker is written before the first step', async () => {
    const file = new FakeDataHost();
    file.blob = seededSettings();
    const refusing = new MemoryVaultSource({ '.olea/concepts/x.json': '{}\n' });
    const vault = Object.assign(Object.create(refusing) as MemoryVaultSource, {
      delete: async () => {
        throw new Error('host refused the delete');
      },
    });
    await expect(
      runFullDelete({
        dataHost: file,
        vault,
        deviceId: DEVICE_ID,
        today: TODAY,
        workerConfig: { baseUrl: '', token: '' },
        httpRequest: async () => ({ status: 200 }),
      }),
    ).rejects.toThrow('host refused the delete');
    expect(await isPausedAfterFullDelete(file)).toBe(true);
  });

  it('any stored marker value pauses (fails closed); an absent one does not', async () => {
    expect(await isPausedAfterFullDelete({ loadData: async () => null })).toBe(false);
    expect(await isPausedAfterFullDelete({ loadData: async () => ({}) })).toBe(false);
    expect(
      await isPausedAfterFullDelete({
        loadData: async () => ({ [FULL_DELETE_PAUSE_STORAGE_KEY]: { from: 'a later build' } }),
      }),
    ).toBe(true);
  });

  it('the marker is classified, kept by a delete and never exported', async () => {
    expect(settingsKeyEntry(FULL_DELETE_PAUSE_STORAGE_KEY)?.classification).toBe('delete-pause');
    expect(CONTENT_DERIVED_SETTINGS_KEYS).not.toContain(FULL_DELETE_PAUSE_STORAGE_KEY);
    expect(KEPT_SETTINGS_KEYS).not.toContain(FULL_DELETE_PAUSE_STORAGE_KEY);

    const file = new FakeDataHost();
    file.blob = { ...seededSettings(), [FULL_DELETE_PAUSE_STORAGE_KEY]: true };
    const bundle = await buildPrivacyExportBundle({
      vault: new MemoryVaultSource(),
      deviceId: DEVICE_ID,
      today: TODAY,
      now: () => NOW.toISOString(),
      dataHost: file,
    });
    expect(bundle.settings).not.toHaveProperty(FULL_DELETE_PAUSE_STORAGE_KEY);
  });

  it('the explanation is one line and names the action she is offered', () => {
    expect(FULL_DELETE_PAUSE_LINE).not.toMatch(/\n/);
    expect(FULL_DELETE_PAUSE_LINE).toContain(FULL_DELETE_START_LABEL);
    expect(FULL_DELETE_START_LABEL.trim().length).toBeGreaterThan(0);
  });
});
