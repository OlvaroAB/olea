/**
 * Real Worker response envelopes for the paper item port's specs (`ol-egov.141.89.7.29`).
 *
 * **Why this file exists.** The port and its two specs used to agree with each other on a shape the
 * Worker never sends (`{ success, error }`, `promptVersion` at the top level), so they stayed green
 * while a real grounding refusal was stored as a generated item and every prompt version read
 * `unknown`. A fixture written by hand next to the code that reads it cannot catch that. Every
 * envelope built here is therefore run through `olea-contracts`' own `workerResponse` schema before
 * it is returned: a fixture that is not the contract's envelope throws in the test that built it.
 */

import { CONTRACT_VERSION, type ErrorCode, workerResponse } from 'olea-contracts';

/** A stamped success envelope (`{ ok: true, stamp, result }`), exactly as the Worker sends it. */
export function successEnvelope(result: unknown, promptVersion = 'v1.5.0'): unknown {
  return workerResponse.parse({
    ok: true,
    stamp: {
      contractVersion: CONTRACT_VERSION,
      promptVersion,
      modelId: 'test-model',
      usage: {
        inputTokens: 120,
        inputTokensSource: 'reported',
        outputTokens: 40,
        costUsd: 0.001,
        latencyMs: 250,
      },
    },
    result,
  });
}

/** An error envelope (`{ ok: false, code, message }`), exactly as the Worker sends it. */
export function errorEnvelope(code: ErrorCode, message = 'a message safe to show her'): unknown {
  return workerResponse.parse(
    code === 'update-required'
      ? { ok: false, code, message, supported: { min: 1, current: CONTRACT_VERSION } }
      : { ok: false, code, message },
  );
}

/** One `quiz.generate.v1` question, in the shape `paperItemMcqCandidate` reads off `result.questions`. */
export const QUIZ_QUESTION = {
  stem: 'Which process produces most of the ATP?',
  correctAnswer: 'oxidative phosphorylation',
  distractors: ['glycolysis', 'fermentation', 'the Calvin cycle'],
  feedback: 'Most ATP is made at the inner membrane.',
  subject: 'metabolism',
} as const;
