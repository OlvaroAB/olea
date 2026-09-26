/**
 * `ObsidianSource.removeEmptyFolder` (`ol-egov.141.8.9`), over a fake `App`
 * whose `vault.adapter` mimics the two `DataAdapter` calls the real
 * implementation makes: `exists` and `rmdir(path, false)` — Obsidian's own
 * non-recursive form, which the adapter's own doc says "the folder needs to
 * be empty" for. `obsidian-source.ts` needs only `TFile` at runtime, so this
 * one-line `vi.mock` is enough to import the real class here, same pattern
 * as `obsidian-source-hidden-paths.spec.ts`.
 *
 * Deliberately its own file rather than editing that one — that file
 * belongs to a different bead; see `LANE-RULES-r2.md`.
 */

import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ TFile: class TFile {} }));

import { ObsidianSource } from '../../src/vault/obsidian-source.js';

/** A minimal `Vault.adapter`-shaped fake: a flat map of paths to folder-ness. */
class FakeAdapter {
  private readonly folders = new Set<string>();
  private readonly files = new Map<string, string>();

  addFolder(path: string): void {
    this.folders.add(path);
  }

  addFile(path: string, content = ''): void {
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.folders.has(path) || this.files.has(path);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    if (!this.folders.has(path)) return;
    const hasChildren =
      [...this.folders].some((f) => f !== path && f.startsWith(`${path}/`)) ||
      [...this.files.keys()].some((f) => f.startsWith(`${path}/`));
    if (hasChildren && !recursive) {
      throw new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`);
    }
    this.folders.delete(path);
    if (recursive) {
      for (const f of [...this.files.keys()]) if (f.startsWith(`${path}/`)) this.files.delete(f);
      for (const f of [...this.folders]) if (f.startsWith(`${path}/`)) this.folders.delete(f);
    }
  }
}

function sourceOver(adapter: FakeAdapter): ObsidianSource {
  return new ObsidianSource({ vault: { adapter } } as unknown as App);
}

describe('ObsidianSource.removeEmptyFolder', () => {
  it('removes an empty folder via a non-recursive adapter.rmdir', async () => {
    const adapter = new FakeAdapter();
    adapter.addFolder('.olea/concepts');
    const source = sourceOver(adapter);

    // Failing-first: before this bead, VaultSource/ObsidianSource had no removeEmptyFolder
    // method, so this call was a TypeError, not a resolved promise.
    await source.removeEmptyFolder?.('.olea/concepts');

    expect(await adapter.exists('.olea/concepts')).toBe(false);
  });

  it('refuses a non-empty folder, never recursively, and leaves its contents in place', async () => {
    const adapter = new FakeAdapter();
    adapter.addFolder('.olea/concepts');
    adapter.addFile('.olea/concepts/key-1.json', '{"key":1}\n');
    const source = sourceOver(adapter);

    await expect(source.removeEmptyFolder?.('.olea/concepts')).rejects.toThrow();

    expect(await adapter.exists('.olea/concepts')).toBe(true);
    expect(await adapter.exists('.olea/concepts/key-1.json')).toBe(true);
  });

  it('is a no-op, never a throw, on a folder that does not exist', async () => {
    const adapter = new FakeAdapter();
    const source = sourceOver(adapter);

    await expect(source.removeEmptyFolder?.('.olea/never-existed')).resolves.toBeUndefined();
  });

  it('rejects an invalid path with the same message shape as delete/write', async () => {
    const adapter = new FakeAdapter();
    const source = sourceOver(adapter);

    await expect(source.removeEmptyFolder?.('/abs')).rejects.toThrow(
      'ObsidianSource: not a valid vault path: "/abs"',
    );
  });
});
