/**
 * `[ol-egov.141.89.5.17]` — regression test for the gap `[ol-dpzz]`'s own
 * per-path lock deliberately leaves open (see that bead's report, section
 * 3, and `wiring.ts`'s `evaluate` doc): the lock covers the record load,
 * gate decision and any NON-judge write, but is released BEFORE the judge
 * dispatch itself. A second `evaluate()` call on the SAME path that takes a
 * free gate (debounced/formatting-only/below-floor/no-groundable-content)
 * while that first call's judge call is still in flight writes its own,
 * later `lastChangedAt` WITHOUT bumping `revision` (every free-gate
 * `store.save` in `evaluateUnderLock` carries `revision: persistedRevision`
 * forward unchanged). `dispatchJudgeAndCommit`'s own stale-response guard
 * only ever checks `revision` (`[D-311]`, `[DOS-C3]`) — a write that never
 * touches it is invisible to that check, so the judge's own commit, which
 * still carries the value of `lastChangedAt` it captured back when IT was
 * dispatched, can silently overwrite the free-gate write's newer one.
 *
 * This is narrower than `[ol-dpzz]`'s own race (it needs a judge call
 * genuinely in flight, not just two overlapping free-gate calls) and, per
 * the bead's own text, the worst case is safe-direction (an extra judge
 * call later, never a lost real change) — but the free-gate write's
 * `lastChangedAt` is still a real fact (every free-gate branch advances it
 * to that call's own observed time) that must not quietly move backwards.
 *
 * Ordering is driven explicitly, not raced: `judgeCallStarted` resolves the
 * instant the fake judge is actually invoked, which can only happen once
 * `callA`'s own locked phase (`evaluateUnderLock`) has fully finished and
 * released `PATH`'s lock — so awaiting it before issuing `callB` guarantees
 * `callB` runs entirely unimpeded, exactly the "second evaluation... while
 * the first path's judge call is in flight" scenario the bead describes,
 * with no dependence on real timing.
 */
import { describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
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

const PATH = 'Courses/GEO101/Lecture 6.md';
const ORIGINAL_TEXT = 'Basalt weathers quickly.';
// A large, unrelated rewrite -- clears debounce and the floor, and is not a
// reflow, so it reaches 'call-judge'.
const JUDGE_CALL_TEXT =
  'Basalt undergoes rapid chemical weathering under acidic rainfall across many separate regions.';
// Same canonical LENGTH as ORIGINAL_TEXT (one trailing-punctuation swap) --
// `canonicalCharDelta` is a length difference, not an edit distance, so this
// is exactly the "same-length substitution" case `pendingSmallEdit`'s own
// doc names: a real, if small, content change with a zero length delta.
const FREE_GATE_TEXT = 'Basalt weathers quickly!';

describe('[ol-egov.141.89.5.17] a free-gate write on a path whose judge call is in flight', () => {
  it("keeps the free-gate write's lastChangedAt once the judge's verdict commits", async () => {
    const store = new FakeStore();
    const originalHashes = await computeMaterialityHashes(ORIGINAL_TEXT);
    await store.save({
      path: PATH,
      hashes: originalHashes,
      canonicalLength: canonicalizeForMateriality(ORIGINAL_TEXT).length,
      lastChangedAt: 0,
      lastVerdictAt: null,
      revision: 0,
    });

    let resolveJudge: (v: MaterialityJudgeVerdict) => void = () => {};
    const heldJudgeResponse = new Promise<MaterialityJudgeVerdict>((resolve) => {
      resolveJudge = resolve;
    });
    let resolveJudgeCallStarted: () => void = () => {};
    const judgeCallStarted = new Promise<void>((resolve) => {
      resolveJudgeCallStarted = resolve;
    });
    const judge: MaterialityJudge = {
      judge: vi.fn(() => {
        resolveJudgeCallStarted();
        return heldJudgeResponse;
      }),
    };

    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // Call A: clears every free gate, dispatches to the judge, and hangs --
    // its locked phase (load/decide) has already fully released PATH's lock
    // by the time `judge.judge` is actually invoked.
    const dispatchLastChangedAt = clock.now();
    const callA = trigger.evaluate(PATH, JUDGE_CALL_TEXT, ORIGINAL_TEXT);
    await judgeCallStarted;

    // Call B: a second, independent evaluation on the SAME path, issued
    // once A's judge call is confirmed in flight. It loads the ORIGINAL
    // record (A has not committed anything yet), takes the free below-floor
    // gate, and completes entirely on its own -- nothing gates it.
    const freeWriteAt = dispatchLastChangedAt + 2000;
    clock.set(freeWriteAt);
    const resultB = await trigger.evaluate(PATH, FREE_GATE_TEXT, ORIGINAL_TEXT);
    expect(resultB.kind).toBe('below-floor');

    const recordAfterFreeWrite = await store.load(PATH);
    // The free-gate write's own facts: a later `lastChangedAt`, `revision`
    // left untouched -- exactly what makes it invisible to
    // `dispatchJudgeAndCommit`'s persisted-revision guard.
    expect(recordAfterFreeWrite?.lastChangedAt).toBe(freeWriteAt);
    expect(recordAfterFreeWrite?.revision).toBe(0);

    // A's judge call now resolves. Its own persisted-revision check sees
    // revision 0 both when it started and now -- B's write never bumped
    // it -- so A's commit proceeds.
    resolveJudge({ material: true, reason: 'new claim introduced' });
    const resultA = await callA;
    expect(resultA.kind).toBe('verdict');

    const finalRecord = await store.load(PATH);
    expect(finalRecord).not.toBeNull();
    // The judge's own verdict still commits: revision advances, and the
    // hashes/canonicalLength reflect what A actually judged.
    expect(finalRecord?.revision).toBe(1);
    const expectedJudgedHashes = await computeMaterialityHashes(JUDGE_CALL_TEXT);
    expect(finalRecord?.hashes).toEqual(expectedJudgedHashes);
    expect(finalRecord?.canonicalLength).toBe(canonicalizeForMateriality(JUDGE_CALL_TEXT).length);

    // The fact this bead exists to keep: B's free-gate write observed PATH
    // changing at `freeWriteAt`, strictly AFTER A's own dispatch-time
    // `lastChangedAt` (`dispatchLastChangedAt`). A's commit must not carry
    // its own, now-stale `lastChangedAt` over B's later, real one.
    //
    // Pre-fix, this is exactly `dispatchLastChangedAt` (A's commit
    // overwrites unconditionally) -- this assertion is the failing-first
    // line:
    expect(finalRecord?.lastChangedAt).toBe(freeWriteAt);
  });
});
