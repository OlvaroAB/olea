/**
 * `[ol-dpzz]` — regression test for the "now captured before the record
 * load" race: `MaterialityTrigger.evaluate` used to read `Date`-like `now`
 * and then `await` its record load with NOTHING stopping a second,
 * overlapping `evaluate()` call on the SAME path from reading, deciding and
 * WRITING in between. This file forces exactly that interleaving.
 *
 * Timing is controlled at the STORE, not by racing real hash/judge timing
 * against itself (the approach `revision-guard.spec.ts`'s own comments
 * already warn reads as flaky). `RacingStore.load` below snapshots its
 * path's current content SYNCHRONOUSLY, the instant it is called — exactly
 * what a real storage read already in flight would have captured — but only
 * lets the FIRST call's promise actually settle once the test releases it.
 * Everything else about it (`save`, every OTHER `load` call) behaves like an
 * ordinary in-memory store.
 *
 * Call A (an older, small edit) is issued first, so its `store.load()` is
 * that gated first call — it snapshots the ORIGINAL record and then hangs.
 * Call B (a newer, larger edit, on the SAME path) is issued right after and
 * left to run on its own: nothing gates it, so it completes an entire
 * judge-backed verdict — including its own commit, which advances
 * `revision`, `hashes` and `lastChangedAt` — while A is still parked. Only
 * once that has had time to happen does the test release A's gate. A then
 * resumes with its STALE, pre-B snapshot and (pre-fix) proceeds to write
 * based on it, clobbering B's already-committed advance.
 *
 * This does not `await callB` before releasing A's gate (that WOULD
 * deadlock against the fix below, since a per-path lock means `callB`
 * cannot even begin its own record load until `callA` has fully finished).
 * Instead it gives the event loop a bounded, real amount of time to let B's
 * OWN, entirely independent work finish, without that wait depending on A's
 * gate at all. Against the fix, this wait is a no-op (nothing can happen for
 * either call until the gate is released); against the pre-fix code, it is
 * long enough for B's few real async hops (two SHA-256 digests, one mocked
 * judge round trip, two more in-memory store reads) to complete.
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

class RacingStore implements MaterialityHashStore {
  private readonly byPath = new Map<string, MaterialityRecord>();
  private loadCallCount = 0;
  private releaseGate0: (() => void) | null = null;
  private readonly gate0 = new Promise<void>((resolve) => {
    this.releaseGate0 = resolve;
  });

  async load(path: string): Promise<MaterialityRecord | null> {
    const callIndex = this.loadCallCount++;
    // Captured synchronously, before any await below -- this is what the
    // store held AT THE MOMENT this call was made, whatever order its own
    // promise later settles in.
    const snapshot = this.byPath.get(path) ?? null;
    if (callIndex === 0) {
      await this.gate0;
    }
    return snapshot;
  }

  async save(record: MaterialityRecord): Promise<void> {
    this.byPath.set(record.path, record);
  }

  /** Releases the first `load()` call's held-open promise. */
  release(): void {
    this.releaseGate0?.();
  }

  /** Test-only read that never participates in the gate/index scheme. */
  peek(path: string): MaterialityRecord | null {
    return this.byPath.get(path) ?? null;
  }
}

/**
 * A clock whose `now()` advances on its OWN, by `incrementMs`, every time
 * it is called — never on a `set()` the test drives from the outside. With
 * the fix, `now` is captured lazily (inside the per-path lock's queued
 * turn), so a call to `evaluate()` and the moment its OWN `clock.now()`
 * actually runs are no longer synchronous with each other; a test-driven
 * `clock.set()` between two `evaluate()` calls could land before OR after
 * either one's real capture point. Ordering `now()`'s own call count
 * instead is safe under both the bug and the fix: `evaluateUnderLock` (or,
 * pre-fix, `evaluate`'s own synchronous prefix) calls `clock.now()` exactly
 * once, and — the property this whole test exists to rely on — the FIX
 * guarantees A's call fully completes, including this read, before B's own
 * turn ever starts; the bug preserves it too, since capturing `now` is the
 * very first synchronous statement of two back-to-back calls.
 */
function sequentialClock(base: number, incrementMs: number) {
  let calls = 0;
  return { now: () => base + incrementMs * calls++ };
}

async function flush(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const PATH = 'Courses/GEO101/Lecture 5.md';
const ORIGINAL_TEXT = 'Basalt weathers quickly.';
// +4 canonical chars ("... now.") -- real content, well under the 8-char floor.
const OLDER_SMALL_EDIT = 'Basalt weathers quickly now.';
// A large, unrelated rewrite -- clears debounce, the floor, and is not a reflow.
const NEWER_LARGE_EDIT =
  'Basalt undergoes rapid chemical weathering under acidic rainfall across many separate regions today.';

describe('[ol-dpzz] MaterialityTrigger.evaluate: two overlapping calls on the same path', () => {
  it('never lets an older call, whose record load resolves after a newer call already committed, revert the newer commit', async () => {
    const store = new RacingStore();
    const originalHashes = await computeMaterialityHashes(ORIGINAL_TEXT);
    await store.save({
      path: PATH,
      hashes: originalHashes,
      canonicalLength: canonicalizeForMateriality(ORIGINAL_TEXT).length,
      lastChangedAt: 0,
      lastVerdictAt: null,
      revision: 0,
    });

    const judge: MaterialityJudge = {
      judge: vi.fn(async () => ({ material: false, reason: 'reworded only' })),
    };
    // The base is comfortably past the seed's `lastChangedAt: 0`, and the
    // increment is comfortably more than one debounce window -- so B clears
    // debounce whether it ends up measured against the ORIGINAL seed (the
    // bug's stale read) or against A's OWN just-committed `lastChangedAt`
    // (the fix's legitimately-serialised read).
    const olderNow = DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1000;
    const newerNow = olderNow + DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1000;
    const clock = sequentialClock(olderNow, DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1000);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // Call A: an older, small edit. Its `store.load()` is the gated FIRST
    // call -- it snapshots the seed record above and then hangs.
    const callA = trigger.evaluate(PATH, OLDER_SMALL_EDIT, ORIGINAL_TEXT);

    // Call B: a newer, larger edit on the SAME path, issued right after.
    // Nothing gates its own `store.load()` (call index 1 onward) -- it runs
    // to a full, judge-backed commit on its own.
    const callB = trigger.evaluate(PATH, NEWER_LARGE_EDIT, ORIGINAL_TEXT);

    // Give B's own (few, real) async hops time to complete -- WITHOUT
    // touching A's gate, so this wait means nothing to the fixed code (both
    // calls are still queued behind the per-path lock at this point) and
    // is a generous upper bound for the racy, pre-fix code.
    await flush(150);

    // Only now does A's stale-snapshot load resolve.
    store.release();
    const [resultA, resultB] = await Promise.all([callA, callB]);

    expect(resultB.kind).toBe('verdict');
    expect(resultA.kind).toBe('below-floor');
    expect(judge.judge).toHaveBeenCalledOnce();

    const expectedFreshHashes = await computeMaterialityHashes(NEWER_LARGE_EDIT);
    const finalRecord = store.peek(PATH);
    expect(finalRecord).not.toBeNull();

    // The three inversions the bead describes, all on the one persisted
    // record: an older call's stale snapshot must never win the write race
    // against a newer call's already-committed advance.
    //
    // Pre-fix, A's below-floor write carries forward `record.revision` from
    // its OWN (stale, pre-B) snapshot, silently erasing B's judge commit:
    expect(finalRecord?.revision).toBe(1);
    // ... and carries forward `record.hashes`/`canonicalLength` from that
    // same stale snapshot, reverting the store's cached content back to
    // pre-B text even though B's newer, real edit already landed:
    expect(finalRecord?.hashes).toEqual(expectedFreshHashes);
    expect(finalRecord?.canonicalLength).toBe(canonicalizeForMateriality(NEWER_LARGE_EDIT).length);
    // ... and moves `lastChangedAt` BACKWARDS to the older call's own `now`,
    // even though B's real, newer edit was already recorded as more recent:
    expect(finalRecord?.lastChangedAt).toBe(newerNow);
  });
});
