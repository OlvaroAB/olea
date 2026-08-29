/**
 * Scenarios: `features/F4-oracle.md`, "F4.6 / F4.7 / F4.8 — the session
 * builder" — @auto:core/study-session/explain-back.spec
 */

import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/types.js';
import type { DurationModel } from './duration.js';
import {
  type AcceptedExplainBack,
  priceAcceptedExplainBacks,
  totalExplainBackSeconds,
} from './explain-back.js';

function event(instrumentId: string, conceptName = 'Alpha'): AcceptedExplainBack {
  return {
    instrumentId,
    conceptName,
    course: 'CRS101',
    notePath: `05 Zettelkasten/${instrumentId}.md` as VaultPath,
    noteTitle: instrumentId,
  };
}

function durations(seconds: number, source: 'measured' | 'assumed'): DurationModel {
  return {
    estimates: [],
    basis: 'assumed',
    totalSampleCount: 0,
    secondsFor: (instrumentType) => (instrumentType === 'explain-back' ? seconds : 0),
    sourceFor: (instrumentType) => (instrumentType === 'explain-back' ? source : 'assumed'),
  };
}

describe('priceAcceptedExplainBacks (F2.14a, `[D-126]`)', () => {
  it('prices every event from the duration model, order-preserving', () => {
    const items = priceAcceptedExplainBacks(
      [event('eb1', 'Alpha'), event('eb2', 'Beta')],
      durations(90, 'assumed'),
    );
    expect(items.map((i) => i.instrumentId)).toEqual(['eb1', 'eb2']);
    expect(items.every((i) => i.instrumentType === 'explain-back')).toBe(true);
    expect(items.every((i) => i.estimatedSeconds === 90)).toBe(true);
    expect(items.every((i) => i.durationSource === 'assumed')).toBe(true);
  });

  it('carries every fact from the event through unchanged', () => {
    const [item] = priceAcceptedExplainBacks([event('eb1', 'Alpha')], durations(120, 'measured'));
    expect(item).toMatchObject({
      instrumentId: 'eb1',
      conceptName: 'Alpha',
      course: 'CRS101',
      notePath: '05 Zettelkasten/eb1.md',
      noteTitle: 'eb1',
      instrumentType: 'explain-back',
      estimatedSeconds: 120,
      durationSource: 'measured',
    });
  });

  it('an empty list of events prices to an empty list of items', () => {
    expect(priceAcceptedExplainBacks([], durations(90, 'assumed'))).toEqual([]);
  });

  it('carries a caller-supplied supportLevel decision through unchanged (row 3.9, `[SUPP-2]`) — this module never computes one', () => {
    const withDecision: AcceptedExplainBack = {
      ...event('eb1', 'Alpha'),
      supportLevel: { level: 'guided', provenance: 'self-requested' },
    };
    const [item] = priceAcceptedExplainBacks([withDecision], durations(90, 'assumed'));
    expect(item?.supportLevel).toEqual({ level: 'guided', provenance: 'self-requested' });
  });

  it('an event with no supportLevel prices to an item with none either — never a fabricated default', () => {
    const [item] = priceAcceptedExplainBacks([event('eb1')], durations(90, 'assumed'));
    expect(Object.hasOwn(item ?? {}, 'supportLevel')).toBe(false);
  });

  it('never reads a candidate-type seconds/source — it asks the model for explain-back specifically', () => {
    const model: DurationModel = {
      estimates: [],
      basis: 'assumed',
      totalSampleCount: 0,
      secondsFor: (instrumentType) => {
        expect(instrumentType).toBe('explain-back');
        return 90;
      },
      sourceFor: (instrumentType) => {
        expect(instrumentType).toBe('explain-back');
        return 'assumed';
      },
    };
    priceAcceptedExplainBacks([event('eb1')], model);
  });
});

describe('totalExplainBackSeconds', () => {
  it('sums every priced item', () => {
    const items = priceAcceptedExplainBacks(
      [event('eb1', 'Alpha'), event('eb2', 'Beta'), event('eb3', 'Gamma')],
      durations(90, 'assumed'),
    );
    expect(totalExplainBackSeconds(items)).toBe(270);
  });

  it('is zero for an empty list', () => {
    expect(totalExplainBackSeconds([])).toBe(0);
  });
});
