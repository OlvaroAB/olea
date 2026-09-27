/**
 * `renderPrivacySection`'s two button paths, driven the way the settings pane drives them
 * (`ol-egov.141.8.12`). `obsidian` has no runtime under Vitest, so `Setting` and `Notice` are
 * replaced by a stand-in that records each button's click handler; everything behind the click —
 * the export bundle, the full delete, the seal on the plugin's settings host — is the real code.
 *
 * 1. The export the pane writes carries the settings file's content-derived keys, and nothing
 *    else from it (`data-manifest.ts`).
 * 2. A full delete stays deleted: a job of the old plugin instance still holding a pre-delete
 *    copy when the delete starts, a real store writing after it, and the unload-time gate-stage
 *    flush of the reload that follows all fail to put a cleared key back. A control run on a host
 *    without the seal shows the same job does write it back, so the check can fail.
 * 3. `main.ts` (no runtime under Vitest either) is read as source, comments stripped, for the
 *    three lines that put the seal in production: the settings host, `sealForFullDelete`, and the
 *    unload-time flush gated on `retire`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { App } from 'obsidian';
import type { VaultPath, VaultSource } from 'olea-core';
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
import { CONTENT_DERIVED_SETTINGS_KEYS } from '../../src/privacy/data-manifest.js';
import type { PrivacyExportBundle } from '../../src/privacy/export-bundle.js';
import { OleaLayerWriteSeal } from '../../src/privacy/olea-layer-write-seal.js';
import {
  FullDeleteWriteSeal,
  PRIVACY_EXPORT_FOLDER,
  renderPrivacySection,
  type SealedFullDeleteHost,
} from '../../src/privacy/settings-section.js';
import type { ObsidianDataHost } from '../../src/privacy/types.js';
import {
  GATE_STAGE_STORAGE_KEY,
  ObsidianGateStageStore,
} from '../../src/retrieval/gate-stage-store.js';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import { FakeDataHost, MemoryVaultSource } from './fakes.js';

const DEVICE_ID = 'device-1';
const NOW = new Date('2026-09-27T10:00:00Z');

/** A settings file holding records, configuration, safety state, the device id and one unlisted key. */
function seededSettings(): Record<string, unknown> {
  return {
    [GATE_STAGE_STORAGE_KEY]: {
      version: 1,
      periodStartedAt: '2026-09-01T00:00:00.000Z',
      lastRecordedAt: '2026-09-26T00:00:00.000Z',
      counts: { 'no-hits': 4 },
    },
    ingestionQueue: { jobs: [{ id: 'job-1' }] },
    keywordIndex: { terms: 3 },
    usageLog: { entries: [{ task: 't' }] },
    [WORKER_CONFIG_STORAGE_KEY]: { baseUrl: '', token: '' },
    explainBackAuditGate: { paused: false },
    [DEVICE_ID_STORAGE_KEY]: DEVICE_ID,
    someKeyNoManifestLists: 1,
  };
}

/**
 * The plugin instance as `main.ts` builds it: every store writes through one
 * `FullDeleteWriteSeal` over one `SerializingDataHost` over the raw file, and the instance
 * offers `sealForFullDelete`. `unload` is `onunload`'s gate-stage branch; `pendingFlush` is the
 * in-memory counts `GateStagePersistence` would write there.
 */
class FakePluginInstance implements ObsidianDataHost {
  readonly file = new FakeDataHost();
  readonly host: FullDeleteWriteSeal;
  readonly gateStageStore: ObsidianGateStageStore;
  pendingFlush: Record<string, number> | null = null;
  flushes: Promise<void>[] = [];

  /** `vaultSeal`: `main.ts`'s `vaultSource` (`ol-egov.141.8.14`); `null` builds the host without it. */
  constructor(vaultSeal: OleaLayerWriteSeal | null = null) {
    this.host = new FullDeleteWriteSeal(new SerializingDataHost(this.file), vaultSeal);
    this.gateStageStore = new ObsidianGateStageStore(this.host);
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
  unload(): void {
    if (this.host.retire() && this.pendingFlush !== null) {
      this.flushes.push(
        this.gateStageStore.save(this.pendingFlush as never, '2026-09-27T10:00:01.000Z'),
      );
    }
  }
}

/** `app.plugins` with the disable/enable pair `reload-plugin.ts` calls; `onDisable` runs the old instance's unload. */
function fakeApp(onDisable: (() => void) | null): App {
  if (onDisable === null) return {} as App;
  return {
    plugins: {
      disablePlugin: async () => onDisable(),
      enablePlugin: async () => {},
    },
  } as unknown as App;
}

function render(deps: { app: App; vault: VaultSource; dataHost: ObsidianDataHost }): void {
  ui.buttons.clear();
  ui.notices.length = 0;
  const containerEl = { createEl: () => ({}) } as unknown as HTMLElement;
  renderPrivacySection(containerEl, { ...deps, deviceId: DEVICE_ID, now: () => NOW });
}

function button(name: string): FakeButton {
  const found = ui.buttons.get(name);
  if (found === undefined) throw new Error(`no button rendered under "${name}"`);
  return found;
}

async function clickDeleteTwiceAndWait(): Promise<void> {
  const del = button('Delete everything');
  del.click();
  del.click();
  await vi.waitFor(() => expect(ui.notices.length).toBe(1));
  await vi.waitFor(() => expect(del.disabled).toBe(false));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('the export button (ol-egov.141.8.12)', () => {
  it('writes an export whose settings are exactly the content-derived keys present', async () => {
    const plugin = new FakePluginInstance();
    plugin.file.blob = seededSettings();
    const vault = new MemoryVaultSource();
    render({ app: fakeApp(null), vault, dataHost: plugin });

    button('Export my data').click();
    await vi.waitFor(() => expect(ui.notices.length).toBe(1));

    const exportPath = (await vault.list()).find((p) => p.startsWith(`${PRIVACY_EXPORT_FOLDER}/`));
    expect(exportPath).toBeDefined();
    const bundle = JSON.parse(vault.raw(exportPath as string) as string) as PrivacyExportBundle;
    expect(bundle.settings).not.toBeNull();

    const present = Object.keys(seededSettings()).filter((key) =>
      CONTENT_DERIVED_SETTINGS_KEYS.includes(key),
    );
    expect(present.length).toBeGreaterThan(0);
    expect(Object.keys(bundle.settings ?? {}).sort()).toEqual([...present].sort());
    expect(bundle.settings?.[GATE_STAGE_STORAGE_KEY]).toEqual(
      seededSettings()[GATE_STAGE_STORAGE_KEY],
    );
    for (const kept of [
      WORKER_CONFIG_STORAGE_KEY,
      'explainBackAuditGate',
      DEVICE_ID_STORAGE_KEY,
      'someKeyNoManifestLists',
    ]) {
      expect(bundle.settings).not.toHaveProperty(kept);
    }
  });
});

describe('a full delete stays deleted (ol-egov.141.8.12)', () => {
  it('no job in flight, later store write or unload-time flush puts a cleared key back', async () => {
    const plugin = new FakePluginInstance();
    plugin.file.blob = seededSettings();
    plugin.pendingFlush = { 'no-hits': 9 };
    const vault = new MemoryVaultSource();

    // A background job of this instance: it read the settings file before the delete and
    // writes its copy back once it finishes, which is after the delete has run.
    const jobMayFinish = deferred();
    const staleCopy = await plugin.loadData();
    const job = jobMayFinish.promise.then(() => plugin.saveData(staleCopy));

    render({ app: fakeApp(() => plugin.unload()), vault, dataHost: plugin });
    await clickDeleteTwiceAndWait();

    jobMayFinish.resolve();
    await job;
    await Promise.all(plugin.flushes);
    await plugin.gateStageStore.save({ 'no-hits': 11 } as never, '2026-09-27T10:00:02.000Z');
    await plugin.saveData({ ...(staleCopy as object) });

    const after = plugin.file.blob as Record<string, unknown>;
    for (const key of CONTENT_DERIVED_SETTINGS_KEYS) expect(after).not.toHaveProperty(key);
    expect(after).not.toHaveProperty('someKeyNoManifestLists');
    expect(after[WORKER_CONFIG_STORAGE_KEY]).toEqual({ baseUrl: '', token: '' });
    expect(after.explainBackAuditGate).toEqual({ paused: false });
    expect(typeof after[DEVICE_ID_STORAGE_KEY]).toBe('string');
    expect(after[DEVICE_ID_STORAGE_KEY]).not.toBe(DEVICE_ID);
    expect(plugin.flushes).toHaveLength(0);
  });

  it('control: on a host without the seal, the same job writes the cleared keys back', async () => {
    const file = new FakeDataHost();
    file.blob = seededSettings();
    const unsealed = new SerializingDataHost(file);
    const vault = new MemoryVaultSource();

    const jobMayFinish = deferred();
    const staleCopy = await unsealed.loadData();
    const job = jobMayFinish.promise.then(() => unsealed.saveData(staleCopy));

    render({ app: fakeApp(() => {}), vault, dataHost: unsealed });
    await clickDeleteTwiceAndWait();
    jobMayFinish.resolve();
    await job;

    expect(file.blob as Record<string, unknown>).toHaveProperty(GATE_STAGE_STORAGE_KEY);
  });

  it('a write issued before the seal still lands, ahead of the delete', async () => {
    const plugin = new FakePluginInstance();
    plugin.file.blob = seededSettings();
    const vault = new MemoryVaultSource();
    render({ app: fakeApp(() => plugin.unload()), vault, dataHost: plugin });

    const configWrite = plugin.readModifyWrite((current) => ({
      ...(current as object),
      [WORKER_CONFIG_STORAGE_KEY]: { baseUrl: 'https://example.invalid', token: '' },
    }));
    await clickDeleteTwiceAndWait();
    await configWrite;

    const after = plugin.file.blob as Record<string, unknown>;
    expect(after[WORKER_CONFIG_STORAGE_KEY]).toEqual({
      baseUrl: 'https://example.invalid',
      token: '',
    });
    expect(after).not.toHaveProperty(GATE_STAGE_STORAGE_KEY);
  });

  it('lifts the seal when no reload happened, so the instance runs on as before', async () => {
    const plugin = new FakePluginInstance();
    plugin.file.blob = seededSettings();
    const vault = new MemoryVaultSource();
    render({ app: fakeApp(null), vault, dataHost: plugin });
    await clickDeleteTwiceAndWait();

    await plugin.saveData({ ...(plugin.file.blob as object), laterRecord: 1 });
    expect(plugin.file.blob as Record<string, unknown>).toHaveProperty('laterRecord', 1);

    plugin.pendingFlush = { 'no-hits': 1 };
    plugin.unload();
    expect(plugin.flushes).toHaveLength(1);
  });
});

/** A memory vault whose writes to one path wait until the test lets them land. */
class HeldWriteVault extends MemoryVaultSource {
  private readonly holds = new Map<VaultPath, Promise<void>>();

  hold(path: VaultPath): () => void {
    const gate = deferred();
    this.holds.set(path, gate.promise);
    return gate.resolve;
  }

  override async write(path: VaultPath, content: string): Promise<void> {
    await this.holds.get(path);
    await super.write(path, content);
  }
}

/** Olea's layer as a full delete finds it, beside one note of hers the delete never touches. */
function seededOleaVault(): HeldWriteVault {
  return new HeldWriteVault({
    '.olea/concepts/c1.json': '{"key":"c1"}',
    '.olea/relations/r1.json': '{"pair":1}',
    [`.olea/reviews/${DEVICE_ID}/2026-09-27.jsonl`]: '{"e":1}\n',
    'Notes/her-note.md': 'hers',
  });
}

const oleaPaths = (vault: MemoryVaultSource): VaultPath[] =>
  vault.paths().filter((path) => path.startsWith('.olea/'));

describe('a full delete leaves nothing under .olea/ (ol-egov.141.8.14)', () => {
  it('a job in flight at delete time cannot recreate a file after the delete and the reload', async () => {
    const vault = seededOleaVault();
    const vaultSeal = new OleaLayerWriteSeal(vault);
    const plugin = new FakePluginInstance(vaultSeal);
    plugin.file.blob = seededSettings();

    // A background job of the old instance: it read a record before the delete and writes it,
    // a log line and an item she accepted into her note once it finishes, after the reload.
    const jobMayFinish = deferred();
    const staleRecord = await vaultSeal.read('.olea/concepts/c1.json');
    const job = jobMayFinish.promise.then(async () => {
      await vaultSeal.write('.olea/concepts/c1.json', staleRecord);
      await vaultSeal.write(`.olea/reviews/${DEVICE_ID}/2026-09-27.jsonl`, '{"e":2}\n');
      await vaultSeal.write('.olea/drafts/late.json', '{}');
      await vaultSeal.write('Notes/her-note.md', 'hers, with the item she accepted');
    });
    // A write already on its way to disk when she confirms: it lands first, then goes.
    const letInFlightLand = vault.hold('.olea/concepts/c2.json');
    const inFlight = vaultSeal.write('.olea/concepts/c2.json', '{"key":"c2"}');

    render({ app: fakeApp(() => plugin.unload()), vault: vaultSeal, dataHost: plugin });
    const del = button('Delete everything');
    del.click();
    del.click();
    letInFlightLand();
    await inFlight;
    await vi.waitFor(() => expect(ui.notices.length).toBe(1));
    await vi.waitFor(() => expect(del.disabled).toBe(false));
    expect(oleaPaths(vault)).toEqual([]);

    jobMayFinish.resolve();
    await job;

    expect(oleaPaths(vault)).toEqual([]);
    expect(vault.raw('Notes/her-note.md')).toBe('hers, with the item she accepted');
    const after = plugin.file.blob as Record<string, unknown>;
    for (const key of CONTENT_DERIVED_SETTINGS_KEYS) expect(after).not.toHaveProperty(key);
  });

  it('control: without the vault seal, the same job recreates the files', async () => {
    const vault = seededOleaVault();
    const plugin = new FakePluginInstance(null);
    plugin.file.blob = seededSettings();

    const jobMayFinish = deferred();
    const staleRecord = await vault.read('.olea/concepts/c1.json');
    const job = jobMayFinish.promise.then(() => vault.write('.olea/concepts/c1.json', staleRecord));

    render({ app: fakeApp(() => plugin.unload()), vault, dataHost: plugin });
    await clickDeleteTwiceAndWait();
    expect(oleaPaths(vault)).toEqual([]);
    jobMayFinish.resolve();
    await job;

    expect(oleaPaths(vault)).toEqual(['.olea/concepts/c1.json']);
  });

  it('when no reload happened, the vault seal lifts with the settings seal', async () => {
    const vault = seededOleaVault();
    const vaultSeal = new OleaLayerWriteSeal(vault);
    const plugin = new FakePluginInstance(vaultSeal);
    plugin.file.blob = seededSettings();
    render({ app: fakeApp(null), vault: vaultSeal, dataHost: plugin });
    await clickDeleteTwiceAndWait();
    expect(oleaPaths(vault)).toEqual([]);

    await vaultSeal.write('.olea/concepts/new.json', '{}');
    expect(oleaPaths(vault)).toEqual(['.olea/concepts/new.json']);
  });
});

describe('FullDeleteWriteSeal', () => {
  it('a sealed instance that retires stays sealed after release', async () => {
    const file = new FakeDataHost();
    file.blob = { a: 1 };
    const seal = new FullDeleteWriteSeal(new SerializingDataHost(file));
    const sealed = await seal.seal();
    expect(seal.retire()).toBe(false);
    sealed.release();
    await seal.saveData({ a: 2 });
    await seal.readModifyWrite(() => ({ a: 3 }));
    expect(file.blob).toEqual({ a: 1 });
    await sealed.dataHost.saveData({ a: 4 });
    expect(file.blob).toEqual({ a: 4 });
  });

  it('a failed seal leaves nothing sealed', async () => {
    const file = new FakeDataHost();
    let failNextLoad = true;
    const raw = {
      loadData: async () => {
        if (failNextLoad) {
          failNextLoad = false;
          throw new Error('read failed');
        }
        return file.blob;
      },
      saveData: (data: unknown) => file.saveData(data),
    };
    const seal = new FullDeleteWriteSeal(new SerializingDataHost(raw));
    await expect(seal.seal()).rejects.toThrow('read failed');
    await seal.saveData({ b: 1 });
    expect(file.blob).toEqual({ b: 1 });
    expect(seal.retire()).toBe(true);
  });
});

describe('main.ts wires the seal (ol-egov.141.8.12)', () => {
  const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('builds its one settings host as a FullDeleteWriteSeal over the serializing queue', () => {
    expect(main).toMatch(
      /private readonly dataFileHost = new FullDeleteWriteSeal\(\s*new SerializingDataHost\(/,
    );
  });

  it('offers sealForFullDelete from that host', () => {
    expect(main).toMatch(/sealForFullDelete\(\)[^{]*\{\s*return this\.dataFileHost\.seal\(\);/);
  });

  it('flushes the gate-stage counts at unload only when retire allows it', () => {
    const onunload = main.slice(main.indexOf('override onunload()'));
    expect(onunload).toMatch(
      /if \(this\.dataFileHost\.retire\(\)\) this\.gateStagePersistence\.flush\(\);/,
    );
    expect(onunload.match(/gateStagePersistence\.flush\(\)/g)).toHaveLength(1);
  });
});
