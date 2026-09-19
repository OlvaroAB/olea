/**
 * `createGenerationAwareJobRunner` — the `JobRunner` consumer for the
 * `'generation'` job kind, mirroring `packages/plugin/src/generation
 * /revision-job-runner.ts`'s `createRevisionAwareJobRunner` one payload
 * family over: `IngestionQueueEngine` drains against whatever single
 * `JobRunner` it was constructed with, and an unrecognised payload reaches
 * `createExtractionJobRunner`'s own honest `ok: false, retryable: false`
 * ("Not an extraction job") unless something recognises it first. This is
 * that recognition for `GenerationJobPayload` — dispatch to `deps.draft`,
 * fall through to `deps.fallback` for anything else.
 *
 * **`deps.draft` is injected, deliberately.** This module decides WHETHER a
 * drained job is a generation call; it never decides HOW to service one.
 * The actual call — `draftQuizCardsForConcept` today, whatever
 * `cards.generate.v1`'s client caller becomes once component register row
 * 2.1 closes — lives in `packages/plugin/src/generation/` and
 * `packages/plugin/src/retrieval/`, outside this bead's owned paths
 * (`packages/core/src/generation/`, `packages/plugin/src/ingestion/`). See
 * `packages/plugin/src/ingestion/wiring.ts`'s `IngestionWiringDeps
 * .generation` for the composition seam a caller supplies `deps.draft`
 * through, and this bead's close evidence for the named follow-up that
 * would give it a real implementation.
 */

import type { JobRunner, JobRunnerView, JobRunOutcome } from '../ingestion/types.js';
import { isGenerationJobPayload } from './types.js';

export interface GenerationAwareJobRunnerDeps {
  /** Services one drained generation job. Never called for a non-generation payload. */
  readonly draft: (job: JobRunnerView) => Promise<JobRunOutcome>;
  /** Whatever runner a host already has for every other payload kind. */
  readonly fallback: JobRunner;
}

export function createGenerationAwareJobRunner(deps: GenerationAwareJobRunnerDeps): JobRunner {
  return async (job) => {
    if (isGenerationJobPayload(job.payload)) return deps.draft(job);
    return deps.fallback(job);
  };
}
