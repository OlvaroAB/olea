/**
 * Builds a generation call's `EnqueueInput`-shaped identity and payload.
 *
 * **The identity IS the idempotency key.** `IngestionQueueEngine.enqueue`
 * treats two calls with the same `contentHash` as one job (D-002); this
 * function's whole job is producing a `contentHash` that is stable for the
 * same (course, concept, kind) triple and nothing else — matching D-238's
 * "the unit is the call... a second trigger asking for the same (concept,
 * kind) a call already covers is not a second call" for free, from the
 * engine's own existing dedup, with no extra state this module has to keep.
 *
 * **D-381 (`ol-egov.141.89.5.18`; chg.md §11's cache-key audit).** The audit
 * found this key had no content-digest term at all and no version term — "a
 * materiality-confirmed change to the concept's source cannot make this job
 * 'new' by content, only a different mechanism can." `sourceContentHash`/
 * `promptVersion` below are that mechanism: two OPTIONAL fields on
 * `GenerationJobKeyInput`, folded into the hashed identity string only when
 * present. Every current production caller (`generation-queue.ts`) supplies
 * neither, so `generationJobIdentityString`/`generationJobContentHash`
 * produce byte-identical output to before these fields existed — this is
 * purely additive. A caller that starts supplying either turns a source or
 * prompt-version change into a genuinely different `contentHash`, so
 * `IngestionQueueEngine.enqueue`'s existing content-hash dedup (unchanged)
 * naturally treats it as a new job rather than a duplicate — the same
 * discard-and-rebuild-on-mismatch pattern the embedding cache and the study-
 * plan cache already use (chg.md §11.3's recommendation), achieved without
 * this module needing to know anything about `IngestionQueueEngine`'s own
 * internals. The old job, under the old hash, is never touched (INV-2).
 *
 * **Wired to its production caller (`ol-egov.141.89.5.24`).**
 * `generation-queue.ts`'s `buildGenerationEnqueueInput` now supplies both
 * fields when its own caller knows them, computing the enqueued job's
 * `contentHash` from the FULL `GenerationJobKeyInput` (version terms
 * included) while deriving `EnqueueInput.sourceUnitId` from the version-
 * BLIND triple alone (`generationJobIdentityString` with no version
 * fields) — exactly the split this file's functions were built to support:
 * a source or prompt-version bump changes `contentHash` for a `sourceUnitId`
 * that stays the same, so `IngestionQueueEngine.enqueue`'s existing
 * supersede check (`engine.ts`, "same `sourceUnitId`, different
 * `contentHash`") retires a still-pending job for the old version without
 * this file, or `generation-queue.ts`, needing to know anything about the
 * engine's own internals. See `generation-queue.ts`'s module doc for where
 * the two values come from in production (D-385, Class B: read from local
 * state only — never a network probe triggered by the check).
 */

import { hashText } from '../ingestion/hash.js';
import type {
  GenerationJobPayload,
  GenerationTriggerKind,
  SchedulableInstrumentType,
} from './types.js';

export interface GenerationJobKeyInput {
  readonly courseCode: string;
  readonly conceptKey: string;
  readonly instrumentKind: SchedulableInstrumentType;
  /**
   * D-381: the concept's current source digest (e.g. the same `hashText`
   * output `DraftRecord.sourceContentHash` already carries for the draft
   * cache — `packages/plugin/src/generation/types.ts`). Omitted (every
   * current caller): no change to the hashed identity string.
   */
  readonly sourceContentHash?: string;
  /**
   * D-381: the currently-configured task's prompt/contract version (D7.3
   * stamping — e.g. the `quiz.generate`/`cards.generate` task's `VERSION`).
   * Omitted (every current caller): no change to the hashed identity string.
   */
  readonly promptVersion?: string;
}

/** The exact string hashed for a generation call's `contentHash` — exposed so a test can assert stability without re-deriving the hash itself. */
export function generationJobIdentityString(input: GenerationJobKeyInput): string {
  const base = `generation:${input.courseCode}:${input.conceptKey}:${input.instrumentKind}`;
  if (input.sourceContentHash === undefined && input.promptVersion === undefined) return base;
  // D-381: fold the version pair in only when supplied — see the module doc.
  return `${base}:${input.sourceContentHash ?? ''}:${input.promptVersion ?? ''}`;
}

/** SHA-256 (via `hashText`) of {@link generationJobIdentityString} — the `EnqueueInput.contentHash` for this call. */
export function generationJobContentHash(input: GenerationJobKeyInput): Promise<string> {
  return hashText(generationJobIdentityString(input));
}

export interface BuildGenerationJobPayloadInput {
  readonly courseCode: string;
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly instrumentKind: SchedulableInstrumentType;
  readonly trigger: GenerationTriggerKind;
}

export function buildGenerationJobPayload(
  input: BuildGenerationJobPayloadInput,
): GenerationJobPayload {
  return { kind: 'generation', ...input };
}
