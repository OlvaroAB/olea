/**
 * `selectPracticeFormat` — no vault content anywhere here; every fixture is
 * invented, so INV-3 does not apply to this file the way it does to a module
 * reading real material.
 */

import { describe, expect, it } from 'vitest';
import type { KnowledgeKindClassification } from '../concept/knowledge-kind.js';
import { EMPHASIS_ORDER, type InstrumentMix, instrumentMixGaps } from './instrument-mix.js';
import {
  MCQ_ONLY_DELIVERABLE_FORMATS,
  type RoutingDecision,
  selectPracticeFormat,
} from './practice-need.js';

const UNCLASSIFIED: KnowledgeKindClassification = {
  status: 'unclassified',
  confidence: undefined,
  method: 'model',
};

function decisionFor(
  mix: InstrumentMix,
  inventory: Parameters<typeof instrumentMixGaps>[1],
): RoutingDecision {
  return { classification: UNCLASSIFIED, mix, gaps: instrumentMixGaps(mix, inventory) };
}

describe('selectPracticeFormat — a deliverable format is wanted', () => {
  it('returns the quiz format when quiz has a deficit and quiz is deliverable', () => {
    const decision = decisionFor(
      { retrieval: 'none', quiz: 'floor', explainBack: 'none' },
      { retrieval: 0, quiz: 0, explainBack: 0 },
    );
    expect(selectPracticeFormat(decision, 'concept-1')).toBe('quiz');
  });

  it('accepts a caller-supplied deliverable set rather than assuming MCQ-only', () => {
    const decision = decisionFor(
      { retrieval: 'floor', quiz: 'none', explainBack: 'none' },
      { retrieval: 0, quiz: 0, explainBack: 0 },
    );
    expect(selectPracticeFormat(decision, 'concept-1', new Set(['retrieval']))).toBe('retrieval');
  });
});

describe('selectPracticeFormat — wanted, but nothing deliverable: explicit deferral', () => {
  it('records an unmet practice need when only explainBack is wanted and Olea can only deliver quiz', () => {
    const decision = decisionFor(
      { retrieval: 'none', quiz: 'none', explainBack: 'weighted' },
      { retrieval: 0, quiz: 0, explainBack: 0 },
    );
    const result = selectPracticeFormat(decision, 'concept-2', MCQ_ONLY_DELIVERABLE_FORMATS);
    expect(result).toEqual({
      conceptKey: 'concept-2',
      wantedFormats: ['explainBack'],
      reason: 'unmet-format',
    });
  });

  it('names every wanted-but-undeliverable format, not just one', () => {
    const decision = decisionFor(
      { retrieval: 'floor', quiz: 'none', explainBack: 'weighted' },
      { retrieval: 0, quiz: 0, explainBack: 0 },
    );
    const result = selectPracticeFormat(decision, 'concept-3', MCQ_ONLY_DELIVERABLE_FORMATS);
    expect(result).toEqual({
      conceptKey: 'concept-3',
      wantedFormats: ['retrieval', 'explainBack'],
      reason: 'unmet-format',
    });
  });

  it('prefers the deliverable format even when a non-deliverable group is ALSO wanted', () => {
    const decision = decisionFor(
      { retrieval: 'floor', quiz: 'floor', explainBack: 'weighted' },
      { retrieval: 0, quiz: 0, explainBack: 0 },
    );
    // retrieval and explainBack are both wanted too, but quiz is the one Olea can deliver.
    expect(selectPracticeFormat(decision, 'concept-4')).toBe('quiz');
  });
});

describe('selectPracticeFormat — nothing wanted at all: still an explicit record, never nothing', () => {
  it('reports an explicit nothing-wanted record when every group already meets its target', () => {
    const decision = decisionFor(
      { retrieval: 'floor', quiz: 'floor', explainBack: 'floor' },
      {
        retrieval: EMPHASIS_ORDER.floor,
        quiz: EMPHASIS_ORDER.floor,
        explainBack: EMPHASIS_ORDER.floor,
      },
    );
    const result = selectPracticeFormat(decision, 'concept-5');
    expect(result).toEqual({ conceptKey: 'concept-5', nothingWanted: true });
  });

  it('never returns undefined or null', () => {
    const decision = decisionFor(
      { retrieval: 'none', quiz: 'none', explainBack: 'none' },
      { retrieval: 0, quiz: 0, explainBack: 0 },
    );
    const result = selectPracticeFormat(decision, 'concept-6');
    expect(result).not.toBeUndefined();
    expect(result).not.toBeNull();
  });
});

describe('selectPracticeFormat — determinism', () => {
  it('is pure: the same inputs produce the same result every time', () => {
    const decision = decisionFor(
      { retrieval: 'floor', quiz: 'none', explainBack: 'weighted' },
      { retrieval: 0, quiz: 0, explainBack: 0 },
    );
    const first = selectPracticeFormat(decision, 'concept-7');
    const second = selectPracticeFormat(decision, 'concept-7');
    expect(first).toEqual(second);
  });
});
