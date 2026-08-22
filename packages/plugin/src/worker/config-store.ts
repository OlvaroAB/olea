/**
 * `ObsidianWorkerConfigStore` — persists the Worker base URL and pasted
 * access token (F7.1) in the plugin's `data.json`, under its own top-level
 * key, following the exact pattern `ingestion/queue-store.ts` and
 * `keyword-index/store.ts` already establish for everything else this
 * plugin persists there: a narrow `ObsidianDataHost` port (so this file
 * loads and is tested in plain Vitest, unlike anything that imports
 * `obsidian` itself), one owned key, and read-modify-write on every save so
 * this store never clobbers whatever `deviceId`, `keywordIndex` or
 * `ingestionQueue` already hold in the same blob.
 *
 * **Never logs, and nothing here has a code path that could.** The token is
 * plaintext in `data.json` — the same place Obsidian already stores every
 * other plugin's secrets in the absence of a platform keychain API, and the
 * honest baseline `token-field-copy.ts` and F7.1 both describe — but it
 * never appears in a thrown error, a logging call, or anything derived from
 * this module. `config-store.spec.ts` asserts the source contains no
 * console-logging call at all, the same defence `transport.ts` uses for the
 * same reason.
 */

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — see the module doc for why it's spelled out rather than imported. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const WORKER_CONFIG_STORAGE_KEY = 'workerConfig';

export interface PersistedWorkerConfig {
  readonly version: 1;
  readonly baseUrl: string;
  readonly token: string;
}

/** Nothing pasted yet, or nothing usable typed — the state a fresh install and a cleared field share. */
export const EMPTY_WORKER_CONFIG: PersistedWorkerConfig = {
  version: 1,
  baseUrl: '',
  token: '',
};

function isPersistedWorkerConfig(value: unknown): value is PersistedWorkerConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.baseUrl === 'string' &&
    typeof candidate.token === 'string'
  );
}

/** True once both a base URL and a token are non-blank — the only state in which a real call can be attempted (F7.8: everything else works regardless). */
export function isWorkerConfigured(config: PersistedWorkerConfig): boolean {
  return config.baseUrl.trim().length > 0 && config.token.trim().length > 0;
}

export class ObsidianWorkerConfigStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns `EMPTY_WORKER_CONFIG` — never `null`, never a throw — when nothing usable is stored, matching a fresh install or a corrupted blob alike. */
  async load(): Promise<PersistedWorkerConfig> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return EMPTY_WORKER_CONFIG;
    const candidate = (blob as Record<string, unknown>)[WORKER_CONFIG_STORAGE_KEY];
    // Corrupted or absent is "nothing configured yet", not an error — the
    // same call `queue-store.ts`/`keyword-index/store.ts` make: a person
    // whose data.json got mangled by something outside this plugin's
    // control should see an empty field to fill in again, not a crash.
    return isPersistedWorkerConfig(candidate) ? candidate : EMPTY_WORKER_CONFIG;
  }

  async save(config: PersistedWorkerConfig): Promise<void> {
    // Read-modify-write: `ObsidianQueueStore`/`ObsidianKeywordIndexStore`
    // both share this exact blob under their own keys, and this must not
    // clobber whichever of them saved most recently.
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[WORKER_CONFIG_STORAGE_KEY] = config;
    await this.host.saveData(blob);
  }
}
