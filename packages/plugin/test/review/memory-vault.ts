/**
 * A `VaultSource` over a literal map of files, for the review-wiring suite.
 *
 * A local copy rather than an import of `packages/core`'s equivalent: that one
 * lives under `packages/core/test/`, which is outside this package's tsconfig,
 * and it deliberately records writes without performing them because its suites
 * assert the pipeline writes *nothing*. This one performs them, because
 * `open-session.spec.ts` asserts the opposite of exactly one file — that rating
 * an item really does append a D7.1 record — and a fake that only recorded the
 * call could not read it back.
 *
 * `list()` sees every file, including the dot-prefixed `.olea/reviews/` tree.
 * That is `FolderSource`-unlike and Obsidian-unlike on purpose: the suite that
 * cares about listing-blind hosts is `today/data-source.spec.ts`, and this one
 * needs the log to be readable by both routes so that a failure points at the
 * wiring rather than at discovery.
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';

export interface MemoryVault extends VaultSource {
  /** Every path written, in order — so a suite can assert that no *note* was touched. */
  readonly writes: readonly VaultPath[];
  /** Current content of a path, for reading a written log back. */
  contentOf(path: VaultPath): string | undefined;
}

function extensionOf(path: VaultPath): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase();
}

export function memoryVault(files: Readonly<Record<string, string>> = {}): MemoryVault {
  const contents = new Map<VaultPath, string>(Object.entries(files));
  const writes: VaultPath[] = [];

  return {
    writes,
    contentOf: (path) => contents.get(path),
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

/** A vault whose walk fails — the "could not read your vault" case, which is not "nothing is due". */
export function unreadableVault(message = 'vault unavailable'): VaultSource {
  const boom = () => {
    throw new Error(message);
  };
  return {
    list: async () => boom(),
    read: async () => boom(),
    readBinary: async () => boom(),
    write: async () => boom(),
    exists: async () => boom(),
    watch: () => () => undefined,
  } as unknown as VaultSource;
}
