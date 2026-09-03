/**
 * `PersistentVaultSource` (`ol-3ux7.64.2` [WBX-1]) — proves the two claims
 * F9.S2 depends on: a write survives being wrapped in a fresh
 * `PersistentVaultSource` over a fresh base (the shape of a page reload,
 * since a real reload always re-fetches the fixture vault into a brand new
 * `MemoryVaultSource`), and a delete's tombstone survives the same way.
 */
import { describe, expect, it } from 'vitest';
import { PersistentVaultSource } from '../src/simulator/persistent-vault.js';
import { createMemoryStore } from '../src/simulator/store.js';
import { MemoryVaultSource } from '../src/vault/memory-source.js';

function freshBase(entries: ReadonlyMap<string, Uint8Array> = new Map()): MemoryVaultSource {
  return MemoryVaultSource.fromBytes(entries);
}

const encode = (s: string) => new TextEncoder().encode(s);

describe('PersistentVaultSource', () => {
  it('reads and lists straight from the base when nothing has been overlaid', async () => {
    const base = freshBase(new Map([['note.md', encode('hello')]]));
    const store = createMemoryStore();
    const vault = await PersistentVaultSource.create(base, store);

    expect(await vault.list()).toEqual(['note.md']);
    expect(await vault.read('note.md')).toBe('hello');
  });

  it('a write lands in the overlay AND the in-memory base immediately', async () => {
    const store = createMemoryStore();
    const vault = await PersistentVaultSource.create(freshBase(), store);

    await vault.write(
      '.olea/reviews/2027-01-15.olea-sim-000000000000.jsonl',
      '{"kind":"review"}\n',
    );

    expect(await vault.read('.olea/reviews/2027-01-15.olea-sim-000000000000.jsonl')).toBe(
      '{"kind":"review"}\n',
    );
    const overlay = await store.loadOverlay();
    expect(overlay.has('.olea/reviews/2027-01-15.olea-sim-000000000000.jsonl')).toBe(true);
  });

  it('a write SURVIVES being re-applied onto a brand new base — the shape of a page reload', async () => {
    const store = createMemoryStore();
    const first = await PersistentVaultSource.create(freshBase(), store);
    await first.write('note.md', 'written once');

    // A reload never reuses the old MemoryVaultSource — it fetches a fresh one.
    const second = await PersistentVaultSource.create(freshBase(), store);

    expect(await second.exists('note.md')).toBe(true);
    expect(await second.read('note.md')).toBe('written once');
  });

  it('a delete tombstone survives the same reload shape, even over a base that starts with the file', async () => {
    const store = createMemoryStore();
    const seeded = new Map([['note.md', encode('seed')]]);
    const first = await PersistentVaultSource.create(freshBase(seeded), store);
    await first.delete('note.md');
    expect(await first.exists('note.md')).toBe(false);

    const second = await PersistentVaultSource.create(freshBase(seeded), store);
    expect(await second.exists('note.md')).toBe(false);
  });

  it('never fabricates a file: a path nobody wrote is absent from list() after a reload', async () => {
    const store = createMemoryStore();
    await PersistentVaultSource.create(freshBase(), store);
    const second = await PersistentVaultSource.create(freshBase(), store);
    expect(await second.list()).toEqual([]);
  });

  it('watch forwards events from writes made through this wrapper', async () => {
    const store = createMemoryStore();
    const vault = await PersistentVaultSource.create(freshBase(), store);
    const events: string[] = [];
    vault.watch((event) => events.push(`${event.kind}:${event.path}`));

    await vault.write('a.md', 'x');
    await vault.write('a.md', 'y');
    await vault.delete('a.md');

    expect(events).toEqual(['create:a.md', 'modify:a.md', 'delete:a.md']);
  });
});
