import { describe, expect, it } from 'vitest';
import {
  deckServedOutOrLapsedTrigger,
  evaluateGenerationTriggers,
  formatAskTrigger,
  otherKindToDraft,
  repeatedRejectionTrigger,
  topBandTrigger,
} from './triggers.js';

describe('otherKindToDraft', () => {
  it('returns the first preferred kind not yet built', () => {
    expect(otherKindToDraft({ builtKinds: ['mcq'], preferredOrder: ['mcq', 'qa', 'cloze'] })).toBe(
      'qa',
    );
  });

  it('returns null when every preferred kind is already built — never re-requests one', () => {
    expect(
      otherKindToDraft({ builtKinds: ['mcq', 'qa'], preferredOrder: ['mcq', 'qa'] }),
    ).toBeNull();
  });
});

describe('topBandTrigger — F3.7 "enters its course\'s top band (F4.2)"', () => {
  it('fires and names the other kind on entry', () => {
    const trigger = topBandTrigger({
      enteredTopBand: true,
      other: { builtKinds: ['mcq'], preferredOrder: ['mcq', 'qa'] },
    });
    expect(trigger).toEqual({ kind: 'top-band', instrumentKind: 'qa' });
  });

  it('does not fire when the concept has not entered the top band', () => {
    expect(
      topBandTrigger({
        enteredTopBand: false,
        other: { builtKinds: ['mcq'], preferredOrder: ['mcq', 'qa'] },
      }),
    ).toBeNull();
  });

  it('does not fire when every preferred kind is already built', () => {
    expect(
      topBandTrigger({
        enteredTopBand: true,
        other: { builtKinds: ['mcq', 'qa'], preferredOrder: ['mcq', 'qa'] },
      }),
    ).toBeNull();
  });
});

describe('formatAskTrigger — F3.7 "the format match or her instrument-type log (D7.1) asks for the other kind"', () => {
  it('fires for the requested kind when it is not already built', () => {
    expect(formatAskTrigger({ requestedKind: 'cloze', builtKinds: ['mcq'] })).toEqual({
      kind: 'format-ask',
      instrumentKind: 'cloze',
    });
  });

  it('does not fire when nothing asks for a kind', () => {
    expect(formatAskTrigger({ requestedKind: null, builtKinds: ['mcq'] })).toBeNull();
  });

  it('does not fire when the requested kind is already built', () => {
    expect(formatAskTrigger({ requestedKind: 'mcq', builtKinds: ['mcq'] })).toBeNull();
  });
});

describe('deckServedOutOrLapsedTrigger — F3.7 "deck served out or it has lapsed (F2.12)"', () => {
  const other = { builtKinds: ['mcq'] as const, preferredOrder: ['mcq', 'qa'] as const };

  it('fires on deck-served-out alone', () => {
    expect(deckServedOutOrLapsedTrigger({ deckServedOut: true, lapsed: false, other })).toEqual({
      kind: 'deck-served-out-or-lapsed',
      instrumentKind: 'qa',
    });
  });

  it('fires on lapsed alone', () => {
    expect(deckServedOutOrLapsedTrigger({ deckServedOut: false, lapsed: true, other })).toEqual({
      kind: 'deck-served-out-or-lapsed',
      instrumentKind: 'qa',
    });
  });

  it('does not fire when neither holds', () => {
    expect(deckServedOutOrLapsedTrigger({ deckServedOut: false, lapsed: false, other })).toBeNull();
  });
});

describe('repeatedRejectionTrigger — F3.7 "a kind has been repeatedly rejected" (F3.3)', () => {
  const other = { builtKinds: ['mcq'] as const, preferredOrder: ['mcq', 'qa'] as const };

  it('does not fire below the caller-supplied threshold', () => {
    expect(repeatedRejectionTrigger({ rejectionCount: 2, threshold: 4, other })).toBeNull();
  });

  it('fires at or above the threshold', () => {
    expect(repeatedRejectionTrigger({ rejectionCount: 4, threshold: 4, other })).toEqual({
      kind: 'repeated-rejection',
      instrumentKind: 'qa',
    });
  });

  it('takes no default threshold — Class C, a caller must supply one', () => {
    // TypeScript enforces this at compile time (`threshold` is required);
    // this test documents the intent for a reader who only sees the runtime behaviour.
    expect(
      repeatedRejectionTrigger({ rejectionCount: 100, threshold: Number.POSITIVE_INFINITY, other }),
    ).toBeNull();
  });
});

describe('evaluateGenerationTriggers — combinator', () => {
  it('returns every trigger that fires, deduplicated by instrument kind', () => {
    const fired = evaluateGenerationTriggers({
      topBand: {
        enteredTopBand: true,
        other: { builtKinds: ['mcq'], preferredOrder: ['mcq', 'qa'] },
      },
      formatAsk: { requestedKind: 'qa', builtKinds: ['mcq'] },
      deckServedOutOrLapsed: {
        deckServedOut: false,
        lapsed: false,
        other: { builtKinds: ['mcq'], preferredOrder: ['mcq', 'qa'] },
      },
      repeatedRejection: {
        rejectionCount: 0,
        threshold: 4,
        other: { builtKinds: ['mcq'], preferredOrder: ['mcq', 'qa'] },
      },
    });
    // top-band and format-ask both name 'qa' — D-238's "the unit is the call"
    // means this is one trigger, not two, and top-band (listed first) keeps credit.
    expect(fired).toEqual([{ kind: 'top-band', instrumentKind: 'qa' }]);
  });

  it('returns an empty array when nothing fires', () => {
    const other = { builtKinds: ['mcq'], preferredOrder: ['mcq'] } as const;
    const fired = evaluateGenerationTriggers({
      topBand: { enteredTopBand: false, other },
      formatAsk: { requestedKind: null, builtKinds: ['mcq'] },
      deckServedOutOrLapsed: { deckServedOut: false, lapsed: false, other },
      repeatedRejection: { rejectionCount: 0, threshold: 4, other },
    });
    expect(fired).toEqual([]);
  });
});
