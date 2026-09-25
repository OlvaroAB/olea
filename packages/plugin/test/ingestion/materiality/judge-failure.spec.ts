/**
 * Defect 3 (`ol-egov.141.89.5.7`, ILB-CHG-B1): "An operational failure of
 * the judge call is dropped instead of being treated as changed."
 *
 * Mirrors the source-change case set's `provider-unavailable` gate case
 * (`eval/data/ilb/chg/`, olea-service): the judge call itself throws (a
 * refused/unauthorised request, a network failure). Before this fix, the
 * throw propagated straight out of `evaluate()`/`drainDuePendingEdits`, past
 * `main.ts`'s own try/catch (`evaluateMaterialityChange`), which only logs
 * and swallows it — so NEITHER of row 1.4's consumers (the material-arrival
 * timestamp, the authored-note generation sweep) ever ran, and nothing was
 * invalidated. `evaluate()` must always RETURN a result its caller can act
 * on, never throw past it.
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

function fakeClock(now: number) {
  return { now: () => now };
}

const PATH = 'Field notes/Sluice.md';
const R0 = 'The sluice gate is inspected every spring before the melt.';
const R1 = `${R0} A second inspection follows any flood warning.`;

async function seed(store: FakeStore, text: string): Promise<void> {
  const hashes = await computeMaterialityHashes(text);
  await store.save({
    path: PATH,
    hashes,
    canonicalLength: canonicalizeForMateriality(text).length,
    lastChangedAt: -DEFAULT_MATERIALITY_CONSTANTS.debounceMs * 100,
    lastVerdictAt: null,
    revision: 1,
  });
}

describe('defect 3 (ol-egov.141.89.5.7): an operational judge failure is reported, never dropped', () => {
  it('evaluate() resolves to judge-unavailable, rather than throwing, when the judge call rejects', async () => {
    const store = new FakeStore();
    await seed(store, R0);
    const judge: MaterialityJudge = {
      judge: vi.fn(async () => {
        throw new Error('401 Unauthorized');
      }),
    };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    await expect(trigger.evaluate(PATH, R1, R0)).resolves.toEqual({ kind: 'judge-unavailable' });
  });

  it('never advances the stored baseline on a failed call — the SAME delta is retried once the judge answers', async () => {
    const store = new FakeStore();
    await seed(store, R0);
    const judge: MaterialityJudge = {
      judge: vi.fn(async () => {
        throw new Error('503 Service Unavailable');
      }),
    };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    const result = await trigger.evaluate(PATH, R1, R0);
    expect(result).toEqual({ kind: 'judge-unavailable' });

    const record = await store.load(PATH);
    expect(record?.canonicalLength).toBe(canonicalizeForMateriality(R0).length);
    expect(record?.revision).toBe(1);
  });

  it('a failure during a drained (below-floor) edit is reported the same way, not thrown out of the drain', async () => {
    const store = new FakeStore();
    await seed(store, 'The reading was +5 degrees.');
    const judge: MaterialityJudge = {
      judge: vi.fn(async () => {
        throw new Error('network error');
      }),
    };
    let now = DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1;
    const clock = { now: () => now, set: (n: number) => (now = n) };
    const trigger = new MaterialityTrigger({ store, clock, judge });

    await trigger.evaluate(PATH, 'The reading was -5 degrees.', 'The reading was +5 degrees.');
    clock.set(now + DEFAULT_MATERIALITY_CONSTANTS.pendingDrainMs + 1);

    await expect(trigger.drainDuePendingEdits(clock.now())).resolves.toEqual([]);
  });
});
