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
}

/** The exact string hashed for a generation call's `contentHash` — exposed so a test can assert stability without re-deriving the hash itself. */
export function generationJobIdentityString(input: GenerationJobKeyInput): string {
  return `generation:${input.courseCode}:${input.conceptKey}:${input.instrumentKind}`;
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
