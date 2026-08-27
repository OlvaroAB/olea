import { describe, expect, it } from 'vitest';
import {
  advanceSupportLevel,
  ESCALATION_FAILURE_COUNT,
  initialSupportLevelState,
  RECESSION_CLEAN_STREAK_THRESHOLD,
  SNAPBACK_RECESSION_MULTIPLIER,
  type SupportLevelState,
} from './ladder.js';
import type { SessionSupportOutcome } from './types.js';

function outcome(overrides: Partial<SessionSupportOutcome> = {}): SessionSupportOutcome {
  return { failureShape: 'none', hintUptake: false, ...overrides };
}

function advanceMany(
  state: SupportLevelState,
  outcomes: readonly SessionSupportOutcome[],
): SupportLevelState {
  return outcomes.reduce(advanceSupportLevel, state);
}

describe('initialSupportLevelState', () => {
  it("cold-starts at 'prompted' — [D-094]'s own rule for a fresh recall cell", () => {
    expect(initialSupportLevelState().level).toBe('prompted');
  });

  it('starts with no streak and the ordinary recession requirement', () => {
    const state = initialSupportLevelState();
    expect(state.cleanUnhintedStreak).toBe(0);
    expect(state.requiredCleanStreak).toBe(RECESSION_CLEAN_STREAK_THRESHOLD);
    expect(state.justRecessioned).toBe(false);
  });
});

describe('advanceSupportLevel — escalation (thinness threshold)', () => {
  it(`escalates after exactly ${ESCALATION_FAILURE_COUNT} triggering failure — fast, no pattern required`, () => {
    const state = advanceSupportLevel(
      initialSupportLevelState(),
      outcome({ failureShape: 'blank' }),
    );
    expect(state.level).toBe('guided');
  });

  it('a wrong-concept failure escalates identically to a blank one', () => {
    const state = advanceSupportLevel(
      initialSupportLevelState(),
      outcome({ failureShape: 'wrong-concept' }),
    );
    expect(state.level).toBe('guided');
  });

  it('a minor slip does NOT escalate — it is ranked below the escalation bar', () => {
    const state = advanceSupportLevel(
      initialSupportLevelState(),
      outcome({ failureShape: 'minor-slip' }),
    );
    expect(state.level).toBe('prompted');
  });

  it("escalation caps at 'guided' — it does not throw or wrap past the top", () => {
    const alreadyTop: SupportLevelState = {
      level: 'guided',
      cleanUnhintedStreak: 0,
      requiredCleanStreak: RECESSION_CLEAN_STREAK_THRESHOLD,
      justRecessioned: false,
    };
    const state = advanceSupportLevel(alreadyTop, outcome({ failureShape: 'blank' }));
    expect(state.level).toBe('guided');
  });

  it('a failure resets the clean streak to zero', () => {
    const midStreak: SupportLevelState = {
      level: 'guided',
      cleanUnhintedStreak: 1,
      requiredCleanStreak: RECESSION_CLEAN_STREAK_THRESHOLD,
      justRecessioned: false,
    };
    const state = advanceSupportLevel(midStreak, outcome({ failureShape: 'blank' }));
    expect(state.cleanUnhintedStreak).toBe(0);
  });
});

describe('advanceSupportLevel — recession (performance threshold, slow)', () => {
  it(`does not recede on a single clean session — needs ${RECESSION_CLEAN_STREAK_THRESHOLD}`, () => {
    const state = advanceSupportLevel(initialSupportLevelState(), outcome());
    expect(state.level).toBe('prompted'); // unchanged, still the cold-start level
    expect(state.cleanUnhintedStreak).toBe(1);
  });

  it(`recedes on the ${RECESSION_CLEAN_STREAK_THRESHOLD}th consecutive clean, unhinted session`, () => {
    const outcomes = Array.from({ length: RECESSION_CLEAN_STREAK_THRESHOLD }, () => outcome());
    const state = advanceMany(initialSupportLevelState(), outcomes);
    expect(state.level).toBe('independent');
    expect(state.cleanUnhintedStreak).toBe(0);
  });

  it("does not recede past 'independent'", () => {
    const outcomes = Array.from({ length: RECESSION_CLEAN_STREAK_THRESHOLD * 3 }, () => outcome());
    const state = advanceMany(initialSupportLevelState(), outcomes);
    expect(state.level).toBe('independent');
  });

  it('marks justRecessioned true for exactly the session a recession happens on', () => {
    const outcomes = Array.from({ length: RECESSION_CLEAN_STREAK_THRESHOLD }, () => outcome());
    const state = advanceMany(initialSupportLevelState(), outcomes);
    expect(state.justRecessioned).toBe(true);
  });
});

describe('advanceSupportLevel — the hint-uptake ratchet', () => {
  it('a clean session where a hint was used does NOT count toward the recession streak', () => {
    const outcomes = Array.from({ length: RECESSION_CLEAN_STREAK_THRESHOLD }, () =>
      outcome({ hintUptake: true }),
    );
    const state = advanceMany(initialSupportLevelState(), outcomes);
    expect(state.level).toBe('prompted'); // never receded
    expect(state.cleanUnhintedStreak).toBe(0); // never accrued either
  });

  it('hint uptake never raises the level on its own — only a failure shape does', () => {
    const state = advanceSupportLevel(initialSupportLevelState(), outcome({ hintUptake: true }));
    expect(state.level).toBe('prompted'); // held, not raised
  });

  it('one hinted session in the middle of an otherwise-clean run breaks the streak', () => {
    const state = advanceMany(initialSupportLevelState(), [
      outcome(),
      outcome({ hintUptake: true }),
      outcome(),
    ]);
    // Streak reset by the hinted session, then one more clean session — not
    // yet enough to recede (threshold is 2, only 1 accrued since the break).
    expect(state.level).toBe('prompted');
    expect(state.cleanUnhintedStreak).toBe(1);
  });
});

describe('advanceSupportLevel — snap-back doubling', () => {
  it('an immediate failure right after a recession escalates (fast readmission)', () => {
    const recessionOutcomes = Array.from({ length: RECESSION_CLEAN_STREAK_THRESHOLD }, () =>
      outcome(),
    );
    const justRecessioned = advanceMany(initialSupportLevelState(), recessionOutcomes);
    expect(justRecessioned.level).toBe('independent');

    const snappedBack = advanceSupportLevel(justRecessioned, outcome({ failureShape: 'blank' }));
    expect(snappedBack.level).toBe('prompted'); // escalated straight back up
  });

  it(`doubles the NEXT recession requirement to ${RECESSION_CLEAN_STREAK_THRESHOLD * SNAPBACK_RECESSION_MULTIPLIER} after a snap-back`, () => {
    const recessionOutcomes = Array.from({ length: RECESSION_CLEAN_STREAK_THRESHOLD }, () =>
      outcome(),
    );
    const justRecessioned = advanceMany(initialSupportLevelState(), recessionOutcomes);
    const snappedBack = advanceSupportLevel(justRecessioned, outcome({ failureShape: 'blank' }));
    expect(snappedBack.requiredCleanStreak).toBe(
      RECESSION_CLEAN_STREAK_THRESHOLD * SNAPBACK_RECESSION_MULTIPLIER,
    );

    // The ordinary threshold's worth of clean sessions is NOT enough this time.
    const notYet = advanceMany(
      snappedBack,
      Array.from({ length: RECESSION_CLEAN_STREAK_THRESHOLD }, () => outcome()),
    );
    expect(notYet.level).toBe('prompted'); // still has not receded

    // The doubled streak IS enough.
    const receded = advanceMany(
      notYet,
      Array.from(
        {
          length:
            RECESSION_CLEAN_STREAK_THRESHOLD * SNAPBACK_RECESSION_MULTIPLIER -
            RECESSION_CLEAN_STREAK_THRESHOLD,
        },
        () => outcome(),
      ),
    );
    expect(receded.level).toBe('independent');
  });

  it('an ordinary escalation with NO prior recession does not double the next requirement', () => {
    const state = advanceSupportLevel(
      initialSupportLevelState(),
      outcome({ failureShape: 'blank' }),
    );
    expect(state.requiredCleanStreak).toBe(RECESSION_CLEAN_STREAK_THRESHOLD);
  });

  it('the snap-back window is exactly one session — a non-failure session after a recession clears it', () => {
    const recessionOutcomes = Array.from({ length: RECESSION_CLEAN_STREAK_THRESHOLD }, () =>
      outcome(),
    );
    const justRecessioned = advanceMany(initialSupportLevelState(), recessionOutcomes);
    const oneCleanSession = advanceSupportLevel(justRecessioned, outcome());
    expect(oneCleanSession.justRecessioned).toBe(false);

    // A failure the session AFTER that is an ordinary escalation, not a snap-back.
    const laterFailure = advanceSupportLevel(oneCleanSession, outcome({ failureShape: 'blank' }));
    expect(laterFailure.requiredCleanStreak).toBe(RECESSION_CLEAN_STREAK_THRESHOLD);
  });
});
