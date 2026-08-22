/**
 * The misconception **projection** — folds the event log into current
 * `MisconceptionRecord`s (§4.1's shape). The only source of truth is the
 * event log; this function is the entire "how do we get the read model back"
 * answer, and it is a pure fold with no external state, mirroring
 * `../review-log/suspension.js`'s "there is no stored list, there is only
 * the log and this fold over it."
 *
 * **Rebuildability, concretely.** Given the same events in any order, this
 * function returns the same records. Discarding a cached projection and
 * calling this again is always safe and always correct — that property is
 * what the bead card means by "a projection you cannot rebuild is a
 * database," and `project.spec.ts`'s "discard, re-project, compare" test
 * exercises it directly.
 *
 * **Ordering.** Events are sorted by `(timestamp instant, eventId)` before
 * folding — the same tiebreak `../review-log/suspension.js` uses — so the
 * result does not depend on which order the caller happened to read several
 * devices' files in. Feed this the output of `./merge.js` for that guarantee
 * to hold across devices; a single file is already in append order, but
 * sorting here costs nothing and removes the assumption.
 *
 * **Idempotency on replay.** A duplicate event (same `eventId` appearing
 * twice — the ordinary case is an unmerged file re-read, or a defensive
 * caller that didn't run `./merge.js` first) is processed once: the second
 * occurrence is skipped rather than double-counted. `./merge.js` already
 * enforces this across files: this function enforces it again, standalone,
 * because a caller should not have to prove it always calls merge first for
 * the projection to be trustworthy.
 *
 * **Observation folding.** A new `misconceptionId` creates a record
 * (`status: 'active'`, `occurrenceCount: 1`). An id seen before increments
 * `occurrenceCount`, advances `lastSeen`, and **reactivates to `active`**
 * regardless of its prior status — a misconception recurring after fading or
 * even after being marked resolved is exactly the "keeps coming back" case
 * §4.1 exists to name, not a state that should be silently ignored.
 * `statement`/`correction`/`citation`/`confusedWithConceptId`/
 * `conceptId`/`originInstrumentId` are updated to the triggering event's
 * values each time — the record reflects the **most recent** occurrence's
 * wording and citation, while `occurrenceCount` and `firstSeen` preserve the
 * full history. (An alternative — keep the first occurrence's wording — was
 * considered and rejected: her own words about a recurring confusion may
 * sharpen over repeated attempts, and the correction should always cite the
 * source passage the *grader most recently checked against*, not a stale
 * one.)
 *
 * **Resolution folding (M2).** A `resolution-evidence` event downgrades
 * *every* `active`/`fading` record on its `conceptId` one step
 * (`active` → `fading` → `resolved`); `resolved` records are a no-op.
 * **Known imprecision, stated rather than hidden:** when a concept carries
 * more than one open misconception simultaneously, one piece of evidence
 * downgrades all of them, because the event only names a concept, not a
 * specific misconception id (`./events.js`'s doc explains why the grader
 * cannot reliably supply one). This is the conservative-toward-availability
 * side of the M1/M2 trade: M1 already biases toward *not* merging distinct
 * misconceptions into one record, so a shared concept-level resolution
 * signal is the accepted cost of that same conservatism rather than a
 * separate design flaw. Flagged as a Class B call in the bead report.
 */

import type { MisconceptionEvent, MisconceptionRecord, MisconceptionStatus } from './types.js';

function eventInstant(event: MisconceptionEvent): number {
  return Date.parse(event.timestamp);
}

function sortKey(event: MisconceptionEvent): [number, string] {
  return [eventInstant(event), event.eventId];
}

const DOWNGRADE: Readonly<Record<MisconceptionStatus, MisconceptionStatus>> = {
  active: 'fading',
  fading: 'resolved',
  resolved: 'resolved',
};

/**
 * Folds `events` (any order, any source) into current `MisconceptionRecord`s,
 * one per distinct `misconceptionId`. See this module's doc for the full
 * fold rules.
 */
export function projectMisconceptions(
  events: readonly MisconceptionEvent[],
): readonly MisconceptionRecord[] {
  const ordered = [...events].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    return ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0;
  });

  const seenEventIds = new Set<string>();
  const records = new Map<string, MisconceptionRecord>();

  for (const event of ordered) {
    if (seenEventIds.has(event.eventId)) continue;
    seenEventIds.add(event.eventId);

    if (event.kind === 'observed') {
      const prior = records.get(event.misconceptionId);

      if (prior === undefined) {
        records.set(event.misconceptionId, {
          id: event.misconceptionId,
          conceptId: event.conceptId,
          confusedWithConceptId: event.confusedWithConceptId,
          statement: event.statement,
          correction: event.correction,
          citation: event.citation,
          firstSeen: event.timestamp,
          lastSeen: event.timestamp,
          occurrenceCount: 1,
          status: 'active',
          originInstrumentId: event.originInstrumentId,
        });
        continue;
      }

      // `ordered` is sorted ascending, so `event.timestamp` is always >= the
      // timestamp of whatever set `prior` — no comparison needed to know
      // this event is the new `lastSeen`.
      records.set(event.misconceptionId, {
        id: prior.id,
        conceptId: event.conceptId,
        confusedWithConceptId: event.confusedWithConceptId,
        statement: event.statement,
        correction: event.correction,
        citation: event.citation,
        firstSeen: prior.firstSeen,
        lastSeen: event.timestamp,
        occurrenceCount: prior.occurrenceCount + 1,
        status: 'active',
        originInstrumentId: event.originInstrumentId,
      });
      continue;
    }

    // resolution-evidence: downgrade every active/fading record on this concept.
    for (const [id, record] of records) {
      if (record.conceptId !== event.conceptId) continue;
      if (record.status === 'resolved') continue;
      records.set(id, { ...record, status: DOWNGRADE[record.status] });
    }
  }

  return [...records.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
