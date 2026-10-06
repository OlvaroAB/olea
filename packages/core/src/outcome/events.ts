/**
 * Outcome event types — the domain model `./project.ts` folds into an `OutcomeRecord`
 * (`./types.ts`) and `./store.ts` applies incrementally against a vault-persisted record.
 *
 * **Not a persisted event log.** `[ONT-R5]`'s ruling on the concept web's shape is explicit that
 * a node's persisted state is "typed records... projection only when read, never an index or a
 * query engine" — there is no `.olea/outcomes/`-adjacent JSONL stream the way `../review-log/`
 * and `../misconception/` keep one. These event types exist so "create an outcome," "attach a
 * concept to it" and "retire it" are named, auditable operations with one pure fold
 * (`./project.ts`'s `applyOutcomeEvent`) rather than being three different ad hoc object-spread
 * call sites — the same "one seam, nothing assembles a record itself" discipline
 * `../concept/concept-key.ts`'s `ConceptKeySource` and `../session/instrument-id.ts`'s
 * `InstrumentIdSource` already hold their callers to. `./store.ts` constructs one event per
 * operation, folds it against whatever record already exists on disk (or `undefined`, for a
 * genuine mint), and persists only the result — never the event itself.
 */

import type { OutcomeProvenance, OutcomeSourceReference } from './types.js';

interface OutcomeEventCommon {
  readonly schemaVersion: 1;
  /** Stable unique id for this event — no persisted log reads it back, but it keeps every event self-identifying for logging/debugging (D-005: structural facts only, never content). */
  readonly eventId: string;
  /** ISO-8601 with offset, mirroring D7.1's `timestamp` discipline. */
  readonly timestamp: string;
}

/**
 * Mints a new Outcome. `./store.ts`'s `resolveOutcomes` is the only production caller: it looks
 * for the existing record a candidate is first (same block, then same or near wording, `[D-477]`;
 * conservation — never mint a second record for material already read once) and constructs this
 * event only on a genuine miss, with `source.labelDigest` set.
 */
export interface OutcomeCreatedEvent extends OutcomeEventCommon {
  readonly kind: 'created';
  readonly outcomeId: string;
  readonly courses: readonly string[];
  readonly source: OutcomeSourceReference;
  readonly label: string;
  readonly provenance: OutcomeProvenance;
  /** `[D-253]`'s ratifying amendment — see `./types.ts`'s `OutcomeRecord.extractorSelfRating` for what this is and the no-branching-until-calibrated rule attached to it. Omitted (never `undefined`) when the extractor supplied none. */
  readonly extractorSelfRating?: number;
  /** `[D-531]`: the version that stated it, when the delivery's version is known (`./types.ts`, `OutcomeRecord.statedInRevision`). Omitted (never `undefined`) otherwise. */
  readonly statedInRevision?: string;
}

/**
 * Records the outcome→concept containment edge (component register row 1.1b: "1:N, part-of
 * style"). Applying this against a record that does not yet exist is dropped, never invents a
 * parent (`./project.ts`'s `applyOutcomeEvent` doc) — the same "never mints from a rebind-shaped
 * operation" discipline `../concept/key-store.ts`'s `bindConceptKeyToNote` holds for concepts.
 */
export interface OutcomeConceptAttachedEvent extends OutcomeEventCommon {
  readonly kind: 'concept-attached';
  readonly outcomeId: string;
  readonly conceptKey: string;
}

/**
 * F8.5's pruning-is-withdrawal pattern (`./types.ts`'s `OutcomeStatus` doc): moves an outcome to
 * `'retired'`. Never deletes the record, and this module never removes a record file for any
 * reason. Carries no reason (`[D-531]`): retiring on revision (`./retire-on-revision.ts`) is the
 * only cause of retirement, so a reason field waits for a second cause.
 */
export interface OutcomeRetiredEvent extends OutcomeEventCommon {
  readonly kind: 'retired';
  readonly outcomeId: string;
}

/**
 * `[D-531]` (`ol-egov.141.89.7.68`): an open delivery of a later version of the outcome's document
 * stated it again, so its version stamp moves to that version (`./types.ts`,
 * `OutcomeRecord.statedInRevision`). Changes nothing else, a status included.
 */
export interface OutcomeRestatedEvent extends OutcomeEventCommon {
  readonly kind: 'restated';
  readonly outcomeId: string;
  readonly revisionDigest: string;
}

/**
 * `[D-272]`, `[D-531]`: a later version of the outcome's document states a retired outcome again,
 * so it comes back — active, stamped with that version, every other field (its concept links
 * included) as it was. The same record and id: retirement never deleted it.
 */
export interface OutcomeReinstatedEvent extends OutcomeEventCommon {
  readonly kind: 'reinstated';
  readonly outcomeId: string;
  readonly revisionDigest: string;
}

export type OutcomeEvent =
  | OutcomeCreatedEvent
  | OutcomeConceptAttachedEvent
  | OutcomeRetiredEvent
  | OutcomeRestatedEvent
  | OutcomeReinstatedEvent;
