/**
 * `SimulatorStore` — the one persistence seam the simulator (`ol-3ux7.64`,
 * WBX-1) is built on: three logical concerns (the vault overlay, the
 * plugin's `data.json` blob, and the clock offset) that must reset together
 * or the device id and the review log fall out of step (F9.S2's reset
 * scenario). Two implementations satisfy the same interface —
 * {@link openIndexedDbStore} (the real, browser-persisted one) and
 * {@link createMemoryStore} (an in-memory fallback, used here because
 * `fake-indexeddb` is not a dependency of this package and Vitest's default
 * `node` environment has no global `indexedDB`; also the graceful runtime
 * fallback when a real browser's `indexedDB.open` throws, e.g. some private-
 * browsing modes). {@link openSimulatorStore} picks whichever is available.
 *
 * **This is also the WBX-2 wiring point.** `simulator/plugin-data-host.ts`
 * wraps whichever `SimulatorStore` this module hands back into the narrow
 * `{ loadData, saveData }` shape a real `Plugin` (and the shim's `Plugin`
 * double) exposes — see that file's own doc.
 */

/** One overlay entry: either the bytes a write left, or a delete tombstone. */
export type OverlayValue = { readonly bytes: Uint8Array } | { readonly tombstoned: true };

export interface SimulatorStore {
  readonly backend: 'indexeddb' | 'memory';

  /** Every overlay entry recorded so far, keyed by vault-relative path. */
  loadOverlay(): Promise<ReadonlyMap<string, OverlayValue>>;
  /** Records one overlay entry (a write's bytes, or a delete's tombstone). */
  putOverlay(path: string, value: OverlayValue): Promise<void>;

  /** The plugin's single `data.json` blob, or `undefined` before anything was ever saved. */
  loadPluginData(): Promise<unknown>;
  savePluginData(data: unknown): Promise<void>;

  /** Milliseconds added to the real wall clock; `0` until a session moves it. */
  loadClockOffsetMs(): Promise<number>;
  saveClockOffsetMs(offsetMs: number): Promise<void>;

  /**
   * Clears the overlay, the plugin data and the clock offset together, in one
   * transaction where the backend supports one (`openIndexedDbStore` does) —
   * `docs/dev/simulator-design.md` §3: "a reset clears both stores in one
   * transaction, so the device id and the log are never out of step."
   */
  resetAll(): Promise<void>;
}

export const DEFAULT_SIMULATOR_DB_NAME = 'olea-simulator';

const OVERLAY_STORE_NAME = 'overlay';
const META_STORE_NAME = 'meta';
const META_KEY_PLUGIN_DATA = 'pluginData';
const META_KEY_CLOCK_OFFSET_MS = 'clockOffsetMs';
const DB_VERSION = 1;

interface OverlayRow {
  readonly path: string;
  readonly tombstoned: boolean;
  readonly bytes: Uint8Array | null;
}

interface MetaRow {
  readonly key: string;
  readonly value: unknown;
}

/** An in-memory `SimulatorStore` — the fallback adapter, and what every unit test in this package runs against. */
export function createMemoryStore(): SimulatorStore {
  const overlay = new Map<string, OverlayValue>();
  let pluginData: unknown;
  let clockOffsetMs = 0;

  return {
    backend: 'memory',
    async loadOverlay() {
      return new Map(overlay);
    },
    async putOverlay(path, value) {
      overlay.set(path, value);
    },
    async loadPluginData() {
      return pluginData;
    },
    async savePluginData(data) {
      pluginData = data;
    },
    async loadClockOffsetMs() {
      return clockOffsetMs;
    },
    async saveClockOffsetMs(offsetMs) {
      clockOffsetMs = offsetMs;
    },
    async resetAll() {
      overlay.clear();
      pluginData = undefined;
      clockOffsetMs = 0;
    },
  };
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('SimulatorStore: IndexedDB request failed'));
  });
}

function promisifyTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('SimulatorStore: IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('SimulatorStore: IndexedDB transaction aborted'));
  });
}

/**
 * The real, browser-persisted `SimulatorStore`. One database, two object
 * stores — `overlay` (keyed by vault path) and `meta` (two rows: the plugin's
 * data blob and the clock offset) — so `resetAll` can clear both inside a
 * single `readwrite` transaction spanning both stores.
 */
export async function openIndexedDbStore(
  dbName: string = DEFAULT_SIMULATOR_DB_NAME,
): Promise<SimulatorStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OVERLAY_STORE_NAME)) {
        database.createObjectStore(OVERLAY_STORE_NAME, { keyPath: 'path' });
      }
      if (!database.objectStoreNames.contains(META_STORE_NAME)) {
        database.createObjectStore(META_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('SimulatorStore: IndexedDB open failed'));
  });

  async function readMeta(key: string): Promise<unknown> {
    const transaction = db.transaction(META_STORE_NAME, 'readonly');
    const row = await promisifyRequest(
      transaction.objectStore(META_STORE_NAME).get(key) as IDBRequest<MetaRow | undefined>,
    );
    return row?.value;
  }

  async function writeMeta(key: string, value: unknown): Promise<void> {
    const transaction = db.transaction(META_STORE_NAME, 'readwrite');
    transaction.objectStore(META_STORE_NAME).put({ key, value } satisfies MetaRow);
    await promisifyTransaction(transaction);
  }

  return {
    backend: 'indexeddb',
    async loadOverlay() {
      const transaction = db.transaction(OVERLAY_STORE_NAME, 'readonly');
      const rows = await promisifyRequest(
        transaction.objectStore(OVERLAY_STORE_NAME).getAll() as IDBRequest<OverlayRow[]>,
      );
      const map = new Map<string, OverlayValue>();
      for (const row of rows) {
        map.set(
          row.path,
          row.tombstoned ? { tombstoned: true } : { bytes: row.bytes ?? new Uint8Array() },
        );
      }
      return map;
    },
    async putOverlay(path, value) {
      const transaction = db.transaction(OVERLAY_STORE_NAME, 'readwrite');
      const row: OverlayRow =
        'tombstoned' in value
          ? { path, tombstoned: true, bytes: null }
          : { path, tombstoned: false, bytes: value.bytes };
      transaction.objectStore(OVERLAY_STORE_NAME).put(row);
      await promisifyTransaction(transaction);
    },
    loadPluginData: () => readMeta(META_KEY_PLUGIN_DATA),
    savePluginData: (data) => writeMeta(META_KEY_PLUGIN_DATA, data),
    async loadClockOffsetMs() {
      const value = await readMeta(META_KEY_CLOCK_OFFSET_MS);
      return typeof value === 'number' ? value : 0;
    },
    saveClockOffsetMs: (offsetMs) => writeMeta(META_KEY_CLOCK_OFFSET_MS, offsetMs),
    async resetAll() {
      const transaction = db.transaction([OVERLAY_STORE_NAME, META_STORE_NAME], 'readwrite');
      transaction.objectStore(OVERLAY_STORE_NAME).clear();
      transaction.objectStore(META_STORE_NAME).clear();
      await promisifyTransaction(transaction);
    },
  };
}

/**
 * Picks {@link openIndexedDbStore} when a global `indexedDB` exists and opens
 * cleanly, and {@link createMemoryStore} otherwise — the fallback this
 * bead's brief asks for, exercised for real whenever this package's own
 * tests run (Vitest's `node` environment has no `indexedDB`) and as the
 * defensive path in a real browser that refuses to open one.
 */
export async function openSimulatorStore(
  dbName: string = DEFAULT_SIMULATOR_DB_NAME,
): Promise<SimulatorStore> {
  if (typeof indexedDB === 'undefined') return createMemoryStore();
  try {
    return await openIndexedDbStore(dbName);
  } catch {
    return createMemoryStore();
  }
}
