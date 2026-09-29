/**
 * A `VaultSource` over a literal map, for the unit manifest store's suites (`[D-445]`,
 * `ol-egov.141.89.8.43`): unlike `../review/memory-vault.ts` it holds bytes, deletes, fails a write
 * on demand and lets a test emit vault events, because the store's behaviour under deletion, a
 * changed source and a broken write is the thing under test. `list()` sees every path, dot-prefixed
 * ones included, so a failure points at the store rather than at discovery.
 *
 * Every string in a suite that uses it is invented (INV-3).
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';

export interface EventedTestVault extends VaultSource {
  /** Every path written through `write`, in order: what a suite asserts stayed inside `.olea/`. */
  readonly writes: VaultPath[];
  /** Sets a file's content outside the store (her edit, a sync arriving), without recording a write. */
  put(path: VaultPath, content: string | Uint8Array): void;
  contentOf(path: VaultPath): string | undefined;
  paths(): readonly VaultPath[];
  emit(event: VaultEvent): void;
  /** While true, `write` rejects. */
  failWrites: boolean;
  /** A snapshot of every file, for building a second device's copy of a vault. */
  snapshot(): ReadonlyMap<VaultPath, string | Uint8Array>;
}

function extensionOf(path: VaultPath): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase();
}

function textOf(content: string | Uint8Array): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

export function eventedTestVault(
  files: Readonly<Record<string, string | Uint8Array>> = {},
): EventedTestVault {
  const contents = new Map<VaultPath, string | Uint8Array>(Object.entries(files));
  const handlers = new Set<(event: VaultEvent) => void>();
  const writes: VaultPath[] = [];
  const vault: EventedTestVault = {
    writes,
    failWrites: false,
    put: (path, content) => {
      contents.set(path, content);
    },
    contentOf: (path) => {
      const content = contents.get(path);
      return content === undefined ? undefined : textOf(content);
    },
    paths: () => [...contents.keys()].sort(),
    emit: (event) => {
      for (const handler of [...handlers]) handler(event);
    },
    snapshot: () => new Map(contents),
    async list(options: ListOptions = {}) {
      const extensions = options.extensions?.map((ext) => ext.toLowerCase());
      return [...contents.keys()]
        .filter((path) => options.under === undefined || path.startsWith(`${options.under}/`))
        .filter((path) => {
          if (extensions === undefined) return true;
          const ext = extensionOf(path);
          return ext !== undefined && extensions.includes(ext);
        })
        .sort();
    },
    async read(path) {
      const content = contents.get(path);
      if (content === undefined) throw new Error(`eventedTestVault: no such file ${path}`);
      return textOf(content);
    },
    async readBinary(path) {
      const content = contents.get(path);
      if (content === undefined) throw new Error(`eventedTestVault: no such file ${path}`);
      return typeof content === 'string' ? new TextEncoder().encode(content) : content;
    },
    async write(path, content) {
      if (vault.failWrites) throw new Error('eventedTestVault: write refused');
      writes.push(path);
      contents.set(path, content);
    },
    async exists(path) {
      return contents.has(path);
    },
    async delete(path) {
      contents.delete(path);
    },
    watch(handler): Unsubscribe {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
  return vault;
}
