import type { AssessmentRecord, RetrospectiveOfferEvent } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  resolveOfferCards,
  unrecordedOfferedAssessmentPaths,
} from '../../src/retrospective/offer-card.js';

const NOW = new Date('2026-09-01T09:00:00.000Z');

function assessment(overrides: Partial<AssessmentRecord> = {}): AssessmentRecord {
  return {
    path: 'Courses/C1/Final.md',
    course: 'C1',
    type: undefined,
    weight: undefined,
    weightRaw: undefined,
    due: '2026-08-20',
    status: undefined,
    ...overrides,
  };
}

describe('resolveOfferCards', () => {
  it('offers a card for a passed, never-touched assessment', () => {
    const cards = resolveOfferCards([assessment()], [], NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.course).toBe('C1');
  });

  it('never offers a card for an assessment that has not passed yet', () => {
    const cards = resolveOfferCards([assessment({ due: '2026-12-01' })], [], NOW);
    expect(cards).toEqual([]);
  });

  it('never offers a card once opened', () => {
    const events: readonly RetrospectiveOfferEvent[] = [
      {
        kind: 'retrospective-opened',
        assessmentPath: 'Courses/C1/Final.md',
        timestamp: '2026-08-21T00:00:00Z',
      },
    ];
    expect(resolveOfferCards([assessment()], events, NOW)).toEqual([]);
  });

  it('never offers a card once dismissed', () => {
    const events: readonly RetrospectiveOfferEvent[] = [
      {
        kind: 'retrospective-dismissed',
        assessmentPath: 'Courses/C1/Final.md',
        timestamp: '2026-08-21T00:00:00Z',
      },
    ];
    expect(resolveOfferCards([assessment()], events, NOW)).toEqual([]);
  });

  it('never fabricates more than one card per assessment across multiple calls worth of events', () => {
    const cards = resolveOfferCards(
      [assessment(), assessment({ path: 'Courses/C2/Mid.md', course: 'C2', due: '2026-08-15' })],
      [],
      NOW,
    );
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.assessmentPath)).size).toBe(2);
  });
});

describe('unrecordedOfferedAssessmentPaths (`ol-0r92.26`, D7.1 as amended by `[D-178]`)', () => {
  it('names a showing card that has never had a retrospective-offered event logged', () => {
    const cards = resolveOfferCards([assessment()], [], NOW);
    expect(unrecordedOfferedAssessmentPaths(cards, [])).toEqual(['Courses/C1/Final.md']);
  });

  it('drops an assessment that already has a retrospective-offered event', () => {
    const cards = resolveOfferCards([assessment()], [], NOW);
    const events: readonly RetrospectiveOfferEvent[] = [
      {
        kind: 'retrospective-offered',
        assessmentPath: 'Courses/C1/Final.md',
        timestamp: '2026-08-21T00:00:00Z',
      },
    ];
    expect(unrecordedOfferedAssessmentPaths(cards, events)).toEqual([]);
  });

  it('never names an assessment with no showing card at all (opened, so excluded upstream)', () => {
    const events: readonly RetrospectiveOfferEvent[] = [
      {
        kind: 'retrospective-opened',
        assessmentPath: 'Courses/C1/Final.md',
        timestamp: '2026-08-21T00:00:00Z',
      },
    ];
    const cards = resolveOfferCards([assessment()], events, NOW);
    expect(cards).toEqual([]);
    expect(unrecordedOfferedAssessmentPaths(cards, events)).toEqual([]);
  });
});
