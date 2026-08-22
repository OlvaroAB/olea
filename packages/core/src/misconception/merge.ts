/**
 * Merges misconception-log events from any number of sources (typically one
 * file per device for the same day) into one deduplicated, deterministically
 * ordered list — the same `eventId`-keyed idempotent merge
 * `../review-log/merge.js` defines, applied to this store's own event shape.
 * See that file's doc for the full argument; it is not repeated here.
 */

import type { MisconceptionEvent } from './types.js';

export interface MergeMisconceptionLogResult {
  readonly events: readonly MisconceptionEvent[];
  readonly duplicateEventIds: readonly string[];
}

function sameContent(a: MisconceptionEvent, b: MisconceptionEvent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeMisconceptionEvents(
  ...sources: ReadonlyArray<readonly MisconceptionEvent[]>
): MergeMisconceptionLogResult {
  const byEventId = new Map<string, MisconceptionEvent>();
  const duplicateEventIds = new Set<string>();

  for (const source of sources) {
    for (const event of source) {
      const prior = byEventId.get(event.eventId);
      if (prior !== undefined) {
        if (!sameContent(prior, event)) {
          throw new Error(
            `mergeMisconceptionEvents: eventId ${JSON.stringify(event.eventId)} appears twice ` +
              'with different content — an eventId must uniquely identify one event.',
          );
        }
        duplicateEventIds.add(event.eventId);
        continue;
      }
      byEventId.set(event.eventId, event);
    }
  }

  const events = [...byEventId.values()].sort((a, b) => {
    const instantA = Date.parse(a.timestamp);
    const instantB = Date.parse(b.timestamp);
    if (instantA !== instantB) return instantA - instantB;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });

  return { events, duplicateEventIds: [...duplicateEventIds] };
}
