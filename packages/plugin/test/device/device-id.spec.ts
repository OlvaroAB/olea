import { isValidDeviceId, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_ID_STORAGE_KEY,
  ensureDeviceId,
  generateDeviceId,
  resetDeviceId,
} from '../../src/device/device-id.js';
import type { ObsidianDataHost } from '../../src/keyword-index/store.js';

/** A `data.json` that behaves like Obsidian's: one blob, shared by every feature. */
function fakeHost(initial: unknown = null): ObsidianDataHost & { blob: unknown; writes: number } {
  return {
    blob: initial,
    writes: 0,
    async loadData() {
      return this.blob;
    },
    async saveData(data: unknown) {
      this.blob = data;
      this.writes += 1;
    },
  };
}

describe('generateDeviceId', () => {
  it('produces an id core will accept in a review-log path', () => {
    const id = generateDeviceId();
    expect(isValidDeviceId(id)).toBe(true);
    // The real consumer, not a re-implementation of its rule: this is the call
    // that throws in production if the shape is wrong.
    expect(reviewLogPath('2026-08-10', id)).toBe(`.olea/reviews/2026-08-10.${id}.jsonl`);
  });

  it('is the documented shape and length', () => {
    const id = generateDeviceId(() => 0.123456789);
    expect(id.startsWith('olea-')).toBe(true);
    expect(id).toHaveLength('olea-'.length + 12);
  });

  it('fills the full length even when the random source returns short strings', () => {
    // `(0.5).toString(36)` is "0.i" — two characters after the prefix. A naive
    // single-draw implementation would emit a one-character id here, which is
    // still *valid* and therefore would not fail any shape assertion; it would
    // just quietly collide across installs. Hence the loop, and hence this test.
    const id = generateDeviceId(() => 0.5);
    expect(id).toHaveLength('olea-'.length + 12);
    expect(isValidDeviceId(id)).toBe(true);
  });

  it('differs between draws', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateDeviceId()));
    expect(ids.size).toBe(50);
  });
});

describe('ensureDeviceId', () => {
  it('mints and persists on first run', async () => {
    const host = fakeHost();
    const id = await ensureDeviceId(host);
    expect(isValidDeviceId(id)).toBe(true);
    expect((host.blob as Record<string, unknown>)[DEVICE_ID_STORAGE_KEY]).toBe(id);
    expect(host.writes).toBe(1);
  });

  it('returns the same id on every later call, without writing again', async () => {
    const host = fakeHost();
    const first = await ensureDeviceId(host);
    const second = await ensureDeviceId(host);
    const third = await ensureDeviceId(host);
    expect(second).toBe(first);
    expect(third).toBe(first);
    // The point of the assertion is the *absence* of a write: an id that is
    // rewritten on every plugin load is one bad merge away from changing, and a
    // changed id splits her history under a second filename.
    expect(host.writes).toBe(1);
  });

  it('never clobbers another feature sharing data.json', async () => {
    const host = fakeHost({
      keywordIndex: { version: 1, documents: [] },
      ingestionQueue: { v: 2 },
    });
    await ensureDeviceId(host);
    const blob = host.blob as Record<string, unknown>;
    expect(blob.keywordIndex).toEqual({ version: 1, documents: [] });
    expect(blob.ingestionQueue).toEqual({ v: 2 });
    expect(typeof blob[DEVICE_ID_STORAGE_KEY]).toBe('string');
  });

  it('replaces a stored id that core would reject, rather than returning it', async () => {
    // The failure this prevents is remote in time from its cause: a bad id
    // stored here does nothing until `reviewLogPath` is called, which happens
    // the moment she finishes a review.
    for (const bad of ['', '../escape', 'has space', '-leading-dash', 42, null]) {
      const host = fakeHost({ [DEVICE_ID_STORAGE_KEY]: bad });
      const id = await ensureDeviceId(host);
      expect(isValidDeviceId(id)).toBe(true);
      expect(id).not.toBe(bad);
      expect(() => reviewLogPath('2026-08-10', id)).not.toThrow();
    }
  });

  it('recovers when data.json holds something that is not an object at all', async () => {
    for (const junk of [null, 'corrupted', 7, []]) {
      const host = fakeHost(junk);
      const id = await ensureDeviceId(host);
      expect(isValidDeviceId(id)).toBe(true);
    }
  });

  it('does not leak anything about the machine into the id', () => {
    // A hostname or username in the id would be a fact about her written into a
    // filename inside a vault that syncs. The id is base-36 noise after a fixed
    // prefix, so there is nothing in it to leak — asserted structurally rather
    // than by grepping for particular words.
    const id = generateDeviceId();
    expect(id).toMatch(/^olea-[0-9a-z]{12}$/);
  });
});

describe('resetDeviceId (ol-1ttf, ruled by ol-ppxj.16)', () => {
  it('mints and persists a fresh id even when a valid one is already stored', async () => {
    const host = fakeHost({ [DEVICE_ID_STORAGE_KEY]: 'olea-aaaaaaaaaaaa' });
    const fresh = await resetDeviceId(host);
    expect(isValidDeviceId(fresh)).toBe(true);
    expect(fresh).not.toBe('olea-aaaaaaaaaaaa');
    expect((host.blob as Record<string, unknown>)[DEVICE_ID_STORAGE_KEY]).toBe(fresh);
    expect(host.writes).toBe(1);
  });

  it('mints a different id on every call — a full delete never reuses the id it just replaced', async () => {
    const host = fakeHost({ [DEVICE_ID_STORAGE_KEY]: 'olea-bbbbbbbbbbbb' });
    const first = await resetDeviceId(host);
    const second = await resetDeviceId(host);
    expect(first).not.toBe('olea-bbbbbbbbbbbb');
    expect(second).not.toBe(first);
  });

  it('never clobbers another feature sharing data.json', async () => {
    const host = fakeHost({
      [DEVICE_ID_STORAGE_KEY]: 'olea-cccccccccccc',
      keywordIndex: { version: 1, documents: [] },
    });
    await resetDeviceId(host);
    const blob = host.blob as Record<string, unknown>;
    expect(blob.keywordIndex).toEqual({ version: 1, documents: [] });
  });

  it('mints an id even from an empty or corrupted data.json', async () => {
    for (const junk of [null, 'corrupted', 7, []]) {
      const host = fakeHost(junk);
      const id = await resetDeviceId(host);
      expect(isValidDeviceId(id)).toBe(true);
    }
  });
});
