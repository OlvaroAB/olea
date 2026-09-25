// `ol-egov.141.89.9.4`: the support ladder's history as a core fold over
// clustered sessions (the attainment chain spec's section 2.6 in
// `olea-service`; failure classes L1, L3, L4, L5, L6, L8). Ids are structural
// placeholders, never fixture vocabulary (INV-3).
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { SESSION_CLUSTERING_GAP_SECONDS } from '../session/cluster.js';
import { chooseSupportLevel } from '../study-session/support-level-chooser.js';
import { buildSupportLevelHistory } from './history.js';

const MIN = 60 * 1000;
const BASE = Date.parse('2026-02-01T09:00:00.000Z');

function at(minutes: number): string {
  return new Date(BASE + minutes * MIN).toISOString();
}

let counter = 0;
function review(minutes: number, overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  counter += 1;
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${String(counter).padStart(4, '0')}`,
    timestamp: at(minutes),
    instrumentId: 'qa:a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    supportLevelShown: 'prompted',
    ...overrides,
  };
}

function explainBack(
  minutes: number,
  correctness: 'correct' | 'partial' | 'incorrect' | undefined,
  soloLevel: 'multistructural' | 'relational' = 'relational',
): ReviewLogRecord {
  return review(minutes, {
    instrumentId: 'eb:a',
    instrumentType: 'explain-back',
    rating: null,
    explainBackGrade: {
      soloLevel,
      ...(correctness === undefined ? {} : { correctness }),
      contentRef: 'content-ref-placeholder',
      revisionOf: null,
      artifactProvenance: { taskId: 'explain-back-grade', promptVersion: 'v0', modelId: 'm' },
    },
  });
}

/** Minutes between sessions: comfortably more than the declared clustering gap. */
const APART = SESSION_CLUSTERING_GAP_SECONDS / 60 + 60;

describe('one outcome per SESSION, never per review (L5, [D-094], C5.4)', () => {
  it('two clean answers minutes apart are one clean session: support does not recede yet', () => {
    const history = buildSupportLevelHistory([review(0), review(5)]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
    expect(chooseSupportLevel(history.outcomesFor('concept-a', 'recall')).level).toBe('prompted');
  });

  it('two clean sessions apart recede support (L4)', () => {
    const history = buildSupportLevelHistory([review(0), review(APART)]);
    expect(history.outcomesFor('concept-a', 'recall')).toHaveLength(2);
    expect(chooseSupportLevel(history.outcomesFor('concept-a', 'recall')).level).toBe(
      'independent',
    );
  });

  it('a clean answer beside a miss in one sitting is one failing session', () => {
    const history = buildSupportLevelHistory([review(0), review(3, { rating: 'again' })]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });

  it('shuffled input gives the same history', () => {
    const entries = [review(0), review(3, { rating: 'again' }), review(APART), review(APART + 2)];
    const a = buildSupportLevelHistory(entries).outcomesFor('concept-a', 'recall');
    const b = buildSupportLevelHistory([...entries].reverse()).outcomesFor('concept-a', 'recall');
    expect(b).toEqual(a);
  });
});

describe('tiers are separate ladders; explanations read correctness first (L8, [D-286], [D-281])', () => {
  it('a clean recall answer never papers over a failing explanation in the same sitting', () => {
    const history = buildSupportLevelHistory([review(0), explainBack(4, 'incorrect')]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });

  it('a relational but incorrect explanation is a failure, never clean', () => {
    const history = buildSupportLevelHistory([explainBack(0, 'incorrect', 'relational')]);
    expect(history.outcomesFor('concept-a', 'explanation')[0]?.failureShape).toBe('wrong-concept');
  });

  it('unknown correctness never reads as a clean pass', () => {
    const history = buildSupportLevelHistory([explainBack(0, undefined, 'relational')]);
    expect(history.outcomesFor('concept-a', 'explanation')[0]?.failureShape).toBe('minor-slip');
  });

  it('a correct, relational explanation is clean', () => {
    const history = buildSupportLevelHistory([explainBack(0, 'correct', 'relational')]);
    expect(history.outcomesFor('concept-a', 'explanation')[0]?.failureShape).toBe('none');
  });
});

describe('what has no ladder, or no honest reading, is skipped (L6)', () => {
  it('a quiz item has no ladder', () => {
    const history = buildSupportLevelHistory([
      review(0, { instrumentId: 'mcq:a:1', instrumentType: 'mcq' }),
    ]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([]);
    expect(chooseSupportLevel(history.outcomesFor('concept-a', 'recall')).level).toBe('prompted');
  });

  it('a recall review with no rating, and an ungraded explain-back, are skipped', () => {
    const ungraded = review(1, {
      instrumentId: 'eb:a',
      instrumentType: 'explain-back',
      rating: null,
    });
    const history = buildSupportLevelHistory([review(0, { rating: null }), ungraded]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([]);
  });

  it('an instrument naming several concepts contributes to each', () => {
    const history = buildSupportLevelHistory([
      review(0, { conceptIds: ['concept-a', 'concept-b'] }),
    ]);
    expect(history.outcomesFor('concept-b', 'recall')).toHaveLength(1);
  });
});

describe('hint use is not recorded yet ([D-350] open): read as not taken (L1)', () => {
  it('every outcome says no hint was taken, never a fabricated positive', () => {
    const history = buildSupportLevelHistory([review(0), review(APART, { rating: 'again' })]);
    for (const outcome of history.outcomesFor('concept-a', 'recall')) {
      expect(outcome.hintUptake).toBe(false);
    }
  });
});

describe('levels are fixed at composition, extension included (L3, [D-186])', () => {
  const earlier = [review(0), review(APART)];
  const composedAt = new Date(BASE + 2 * APART * MIN);
  const inSession = [review(2 * APART + 5, { rating: 'again' }), review(2 * APART + 10)];

  it('reads only sessions closed before the composition', () => {
    const atComposition = buildSupportLevelHistory(earlier, { composedAt });
    expect(chooseSupportLevel(atComposition.outcomesFor('concept-a', 'recall')).level).toBe(
      'independent',
    );
  });

  it('an extension asks as of the same composition and reads the same levels, whatever she answered since', () => {
    const later = buildSupportLevelHistory([...earlier, ...inSession], { composedAt });
    expect(later.outcomesFor('concept-a', 'recall')).toEqual(
      buildSupportLevelHistory(earlier, { composedAt }).outcomesFor('concept-a', 'recall'),
    );
  });

  it('a new composition while the sitting is still open does not read the session in progress', () => {
    const tenMinutesAfter = new Date(BASE + (2 * APART + 20) * MIN);
    const history = buildSupportLevelHistory([...earlier, ...inSession], {
      composedAt: tenMinutesAfter,
    });
    expect(history.outcomesFor('concept-a', 'recall')).toHaveLength(2);
  });

  it('once the sitting has closed, the next composition reads it', () => {
    const wellAfter = new Date(BASE + 3 * APART * MIN);
    const history = buildSupportLevelHistory([...earlier, ...inSession], { composedAt: wellAfter });
    expect(history.outcomesFor('concept-a', 'recall')).toHaveLength(3);
    expect(history.outcomesFor('concept-a', 'recall')[2]?.failureShape).toBe('wrong-concept');
  });

  it('without a composition instant it reads every session, as the plugin fold does today', () => {
    const history = buildSupportLevelHistory([...earlier, ...inSession]);
    expect(history.outcomesFor('concept-a', 'recall')).toHaveLength(3);
  });
});
