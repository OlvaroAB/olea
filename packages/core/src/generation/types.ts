/**
 * `[D-238]`/GEN-3's domain types (`ol-egov.127`, implemented by `ol-2zfj.63`
 * [GEN-3.1]).
 *
 * **Not yet on `olea-core`'s public surface.** This module and its siblings
 * in `packages/core/src/generation/` are deliberately NOT re-exported from
 * `index.ts` — this bead runs alongside concurrent lanes that also touch
 * that one shared barrel file, and the orchestrating brief for this run asks
 * every lane to leave it alone rather than race edits into it. Until a
 * later, coordinated pass adds the export, nothing in `packages/plugin`
 * can import from here across the package boundary (`olea-core`'s
 * `package.json` resolves callers through `src/index.ts` only). See
 * `packages/plugin/src/ingestion/generation-queue.ts`'s module doc for the
 * plugin-side mirror this forces and the follow-up bead that will delete it
 * once the barrel opens.
 *
 * **The ruling, restated.** On a concept's material arrival Olea makes ONE
 * generation call of the *primary* kind — the kind matched to the nearest
 * assessment's format (F4.8), or, absent a known format, her recorded
 * preference (F2.14 note, itself read off D7.1's instrument-type log).
 * Further calls for the same concept fire only on four NAMED triggers, never
 * at session time, and every call goes through the ingestion queue. "The
 * unit is the call, not the item" — one (course, concept, kind) triple is
 * one call, ever, however many items it returns.
 */

import type { SchedulableInstrumentType } from '../instrument/rating.js';

export type { SchedulableInstrumentType };

/**
 * D-238's four named triggers for a further call, plus `'arrival'` for the
 * first (primary-kind) call — five values, never more: F3.7 is explicit that
 * mastery/yield decide ORDER, never whether a further call happens outside
 * this set.
 */
export type GenerationTriggerKind =
  | 'arrival'
  | 'top-band'
  | 'format-ask'
  | 'deck-served-out-or-lapsed'
  | 'repeated-rejection';

/** One decided generation call: which trigger asked for it, and which kind it drafts. */
export interface GenerationTrigger {
  readonly kind: GenerationTriggerKind;
  readonly instrumentKind: SchedulableInstrumentType;
}

/**
 * The ingestion queue's job payload for a generation call (`PersistedJob
 * .payload`, `unknown` by that type's own contract — see
 * `packages/core/src/ingestion/types.ts`). `conceptKey` is the opaque,
 * immutable join key (C7.11, `[D-088]`), never the display name; `conceptName`
 * travels alongside it only because the drafting call itself is keyed on the
 * display name today (`DraftQuizCardsRequest.conceptName`) — the same
 * two-field carry `session/enumerate.ts` and `generation/pipeline.ts` both
 * already use for the identical reason.
 */
export interface GenerationJobPayload {
  readonly kind: 'generation';
  readonly courseCode: string;
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly instrumentKind: SchedulableInstrumentType;
  readonly trigger: GenerationTriggerKind;
}

/** Narrows `PersistedJob.payload` (`unknown` by contract) to the shape this family understands — mirrors `isExtractionJobPayload`/`isInstrumentRevisionJobPayload`, one payload family over. */
export function isGenerationJobPayload(value: unknown): value is GenerationJobPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === 'generation' &&
    typeof v.courseCode === 'string' &&
    v.courseCode.length > 0 &&
    typeof v.conceptKey === 'string' &&
    v.conceptKey.length > 0 &&
    typeof v.conceptName === 'string' &&
    v.conceptName.length > 0 &&
    typeof v.instrumentKind === 'string' &&
    typeof v.trigger === 'string'
  );
}
