/**
 * A `VaultSource` over a literal map of files, for this folder's suites.
 *
 * Not exported from the package. It exists so the session pipeline can be
 * tested against vaults small enough to read in one screen — one note with one
 * card, a note with no `topic:`, a note with a broken MCQ — which is the only
 * way a suite can claim a specific behaviour rather than "something happened
 * over the fixture corpus". The fixture-vault integration suite
 * (`test/session/fixture-vault.spec.ts`) makes the corpus-shaped claims.
 *
 * `writes` is recorded rather than performed, because several of these suites
 * assert that the pipeline writes **nothing** (D-030's irreversible half stays
 * unbuilt), and a fake that silently accepted writes could not tell them.
 */

import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from '../../src/vault/types.js';

export interface MemoryVault extends VaultSource {
  /** Every path this vault was asked to write, in order. Asserted to be empty by the read-only suites. */
  readonly writes: readonly VaultPath[];
}

function extensionOf(path: VaultPath): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase();
}

export function memoryVault(files: Readonly<Record<string, string>>): MemoryVault {
  const contents = new Map<VaultPath, string>(Object.entries(files));
  const writes: VaultPath[] = [];

  return {
    writes,
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
    async read(path: VaultPath) {
      const content = contents.get(path);
      if (content === undefined) throw new Error(`memoryVault: no such file ${path}`);
      return content;
    },
    async readBinary(path: VaultPath) {
      return new TextEncoder().encode(await this.read(path));
    },
    async write(path: VaultPath, content: string) {
      writes.push(path);
      contents.set(path, content);
    },
    async exists(path: VaultPath) {
      return contents.has(path);
    },
    watch(_handler: (event: VaultEvent) => void): Unsubscribe {
      return () => undefined;
    },
  };
}
