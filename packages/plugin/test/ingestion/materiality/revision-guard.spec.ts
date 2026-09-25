/**
 * `[D-311]` (`ol-2zfj.158`, `ol-2zfj.160`) — regression tests for the
 * persisted-revision stale-response guard.
 *
 * `wiring.spec.ts`'s existing "stale response" test already proves the
 * IN-MEMORY guard (`MaterialityTrigger`'s own `revisions` Map) catches two
 * overlapping `evaluate()` calls on the SAME trigger instance. That guard is
 * scoped to `this` and starts empty again on every new instance, so it
 * cannot catch a response that only completes after a restart -- a fresh
 * `MaterialityTrigger` (a new instance, but the SAME persisted store) has no
 * memory of the older call at all. This file adds the case the in-memory
 * guard structurally cannot cover, and the hash-store-level fixture proving
 * a pre-migration record (no `revision` field at all) is not rejected as
 * corrupted.
 */
import { describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
import {
  MATERIALITY_HASH_STORAGE_KEY,
  ObsidianMaterialityHashStore,
} from '../../../src/ingestion/materiality/hash-store.js';
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

async function seed(store: FakeStore, text: string, lastChangedAt: number): Promise<void> {
  const hashes = await computeMaterialityHashes(text);
  await store.save({
    path: PATH,
    hashes,
    canonicalLength: canonicalizeForMateriality(text).length,
    lastChangedAt,
    lastVerdictAt: null,
  });
}

describe('[D-311] persisted revision -- stale response surviving a restart', () => {
  it('drops a judge response that completes only after a restart, once a fresh instance has already committed a newer verdict for the same path', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);

    let resolveStale: (v: { material: boolean }) => void = () => {};
    const stalePromise = new Promise<{ material: boolean }>((resolve) => {
      resolveStale = resolve;
    });
    // Signalled the instant the fake judge is actually invoked -- i.e. once
    // `triggerA.evaluate` has already loaded its record, cleared its own
    // gate checks and dispatched, and is now hanging on the judge call
    // itself. Without waiting for this, `triggerA.evaluate`'s own record
    // load (an `await`, racing real hashing work) and `triggerB`'s later
    // write are two independent async chains with no ordering guarantee
    // between them: `triggerA`'s `now` is captured correctly (a plain
    // synchronous read, before this promise even exists), but if `triggerB`
    // happens to finish writing before `triggerA`'s OWN gate check runs,
    // `triggerA` would read a record `triggerB` already advanced and could
    // spuriously see `'debounced'` instead of ever reaching `'call-judge'`
    // -- a timing artifact of two competing promise chains in this test,
    // never something a genuinely restarted instance's dead code could
    // still race against.
    let resolveJudgeCallStarted: () => void = () => {};
    const judgeCallStarted = new Promise<void>((resolve) => {
      resolveJudgeCallStarted = resolve;
    });
    const staleJudge: MaterialityJudge = {
      judge: vi.fn(() => {
        resolveJudgeCallStarted();
        return stalePromise;
      }),
    };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);

    // Instance A: dispatches a judge call for PATH and hangs (never resolves
    // before the "restart").
    const triggerA = new MaterialityTrigger({ store, clock, judge: staleJudge });
    const stale = triggerA.evaluate(
      PATH,
      'Basalt undergoes rapid chemical and physical weathering under acidic conditions.',
      'Basalt weathers quickly.',
    );
    await judgeCallStarted;

    // "Restart": a BRAND NEW MaterialityTrigger instance, sharing only the
    // persisted store -- its in-memory revisions Map starts empty, exactly
    // as it would after the plugin process restarted. It observes the SAME
    // path change independently and completes a full judge round trip
    // before instance A's stale call ever resolves.
    clock.set(2 * (DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1));
    const freshJudge: MaterialityJudge = {
      judge: vi.fn(async () => ({ material: false, reason: 'reworded only' })),
    };
    const triggerB = new MaterialityTrigger({ store, clock, judge: freshJudge });
    const fresh = await triggerB.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );
    expect(fresh.kind).toBe('verdict');
    const recordAfterFresh = await store.load(PATH);

    // Instance A's stale judge call now resolves. Its own in-memory guard
    // (scoped to itself) has nothing to compare against another instance's
    // work, so it alone would let this through. The persisted revision must
    // catch it instead: the record now on disk was advanced by instance B,
    // past what instance A saw when it started.
    resolveStale({ material: true });
    const staleResult = await stale;
    expect(staleResult).toEqual({ kind: 'judge-unavailable' });

    // No clobber: the store still holds instance B's verdict-baseline record,
    // untouched by instance A's late write.
    expect(await store.load(PATH)).toEqual(recordAfterFresh);
  });

  it('a pre-migration record with no revision field at all is not rejected as corrupted, and is treated as revision 0', async () => {
    const host = {
      blob: {
        [MATERIALITY_HASH_STORAGE_KEY]: {
          [PATH]: {
            path: PATH,
            hashes: { rawHash: 'raw', canonicalHash: 'canon' },
            canonicalLength: 24,
            lastChangedAt: 1000,
            lastVerdictAt: null,
            // no `revision` key -- exactly what every record persisted
            // before this bead looks like.
          },
        },
      } as Record<string, unknown>,
      async loadData() {
        return this.blob;
      },
      async saveData(data: unknown) {
        this.blob = data as Record<string, unknown>;
      },
    };
    const store = new ObsidianMaterialityHashStore(host);
    const record = await store.load(PATH);
    expect(record).not.toBeNull();
    expect(record?.revision).toBeUndefined();
  });
});

describe('[D-311] a legacy record (no revision) is re-judged at its next change, literally', () => {
  it("bypasses the formatting-only shortcut on a legacy record's next change, then takes the normal shortcut once it has a revision", async () => {
    const store = new FakeStore();
    // `seed` never sets `revision` -- exactly a pre-migration record.
    await seed(store, '# Weathering\n\nBasalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // A pure reflow -- canonical hash identical, raw hash different. Against
    // a record WITH a revision this would short-circuit as 'formatting-only'
    // with no judge call (wiring.spec.ts's own test proves that). Against
    // this legacy record it must reach the judge instead.
    const first = await trigger.evaluate(
      PATH,
      '## Weathering\n\nBasalt weathers quickly.',
      '# Weathering\n\nBasalt weathers quickly.',
    );
    expect(first.kind).toBe('verdict');
    expect(judge.judge).toHaveBeenCalledOnce();

    const recordAfter = await store.load(PATH);
    expect(recordAfter?.revision).toBe(1);

    // The path is now on the normal path: a SECOND reflow, against a record
    // that now carries a revision, takes the ordinary formatting-only
    // shortcut -- no second judge call.
    clock.set(2 * (DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1));
    const second = await trigger.evaluate(
      PATH,
      '### Weathering\n\nBasalt weathers quickly.',
      '## Weathering\n\nBasalt weathers quickly.',
    );
    expect(second.kind).toBe('formatting-only');
    expect(judge.judge).toHaveBeenCalledOnce();
  });

  it("bypasses the below-floor shortcut on a legacy record's next change, then takes the normal shortcut once it has a revision", async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers.', 0); // legacy, no revision
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const clock = steppedClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1);
    const trigger = new MaterialityTrigger({ store, clock, judge });

    // +2 chars, well under the 8-char floor. Against a record WITH a
    // revision this defers (below-floor, no judge call) on its FIRST
    // occurrence -- wiring.spec.ts's own test proves that. Against this
    // legacy record it must reach the judge immediately instead.
    const first = await trigger.evaluate(PATH, 'Basalt weathers a.', 'Basalt weathers.');
    expect(first.kind).toBe('verdict');
    expect(judge.judge).toHaveBeenCalledOnce();

    const recordAfter = await store.load(PATH);
    expect(recordAfter?.revision).toBe(1);

    // Now on the normal path: a second small edit against a record that
    // carries a revision defers as an ordinary below-floor edit -- no second
    // judge call (recurrence escalation, if it comes, is a separate edit).
    clock.set(2 * (DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1));
    const second = await trigger.evaluate(PATH, 'Basalt weathers b.', 'Basalt weathers a.');
    expect(second.kind).toBe('below-floor');
    expect(judge.judge).toHaveBeenCalledOnce();
  });

  it("does not force a legacy record's debounced edit to the judge -- debounce is about timing, not a decision to skip", async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    // now = 1: well within the debounce window (lastChangedAt was 0).
    const trigger = new MaterialityTrigger({ store, clock: steppedClock(1), judge });

    const result = await trigger.evaluate(
      PATH,
      'Basalt weathers slowly in cold climates.',
      'Basalt weathers quickly.',
    );
    expect(result.kind).toBe('debounced');
    expect(judge.judge).not.toHaveBeenCalled();
  });
});
