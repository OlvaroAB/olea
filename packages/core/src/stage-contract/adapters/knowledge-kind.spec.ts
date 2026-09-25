/**
 * The knowledge-kind seam through the Decision contract
 * (`ol-egov.141.89.20`), with seam values from `classifyKnowledgeKind` over
 * stub ports.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import {
  type ClassifyKnowledgeKindRequest,
  type ClassifyKnowledgeKindResponse,
  classifyKnowledgeKind,
  type KnowledgeKindClassifierPort,
  KnowledgeKindClassifierUnavailableError,
} from '../../concept/knowledge-kind.js';
import { decisionEnvelopeProblems, decisionWord } from '../decision.js';
import {
  decisionFromKnowledgeKind,
  KNOWLEDGE_KIND_VOCABULARY,
  type KnowledgeKindSeamContext,
  NO_SOURCE_MATERIAL_RULE,
} from './knowledge-kind.js';

const FLOOR = 0.6;

const context: KnowledgeKindSeamContext = {
  seat: 'candidate',
  taskId: 'concepts.classify.v1',
  stamp: null,
  evidenceDigests: ['passage-digest-1'],
  confidenceFloor: FLOOR,
};

const request: ClassifyKnowledgeKindRequest = {
  conceptName: 'Concept A',
  sourceMaterial: [
    {
      text: 'Concept A is defined as coined words.',
      anchor: { sourcePath: 'Note A.md', location: { page: 1, charRange: { start: 0, end: 10 } } },
    },
  ],
};

function port(response: ClassifyKnowledgeKindResponse): KnowledgeKindClassifierPort {
  return { classify: async () => response };
}

function throwing(error: Error): KnowledgeKindClassifierPort {
  return {
    classify: async () => {
      throw error;
    },
  };
}

const classify = (p: KnowledgeKindClassifierPort, r = request) =>
  classifyKnowledgeKind(p, r, { confidenceFloor: FLOOR });

describe('decisionFromKnowledgeKind', () => {
  it('reads a committed label as a verdict with its confidence', async () => {
    const decision = decisionFromKnowledgeKind(
      await classify(port({ kind: 'principle', confidence: 0.8 })),
      context,
    );
    expect(decision).toMatchObject({ kind: 'verdict', verdict: 'principle', confidence: 0.8 });
    expect(decisionEnvelopeProblems(decision, KNOWLEDGE_KIND_VOCABULARY)).toEqual([]);
  });

  it('reads unclassified as undecided: below the floor, or the model declining', async () => {
    const below = decisionFromKnowledgeKind(
      await classify(port({ kind: 'fact', confidence: 0.3 })),
      context,
    );
    const declined = decisionFromKnowledgeKind(
      await classify(port({ kind: 'unclassified', confidence: 0.9 })),
      context,
    );
    expect(below).toMatchObject({
      kind: 'undecided',
      basis: 'below-confidence-bar',
      confidence: 0.3,
    });
    expect(declined).toMatchObject({ kind: 'undecided', basis: 'abstained', confidence: 0.9 });
    expect(decisionWord(KNOWLEDGE_KIND_VOCABULARY, below)).toBe('unclassified');
  });

  it('keeps not-run apart from unclassified: no material is undecided by code, an outage is unavailable', async () => {
    const empty = decisionFromKnowledgeKind(
      await classify(port({ kind: 'fact', confidence: 1 }), { ...request, sourceMaterial: [] }),
      context,
    );
    expect(empty).toEqual({
      kind: 'undecided',
      basis: 'nothing-to-decide-from',
      provenance: {
        producer: { kind: 'code', rule: NO_SOURCE_MATERIAL_RULE },
        evidenceDigests: ['passage-digest-1'],
      },
    });
    expect(
      decisionFromKnowledgeKind(
        await classify(throwing(new KnowledgeKindClassifierUnavailableError('offline'))),
        context,
      ),
    ).toMatchObject({ kind: 'unavailable', cause: 'offline' });
    expect(
      decisionFromKnowledgeKind(await classify(throwing(new Error('500'))), context),
    ).toMatchObject({ kind: 'unavailable', cause: 'call-failed' });
  });
});
