/**
 * `ol-egov.141.89.6.50` — direct, runtime coverage for `recordSoloGradeAndReview`'s
 * two new params (`sourceMaterial`, `relationExpected`) and the exact gap
 * `ol-egov.141.89.6.48`'s own report named: `buildGradeSoloInputFromTypedAnswer`
 * gained an optional `resolved` argument, but nothing called it yet —
 * `modal.ts`'s `resolveGradingSourceBlocks` built a correct `GradingSourceMaterial`
 * and threw it away after flattening. This bead threads it through
 * `ResolvedPrompt` → `recordSoloGradeAndReview`'s params → `buildGradeSoloInputFromTypedAnswer`'s
 * `resolved` argument. `modal.ts` itself cannot be imported under Vitest
 * (`obsidian`, see this directory's other specs); `solo-review.ts` has no such
 * constraint, so this file tests it directly, for real, no source-extraction.
 *
 * The acceptance criterion under test: "with a causes partner the SOLO
 * denominator excludes the neighbour's defining passages and keeps edge
 * provenance, and relationExpected is true; without one, the SOLO input is
 * identical to today's."
 *
 * `buildGradeSoloInputFromTypedAnswer` is spied (real implementation,
 * `vi.fn(actual...)`, mirroring `grove/provider.spec.ts`'s own pattern for
 * `buildRegistryModel`) so the exact `resolved` argument `solo-review.ts`
 * constructs can be inspected directly — `omissionDenominator` is not
 * currently forwarded to the Worker wire request at all (`explainBackSolo.ts`'s
 * own module doc: "omissionDenominator is not read here"), so this is the
 * only place in this repo the denominator's actual VALUE, as threaded by
 * this bead's change, can be observed.
 */

import type { ExplainBackPromptContext, GradingSourceMaterial, WorkerTaskRequest } from 'olea-core';
import { buildGradingSourceMaterial } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import * as requestModule from '../../src/explain-back/request.js';
import { recordSoloGradeAndReview } from '../../src/explain-back/solo-review.js';
import type { GradingWiring } from '../../src/grading/wiring.js';
import { memoryVault } from '../review/memory-vault.js';

// Hoisted above every import above by Vitest's own transform (mirrors
// `grove/provider.spec.ts`'s identical pattern for `buildRegistryModel`), so
// `solo-review.ts`'s own `import { buildGradeSoloInputFromTypedAnswer } from
// './request.js'` binds to this spied wrapper — the real implementation,
// called through, never a hand-written re-implementation.
vi.mock('../../src/explain-back/request.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/explain-back/request.js')>();
  return {
    ...actual,
    buildGradeSoloInputFromTypedAnswer: vi.fn(actual.buildGradeSoloInputFromTypedAnswer),
  };
});

const SUBJECT: SourceBlockRefLike[] = [{ blockId: 'subject-1', text: 'The subject concept.' }];
const EDGE: SourceBlockRefLike[] = [
  { blockId: 'edge-1', text: 'How the subject causes the neighbour.' },
];
const NEIGHBOUR: SourceBlockRefLike[] = [
  { blockId: 'neighbour-1', text: 'The neighbour concept, defined on its own terms.' },
];

interface SourceBlockRefLike {
  readonly blockId: string;
  readonly text: string;
}

/** A real, F5.3-correct `GradingSourceMaterial` for a resolved edge-provenance causes partner — built through the actual (already independently tested, `gradingInputContract.spec.ts`) core function, never hand-assembled, so this file cannot silently drift from what F5.3 actually requires. */
const RELATION_MATERIAL: GradingSourceMaterial = buildGradingSourceMaterial({
  subject: { subjectConceptId: 'concept-subject' },
  subjectDefiningPassages: { conceptId: 'concept-subject', passages: SUBJECT },
  relation: {
    kind: 'relation',
    neighbourConceptId: 'concept-neighbour',
    provenance: { kind: 'edge-provenance', passages: EDGE },
  },
  neighbourDefiningPassages: { conceptId: 'concept-neighbour', passages: NEIGHBOUR },
});

const CONTEXT: ExplainBackPromptContext = {
  question: 'Explain the subject in relation to the neighbour.',
  referenceAnswer: 'A reference answer.',
  // Mirrors production: `modal.ts` flattens `RELATION_MATERIAL.sourceBlocks`
  // onto `context.sourceBlocks` — subject + edge + neighbour, undifferentiated.
  sourceBlocks: RELATION_MATERIAL.sourceBlocks,
  misconceptionDigest: [],
};

function wiringCapturing(onRequest: (request: WorkerTaskRequest) => void): GradingWiring {
  return {
    judgeCaller: null,
    killedBySustainedAuditFailure: false,
    misconceptionEmbedder: null,
    misconceptionEmbeddingCache: null,
    soloTransport: {
      send: async (request) => {
        onRequest(request);
        return {
          ok: true,
          stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'solo-test-model' },
          result: { soloLevel: 'relational', rationale: 'Ties the two together.' },
        };
      },
    },
    acceptedObservationsByAttempt: new Map(),
  };
}

describe('recordSoloGradeAndReview — sourceMaterial/relationExpected threading (ol-egov.141.89.6.50)', () => {
  it("F5.3 sanity: RELATION_MATERIAL's own omissionDenominator excludes the neighbour's defining passages and keeps subject + edge provenance", () => {
    // Proves the fixture actually exercises the case this bead is about,
    // before testing that solo-review.ts forwards it unchanged.
    expect(RELATION_MATERIAL.omissionDenominator).toEqual([...SUBJECT, ...EDGE]);
    expect(RELATION_MATERIAL.omissionDenominator).not.toContainEqual(NEIGHBOUR[0]);
    expect(RELATION_MATERIAL.sourceBlocks).toEqual([...SUBJECT, ...EDGE, ...NEIGHBOUR]);
  });

  it('with a causes partner: sourceMaterial and relationExpected reach buildGradeSoloInputFromTypedAnswer verbatim, as the resolved argument', async () => {
    const spy = vi.mocked(requestModule.buildGradeSoloInputFromTypedAnswer);
    spy.mockClear();
    const vault = memoryVault();

    const outcome = await recordSoloGradeAndReview(
      {
        grading: wiringCapturing(() => {}),
        vault,
        deviceId: 'device-a',
        now: () => new Date('2026-09-25T09:00:00Z'),
      },
      {
        instrumentId: 'explain-back:concept-subject:1',
        attemptId: 'attempt-relation-1',
        subjectConceptId: 'concept-subject',
        context: CONTEXT,
        answer: 'Her explanation of the relation.',
        sourceMaterial: RELATION_MATERIAL,
        relationExpected: true,
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0];
    if (!call) throw new Error('expected buildGradeSoloInputFromTypedAnswer to have been called');
    const [answerArg, contextArg, resolvedArg] = call;
    expect(answerArg).toBe('Her explanation of the relation.');
    expect(contextArg).toBe(CONTEXT);
    expect(resolvedArg).toEqual({ sourceMaterial: RELATION_MATERIAL, relationExpected: true });

    // The actual GradeSoloInput this call produced carries F5.3's narrower
    // denominator, not context.sourceBlocks (which would wrongly include the
    // neighbour's own defining passages) — read back off the spy's real
    // return value, never re-implemented here.
    const spyResult = spy.mock.results[0];
    if (!spyResult) throw new Error('expected a recorded return value');
    const soloInput = spyResult.value as {
      sourceMaterial: GradingSourceMaterial;
      relationExpected: boolean;
    };
    expect(soloInput.sourceMaterial.omissionDenominator).toEqual([...SUBJECT, ...EDGE]);
    expect(soloInput.relationExpected).toBe(true);
  });

  it('without a partner (sourceMaterial/relationExpected omitted): the resolved argument is empty, and buildGradeSoloInputFromTypedAnswer falls back to its pre-existing concept-only default — byte-identical to before this bead', async () => {
    const spy = vi.mocked(requestModule.buildGradeSoloInputFromTypedAnswer);
    spy.mockClear();
    const vault = memoryVault();
    const conceptOnlyContext: ExplainBackPromptContext = {
      question: 'Explain the subject alone.',
      referenceAnswer: 'A reference answer.',
      sourceBlocks: SUBJECT,
      misconceptionDigest: [],
    };

    const outcome = await recordSoloGradeAndReview(
      {
        grading: wiringCapturing(() => {}),
        vault,
        deviceId: 'device-a',
        now: () => new Date('2026-09-25T09:00:00Z'),
      },
      {
        instrumentId: 'explain-back:concept-subject:2',
        attemptId: 'attempt-concept-only-1',
        subjectConceptId: 'concept-subject',
        context: conceptOnlyContext,
        answer: 'Her explanation of the subject alone.',
        // No sourceMaterial, no relationExpected — the shape every call before
        // this bead used, and every call whose prompt has no live partner.
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0];
    if (!call) throw new Error('expected buildGradeSoloInputFromTypedAnswer to have been called');
    const [, , resolvedArg] = call;
    expect(resolvedArg).toEqual({});

    const spyResult = spy.mock.results[0];
    if (!spyResult) throw new Error('expected a recorded return value');
    const soloInput = spyResult.value as {
      sourceMaterial: GradingSourceMaterial;
      relationExpected: boolean;
    };
    // buildGradeSoloInputFromTypedAnswer's own concept-only default: the
    // whole context doubling as sourceBlocks AND omissionDenominator.
    expect(soloInput.sourceMaterial).toEqual({
      sourceBlocks: SUBJECT,
      omissionDenominator: SUBJECT,
      candidateEdgeNomination: null,
    });
    expect(soloInput.relationExpected).toBe(false);
  });

  it('with a causes partner: relationExpected reaches the actual Worker wire request as true, and sourceBlocks sent is the widened relation material, not the subject alone', async () => {
    const vault = memoryVault();
    let captured: WorkerTaskRequest | undefined;

    const outcome = await recordSoloGradeAndReview(
      {
        grading: wiringCapturing((request) => {
          captured = request;
        }),
        vault,
        deviceId: 'device-a',
        now: () => new Date('2026-09-25T09:00:00Z'),
      },
      {
        instrumentId: 'explain-back:concept-subject:3',
        attemptId: 'attempt-relation-2',
        subjectConceptId: 'concept-subject',
        context: CONTEXT,
        answer: 'Her explanation of the relation.',
        sourceMaterial: RELATION_MATERIAL,
        relationExpected: true,
      },
    );

    if (!outcome) throw new Error('expected a written review-log record');
    if (!captured) throw new Error('expected a captured Worker request');
    const payload = captured.payload as { sourceBlocks: unknown; relationExpected: unknown };
    expect(payload.relationExpected).toBe(true);
    expect(payload.sourceBlocks).toEqual(RELATION_MATERIAL.sourceBlocks);
  });
});
