/**
 * `ingestionSessionJustClosed` tests (`[EXT-11]`, `ol-kw4a`).
 *
 * Pure function over two `QueueSnapshot`s — no fakes, no `obsidian` import.
 */
import type { QueueSnapshot } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ingestionSessionJustClosed } from '../../src/concept/corpusRelationTrigger.js';

function snapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    queued: 0,
    inFlight: 0,
    done: 0,
    deferred: 0,
    failed: 0,
    deferredReasons: { 'budget-exhausted': 0, 'transient-error': 0 },
    headroom: null,
    drainBlocked: null,
    pacingUntil: null,
    ...overrides,
  };
}

describe('ingestionSessionJustClosed', () => {
  it('is false on the very first observed tick — nothing to have closed', () => {
    expect(ingestionSessionJustClosed(null, snapshot())).toBe(false);
  });

  it('is false while the queue stays idle across two ticks', () => {
    expect(ingestionSessionJustClosed(snapshot(), snapshot())).toBe(false);
  });

  it('is false while the queue is still active (something queued)', () => {
    const active = snapshot({ queued: 2 });
    expect(ingestionSessionJustClosed(active, active)).toBe(false);
  });

  it('is false while the queue is still active (something in flight)', () => {
    const active = snapshot({ inFlight: 1 });
    expect(ingestionSessionJustClosed(active, active)).toBe(false);
  });

  it('is true the instant a queued+in-flight state drains to fully idle', () => {
    const wasActive = snapshot({ queued: 3, inFlight: 1 });
    const nowIdle = snapshot({ done: 4 });
    expect(ingestionSessionJustClosed(wasActive, nowIdle)).toBe(true);
  });

  it('is true even when the queue is merely queued (not yet in flight) beforehand', () => {
    const wasActive = snapshot({ queued: 1 });
    const nowIdle = snapshot({ done: 1 });
    expect(ingestionSessionJustClosed(wasActive, nowIdle)).toBe(true);
  });

  it('never fires on a per-document shape — there is no job/unit parameter to wire to onUnitsLanded by mistake', () => {
    // Structural proof, not a runtime assertion: the function's signature
    // takes only two QueueSnapshots, so this test exists to keep that true
    // as a compile-time fact — see the module doc.
    const fn: (previous: QueueSnapshot | null, current: QueueSnapshot) => boolean =
      ingestionSessionJustClosed;
    expect(fn.length).toBe(2);
  });
});
