/**
 * The pure fold from `./events.ts`'s `OutcomeEvent` onto `./types.ts`'s `OutcomeRecord`.
 *
 * Two entry points, one fold. `applyOutcomeEvent` applies a single event against an existing
 * record (or `undefined`, for a genuine mint) — this is what `./store.ts` calls once per
 * operation against whatever is already on disk. `projectOutcomeRecords` folds a whole batch of
 * events from scratch — useful for tests and for anything replaying a caller's own in-memory
 * event sequence — and is defined in terms of the same single-event fold, so the two can never
 * drift apart into two different notions of "what does this event do."
 *
 * No I/O anywhere in this file: pure functions of their inputs, same discipline
 * `../misconception/events.ts`'s construction functions and `../session/instrument-id.ts`'s
 * derivation already hold to.
 */

import type {
  OutcomeConceptAttachedEvent,
  OutcomeCreatedEvent,
  OutcomeEvent,
  OutcomeRetiredEvent,
} from './events.js';
import { OUTCOME_RECORD_SCHEMA_VERSION, type OutcomeRecord } from './types.js';

function applyCreated(
  existing: OutcomeRecord | undefined,
  event: OutcomeCreatedEvent,
): OutcomeRecord {
  // Idempotent: a duplicate `created` for an id that already has a record changes nothing —
  // the record's own fields are the truth from its first mint onward, never re-derived.
  if (existing !== undefined) return existing;
  return {
    id: event.outcomeId,
    courses: [...event.courses].sort(),
    source: event.source,
    label: event.label,
    conceptKeys: [],
    status: 'active',
    provenance: event.provenance,
    mintedAt: event.timestamp,
    schemaVersion: OUTCOME_RECORD_SCHEMA_VERSION,
  };
}

function applyConceptAttached(
  existing: OutcomeRecord,
  event: OutcomeConceptAttachedEvent,
): OutcomeRecord {
  if (existing.conceptKeys.includes(event.conceptKey)) return existing;
  return { ...existing, conceptKeys: [...existing.conceptKeys, event.conceptKey] };
}

function applyRetired(existing: OutcomeRecord, _event: OutcomeRetiredEvent): OutcomeRecord {
  if (existing.status === 'retired') return existing;
  return { ...existing, status: 'retired' };
}

/**
 * Applies one event against `existing` (the record currently on disk, or `undefined` when none
 * has been minted yet). Returns `undefined` only when `existing` was `undefined` and `event` was
 * not a `created` event — an attach or retire with no matching record is dropped rather than
 * inventing a parent, mirroring `../concept/key-store.ts`'s `bindConceptKeyToNote` throwing
 * rather than minting on a similar rebind-shaped miss. `./store.ts` treats that `undefined` as
 * "no write, and this is a caller error" for attach/retire, and as "mint" for `created`.
 */
export function applyOutcomeEvent(
  existing: OutcomeRecord | undefined,
  event: OutcomeEvent,
): OutcomeRecord | undefined {
  if (event.kind === 'created') return applyCreated(existing, event);
  if (existing === undefined) return undefined;
  if (event.kind === 'concept-attached') return applyConceptAttached(existing, event);
  return applyRetired(existing, event);
}

/**
 * Folds a whole batch of events, in the order given, into the `OutcomeRecord`s they produce.
 * Every event is scoped to its own `outcomeId`; an event for an id with no preceding `created`
 * event in this same batch is silently dropped (see `applyOutcomeEvent`'s doc) rather than
 * throwing, since a batch is not assumed to be complete or correctly ordered by every caller —
 * `./store.ts`'s incremental path (one real record read from disk, one event applied) is the
 * production path, this is the batch/test convenience built from the same primitive.
 */
export function projectOutcomeRecords(events: readonly OutcomeEvent[]): readonly OutcomeRecord[] {
  const byId = new Map<string, OutcomeRecord>();
  for (const event of events) {
    const next = applyOutcomeEvent(byId.get(event.outcomeId), event);
    if (next !== undefined) byId.set(event.outcomeId, next);
  }
  return [...byId.values()];
}
