/**
 * `audio-transcribe.ts`'s adapter, through the Writing contract
 * (`ol-egov.141.89.20`; this bead `ol-egov.141.89.8.40`).
 *
 * Two boundary halves, mirroring `vision-page.spec.ts`'s own split:
 *  - the PRODUCER half: `writingFromAudioTranscribeResult`/
 *    `writingFromAudioTranscribeCallFailure` map every reachable
 *    `AudioTranscribeResultShape`/`AudioTranscribeCallFailure` shape into the
 *    outcome this module's own doc claims;
 *  - the CONSUMER half: every outcome this adapter can produce survives a
 *    JSON round trip and satisfies `writingEnvelopeProblems` with zero
 *    complaints.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import { writingEnvelopeProblems, writingReceiptProblems } from '../writing.js';
import {
  type AudioTranscribeCallFailure,
  type AudioTranscribeResultShape,
  type AudioTranscribeSeamContext,
  writingFromAudioTranscribeCallFailure,
  writingFromAudioTranscribeResult,
} from './audio-transcribe.js';

const context: AudioTranscribeSeamContext = {
  seat: 'candidate',
  taskId: 'audio.transcribe.v1',
  evidenceDigests: ['coined-audio-digest-1'],
};

/** A result with no wire stamp at all: the fields are absent, not set to undefined (exactOptionalPropertyTypes). */
function unstamped(): AudioTranscribeResultShape {
  const { modelId: _modelId, promptVersion: _promptVersion, ...rest } = result({});
  return rest;
}

function result(partial: Partial<AudioTranscribeResultShape>): AudioTranscribeResultShape {
  return {
    outcome: 'transcribed',
    transcript: 'Coined spoken answer text.',
    durationSeconds: 4.5,
    modelId: 'writer-model',
    promptVersion: 'audio-transcribe-2',
    ...partial,
  };
}

describe('writingFromAudioTranscribeResult — the producer half', () => {
  it('a transcribed reading with text is written, with an empty-checks (unverified) receipt, at code-checks-only assurance', () => {
    const outcome = writingFromAudioTranscribeResult(result({}), context);
    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('unreachable');
    expect(outcome.draft).toEqual({
      transcript: 'Coined spoken answer text.',
      durationSeconds: 4.5,
    });
    expect(outcome.receipt.disposition).toBe('unverified');
    expect(outcome.receipt.assurance).toBe('code-checks-only');
    expect(outcome.receipt.passed).toEqual([]);
    expect(outcome.receipt.failed).toEqual([]);
    expect(outcome.receipt.provenance.producer).toEqual({
      kind: 'model',
      seat: 'candidate',
      taskId: 'audio.transcribe.v1',
      stamp: { modelId: 'writer-model', promptVersion: 'audio-transcribe-2' },
    });
  });

  it("'no-speech' is declined, nothing-to-write-from — never unavailable, never carrying a draft", () => {
    const outcome = writingFromAudioTranscribeResult(
      result({ outcome: 'no-speech', transcript: '' }),
      context,
    );
    expect(outcome).toMatchObject({ kind: 'declined', basis: 'nothing-to-write-from' });
    expect('draft' in outcome).toBe(false);
  });

  it("an honestly empty transcript under outcome 'transcribed' (no VAD/word-count signal reported at all) is also declined, nothing-to-write-from", () => {
    const outcome = writingFromAudioTranscribeResult(
      result({ outcome: 'transcribed', transcript: '' }),
      context,
    );
    expect(outcome).toMatchObject({ kind: 'declined', basis: 'nothing-to-write-from' });
  });

  it('a test double answering with no wire stamp (modelId/promptVersion absent) carries a null stamp, never an invented one', () => {
    const outcome = writingFromAudioTranscribeResult(unstamped(), context);
    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('unreachable');
    expect(outcome.receipt.provenance.producer).toMatchObject({ kind: 'model', stamp: null });
  });

  it('never carries the transcript text in JSON when declined (D-005 — evidenceDigests only, never content)', () => {
    const outcome = writingFromAudioTranscribeResult(
      result({ outcome: 'no-speech', transcript: '' }),
      context,
    );
    const serialised = JSON.stringify(outcome);
    expect(serialised).not.toContain('Coined spoken answer text');
  });
});

describe('writingFromAudioTranscribeCallFailure — the producer half, the operational arm', () => {
  it('the transport itself failing before any response is unavailable, call-failed', () => {
    const failure: AudioTranscribeCallFailure = { reachedWorker: false };
    expect(writingFromAudioTranscribeCallFailure(failure, context)).toMatchObject({
      kind: 'unavailable',
      cause: 'call-failed',
    });
  });

  it("the Worker's own grounding-refused (if it is ever sent for this task) reads as declined, nothing-to-write-from — INV-5's honest refusal, never an outage", () => {
    const failure: AudioTranscribeCallFailure = { reachedWorker: true, code: 'grounding-refused' };
    expect(writingFromAudioTranscribeCallFailure(failure, context)).toMatchObject({
      kind: 'declined',
      basis: 'nothing-to-write-from',
    });
  });

  it('every other named Worker error code this task can actually return is unavailable, service-refused, carrying the code', () => {
    for (const code of ['invalid-request', 'quota-exceeded', 'internal-error', 'upstream-error']) {
      const failure: AudioTranscribeCallFailure = { reachedWorker: true, code };
      expect(writingFromAudioTranscribeCallFailure(failure, context)).toMatchObject({
        kind: 'unavailable',
        cause: 'service-refused',
        serviceCode: code,
      });
    }
  });

  it('a response with no usable code at all is unavailable, malformed', () => {
    const failure: AudioTranscribeCallFailure = { reachedWorker: true };
    expect(writingFromAudioTranscribeCallFailure(failure, context)).toMatchObject({
      kind: 'unavailable',
      cause: 'malformed',
    });
  });
});

describe('the consumer half — every outcome this adapter can produce satisfies the shared envelope, after a JSON round trip', () => {
  it('every writingFromAudioTranscribeResult outcome round-trips clean', () => {
    const results: AudioTranscribeResultShape[] = [
      result({}),
      result({ outcome: 'no-speech', transcript: '' }),
      result({ outcome: 'transcribed', transcript: '' }),
      unstamped(),
    ];
    for (const r of results) {
      const outcome = writingFromAudioTranscribeResult(r, context);
      expect(writingEnvelopeProblems(JSON.parse(JSON.stringify(outcome)))).toEqual([]);
    }
  });

  it('every writingFromAudioTranscribeCallFailure outcome round-trips clean', () => {
    const failures: AudioTranscribeCallFailure[] = [
      { reachedWorker: false },
      { reachedWorker: true, code: 'grounding-refused' },
      { reachedWorker: true, code: 'quota-exceeded' },
      { reachedWorker: true },
    ];
    for (const failure of failures) {
      const outcome = writingFromAudioTranscribeCallFailure(failure, context);
      expect(writingEnvelopeProblems(JSON.parse(JSON.stringify(outcome)))).toEqual([]);
    }
  });

  it("a written outcome's receipt alone also satisfies writingReceiptProblems on its own (the narrower check a receipt-only consumer would run)", () => {
    const outcome = writingFromAudioTranscribeResult(result({}), context);
    if (outcome.kind !== 'written') throw new Error('unreachable');
    expect(writingReceiptProblems(JSON.parse(JSON.stringify(outcome.receipt)))).toEqual([]);
  });
});
