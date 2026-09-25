/**
 * Defect 2 (`ol-egov.141.89.5.7`, ILB-CHG-B1): "The judge is asked to
 * compare against the previous save rather than the last revision it
 * actually judged, on the path the debounce takes."
 *
 * Mirrors the source-change case set's `stale-response` gate case
 * (`eval/data/ilb/chg/`, olea-service): a substantive edit's judgment is
 * still in flight when a second, later edit arrives and itself clears every
 * free gate. Before this fix, the second dispatch used `previousText` as
 * handed to `evaluate()` — "the text right before THIS save" — so it judged
 * only the SECOND edit's own delta, and the first (real, substantive) edit's
 * response, arriving later, was correctly dropped as stale but never
 * re-judged either: the substantive change was lost. The fix makes the
 * SECOND dispatch chain from the last revision this trigger actually
 * processed (still the original baseline, since the first dispatch has not
 * committed), so the accumulated edit is judged in one call.
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

const PATH = 'Garden/Pond.md';
const R0 = 'The pond liner is rated for ten years of continuous exposure.';
// A substantive addition — the claim about warranty coverage.
const R1 = `${R0} The manufacturer voids the warranty if it is ever drained.`;
// A boilerplate-only follow-up edit on top of R1.
const R2 = `${R1} See the supplier's care sheet for seasonal notes.`;

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

describe('defect 2 (ol-egov.141.89.5.7): a judge call chains from the last processed revision, not the last save', () => {
  it('a second dispatch that starts while the first is still in flight compares against the ORIGINAL baseline, not the intervening save', async () => {
    const store = new FakeStore();
    await seed(store, R0);

    let resolveFirst: (v: { material: boolean }) => void = () => {};
    const firstCallPromise = new Promise<{ material: boolean }>((resolve) => {
      resolveFirst = resolve;
    });
    const judge: MaterialityJudge = {
      judge: vi
        .fn()
        .mockImplementationOnce(() => firstCallPromise)
        .mockImplementationOnce(async () => ({ material: true })),
    };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    // First dispatch: R0 -> R1 (substantive), hangs.
    const stalePromise = trigger.evaluate(PATH, R1, R0);

    // A second dispatch for the SAME path starts before the first resolves,
    // with `previousText` set the way `main.ts` actually sets it — the text
    // of the PREVIOUS save (R1), not the true baseline (R0).
    const fresh = await trigger.evaluate(PATH, R2, R1);
    expect(fresh.kind).toBe('verdict');

    // The fix: the second call must have compared the ORIGINAL baseline
    // against the latest text, never the immediately-preceding save against
    // the latest text (which would silently drop the substantive R0->R1
    // change once the first call's response is dropped as stale below).
    expect(judge.judge).toHaveBeenLastCalledWith({
      path: PATH,
      previousText: R0,
      currentText: R2,
    });

    // The first (older) call's response now arrives — dropped as stale by
    // the existing `[DOS-C3]` guard, never committed.
    resolveFirst({ material: true });
    const stale = await stalePromise;
    expect(stale).toEqual({ kind: 'judge-unavailable' });

    // No gap: the store's baseline now spans R0 all the way to R2 in one
    // committed judgment, never leaving R0->R1 unaccounted for.
    const record = await store.load(PATH);
    expect(record?.canonicalLength).toBe(canonicalizeForMateriality(R2).length);
  });

  it('a below-floor defer that later escalates on recurrence still chains to the ORIGINAL baseline, not the deferred save', async () => {
    const store = new FakeStore();
    await seed(store, 'The reading was +5 degrees.');
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    let now = DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1;
    const clock = { now: () => now, set: (n: number) => (now = n) };
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // A same-length sign flip, below the floor, deferred — cached with the
    // TRUE previous text (the seeded baseline).
    await trigger.evaluate(PATH, 'The reading was -5 degrees.', 'The reading was +5 degrees.');

    // A second below-floor edit recurs (still under the floor measured
    // against the ORIGINAL baseline: +4 chars) — DOS-C3 escalates
    // immediately. The caller's own `previousText` argument here is the
    // intervening save ('The reading was -5 degrees.'), never the true
    // baseline.
    clock.set(2 * (DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1));
    const second = await trigger.evaluate(
      PATH,
      'The reading was -5 degrees now.',
      'The reading was -5 degrees.',
    );
    expect(second.kind).toBe('verdict');
    expect(judge.judge).toHaveBeenCalledWith({
      path: PATH,
      previousText: 'The reading was +5 degrees.',
      currentText: 'The reading was -5 degrees now.',
    });
  });
});
