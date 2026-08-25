/**
 * KC-type-to-instrument routing (`ol-tqd5`, `ol-dlr1`, `./instrument-mix.ts`).
 *
 * No vault content anywhere here — every fixture is invented, so INV-3 does
 * not apply to this file the way it does to a module reading real material.
 */

import { describe, expect, it } from 'vitest';
import type { KnowledgeKind, KnowledgeKindClassification } from '../concept/knowledge-kind.js';
import {
  CARDS_FOR_EVERYTHING_NULL,
  EMPHASIS_ORDER,
  EMPTY_INVENTORY,
  instrumentMixGaps,
  ROUTING_GROUPS,
  routeKnowledgeKind,
  routeKnowledgeKindClassification,
  routingReason,
  UNCLASSIFIED_MIX,
} from './instrument-mix.js';

const REAL_KINDS: readonly KnowledgeKind[] = ['fact', 'category', 'principle'];

describe('routeKnowledgeKind — the charter-owned table', () => {
  it('routes fact to retrieval-dominant', () => {
    expect(routeKnowledgeKind('fact')).toEqual({
      retrieval: 'dominant',
      quiz: 'floor',
      explainBack: 'floor',
    });
  });

  it('routes category to quiz-weighted', () => {
    expect(routeKnowledgeKind('category')).toEqual({
      retrieval: 'floor',
      quiz: 'weighted',
      explainBack: 'floor',
    });
  });

  it('routes principle to explain-back-weighted', () => {
    expect(routeKnowledgeKind('principle')).toEqual({
      retrieval: 'floor',
      quiz: 'floor',
      explainBack: 'weighted',
    });
  });

  it('routes a declined classification (null) to the retrieval baseline alone', () => {
    expect(routeKnowledgeKind(null)).toEqual(UNCLASSIFIED_MIX);
    expect(UNCLASSIFIED_MIX).toEqual({ retrieval: 'floor', quiz: 'none', explainBack: 'none' });
  });
});

describe('CAN FAIL: membership never varies for a real label', () => {
  // The module doc's depth-gate-reachability argument: a real KnowledgeKind
  // must never exclude a group outright, or that KC type is permanently
  // locked out of whatever mastery evidence only that group can produce
  // (explainBack for the growth-stage top; retrieval for vitality). Only
  // `unclassified` may legitimately narrow to fewer than three groups.
  for (const kind of REAL_KINDS) {
    it(`${kind}: no routing group is 'none'`, () => {
      const mix = routeKnowledgeKind(kind);
      for (const group of ROUTING_GROUPS) {
        expect(mix[group]).not.toBe('none');
      }
    });
  }

  it('unclassified is the one legitimate exception', () => {
    const mix = routeKnowledgeKind(null);
    expect(mix.quiz).toBe('none');
    expect(mix.explainBack).toBe('none');
  });
});

describe('CAN FAIL: retrieval is never absent, for any input including the null', () => {
  for (const kind of [...REAL_KINDS, null]) {
    it(`${kind ?? 'unclassified'}: retrieval keeps at least a floor`, () => {
      expect(routeKnowledgeKind(kind).retrieval).not.toBe('none');
    });
  }
});

describe('routeKnowledgeKindClassification — the discriminated-union entry point', () => {
  it('reads a classified result through to the same mix as the bare label', () => {
    const classification: KnowledgeKindClassification = {
      status: 'classified',
      kind: 'principle',
      confidence: 0.9,
      method: 'model',
    };
    expect(routeKnowledgeKindClassification(classification)).toEqual(
      routeKnowledgeKind('principle'),
    );
  });

  it('reads an unclassified result — model-declined — to the retrieval baseline', () => {
    const classification: KnowledgeKindClassification = {
      status: 'unclassified',
      confidence: undefined,
      method: 'model',
    };
    expect(routeKnowledgeKindClassification(classification)).toEqual(UNCLASSIFIED_MIX);
  });

  it('reads an unclassified result — gated below the confidence floor — the same way as a model decline', () => {
    // The gate only ever ADDS declines (knowledge-kind.ts's own doc); from
    // this module's side, a gated decline and a model decline are the same
    // input shape and must route identically.
    const classification: KnowledgeKindClassification = {
      status: 'unclassified',
      confidence: 0.6,
      method: 'model',
    };
    expect(routeKnowledgeKindClassification(classification)).toEqual(UNCLASSIFIED_MIX);
  });
});

describe('routingReason — the stated reason routing proposes a mix', () => {
  it('names the kind for every real label, and is distinct per label', () => {
    const reasons = new Set(REAL_KINDS.map((kind) => routingReason(kind)));
    expect(reasons.size).toBe(REAL_KINDS.length);
  });

  it('states honestly that nothing was classified, for the null case', () => {
    expect(routingReason(null)).toMatch(/could not tell/i);
  });
});

describe('CARDS_FOR_EVERYTHING_NULL — the comparator this policy must eventually beat', () => {
  it('is a real 1:1 routing, deliberately — the strawman the tenet forbids', () => {
    expect(CARDS_FOR_EVERYTHING_NULL).toEqual({
      retrieval: 'dominant',
      quiz: 'none',
      explainBack: 'none',
    });
  });

  it('differs from every real KC-type mix — it is a comparator, not a fourth table entry', () => {
    for (const kind of REAL_KINDS) {
      expect(routeKnowledgeKind(kind)).not.toEqual(CARDS_FOR_EVERYTHING_NULL);
    }
  });
});

describe('EMPHASIS_ORDER — the declared ordinal scale', () => {
  it('is strictly increasing: none < floor < weighted < dominant', () => {
    expect(EMPHASIS_ORDER.none).toBeLessThan(EMPHASIS_ORDER.floor);
    expect(EMPHASIS_ORDER.floor).toBeLessThan(EMPHASIS_ORDER.weighted);
    expect(EMPHASIS_ORDER.weighted).toBeLessThan(EMPHASIS_ORDER.dominant);
  });
});

describe('instrumentMixGaps', () => {
  it('reports the full deficit against an empty inventory', () => {
    const gaps = instrumentMixGaps(routeKnowledgeKind('principle'), EMPTY_INVENTORY);
    expect(gaps).toEqual([
      { group: 'retrieval', emphasis: 'floor', target: 1, existing: 0, deficit: 1 },
      { group: 'quiz', emphasis: 'floor', target: 1, existing: 0, deficit: 1 },
      { group: 'explainBack', emphasis: 'weighted', target: 2, existing: 0, deficit: 2 },
    ]);
  });

  it('never reports a deficit once existing meets or exceeds target', () => {
    const gaps = instrumentMixGaps(routeKnowledgeKind('fact'), {
      retrieval: 5,
      quiz: 5,
      explainBack: 5,
    });
    for (const gap of gaps) expect(gap.deficit).toBe(0);
  });

  it('a group at "none" always has target 0 and deficit 0, however much inventory already exists', () => {
    const gaps = instrumentMixGaps(routeKnowledgeKind(null), {
      retrieval: 0,
      quiz: 3,
      explainBack: 3,
    });
    const quiz = gaps.find((g) => g.group === 'quiz');
    const explainBack = gaps.find((g) => g.group === 'explainBack');
    expect(quiz).toMatchObject({ emphasis: 'none', target: 0, deficit: 0 });
    expect(explainBack).toMatchObject({ emphasis: 'none', target: 0, deficit: 0 });
  });

  it('one group short of its floor, others already met', () => {
    const gaps = instrumentMixGaps(routeKnowledgeKind('category'), {
      retrieval: 1,
      quiz: 0,
      explainBack: 1,
    });
    expect(gaps.find((g) => g.group === 'retrieval')?.deficit).toBe(0);
    expect(gaps.find((g) => g.group === 'quiz')?.deficit).toBe(2);
    expect(gaps.find((g) => g.group === 'explainBack')?.deficit).toBe(0);
  });
});
