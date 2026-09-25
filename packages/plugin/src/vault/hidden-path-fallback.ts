/**
 * ObsidianSource's per-path reads, checks and writes, with a raw-adapter fallback for hidden
 * paths (ol-egov.141.89.10.57). Obsidian-free, against a narrow structural type shaped like
 * Obsidian's Vault and its DataAdapter, for the same reason dot-folder-walk.ts is:
 * obsidian-source.ts cannot be imported under vitest, so the decisions live here and
 * ObsidianSource is a thin caller (see hidden-path-fallback.spec.ts).
 *
 * The problem. Every Olea store lives under .olea/, and ObsidianSource resolved each path
 * through the vault index (getFileByPath, then vault.read, vault.modify or vault.create). A real
 * host's getFiles never returns a dot path; nothing on record says whether its getFileByPath,
 * createFolder and create do either (the obsidian typings are silent, and no .olea read or
 * write has been observed on a real host). If the index hides them, read throws, exists says
 * false, and an exists-read-write append overwrites the file every time.
 *
 * The rule, safe under either answer:
 * - The vault index is always asked first. Whatever it resolves goes through the vault API
 *   exactly as before (vault.read, never cachedRead: INV-2 round trips need the disk bytes).
 * - Only a HIDDEN path (some segment starts with a dot, which the vault index skips) that the
 *   index does not resolve falls back to the raw adapter. An ordinary note keeps the
 *   vault-only code path exactly, including a note the index has not caught up with yet.
 * - read and readBinary: adapter.read or adapter.readBinary, which go to disk. If that fails
 *   and adapter.stat finds no file there, the error is the no-such-file error an index miss
 *   gives.
 * - exists and firstSeen: adapter.stat, counting a file only (never a folder), as the index
 *   lookup does.
 * - write, when adapter.stat finds a file already on disk: adapter.write overwrites it in
 *   place. Never create, which would throw "already exists" or duplicate it.
 * - write of a new hidden file: the vault route first (createFolder per missing segment,
 *   then vault.create), so a host that indexes hidden paths behaves exactly as before and never
 *   sees adapter-made folders it has not indexed yet. If that route throws, or returns without
 *   leaving a file on disk, the adapter makes the missing folders one level at a time and writes
 *   the file. Both routes write the whole string as given, so a retry is idempotent.
 *
 * The adapter members below (stat, read, readBinary, write, mkdir) are required, not optional:
 * a real Obsidian DataAdapter always has every one, and since ol-3ux7.64.25 so does the
 * workbench shim's adapter (packages/workbench/src/obsidian-shim/vault-shim.ts), built over the
 * same ShimVaultSource its Vault already uses. The shim's index resolves dot paths on its own
 * (see that file's module doc), so nothing it runs today exercises the fallback branch through
 * these members — they are here so the type is honest about what every real caller provides.
 */

/** The slice of Obsidian's Stat this module reads. */
export interface RawStat {
  readonly type: 'file' | 'folder';
  readonly ctime: number;
}

/** Obsidian's DataAdapter, reduced to the per-path members the fallback uses. */
export interface RawFileAdapter {
  exists(normalizedPath: string): Promise<boolean>;
  stat(normalizedPath: string): Promise<RawStat | null>;
  read(normalizedPath: string): Promise<string>;
  readBinary(normalizedPath: string): Promise<ArrayBuffer>;
  write(normalizedPath: string, data: string): Promise<void>;
  mkdir(normalizedPath: string): Promise<void>;
}

/** The part of Obsidian's TFile this module reads. */
export interface IndexedFile {
  readonly stat: { readonly ctime: number };
}

/** Obsidian's Vault, reduced to the index lookups and file calls ObsidianSource makes. */
export interface IndexedVault<F extends IndexedFile> {
  getFileByPath(path: string): F | null;
  getFolderByPath(path: string): unknown;
  read(file: F): Promise<string>;
  readBinary(file: F): Promise<ArrayBuffer>;
  modify(file: F, data: string): Promise<void>;
  create(path: string, data: string): Promise<unknown>;
  createFolder(path: string): Promise<unknown>;
  readonly adapter: RawFileAdapter;
}

/**
 * True when any segment starts with a dot: the paths Obsidian's vault index skips (.olea/...,
 * .obsidian/..., a dot-named file or folder at any depth). A dot inside a name (a.b/c.md) does
 * not count.
 */
export function isHiddenVaultPath(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.'));
}

function noSuchFile(path: string, cause?: unknown): Error {
  return new Error(
    `ObsidianSource: no such file: ${path}`,
    cause === undefined ? undefined : { cause },
  );
}

/** The adapter to fall back to for this path, or null when the rule above gives none. Every IndexedVault's adapter has the full RawFileAdapter surface (see this module's doc), so a hidden path always has one to fall back to. */
function fallbackFor<F extends IndexedFile>(
  vault: IndexedVault<F>,
  path: string,
): RawFileAdapter | null {
  return isHiddenVaultPath(path) ? vault.adapter : null;
}

async function isFileOnDisk(raw: RawFileAdapter, path: string): Promise<boolean> {
  return (await raw.stat(path))?.type === 'file';
}

async function readFromDisk<T>(
  raw: RawFileAdapter,
  path: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!(await isFileOnDisk(raw, path).catch(() => false))) throw noSuchFile(path, error);
    throw error;
  }
}

export async function readVaultText<F extends IndexedFile>(
  vault: IndexedVault<F>,
  path: string,
): Promise<string> {
  const file = vault.getFileByPath(path);
  if (file !== null) return vault.read(file);
  const raw = fallbackFor(vault, path);
  if (raw === null) throw noSuchFile(path);
  return readFromDisk(raw, path, () => raw.read(path));
}

export async function readVaultBinary<F extends IndexedFile>(
  vault: IndexedVault<F>,
  path: string,
): Promise<ArrayBuffer> {
  const file = vault.getFileByPath(path);
  if (file !== null) return vault.readBinary(file);
  const raw = fallbackFor(vault, path);
  if (raw === null) throw noSuchFile(path);
  return readFromDisk(raw, path, () => raw.readBinary(path));
}

export async function vaultFileExists<F extends IndexedFile>(
  vault: IndexedVault<F>,
  path: string,
): Promise<boolean> {
  if (vault.getFileByPath(path) !== null) return true;
  const raw = fallbackFor(vault, path);
  return raw === null ? false : isFileOnDisk(raw, path);
}

export async function vaultFileFirstSeen<F extends IndexedFile>(
  vault: IndexedVault<F>,
  path: string,
): Promise<number | null> {
  const file = vault.getFileByPath(path);
  if (file !== null) return file.stat.ctime;
  const raw = fallbackFor(vault, path);
  if (raw === null) return null;
  const stat = await raw.stat(path);
  return stat?.type === 'file' ? stat.ctime : null;
}

export async function writeVaultText<F extends IndexedFile>(
  vault: IndexedVault<F>,
  path: string,
  content: string,
): Promise<void> {
  const existing = vault.getFileByPath(path);
  if (existing !== null) {
    await vault.modify(existing, content);
    return;
  }
  const raw = fallbackFor(vault, path);
  if (raw === null) {
    await ensureParentFolderViaVault(vault, path);
    await vault.create(path, content);
    return;
  }

  const onDisk = await raw.stat(path);
  if (onDisk !== null) {
    if (onDisk.type !== 'file') {
      throw new Error(`ObsidianSource.write: a folder, not a file, is at ${path}`);
    }
    await raw.write(path, content);
    return;
  }

  const vaultFailure = await createViaVault(vault, path, content);
  if (vaultFailure === null && (await isFileOnDisk(raw, path))) return;

  try {
    await ensureParentFolderViaAdapter(raw, path);
    await raw.write(path, content);
  } catch (adapterError) {
    throw new AggregateError(
      vaultFailure === null ? [adapterError] : [vaultFailure.error, adapterError],
      `ObsidianSource.write: could not write ${path} through the vault or the adapter`,
    );
  }
}

/** The vault's new-file route; null when it returned, the thrown value when it did not. */
async function createViaVault<F extends IndexedFile>(
  vault: IndexedVault<F>,
  path: string,
  content: string,
): Promise<{ readonly error: unknown } | null> {
  try {
    await ensureParentFolderViaVault(vault, path);
    await vault.create(path, content);
    return null;
  } catch (error) {
    return { error };
  }
}

/** Folder creation through the vault API, as the class always did it. */
async function ensureParentFolderViaVault<F extends IndexedFile>(
  vault: IndexedVault<F>,
  path: string,
): Promise<void> {
  const segments = path.split('/');
  segments.pop(); // drop the file name, keep folder segments only
  let ancestor = '';
  for (const segment of segments) {
    ancestor = ancestor === '' ? segment : `${ancestor}/${segment}`;
    if (vault.getFolderByPath(ancestor) !== null) continue;
    try {
      await vault.createFolder(ancestor);
    } catch {
      // Lost a race with another writer creating the same folder
      // concurrently — fine, as long as it exists now.
      if (vault.getFolderByPath(ancestor) === null)
        throw new Error(`ObsidianSource: could not create folder: ${ancestor}`);
    }
  }
}

/** The same walk against the raw adapter, one level at a time (a mobile mkdir may not recurse). */
async function ensureParentFolderViaAdapter(raw: RawFileAdapter, path: string): Promise<void> {
  const segments = path.split('/');
  segments.pop();
  let ancestor = '';
  for (const segment of segments) {
    ancestor = ancestor === '' ? segment : `${ancestor}/${segment}`;
    if (await raw.exists(ancestor)) continue;
    try {
      await raw.mkdir(ancestor);
    } catch (error) {
      if (!(await raw.exists(ancestor))) {
        throw new Error(`ObsidianSource: could not create folder: ${ancestor}`, { cause: error });
      }
    }
  }
}
