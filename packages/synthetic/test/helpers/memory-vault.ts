/**
 * A `VaultSource` that records every write, for the guard tests.
 *
 * It deliberately does **not** refuse anything itself: the point of
 * `test/guard.spec.ts` is that `olea-synthetic` refuses, so the vault under it
 * has to be perfectly willing to accept a bad write. A vault that also said no
 * would make the guard untestable — the test would pass whether or not the
 * guard existed, which is the vacuity failure this bead is written against.
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';

export class MemoryVault implements VaultSource {
  readonly files = new Map<VaultPath, string>();
  /** Every path `write` was called with, in order, including overwrites. */
  readonly writes: VaultPath[] = [];

  list(_options?: ListOptions): Promise<readonly VaultPath[]> {
    return Promise.resolve([...this.files.keys()]);
  }

  read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined)
      return Promise.reject(new Error(`MemoryVault: no such file ${path}`));
    return Promise.resolve(content);
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((text) => new TextEncoder().encode(text));
  }

  write(path: VaultPath, content: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, content);
    return Promise.resolve();
  }

  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}
