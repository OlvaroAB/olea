/**
 * The whole-plugin mount's vault/metadata/manifest layer (`ol-3ux7.64.3`
 * [WBX-2], `docs/dev/simulator-design.md` §4 in olea-service).
 *
 * Split out of `index.ts` (the file esbuild/tsconfig actually alias to
 * `obsidian`) because it is genuinely new mechanism, not an extension of an
 * existing shim class — `index.ts` re-exports everything here, so nothing
 * outside this package sees the split.
 *
 * ## The injection seam
 *
 * `App`/`Plugin` used to need nothing from outside this package: every
 * member was either inert (`Component.registerDomEvent`) or content-blind
 * chrome. Whole-plugin mount needs the plugin's actual storage — a vault and
 * a `loadData`/`saveData` blob — and this package must not know or care
 * whether that storage is `MemoryVaultSource` (existing fixture scenarios),
 * an in-memory stub (this file's own defaults, for the two pre-existing
 * `new App()`/`new Plugin(app)` call sites that pass nothing), or WBX-1's
 * persisted IndexedDB-backed vault (the simulator's actual lived-term
 * storage — `packages/workbench/src/simulator/`, not owned by this file).
 *
 * So the two interfaces below (`ShimVaultSource`, `PluginDataStore`) are
 * deliberately NOT imported from `olea-core` or anywhere else — they are
 * small local mirrors, shaped to match `olea-core`'s real `VaultSource` and
 * `packages/plugin`'s own `ObsidianDataHost` structurally, so any real
 * implementation of either satisfies these without adaptation, but this
 * package's own compile has zero dependency on what WBX-1 builds. Same
 * pattern `commands/types.ts`'s `CommandRegistrar` already uses in
 * `packages/plugin` for exactly this reason.
 *
 * **The call WBX-1's `main.ts`/`simulator/` code makes**: build (or reuse) a
 * `ShimVaultSource` and, once it holds real persistence, a `PluginDataStore`;
 * pass both to `mountPlugin` (`../plugin-bridge.ts`). Nothing here reaches
 * into IndexedDB, `IDBDatabase`, or any browser storage API — that stays
 * entirely on WBX-1's side of the seam.
 */

/** Obsidian's plugin manifest (`manifest.json`), reduced to the fields `main.ts` reads off `this.manifest` (`version`, `id`) plus the rest `manifest.json` itself declares, for fidelity. */
export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly minAppVersion?: string;
  readonly description?: string;
  readonly author?: string;
  readonly authorUrl?: string;
  readonly isDesktopOnly?: boolean;
}

/** Mirrors the real `packages/plugin/manifest.json` verbatim, so a mounted plugin's `this.manifest.id`/`.version` reads exactly as it does in production. */
export const DEFAULT_MANIFEST: PluginManifest = {
  id: 'olea',
  name: 'Olea',
  version: '0.9.0-alpha.3',
  minAppVersion: '1.9.10',
  description: 'Olea — a study companion that lives in your vault.',
  author: 'Olvaro',
  authorUrl: 'https://olvaro.com',
  isDesktopOnly: false,
};

/**
 * Obsidian's `Platform`/`apiVersion` (§4 gap table). Reduced to `isMobile` —
 * the only member read anywhere in `packages/plugin`
 * (`ingestion/device-capability.ts`, `commands/diagnostics-clipboard.ts`;
 * verified by grep before writing this, same discipline `index.ts`'s own
 * module doc holds elsewhere). Always desktop: mobile chrome stays `@manual`
 * per the design's own table.
 */
export const Platform = { isMobile: false } as const;

/** Fixed at the manifest's own `minAppVersion` — the one value `diagnostics-clipboard.ts` reads it for is a diagnostics report field, never a version gate this shim evaluates. */
export const apiVersion = '1.9.10';

/**
 * Obsidian's `TFile`, reduced to `path`/`stat`/the three derived getters
 * `ObsidianSource` and its callers read. `stat.ctime` is the shim's own
 * best-effort approximation — see `Vault.ready()`'s doc for exactly what it
 * is NOT: a stable arrival time across a simulator remount, unless the
 * injected `ShimVaultSource` supplies `firstSeen`.
 */
export class TFile {
  readonly stat: { ctime: number; mtime: number; size: number };

  constructor(
    readonly path: string,
    ctime = Date.now(),
  ) {
    this.stat = { ctime, mtime: ctime, size: 0 };
  }

  get name(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }

  get extension(): string {
    const dot = this.name.lastIndexOf('.');
    return dot > 0 ? this.name.slice(dot + 1) : '';
  }

  get basename(): string {
    const dot = this.name.lastIndexOf('.');
    return dot > 0 ? this.name.slice(0, dot) : this.name;
  }
}

/** Obsidian's `TFolder`, reduced to `path`/`name` — `ObsidianSource.ensureParentFolder`'s `getFolderByPath(...) !== null` check is the only real call site; folders are otherwise implicit in a flat path map (see `Vault.getFolderByPath` below). */
export class TFolder {
  constructor(readonly path: string) {}

  get name(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }
}

/** An Obsidian-shaped event subscription handle. `Vault.on`/`Workspace.on` both return one; `Component.registerEvent` and `Vault.offref`/`Workspace.offref` both consume one. Not a copy of Obsidian's opaque `EventRef` — a plain object is all any call site here needs. */
export interface EventRef {
  unsubscribe(): void;
}

/** One observed change from an injected vault source. Deliberately has no `'rename'` member — see this file's module doc and `docs/dev/simulator-design.md` §4: rename events stay `@manual`, and neither `MemoryVaultSource` nor the shape this type mirrors can produce one today. */
export interface ShimVaultEvent {
  readonly kind: 'create' | 'modify' | 'delete';
  readonly path: string;
}

/**
 * The slice of `olea-core`'s `VaultSource` (and, structurally,
 * `MemoryVaultSource`/a future persisted overlay) the shim's `Vault` needs.
 * Not imported from `olea-core` — see this file's module doc for why.
 *
 * `firstSeen` is optional: `MemoryVaultSource` has no such method today, so
 * `Vault.ready()` falls back to "first time this shim's own index observed
 * the path" when it is absent. Supplying it is how a persisted source keeps
 * `TFile.stat.ctime` stable across a simulator remount — see `Vault.ready()`.
 */
export interface ShimVaultSource {
  list(options?: {
    readonly under?: string;
    readonly extensions?: readonly string[];
  }): Promise<readonly string[]>;
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  watch(handler: (event: ShimVaultEvent) => void): () => void;
  firstSeen?(path: string): Promise<number | null>;
}

/** A source with nothing in it — the default for the two pre-existing `new App()`/`new Plugin(app)` call sites (`plugin-surface-scenarios.ts`, `explain-back-scenarios.ts`) that construct a bare `App` and never touch `app.vault`. */
function createEmptyVaultSource(): ShimVaultSource {
  return {
    list: () => Promise.resolve([]),
    read: (path) => Promise.reject(new Error(`obsidian-shim: no such file: ${path}`)),
    readBinary: (path) => Promise.reject(new Error(`obsidian-shim: no such file: ${path}`)),
    write: () => Promise.reject(new Error('obsidian-shim: empty vault source is read-only')),
    exists: () => Promise.resolve(false),
    delete: () => Promise.resolve(),
    watch: () => () => {},
  };
}

/** The `{ loadData, saveData }` slice every `ObsidianDataHost` in `packages/plugin` narrows to — see e.g. `usage/log-store.ts`'s own copy of this shape. Not imported from `packages/plugin` for the same "small local mirror" reason `ShimVaultSource` states above. */
export interface PluginDataStore {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** A single mutable blob in memory — the default `PluginDataStore` when nothing is injected. Gone on reload, which is correct for the same reason `MemoryVaultSource`'s own module doc gives: nothing here should look persistent unless something actually persists it. */
export function createInMemoryPluginDataStore(): PluginDataStore {
  let blob: unknown = null;
  return {
    loadData: () => Promise.resolve(blob),
    saveData: (data) => {
      blob = data;
      return Promise.resolve();
    },
  };
}

/** Obsidian's raw filesystem adapter, reduced to the three members `ObsidianSource.delete`/`.listUnder` (via `dot-folder-walk.ts`'s `DotFolderAdapter`) actually call. Composed entirely from `ShimVaultSource.list`/`.exists`/`.delete` — a flat path map has no real folder objects, so "does this folder exist" and "list its immediate children" are both derived by grouping paths on their next `/`, never stored. */
class VaultAdapterShim {
  constructor(private readonly source: ShimVaultSource) {}

  /** True for a file OR a folder — real Obsidian's `DataAdapter.exists` answers both, which is why `dot-folder-walk.ts` can ask it about `.olea/reviews` (a folder) without special-casing. */
  async exists(path: string): Promise<boolean> {
    if (path === '') return true;
    if (await this.source.exists(path)) return true;
    const nested = await this.source.list({ under: path });
    return nested.length > 0;
  }

  async remove(path: string): Promise<void> {
    await this.source.delete(path);
  }

  /** One level of `path`'s children, split into files and folders — exactly the shape `DotFolderAdapter.list` and `dot-folder-walk.ts`'s recursive walk need. */
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const normalized = path.replace(/\/+$/, '');
    const prefix = normalized === '' ? '' : `${normalized}/`;
    const all = await this.source.list(normalized === '' ? {} : { under: normalized });
    const files = new Set<string>();
    const folders = new Set<string>();
    for (const candidate of all) {
      if (prefix !== '' && !candidate.startsWith(prefix)) continue;
      const rest = candidate.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        files.add(prefix + rest);
      } else {
        folders.add(prefix + rest.slice(0, slash));
      }
    }
    return { files: [...files].sort(), folders: [...folders].sort() };
  }
}

type VaultEventName = 'create' | 'modify' | 'delete' | 'rename';

/**
 * True for a dot-prefixed top-level path (`.olea/reviews/…`, `.obsidian/…`)
 * — the same "first segment starts with `.`" test `dot-folder-walk.ts` uses
 * on the real `ObsidianSource` side. Real Obsidian's own vault index never
 * surfaces these through `getFiles()` or its `create`/`modify`/`delete`/
 * `rename` events (`ol-3ux7.64.21`); `Vault` below uses this to match that
 * split rather than the plugin growing a filter Obsidian never needs.
 */
function isDotPath(path: string): boolean {
  return path.split('/')[0]?.startsWith('.') ?? false;
}

/**
 * Obsidian's `Vault`, over an injected `ShimVaultSource` (§4: "`App.vault` as
 * Obsidian `Vault`"). The one real design choice: Obsidian's `getFileByPath`/
 * `getFiles` are SYNCHRONOUS, but every `ShimVaultSource` method is async (it
 * mirrors `olea-core`'s `VaultSource`, and a persisted IndexedDB-backed
 * source cannot be sync). So this class keeps its own synchronous `TFile`
 * index, seeded once by `ready()` and kept live by subscribing to the
 * source's own `watch()` — `mountPlugin` (`../plugin-bridge.ts`) awaits
 * `ready()` before constructing the plugin, the same way a real Obsidian
 * vault is already fully scanned before any plugin's `onload` runs.
 *
 * `rename` is declared (matching `ObsidianSource.watch`'s own `.on('rename',
 * ...)` registration, so that file typechecks against this shim) but never
 * fires — see `ShimVaultEvent`'s doc: rename stays `@manual`.
 */
export class Vault {
  private readonly source: ShimVaultSource;
  readonly adapter: VaultAdapterShim;
  private readonly filesByPath = new Map<string, TFile>();
  private readonly listeners = new Map<VaultEventName, Set<(...args: never[]) => void>>();
  private unsubscribeSource: (() => void) | null = null;

  constructor(source?: ShimVaultSource) {
    this.source = source ?? createEmptyVaultSource();
    this.adapter = new VaultAdapterShim(this.source);
  }

  /**
   * Seeds the synchronous index from the injected source and subscribes to
   * its `watch()` for the lifetime of this `Vault` instance — call exactly
   * once, before anything reads `getFileByPath`/`getFiles` (`mountPlugin`
   * does this). Idempotent: a second call is a no-op rather than a double
   * subscription.
   */
  async ready(): Promise<void> {
    if (this.unsubscribeSource !== null) return;
    const paths = await this.source.list();
    await Promise.all(
      paths.map(async (path) => {
        const firstSeen = (await this.source.firstSeen?.(path)) ?? null;
        this.filesByPath.set(path, new TFile(path, firstSeen ?? Date.now()));
      }),
    );
    this.unsubscribeSource = this.source.watch((event) => {
      this.handleSourceEvent(event);
    });
  }

  /** Unsubscribes from the injected source. `mountPlugin`'s `unmount()` calls this — without it, a persisted source reused across a day-advance remount (§3) would accumulate one listener per generation of `Vault`. */
  dispose(): void {
    this.unsubscribeSource?.();
    this.unsubscribeSource = null;
  }

  /**
   * A dot-prefixed path (`.olea/…`) is still tracked in `filesByPath` here —
   * `getFileByPath` must keep resolving it, or `ObsidianSource.read`/`.write`/
   * `.exists` (all TFile-based, and the only mechanism the plugin has for
   * `.olea/` content — review logs, drafts, misconceptions) would silently
   * lose data on every write after the first. What changes is that a
   * dot-path event is never `emit`-ted — real Obsidian's own `create`/
   * `modify`/`delete` events never fire for one (`ol-3ux7.64.21`), which is
   * what stops e.g. the keyword-index watcher from reindexing a review log.
   */
  private handleSourceEvent(event: ShimVaultEvent): void {
    const dotPath = isDotPath(event.path);
    if (event.kind === 'delete') {
      const file = this.filesByPath.get(event.path);
      this.filesByPath.delete(event.path);
      if (file !== undefined && !dotPath) this.emit('delete', file);
      return;
    }
    const existing = this.filesByPath.get(event.path);
    const file = existing ?? new TFile(event.path);
    if (existing !== undefined) existing.stat.mtime = Date.now();
    this.filesByPath.set(event.path, file);
    if (!dotPath) this.emit(event.kind, file);
  }

  private emit(kind: 'create' | 'modify' | 'delete', file: TFile): void {
    for (const callback of this.listeners.get(kind) ?? [])
      (callback as (file: TFile) => void)(file);
  }

  getFileByPath(path: string): TFile | null {
    return this.filesByPath.get(path) ?? null;
  }

  /** A folder "exists" when some indexed file sits under it — folders are never stored as their own entities over a flat path map. Root (`''`) always exists. */
  getFolderByPath(path: string): TFolder | null {
    if (path === '') return new TFolder('');
    const prefix = `${path}/`;
    for (const existing of this.filesByPath.keys()) {
      if (existing.startsWith(prefix)) return new TFolder(path);
    }
    return null;
  }

  /**
   * Excludes dot-prefixed paths (`.olea/…`) — real Obsidian's `getFiles()`
   * never returns one (`ol-3ux7.64.21`, and the same fact `dot-folder-walk.ts`
   * already documents on the `ObsidianSource` side: `Vault.getFiles()` "never
   * returns dot-prefixed paths at all, a real Obsidian host limitation").
   * They stay in `filesByPath` itself (see `handleSourceEvent`'s doc) — only
   * this enumeration view hides them, matching the split real Obsidian draws.
   */
  getFiles(): TFile[] {
    return [...this.filesByPath.values()].filter((file) => !isDotPath(file.path));
  }

  /** `ObsidianSource.read` deliberately never uses `cachedRead` (its own doc: "always goes to disk") — so `cachedRead` is not declared here at all, per this package's own minimal-shim rule (`index.ts`'s module doc): nothing calls it. */
  async read(file: TFile): Promise<string> {
    return this.source.read(file.path);
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const bytes = await this.source.readBinary(file.path);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async modify(file: TFile, content: string): Promise<void> {
    await this.source.write(file.path, content);
  }

  async create(path: string, content: string): Promise<TFile> {
    await this.source.write(path, content);
    const existing = this.filesByPath.get(path);
    if (existing !== undefined) return existing;
    const file = new TFile(path);
    this.filesByPath.set(path, file);
    return file;
  }

  /** No-op: see this class's own doc — folders are implicit over a flat path map, and nothing reads a folder's existence except through `getFolderByPath`, which derives it from indexed files. */
  async createFolder(_path: string): Promise<void> {}

  on(name: 'create' | 'modify' | 'delete', callback: (file: TFile) => void): EventRef;
  on(name: 'rename', callback: (file: TFile, oldPath: string) => void): EventRef;
  on(name: VaultEventName, callback: (...args: never[]) => void): EventRef {
    let set = this.listeners.get(name);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(callback);
    return { unsubscribe: () => set?.delete(callback) };
  }

  offref(ref: EventRef): void {
    ref.unsubscribe();
  }
}

/**
 * Obsidian's `MetadataCache`, reduced to `getCache(path)?.frontmatter` — the
 * one member `main.ts`'s `classifyPassage` hook reads (§4 gap table; grep
 * confirmed before writing this, same discipline `index.ts` states). No
 * headings, no links, no tags: nothing in the plugin's whole-mount path
 * reads them, and adding them unread would be exactly the "logic this shim
 * doesn't need" `index.ts`'s own module doc warns against.
 *
 * **The frontmatter reader here is deliberately NOT `olea-core`'s
 * `parseFrontmatter`.** That engine returns a byte-exact `Frontmatter` (a
 * list of raw `EntryNode`s) for the INV-2 round-trip — a different shape for
 * a different job (writing her notes back losslessly). This class only ever
 * reads a plain scalar `key: value` block for a role check
 * (`retrieval/classify-passage.ts`'s `roleFromFrontmatter`), so a small,
 * read-only, list-free line scanner is the honest reduction — never fed back
 * into a write, and never mistaken for the round-trip engine.
 */
export class MetadataCache {
  private readonly frontmatterByPath = new Map<string, Record<string, unknown>>();
  private readonly vault: Vault;
  private unsubscribeCreate: EventRef | null = null;
  private unsubscribeModify: EventRef | null = null;
  private unsubscribeDelete: EventRef | null = null;

  constructor(vault: Vault) {
    this.vault = vault;
    this.unsubscribeCreate = vault.on('create', (file) => void this.refresh(file));
    this.unsubscribeModify = vault.on('modify', (file) => void this.refresh(file));
    this.unsubscribeDelete = vault.on('delete', (file) => {
      this.frontmatterByPath.delete(file.path);
    });
  }

  private async refresh(file: TFile): Promise<void> {
    try {
      const content = await this.vault.read(file);
      const frontmatter = parseScalarFrontmatter(content);
      if (frontmatter === undefined) this.frontmatterByPath.delete(file.path);
      else this.frontmatterByPath.set(file.path, frontmatter);
    } catch {
      // Best effort — a read racing a delete is not this cache's problem.
    }
  }

  /** Called once by `mountPlugin`, after `Vault.ready()`, so the very first `getCache` call already reflects every file — matching a real Obsidian host, whose cache is warm before any plugin loads. */
  async warm(): Promise<void> {
    await Promise.all(this.vault.getFiles().map((file) => this.refresh(file)));
  }

  getCache(path: string): { frontmatter?: Record<string, unknown> } | null {
    const frontmatter = this.frontmatterByPath.get(path);
    return frontmatter === undefined ? null : { frontmatter };
  }

  /** Not an Obsidian API name — releases this cache's own vault subscriptions. `mountPlugin`'s `unmount()` calls this alongside `Vault.dispose()`. */
  dispose(): void {
    this.unsubscribeCreate?.unsubscribe();
    this.unsubscribeModify?.unsubscribe();
    this.unsubscribeDelete?.unsubscribe();
    this.unsubscribeCreate = null;
    this.unsubscribeModify = null;
    this.unsubscribeDelete = null;
  }
}

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SCALAR_ENTRY = /^([A-Za-z0-9_-]+):\s*(.*)$/;

function parseScalarFrontmatter(content: string): Record<string, unknown> | undefined {
  const match = FRONTMATTER_BLOCK.exec(content);
  if (match === null) return undefined;
  const block = match[1] ?? '';
  const result: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const entry = SCALAR_ENTRY.exec(line);
    if (entry === null) continue;
    const key = entry[1];
    const rawValue = (entry[2] ?? '').trim();
    if (key === undefined) continue;
    result[key] = unquote(rawValue);
  }
  return result;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
