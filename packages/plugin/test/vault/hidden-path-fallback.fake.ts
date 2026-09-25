/**
 * ol-egov.141.89.10.57: a fake Obsidian host for the hidden-path specs. Disk (files, folders)
 * and the vault's own file index are kept apart so they can disagree, the way a real host's
 * index and its raw DataAdapter can. Shaped like Obsidian's Vault plus DataAdapter (and the
 * getFiles, adapter.list and adapter.remove that ObsidianSource's list, listUnder and delete
 * use), never imported from obsidian.
 *
 * indexesHidden picks the host outcome nothing on record settles yet: false, the index hides
 * dot paths (getFileByPath and getFolderByPath answer null for them, as getFiles already does
 * on a real host); true, it knows them (what the workbench shim models). On a hiding host,
 * hiddenCreate and hiddenCreateFolder pick what vault.create and vault.createFolder do for a
 * hidden path, since the typings are silent on it. The adapter always carries the full
 * RawFileAdapter surface (stat, read, readBinary, write, mkdir, exists) — required since
 * ol-3ux7.64.25, matching both a real host and the workbench shim's adapter.
 */

import {
  type IndexedVault,
  isHiddenVaultPath,
  type RawFileAdapter,
  type RawStat,
} from '../../src/vault/hidden-path-fallback.js';

export type HiddenCreate = 'writes' | 'writes-then-throws' | 'throws' | 'no-op';
export type HiddenCreateFolder = 'mkdir' | 'throws-if-exists' | 'throws';

export interface HostOptions {
  /** true: the vault index knows dot paths; false: it hides them. */
  readonly indexesHidden: boolean;
  /** What vault.create does for a hidden path on a hiding host (unknown on a real one). */
  readonly hiddenCreate?: HiddenCreate;
  /** What vault.createFolder does for a hidden folder on a hiding host (unknown on a real one). */
  readonly hiddenCreateFolder?: HiddenCreateFolder;
}

export class FakeFile {
  readonly stat: { readonly ctime: number };
  constructor(
    readonly path: string,
    ctime: number,
  ) {
    this.stat = { ctime };
  }
}

/** The adapter members ObsidianSource reaches outside the fallback (listUnder, delete). */
export interface FakeAdapterExtras {
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove(path: string): Promise<void>;
}

export type FakeVault = IndexedVault<FakeFile> & {
  readonly adapter: RawFileAdapter & FakeAdapterExtras;
  getFiles(): FakeFile[];
};

export function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function enoent(path: string): Error {
  return new Error(`ENOENT: no such file or directory, '${path}'`);
}

function eisdir(): Error {
  return new Error('EISDIR: illegal operation on a directory');
}

export class FakeHost {
  readonly calls: string[] = [];
  readonly files = new Map<string, string | Uint8Array>();
  readonly folders = new Set<string>(['']);
  private readonly ctimes = new Map<string, number>();
  private readonly indexed = new Map<string, FakeFile>();
  private clock = 1_000;
  readonly vault: FakeVault;

  constructor(readonly options: HostOptions) {
    this.vault = this.buildVault();
  }

  private visible(path: string): boolean {
    return this.options.indexesHidden || !isHiddenVaultPath(path);
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }

  private mkdirp(folder: string): void {
    const segments = folder === '' ? [] : folder.split('/');
    let ancestor = '';
    for (const segment of segments) {
      ancestor = ancestor === '' ? segment : `${ancestor}/${segment}`;
      this.folders.add(ancestor);
    }
  }

  private putOnDisk(path: string, content: string | Uint8Array): number {
    const ctime = this.ctimes.get(path) ?? this.tick();
    this.ctimes.set(path, ctime);
    this.files.set(path, content);
    return ctime;
  }

  /** A file already on disk at startup, indexed wherever this host indexes. */
  seed(path: string, content: string | Uint8Array): void {
    this.mkdirp(parentOf(path));
    const ctime = this.putOnDisk(path, content);
    if (this.visible(path)) this.indexed.set(path, new FakeFile(path, ctime));
  }

  /** A file on disk that the index has not seen (yet): the watcher has not caught up. */
  seedUnindexed(path: string, content: string | Uint8Array): void {
    this.mkdirp(parentOf(path));
    this.putOnDisk(path, content);
  }

  /** A folder on disk with nothing in it. */
  seedFolder(path: string): void {
    this.mkdirp(path);
  }

  ctimeOf(path: string): number | undefined {
    return this.ctimes.get(path);
  }

  isIndexed(path: string): boolean {
    return this.indexed.has(path);
  }

  text(path: string): string | undefined {
    const content = this.files.get(path);
    return typeof content === 'string' ? content : undefined;
  }

  /** Only the calls whose name starts with one of the given prefixes. */
  callsTo(...prefixes: string[]): string[] {
    return this.calls.filter((call) => prefixes.some((prefix) => call.startsWith(prefix)));
  }

  private textAt(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw enoent(path);
    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  }

  private bufferAt(path: string): ArrayBuffer {
    const content = this.files.get(path);
    if (content === undefined) throw enoent(path);
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return bytes.slice().buffer;
  }

  private statAt(path: string): RawStat | null {
    if (this.files.has(path)) return { type: 'file', ctime: this.ctimes.get(path) ?? 0 };
    if (this.folders.has(path)) return { type: 'folder', ctime: 0 };
    return null;
  }

  private createHidden(path: string, data: string): FakeFile | null {
    switch (this.options.hiddenCreate ?? 'writes') {
      case 'writes': {
        if (!this.folders.has(parentOf(path))) throw enoent(path);
        return new FakeFile(path, this.putOnDisk(path, data));
      }
      case 'writes-then-throws': {
        if (!this.folders.has(parentOf(path))) throw enoent(path);
        this.putOnDisk(path, data);
        throw new Error('File creation failed.');
      }
      case 'throws':
        throw new Error('Cannot create a hidden file.');
      case 'no-op':
        return null;
    }
  }

  private createHiddenFolder(path: string): void {
    switch (this.options.hiddenCreateFolder ?? 'mkdir') {
      case 'mkdir':
        this.mkdirp(path);
        return;
      case 'throws-if-exists':
        if (this.folders.has(path)) throw new Error('Folder already exists.');
        this.mkdirp(path);
        return;
      case 'throws':
        throw new Error('Cannot create a hidden folder.');
    }
  }

  private buildAdapter(): RawFileAdapter & FakeAdapterExtras {
    const base = {
      exists: async (path: string): Promise<boolean> => {
        this.calls.push(`adapter.exists ${path}`);
        return this.files.has(path) || this.folders.has(path);
      },
      list: async (path: string): Promise<{ files: string[]; folders: string[] }> => {
        this.calls.push(`adapter.list ${path}`);
        if (!this.folders.has(path)) throw enoent(path);
        const prefix = path === '' ? '' : `${path}/`;
        const child = (candidate: string) =>
          candidate !== path &&
          candidate.startsWith(prefix) &&
          !candidate.slice(prefix.length).includes('/');
        return {
          files: [...this.files.keys()].filter(child).sort(),
          folders: [...this.folders].filter(child).sort(),
        };
      },
      remove: async (path: string): Promise<void> => {
        this.calls.push(`adapter.remove ${path}`);
        if (!this.files.delete(path)) throw enoent(path);
        this.indexed.delete(path);
      },
    };
    return {
      ...base,
      stat: async (path) => {
        this.calls.push(`adapter.stat ${path}`);
        return this.statAt(path);
      },
      read: async (path) => {
        this.calls.push(`adapter.read ${path}`);
        if (this.folders.has(path)) throw eisdir();
        return this.textAt(path);
      },
      readBinary: async (path) => {
        this.calls.push(`adapter.readBinary ${path}`);
        if (this.folders.has(path)) throw eisdir();
        return this.bufferAt(path);
      },
      // The index is never told: on a hiding host it never will be, on an indexing host it lags.
      write: async (path, data) => {
        this.calls.push(`adapter.write ${path}`);
        if (this.folders.has(path)) throw eisdir();
        if (!this.folders.has(parentOf(path))) throw enoent(path);
        this.putOnDisk(path, data);
      },
      // Not recursive, as a mobile adapter may not be.
      mkdir: async (path) => {
        this.calls.push(`adapter.mkdir ${path}`);
        if (!this.folders.has(parentOf(path))) throw enoent(path);
        if (this.files.has(path)) throw new Error(`EEXIST: file already exists, '${path}'`);
        this.folders.add(path);
      },
    };
  }

  private buildVault(): FakeVault {
    return {
      adapter: this.buildAdapter(),
      getFiles: () => {
        this.calls.push('vault.getFiles');
        return [...this.indexed.values()].filter((file) => !isHiddenVaultPath(file.path));
      },
      getFileByPath: (path) => {
        this.calls.push(`vault.getFileByPath ${path}`);
        return this.indexed.get(path) ?? null;
      },
      getFolderByPath: (path) => {
        this.calls.push(`vault.getFolderByPath ${path}`);
        return this.folders.has(path) && this.visible(path) ? { path } : null;
      },
      read: async (file) => {
        this.calls.push(`vault.read ${file.path}`);
        return this.textAt(file.path);
      },
      readBinary: async (file) => {
        this.calls.push(`vault.readBinary ${file.path}`);
        return this.bufferAt(file.path);
      },
      modify: async (file, data) => {
        this.calls.push(`vault.modify ${file.path}`);
        this.putOnDisk(file.path, data);
      },
      create: async (path, data) => {
        this.calls.push(`vault.create ${path}`);
        if (!this.visible(path)) return this.createHidden(path, data);
        // Strict: refuses anything already at the path, indexed or not.
        if (this.indexed.has(path) || this.files.has(path) || this.folders.has(path))
          throw new Error('File already exists.');
        if (!this.folders.has(parentOf(path))) throw enoent(path);
        const file = new FakeFile(path, this.putOnDisk(path, data));
        this.indexed.set(path, file);
        return file;
      },
      createFolder: async (path) => {
        this.calls.push(`vault.createFolder ${path}`);
        if (!this.visible(path)) {
          this.createHiddenFolder(path);
          return undefined;
        }
        if (this.folders.has(path) || this.files.has(path))
          throw new Error('Folder already exists.');
        if (!this.folders.has(parentOf(path))) throw enoent(path);
        this.folders.add(path);
        return { path };
      },
    };
  }
}

export const hidingHost = (options: Omit<HostOptions, 'indexesHidden'> = {}) =>
  new FakeHost({ ...options, indexesHidden: false });
export const indexingHost = (options: Omit<HostOptions, 'indexesHidden'> = {}) =>
  new FakeHost({ ...options, indexesHidden: true });

/**
 * BOM, CRLF, non-ASCII, no trailing newline: every byte a normaliser would touch. Built from
 * code points so this source file stays plain ASCII.
 */
export const AWKWARD = `${String.fromCodePoint(0xfeff)}{"a":1}\r\n{"b":"caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x2713)}"}\r\n{"c":3}`;
export const BYTES = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 13, 10]);

export const HIDDEN = '.olea/concepts/concept-key1.json';
export const HIDDEN_LOG = '.olea/reviews/2026-09-25.device.jsonl';
export const NOTE = 'Course/Week 1/Lecture.md';
