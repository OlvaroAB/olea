/**
 * `buildSuccessionEvent` tests (`[D-133]`, `ol-w00s`).
 */

import { describe, expect, it } from 'vitest';
import { buildSuccessionEvent } from './succession.js';

describe('buildSuccessionEvent', () => {
  const clock = { now: () => 5_000 };

  it('names both instruments and stamps the clock time', () => {
    const event = buildSuccessionEvent('inst-old', 'mcq-new', clock);
    expect(event).toEqual({
      predecessorInstrumentId: 'inst-old',
      successorInstrumentId: 'mcq-new',
      at: 5_000,
    });
  });

  it('reads the time from the injected clock, never Date.now()', () => {
    let calls = 0;
    const countingClock = {
      now: () => {
        calls += 1;
        return 42;
      },
    };
    const event = buildSuccessionEvent('a', 'b', countingClock);
    expect(event.at).toBe(42);
    expect(calls).toBe(1);
  });
});
