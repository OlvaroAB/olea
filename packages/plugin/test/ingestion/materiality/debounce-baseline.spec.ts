/**
 * Defect 1 (`ol-egov.141.89.5.7`, ILB-CHG-B1): "A save inside the 3-minute
 * debounce window replaces the stored comparison point without any
 * judgment, and nothing re-checks after the window closes, so later
 * autosaves in one editing session are never judged."
 *
 * Mirrors the source-change case set's `debounce-burst` gate case
 * (`eval/data/ilb/chg/`, olea-service): two saves a few seconds apart, the
 * second landing inside the debounce window opened by the first. Neither
 * save alone clears the free gates; the accumulated edit against the
 * ORIGINAL baseline is material and must eventually reach the judge once
 * the debounce window closes with nothing else touching the path — the same
 * "never go undecided forever" rule `[DOS-3]`'s below-floor drain already
 * enforces for a different free-gate exit.
 */
import { describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
import { computeMaterialityHashes } from '../../../src/ingestion/materiality/hashes.js';
import type {
  MaterialityHashStore,
  MaterialityJudge,
  MaterialityRecord,
} from '../../../src/ingestion/materiality/types.js';
import { MaterialityTrigger } from '../../../src/ingestion/materiality/wiring.js';

class FakeStore implements MaterialityHashStore {
  private readonly byPath = new Map<string, MaterialityRecord>();
  async load(path: string): Promise<MaterialityRecord | null> {
    return this.byPath.get(path) ?? null;
  }
  async save(record: MaterialityRecord): Promise<void> {
    this.byPath.set(record.path, record);
  }
}

function steppedClock(initial: number) {
  let current = initial;
  return { now: () => current, set: (next: number) => (current = next) };
}

const PATH = 'Field notes/Map projections.md';
const R0 = 'A map projection trades one distortion for another.';

async function seed(store: FakeStore, text: string, lastChangedAt: number): Promise<void> {
  const hashes = await computeMaterialityHashes(text);
  await store.save({
    path: PATH,
    hashes,
    canonicalLength: canonicalizeForMateriality(text).length,
    lastChangedAt,
    lastVerdictAt: null,
    revision: 1,
  });
}

describe('defect 1 (ol-egov.141.89.5.7): a debounced save does not silently move the baseline', () => {
  const FIRST_EDIT = `${R0} Ok.`; // +4 chars — below the 8-char floor
  const SECOND_EDIT = `${R0} Ok, usually much more so near the poles.`; // large, clears the floor on its own

  it('a save inside the debounce window does not advance the stored comparison point', async () => {
    const store = new FakeStore();
    await seed(store, R0, 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    // Well clear of debounce for the FIRST edit.
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // First edit: below the floor (a short qualifier), deferred.
    const first = await trigger.evaluate(PATH, FIRST_EDIT, R0);
    expect(first.kind).toBe('below-floor');

    // Second edit, 3 seconds later — inside the debounce window THIS save
    // opens, and large enough on its own to clear the floor.
    clock.set(clock.now() + 3000);
    const second = await trigger.evaluate(PATH, SECOND_EDIT, FIRST_EDIT);
    expect(second.kind).toBe('debounced');
    expect(judge.judge).not.toHaveBeenCalled();

    // The persisted comparison point must still be the ORIGINAL baseline
    // (R0), never the intervening below-floor or debounced save — the exact
    // failure this defect names: "replaces the stored comparison point
    // without any judgment."
    const record = await store.load(PATH);
    expect(record?.canonicalLength).toBe(canonicalizeForMateriality(R0).length);
  });

  it('once the debounce window closes with nothing else touching the path, the accumulated edit still reaches the judge', async () => {
    const store = new FakeStore();
    await seed(store, R0, 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    await trigger.evaluate(PATH, FIRST_EDIT, R0);
    clock.set(clock.now() + 3000);
    const debounced = await trigger.evaluate(PATH, SECOND_EDIT, FIRST_EDIT);
    expect(debounced.kind).toBe('debounced');

    // Nothing else touches this path. Before the debounce window closes:
    // nothing to do yet.
    clock.set(clock.now() + DEFAULT_MATERIALITY_CONSTANTS.debounceMs - 1);
    const tooSoon = await trigger.drainDuePendingEdits(clock.now());
    expect(tooSoon).toHaveLength(0);
    expect(judge.judge).not.toHaveBeenCalled();

    // Once the window closes, the drain forces the ORIGINAL baseline against
    // the LATEST text to the judge — exactly one call, never the two-call
    // "each save judged against its immediate predecessor" shape that would
    // hide the accumulated edit.
    clock.set(clock.now() + 2);
    const drained = await trigger.drainDuePendingEdits(clock.now());
    expect(judge.judge).toHaveBeenCalledOnce();
    expect(judge.judge).toHaveBeenCalledWith({
      path: PATH,
      previousText: R0,
      currentText: SECOND_EDIT,
    });
    expect(drained).toHaveLength(1);
    expect(drained[0]?.material).toBe(true);

    // Draining again is a no-op — the pending marker was consumed.
    const drainedAgain = await trigger.drainDuePendingEdits(clock.now() + 1_000_000);
    expect(drainedAgain).toHaveLength(0);
    expect(judge.judge).toHaveBeenCalledOnce();
  });
});
