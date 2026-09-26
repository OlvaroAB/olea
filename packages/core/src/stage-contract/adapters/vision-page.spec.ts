/**
 * `vision-page.ts`'s adapter, through the Writing contract
 * (`ol-egov.141.89.20`; this bead `ol-egov.141.89.8.4`).
 *
 * Two boundary halves, per the acceptance criterion's own phrasing
 * ("boundary contract tests at each producer and consumer"):
 *  - the PRODUCER half: `writingFromVisionPageExtract`/
 *    `writingFromVisionPageCallFailure` map every reachable
 *    `VisionPageExtractResultShape`/`VisionPageCallFailure` shape into the
 *    outcome this module's own doc claims;
 *  - the CONSUMER half: every outcome this adapter can produce survives a
 *    JSON round trip and satisfies `writingEnvelopeProblems` with zero
 *    complaints — the check a consumer reading this envelope off the wire
 *    (not trusting the producer's own types) would run.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import { writingEnvelopeProblems, writingReceiptProblems } from '../writing.js';
import {
  type VisionPageCallFailure,
  type VisionPageExtractResultShape,
  type VisionPageSeamContext,
  writingFromVisionPageCallFailure,
  writingFromVisionPageExtract,
} from './vision-page.js';

const context: VisionPageSeamContext = {
  seat: 'candidate',
  taskId: 'vision.extract.v2',
  evidenceDigests: ['page-image-digest-1'],
};

/** A result with no wire stamp at all: the fields are absent, not set to undefined (exactOptionalPropertyTypes). */
function unstamped(): VisionPageExtractResultShape {
  const { modelId: _modelId, promptVersion: _promptVersion, ...rest } = result({});
  return rest;
}

function result(partial: Partial<VisionPageExtractResultShape>): VisionPageExtractResultShape {
  return {
    outcome: 'complete',
    extractedText: 'Coined lecture passage text.',
    figureDescription: null,
    coverage: null,
    unreadableReason: null,
    modelId: 'writer-model',
    promptVersion: 'vision-extract-2',
    ...partial,
  };
}

describe('writingFromVisionPageExtract — the producer half', () => {
  it('a complete reading with text is written, with an empty-checks (unverified) receipt, at code-checks-only assurance', () => {
    const outcome = writingFromVisionPageExtract(result({}), context);
    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('unreachable');
    expect(outcome.draft).toEqual({
      text: 'Coined lecture passage text.',
      figureDescription: null,
    });
    expect(outcome.receipt.disposition).toBe('unverified');
    expect(outcome.receipt.assurance).toBe('code-checks-only');
    expect(outcome.receipt.passed).toEqual([]);
    expect(outcome.receipt.failed).toEqual([]);
    expect(outcome.receipt.provenance.producer).toEqual({
      kind: 'model',
      seat: 'candidate',
      taskId: 'vision.extract.v2',
      stamp: { modelId: 'writer-model', promptVersion: 'vision-extract-2' },
    });
  });

  it('a partial reading with text is also written, carrying the draft, never the coverage note, on the draft itself', () => {
    const outcome = writingFromVisionPageExtract(
      result({ outcome: 'partial', coverage: 'covered the top half of the page' }),
      context,
    );
    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('unreachable');
    expect(outcome.draft.text).toBe('Coined lecture passage text.');
    expect('coverage' in outcome.draft).toBe(false);
  });

  it('unreadable is declined, nothing-to-write-from — never unavailable, never carrying a draft', () => {
    const outcome = writingFromVisionPageExtract(
      result({ outcome: 'unreadable', extractedText: '', unreadableReason: 'not-legible' }),
      context,
    );
    expect(outcome).toMatchObject({ kind: 'declined', basis: 'nothing-to-write-from' });
    expect('draft' in outcome).toBe(false);
  });

  it("a figure-only complete reading (D-325: empty text, a figure description) is also declined, nothing-to-write-from — the figure description never becomes the draft's text", () => {
    const outcome = writingFromVisionPageExtract(
      result({ extractedText: '', figureDescription: 'Coined figure: a labelled diagram.' }),
      context,
    );
    expect(outcome).toMatchObject({ kind: 'declined', basis: 'nothing-to-write-from' });
    const serialised = JSON.stringify(outcome);
    expect(serialised).not.toContain('Coined figure');
  });

  it('a test double answering with no wire stamp (modelId/promptVersion absent) carries a null stamp, never an invented one', () => {
    const outcome = writingFromVisionPageExtract(unstamped(), context);
    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('unreachable');
    expect(outcome.receipt.provenance.producer).toMatchObject({ kind: 'model', stamp: null });
  });
});

describe('writingFromVisionPageCallFailure — the producer half, the operational arm', () => {
  it('the transport itself failing before any response is unavailable, call-failed', () => {
    const failure: VisionPageCallFailure = { reachedWorker: false };
    expect(writingFromVisionPageCallFailure(failure, context)).toMatchObject({
      kind: 'unavailable',
      cause: 'call-failed',
    });
  });

  it("the Worker's own grounding-refused reads as declined, nothing-to-write-from — INV-5's honest refusal, never an outage", () => {
    const failure: VisionPageCallFailure = { reachedWorker: true, code: 'grounding-refused' };
    expect(writingFromVisionPageCallFailure(failure, context)).toMatchObject({
      kind: 'declined',
      basis: 'nothing-to-write-from',
    });
  });

  it('every other named Worker error code is unavailable, service-refused, carrying the code', () => {
    for (const code of ['invalid-request', 'quota-exceeded', 'internal-error', 'unauthenticated']) {
      const failure: VisionPageCallFailure = { reachedWorker: true, code };
      expect(writingFromVisionPageCallFailure(failure, context)).toMatchObject({
        kind: 'unavailable',
        cause: 'service-refused',
        serviceCode: code,
      });
    }
  });

  it('a response with no usable code at all is unavailable, malformed', () => {
    const failure: VisionPageCallFailure = { reachedWorker: true };
    expect(writingFromVisionPageCallFailure(failure, context)).toMatchObject({
      kind: 'unavailable',
      cause: 'malformed',
    });
  });
});

describe('the consumer half — every outcome this adapter can produce satisfies the shared envelope, after a JSON round trip', () => {
  it('every writingFromVisionPageExtract outcome round-trips clean', () => {
    const results: VisionPageExtractResultShape[] = [
      result({}),
      result({ outcome: 'partial', coverage: 'top half' }),
      result({ outcome: 'unreadable', extractedText: '', unreadableReason: 'blank-page' }),
      result({ extractedText: '', figureDescription: 'a diagram' }),
      unstamped(),
    ];
    for (const r of results) {
      const outcome = writingFromVisionPageExtract(r, context);
      expect(writingEnvelopeProblems(JSON.parse(JSON.stringify(outcome)))).toEqual([]);
    }
  });

  it('every writingFromVisionPageCallFailure outcome round-trips clean', () => {
    const failures: VisionPageCallFailure[] = [
      { reachedWorker: false },
      { reachedWorker: true, code: 'grounding-refused' },
      { reachedWorker: true, code: 'quota-exceeded' },
      { reachedWorker: true },
    ];
    for (const failure of failures) {
      const outcome = writingFromVisionPageCallFailure(failure, context);
      expect(writingEnvelopeProblems(JSON.parse(JSON.stringify(outcome)))).toEqual([]);
    }
  });

  it("a written outcome's receipt alone also satisfies writingReceiptProblems on its own (the narrower check a receipt-only consumer would run)", () => {
    const outcome = writingFromVisionPageExtract(result({}), context);
    if (outcome.kind !== 'written') throw new Error('unreachable');
    expect(writingReceiptProblems(JSON.parse(JSON.stringify(outcome.receipt)))).toEqual([]);
  });
});
