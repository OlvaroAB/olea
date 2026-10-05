/**
 * `ol-egov.141.89.5.82`: a note that returns to its exact original bytes
 * while a below-floor edit is held must clear that held edit (as the
 * formatting-only exit already does), so the 30-minute drain never judges
 * text the note no longer holds, and a judge answer already in flight for it
 * is dropped, never committed as baseline.
 */
import { describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import {
  DEFAULT_MATERIALITY_CONSTANTS,
  MATERIALITY_PENDING_DRAIN_MS,
} from '../../../src/ingestion/materiality/constants.js';
import { computeMaterialityHashes } from '../../../src/ingestion/materiality/hashes.js';
import type {
  MaterialityHashStore,
  MaterialityJudge,
  MaterialityJudgeVerdict,
  MaterialityRecord,
} from '../../../src/ingestion/materiality/types.js';
import { MaterialityTrigger } from '../../../src/ingestion/materiality/wiring.js';

class FakeStore implements MaterialityHashStore {
  private readonly byPath = new Map<string, MaterialityRecord>();
  saves = 0;
  async load(path: string): Promise<MaterialityRecord | null> {
    return this.byPath.get(path) ?? null;
  }
  async save(record: MaterialityRecord): Promise<void> {
    this.saves += 1;
    this.byPath.set(record.path, record);
  }
}

function steppedClock(initial: number) {
  let current = initial;
  return { now: () => current, set: (next: number) => (current = next) };
}

const PATH = 'Courses/GEO101/Lecture 9.md';
const ORIGINAL = 'The reading was +5 degrees.';
// Same canonical length, different content: below the floor, held.
const EDITED = 'The reading was -5 degrees.';
// Same canonical content as ORIGINAL, different raw bytes.
const REFLOWED = 'The reading was   +5 degrees.';

async function seed(store: FakeStore): Promise<void> {
  await store.save({
    path: PATH,
    hashes: await computeMaterialityHashes(ORIGINAL),
    canonicalLength: canonicalizeForMateriality(ORIGINAL).length,
    lastChangedAt: 0,
    lastVerdictAt: null,
    revision: 1,
  });
  store.saves = 0;
}

describe('[ol-egov.141.89.5.82] returning to identical bytes clears a held below-floor edit', () => {
  it('a: the next observation clears the held edit; the drain makes no call and commits nothing', async () => {
    const store = new FakeStore();
    await seed(store);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    expect((await trigger.evaluate(PATH, EDITED, ORIGINAL)).kind).toBe('below-floor');
    const reverted = await trigger.evaluate(PATH, ORIGINAL, EDITED);
    expect(reverted.kind).toBe('unchanged');

    clock.set(clock.now() + MATERIALITY_PENDING_DRAIN_MS + 1);
    const drained = await trigger.drainDuePendingEdits(clock.now());
    expect(drained).toHaveLength(0);
    expect(judge.judge).not.toHaveBeenCalled();
    const record = await store.load(PATH);
    expect(record?.hashes).toEqual(await computeMaterialityHashes(ORIGINAL));
    expect(record?.revision).toBe(1);
    expect(record?.lastVerdictAt).toBeNull();
  });

  it('a: an identical-bytes observation with nothing held writes nothing', async () => {
    const store = new FakeStore();
    await seed(store);
    const trigger = new MaterialityTrigger({
      store,
      clock: steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge: { judge: vi.fn(async () => ({ material: true })) },
    });
    expect((await trigger.evaluate(PATH, ORIGINAL, ORIGINAL)).kind).toBe('unchanged');
    expect(store.saves).toBe(0);
  });

  it('b: a judge answer arriving after the revert is discarded; baseline stays at the original bytes', async () => {
    const store = new FakeStore();
    await seed(store);
    let resolveJudge: (v: MaterialityJudgeVerdict) => void = () => {};
    const held = new Promise<MaterialityJudgeVerdict>((r) => {
      resolveJudge = r;
    });
    let started: () => void = () => {};
    const judgeStarted = new Promise<void>((r) => {
      started = r;
    });
    const judge: MaterialityJudge = {
      judge: vi.fn(() => {
        started();
        return held;
      }),
    };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const onVerdict = vi.fn(async () => {});
    const trigger = new MaterialityTrigger({ store, clock, judge, onVerdict });

    expect((await trigger.evaluate(PATH, EDITED, ORIGINAL)).kind).toBe('below-floor');
    clock.set(clock.now() + MATERIALITY_PENDING_DRAIN_MS + 1);
    const draining = trigger.drainDuePendingEdits(clock.now());
    await judgeStarted;

    // The note returns to its exact original bytes while the call is in flight.
    expect((await trigger.evaluate(PATH, ORIGINAL, EDITED)).kind).toBe('unchanged');
    resolveJudge({ material: true, reason: 'late answer about reverted text' });
    const drained = await draining;

    expect(drained).toHaveLength(0);
    expect(onVerdict).not.toHaveBeenCalled();
    const record = await store.load(PATH);
    expect(record?.hashes).toEqual(await computeMaterialityHashes(ORIGINAL));
    expect(record?.revision).toBe(1);
    expect(record?.lastVerdictAt).toBeNull();

    // And the baseline text is the original: a later edit is judged against it.
    clock.set(clock.now() + 1);
    await trigger.evaluate(PATH, EDITED, ORIGINAL);
    clock.set(clock.now() + MATERIALITY_PENDING_DRAIN_MS + 1);
    await trigger.drainDuePendingEdits(clock.now());
    expect(judge.judge).toHaveBeenLastCalledWith({
      path: PATH,
      previousText: ORIGINAL,
      currentText: EDITED,
    });
  });

  it('c: the formatting-only exit still clears a held edit (unchanged behaviour)', async () => {
    const store = new FakeStore();
    await seed(store);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    expect((await trigger.evaluate(PATH, EDITED, ORIGINAL)).kind).toBe('below-floor');
    expect((await trigger.evaluate(PATH, REFLOWED, EDITED)).kind).toBe('formatting-only');
    clock.set(clock.now() + MATERIALITY_PENDING_DRAIN_MS + 1);
    expect(await trigger.drainDuePendingEdits(clock.now())).toHaveLength(0);
    expect(judge.judge).not.toHaveBeenCalled();
  });
});
