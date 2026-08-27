/**
 * Proves `checkSupportOfferRateByDepth` and `checkSupportLevelRecordShape`
 * against the real ladder (`../support-level/ladder.js`), not a stubbed
 * struct, the same discipline the other twin-style checks in this
 * directory follow.
 */
import { describe, expect, it } from 'vitest';
import { advanceSupportLevel, initialSupportLevelState } from '../support-level/ladder.js';
import { supportLevelReviewFields } from '../support-level/record.js';
import {
  checkSupportLevelRecordShape,
  checkSupportOfferRateByDepth,
  type SupportLevelRecordCase,
  type SupportOfferCase,
} from './support-level-offer-rate.js';

/** Runs `cleanSessions` clean, unhinted sessions from cold start and reports whether support is still offered (level !== 'independent'). */
function offeredAfterCleanSessions(cleanSessions: number): boolean {
  let state = initialSupportLevelState();
  for (let i = 0; i < cleanSessions; i += 1) {
    state = advanceSupportLevel(state, { failureShape: 'none', hintUptake: false });
  }
  return state.level !== 'independent';
}

describe('checkSupportOfferRateByDepth', () => {
  it('passes on the real ladder: offer rate drops as evidence depth (consecutive clean sessions) grows', () => {
    // Several cases per depth so each bin has more than one point, the way
    // a real corpus would.
    const cases: SupportOfferCase[] = [];
    for (const depth of [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]) {
      cases.push({ evidenceDepth: depth, offered: offeredAfterCleanSessions(depth) });
    }

    const verdict = checkSupportOfferRateByDepth(cases, /* binWidth */ 1, /* minRateRange */ 0.5);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.rateRange).toBeGreaterThanOrEqual(0.5);
    // Sanity: the shallow bin should be near-fully offered, the deep bin
    // near-fully receded — this is what makes the range large, not an
    // artifact of the bar chosen.
    const shallow = verdict.measured.bins.find((b) => b.binIndex === 0);
    const deep = verdict.measured.bins.at(-1);
    expect(shallow?.rate).toBe(1);
    expect(deep?.rate).toBe(0);
  });

  it('FAILS when the offer rate is flat across depth — the trigger not firing, made real', () => {
    // Every case offered regardless of depth — e.g. a trigger that never
    // recedes, wired to ignore the evidence entirely.
    const cases: SupportOfferCase[] = [0, 1, 2, 3, 4, 5].map((depth) => ({
      evidenceDepth: depth,
      offered: true,
    }));

    const verdict = checkSupportOfferRateByDepth(cases, 1, 0.5);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.rateRange).toBe(0);
  });

  it('fails on zero cases (N-013)', () => {
    const verdict = checkSupportOfferRateByDepth([], 1, 0.5);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(0);
  });

  it('fails when fewer than two non-empty bins exist — a range needs two points', () => {
    const cases: SupportOfferCase[] = [
      { evidenceDepth: 0, offered: true },
      { evidenceDepth: 0.5, offered: false },
    ];
    // binWidth 10 puts both cases in bin 0.
    const verdict = checkSupportOfferRateByDepth(cases, 10, 0.1);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.bins.length).toBe(1);
  });

  it('throws on a non-positive binWidth', () => {
    expect(() =>
      checkSupportOfferRateByDepth([{ evidenceDepth: 0, offered: true }], 0, 0.1),
    ).toThrow(/binWidth/);
  });
});

describe('checkSupportLevelRecordShape', () => {
  function caseFor(
    id: string,
    level: 'independent' | 'prompted' | 'guided',
  ): SupportLevelRecordCase {
    const fields = supportLevelReviewFields(level);
    return { id, hasSupportLevelShown: 'supportLevelShown' in fields, hasSelfRating: false };
  }

  it('passes when every record carries a shown level and none carries a self-rating', () => {
    const cases = [
      caseFor('r1', 'independent'),
      caseFor('r2', 'prompted'),
      caseFor('r3', 'guided'),
    ];
    const verdict = checkSupportLevelRecordShape(cases);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.missingSupportLevel).toEqual([]);
    expect(verdict.measured.leakedSelfRating).toEqual([]);
  });

  it('FAILS when a record is missing supportLevelShown', () => {
    const cases: SupportLevelRecordCase[] = [
      { id: 'ok', hasSupportLevelShown: true, hasSelfRating: false },
      { id: 'missing', hasSupportLevelShown: false, hasSelfRating: false },
    ];
    const verdict = checkSupportLevelRecordShape(cases);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.missingSupportLevel).toEqual(['missing']);
  });

  it('FAILS when a record carries a self-rating — the leak this check exists to catch', () => {
    const cases: SupportLevelRecordCase[] = [
      { id: 'ok', hasSupportLevelShown: true, hasSelfRating: false },
      { id: 'leaked', hasSupportLevelShown: true, hasSelfRating: true },
    ];
    const verdict = checkSupportLevelRecordShape(cases);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.leakedSelfRating).toEqual(['leaked']);
  });

  it('fails on zero cases (N-013)', () => {
    const verdict = checkSupportLevelRecordShape([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(0);
  });
});
