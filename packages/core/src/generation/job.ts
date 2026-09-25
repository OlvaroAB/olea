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
 * **Not wired to a production caller by this bead.** `generation-queue.ts`
 * is the one call site that would need to start passing these two fields
 * (and is out of this bead's `owns` — reported, not built here). Until that
 * lands, this fix exists as a correct, tested mechanism with no live effect
 * — see this bead's report.
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
