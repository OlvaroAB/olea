/**
 * `PersistentVaultSource` (`ol-3ux7.64.2` [WBX-1]) — proves the two claims
 * F9.S2 depends on: a write survives being wrapped in a fresh
 * `PersistentVaultSource` over a fresh base (the shape of a page reload,
 * since a real reload always re-fetches the fixture vault into a brand new
 * `MemoryVaultSource`), and a delete's tombstone survives the same way.
 *
 * The `setVisibilityCutoff` suite below (`ol-3ux7.64.16` [WBX-13]) proves the
 * term scrubber's own claim: a review-log file dated after the cutoff is
 * absent from `list`/`exists`/`read`/`readBinary` — never deleted, never
 * rewritten, and restored the instant the cutoff moves forward past it
 * again. Course material (any path outside `.olea/reviews/`) is unaffected
 * by the cutoff at any setting — "her material stays at its snapshot state."
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

  describe('setVisibilityCutoff (ol-3ux7.64.16 [WBX-13])', () => {
    const DEVICE = 'olea-sim-000000000000';
    const dayPath = (day: string) => `.olea/reviews/${day}.${DEVICE}.jsonl`;

    it('with no cutoff set, a review-log file of any date is visible', async () => {
      const vault = await PersistentVaultSource.create(freshBase(), createMemoryStore());
      await vault.write(dayPath('2027-03-01'), 'x\n');
      expect(await vault.exists(dayPath('2027-03-01'))).toBe(true);
      expect(await vault.list()).toEqual([dayPath('2027-03-01')]);
    });

    it('hides a review-log file dated AFTER the cutoff from list, exists and read', async () => {
      const vault = await PersistentVaultSource.create(freshBase(), createMemoryStore());
      await vault.write(dayPath('2027-03-05'), 'later\n');
      vault.setVisibilityCutoff('2027-03-01');

      expect(await vault.exists(dayPath('2027-03-05'))).toBe(false);
      expect(await vault.list()).toEqual([]);
      await expect(vault.read(dayPath('2027-03-05'))).rejects.toThrow();
      await expect(vault.readBinary(dayPath('2027-03-05'))).rejects.toThrow();
    });

    it('a review-log file dated ON the cutoff day is still visible — only strictly AFTER is hidden', async () => {
      const vault = await PersistentVaultSource.create(freshBase(), createMemoryStore());
      await vault.write(dayPath('2027-03-01'), 'today\n');
      vault.setVisibilityCutoff('2027-03-01');

      expect(await vault.exists(dayPath('2027-03-01'))).toBe(true);
      expect(await vault.read(dayPath('2027-03-01'))).toBe('today\n');
    });

    it('moving the cutoff forward past a hidden file restores it — nothing was deleted', async () => {
      const store = createMemoryStore();
      const vault = await PersistentVaultSource.create(freshBase(), store);
      await vault.write(dayPath('2027-03-05'), 'later\n');

      vault.setVisibilityCutoff('2027-03-01');
      expect(await vault.exists(dayPath('2027-03-05'))).toBe(false);
      // Never deleted: the overlay still holds it while it is hidden.
      expect((await store.loadOverlay()).has(dayPath('2027-03-05'))).toBe(true);

      vault.setVisibilityCutoff('2027-03-05');
      expect(await vault.exists(dayPath('2027-03-05'))).toBe(true);
      expect(await vault.read(dayPath('2027-03-05'))).toBe('later\n');

      vault.setVisibilityCutoff(null);
      expect(await vault.exists(dayPath('2027-03-05'))).toBe(true);
    });

    it('never hides material outside .olea/reviews/, at any cutoff', async () => {
      const base = freshBase(new Map([['01 Courses/vantrel/note.md', encode('material')]]));
      const vault = await PersistentVaultSource.create(base, createMemoryStore());
      vault.setVisibilityCutoff('1900-01-01');

      expect(await vault.exists('01 Courses/vantrel/note.md')).toBe(true);
      expect(await vault.read('01 Courses/vantrel/note.md')).toBe('material');
      expect(await vault.list()).toEqual(['01 Courses/vantrel/note.md']);
    });

    it('a malformed filename under the review-log folder is never mistaken for a dated file', async () => {
      const vault = await PersistentVaultSource.create(freshBase(), createMemoryStore());
      await vault.write('.olea/reviews/README.md', 'not a log file\n');
      vault.setVisibilityCutoff('1900-01-01');

      expect(await vault.exists('.olea/reviews/README.md')).toBe(true);
    });
  });
});

/**
 * Scrubbing a seeded persona world BACK through its own term
 * (`ol-3ux7.5.57.13` [MOM-9b], F9.S17). The mechanism is entirely the cutoff
 * above — this suite is about the property the scrub-back feature actually
 * rests on: as the cutoff walks forward day by day, the number of visible
 * review-log day files never decreases and ends at the full seeded set, and
 * not one byte of the seeded history (or of the world's authored notes) is
 * rewritten at any position.
 */
describe('PersistentVaultSource — windowing a seeded term day by day', () => {
  const DEVICE = 'sim-persona-000000000000';
  const seededDays = ['2026-05-04', '2026-05-18', '2026-06-15', '2026-07-20', '2026-08-28'];

  async function seededVault() {
    const store = createMemoryStore();
    const vault = await PersistentVaultSource.create(
      freshBase(new Map([['01 Courses/vantrel/note.md', encode('material')]])),
      store,
    );
    for (const day of seededDays) {
      await vault.write(
        `.olea/reviews/${day}.${DEVICE}.jsonl`,
        `{"timestamp":"${day}T09:00:00Z"}\n`,
      );
    }
    return { store, vault };
  }

  it('shows more of the term the further forward the cutoff walks, and never fewer', async () => {
    const { vault } = await seededVault();
    const counts: number[] = [];
    for (const day of [...seededDays, '2026-12-18']) {
      vault.setVisibilityCutoff(day);
      counts.push(await vault.visibleReviewLogDayCount());
    }
    expect(counts).toEqual([1, 2, 3, 4, 5, 5]);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1] as number);
    }
  });

  it('hides the later days at an earlier cutoff and restores every one of them at asOf', async () => {
    const { vault } = await seededVault();
    vault.setVisibilityCutoff('2026-06-15');
    expect(await vault.exists(`.olea/reviews/2026-08-28.${DEVICE}.jsonl`)).toBe(false);
    await expect(vault.read(`.olea/reviews/2026-08-28.${DEVICE}.jsonl`)).rejects.toThrow();

    vault.setVisibilityCutoff('2026-08-28');
    expect(await vault.exists(`.olea/reviews/2026-08-28.${DEVICE}.jsonl`)).toBe(true);
    expect(await vault.read(`.olea/reviews/2026-08-28.${DEVICE}.jsonl`)).toBe(
      '{"timestamp":"2026-08-28T09:00:00Z"}\n',
    );
  });

  it('never rewrites the overlay while windowing — the same bytes are stored at every cutoff', async () => {
    const { store, vault } = await seededVault();
    const before = await store.loadOverlay();
    for (const day of ['2026-05-04', '2026-07-20', '2026-08-28']) {
      vault.setVisibilityCutoff(day);
      await vault.visibleReviewLogDayCount();
    }
    const after = await store.loadOverlay();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it("leaves the world's authored notes visible at every cutoff, including term start", async () => {
    const { vault } = await seededVault();
    for (const day of ['2026-05-04', '2026-08-28']) {
      vault.setVisibilityCutoff(day);
      expect(await vault.exists('01 Courses/vantrel/note.md')).toBe(true);
      expect(await vault.read('01 Courses/vantrel/note.md')).toBe('material');
    }
  });
});
