/**
 * `[DOS-3]` (`ol-2zfj.159`) regression tests: a below-floor edit that never
 * recurs on its own path must still eventually reach the judge, via
 * `MaterialityTrigger.drainDuePendingEdits`. `wiring.spec.ts`'s existing
 * `[DOS-C3]` tests already prove the RECURRENCE escalation (a second
 * below-floor edit on the same path); this file covers the case that
 * recurrence-only bookkeeping structurally cannot: no second edit ever
 * comes.
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

const PATH = 'Courses/GEO101/Lecture 3.md';

/**
 * `revision: 1` marks this as an already-established record (a path that
 * has already had at least one judge call under the post-`[D-311]` system),
 * never a legacy pre-migration one -- these tests are about the DRAIN
 * (`[DOS-3]`), not `[D-311]`'s separate "a record with no revision is
 * re-judged at its next change, bypassing the below-floor shortcut" rule
 * (covered on its own in `revision-guard.spec.ts`). Without this, every
 * below-floor edit below would be forced straight to the judge by THAT
 * rule instead of exercising the pending/drain path this file tests.
 */
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

describe('[DOS-3] MaterialityTrigger.drainDuePendingEdits', () => {
  it('a single below-floor edit that never recurs still reaches the judge once the drain delay elapses', async () => {
    const store = new FakeStore();
    await seed(store, 'The reading was +5 degrees.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // One below-floor edit (a sign flip, zero length delta) -- deferred, not
    // decided. No second edit ever comes on this path.
    const first = await trigger.evaluate(
      PATH,
      'The reading was -5 degrees.',
      'The reading was +5 degrees.',
    );
    expect(first.kind).toBe('below-floor');
    expect(judge.judge).not.toHaveBeenCalled();

    // Before the drain delay elapses: nothing to do yet.
    clock.set(clock.now() + MATERIALITY_PENDING_DRAIN_MS - 1);
    const tooSoon = await trigger.drainDuePendingEdits(clock.now());
    expect(tooSoon).toHaveLength(0);
    expect(judge.judge).not.toHaveBeenCalled();

    // Once the delay elapses, the drain sends the ORIGINAL deferred edit to
    // the judge using the text captured when it was deferred.
    clock.set(clock.now() + 1);
    const drained = await trigger.drainDuePendingEdits(clock.now());
    expect(judge.judge).toHaveBeenCalledOnce();
    expect(judge.judge).toHaveBeenCalledWith({
      path: PATH,
      previousText: 'The reading was +5 degrees.',
      currentText: 'The reading was -5 degrees.',
    });
    expect(drained).toHaveLength(1);
    expect(drained[0]?.material).toBe(true);

    // Draining again is a no-op -- the pending marker was consumed.
    const drainedAgain = await trigger.drainDuePendingEdits(clock.now() + 1_000_000);
    expect(drainedAgain).toHaveLength(0);
    expect(judge.judge).toHaveBeenCalledOnce();
  });

  it('does not drain a path with no previousText available to send (never had text to drain)', async () => {
    const store = new FakeStore();
    await seed(store, 'The reading was +5 degrees.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // Below-floor edit with NO previousText supplied by the caller.
    const first = await trigger.evaluate(PATH, 'The reading was -5 degrees.');
    expect(first.kind).toBe('below-floor');

    clock.set(clock.now() + MATERIALITY_PENDING_DRAIN_MS + 1);
    const drained = await trigger.drainDuePendingEdits(clock.now());
    expect(drained).toHaveLength(0);
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('a recurrence escalation before the drain delay clears the pending marker, so the drain later finds nothing to do', async () => {
    const store = new FakeStore();
    await seed(store, 'The reading was +5 degrees.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    await trigger.evaluate(PATH, 'The reading was -5 degrees.', 'The reading was +5 degrees.');
    clock.set(2 * (DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1));
    const second = await trigger.evaluate(
      PATH,
      'The reading was -5 degrees, not +5.',
      'The reading was -5 degrees.',
    );
    expect(second.kind).toBe('verdict');
    expect(judge.judge).toHaveBeenCalledOnce();

    clock.set(clock.now() + MATERIALITY_PENDING_DRAIN_MS + 1);
    const drained = await trigger.drainDuePendingEdits(clock.now());
    expect(drained).toHaveLength(0);
    expect(judge.judge).toHaveBeenCalledOnce();
  });

  it('does not drain when no judge is configured, and reports the path as still pending', async () => {
    const store = new FakeStore();
    await seed(store, 'The reading was +5 degrees.', 0);
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge: null });

    await trigger.evaluate(PATH, 'The reading was -5 degrees.', 'The reading was +5 degrees.');
    clock.set(clock.now() + MATERIALITY_PENDING_DRAIN_MS + 1);
    const drained = await trigger.drainDuePendingEdits(clock.now());
    expect(drained).toHaveLength(0);
  });
});
