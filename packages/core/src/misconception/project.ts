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
 * `statement`/`correction`/`conceptId`/`originInstrumentId` are updated to
 * the triggering event's values each time — the record reflects the **most
 * recent** occurrence's wording and grounding, while `occurrenceCount` and
 * `firstSeen` preserve the full history. (An alternative — keep the first
 * occurrence's wording — was considered and rejected: her own words about a
 * recurring confusion may sharpen over repeated attempts, and the correction
 * should always cite the source passage the *grader most recently checked
 * against*, not a stale one.)
 *
 * **`citation`/`confusedWithConceptId` are "sticky": a later occurrence only
 * overwrites either with a non-null value; a `null` never erases evidence a
 * prior occurrence already established** (`[D-202]`/`[D-220]`, `ol-2zfj.70`).
 * Every Stream-A event (this module's own, `./events.js`-built) always
 * carries both, so this never changes pure-Stream-A behaviour — the two
 * fields are only ever `null` here for a record folded in part from
 * `./store.js`'s review-log reconciliation, whose `misconceptionObservedLogRecordV5`
 * schema has no `confusedWithConceptId` field and no vault-block citation at
 * all. Letting that ABSENCE overwrite a real pairing or a real citation
 * would silently destroy evidence a richer occurrence already recorded — an
 * MCQ pick asserts nothing about either field, so it must not be read as
 * asserting their absence. `project.spec.ts`'s "sticky merge" cases pin this.
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
 *
 * **Generalised for cross-stream reconciliation (`ol-2zfj.70`).** The actual
 * fold logic lives in `foldMisconceptionObservations`, over a normalized
 * entry shape (`NormalizedMisconceptionFoldEntry`) rather than over
 * `MisconceptionEvent` directly. `projectMisconceptions` below is that fold
 * specialised to this module's own Stream A event log (via
 * `normalizeMisconceptionEvent`) — its signature and behaviour are
 * unchanged by this refactor, and every test in `project.spec.ts` from
 * before this bead still exercises it unmodified. `./store.js`'s
 * `projectMisconceptionsFromAllSources` is the OTHER specialisation, folding
 * Stream A's events together with review-log `misconception-observed`
 * picks (Stream B, `[D-202]`/`[D-220]`) through this exact same rule set —
 * see that module's doc for why a single interleaved fold, not two
 * projections merged after the fact, is required for correct chronological
 * behaviour (a Stream A resolution-evidence event must downgrade a
 * Stream-B-origin record too, in the right order relative to later picks).
 */

import type {
  MisconceptionEvent,
  MisconceptionRecord,
  MisconceptionStatus,
  SourceCitation,
} from './types.js';

function eventInstant(instant: { readonly timestamp: string }): number {
  return Date.parse(instant.timestamp);
}

function sortKey(entry: {
  readonly timestamp: string;
  readonly eventId: string;
}): [number, string] {
  return [eventInstant(entry), entry.eventId];
}

const DOWNGRADE: Readonly<Record<MisconceptionStatus, MisconceptionStatus>> = {
  active: 'fading',
  fading: 'resolved',
  resolved: 'resolved',
};

/**
 * One observation, already reduced to exactly the fields the fold needs,
 * regardless of which stream produced it. For a Stream A event (this
 * module's own `MisconceptionObservedEvent`) `citation` is always a real
 * `SourceCitation` and `misconceptionId` is that event's own field, already
 * resolved by M1 at write time (`./events.js`). For a Stream B pick
 * (`./store.js`'s `normalizeMcqPick`) `citation` is `null` (no vault-block
 * reference exists for an MCQ distractor) and `misconceptionId` is a key
 * `./store.js` derives — never the review-log record's own always-fresh id
 * (`[D-202]`'s "a hint, not an assertion").
 */
export interface NormalizedMisconceptionObservation {
  readonly kind: 'observed';
  readonly eventId: string;
  readonly timestamp: string;
  readonly misconceptionId: string;
  readonly conceptId: string;
  readonly confusedWithConceptId: string | null;
  readonly statement: string;
  readonly correction: string;
  readonly citation: SourceCitation | null;
  readonly originInstrumentId: string;
}

/** M2's per-concept resolution signal, normalized the same way. */
export interface NormalizedMisconceptionResolution {
  readonly kind: 'resolution-evidence';
  readonly eventId: string;
  readonly timestamp: string;
  readonly conceptId: string;
}

export type NormalizedMisconceptionFoldEntry =
  | NormalizedMisconceptionObservation
  | NormalizedMisconceptionResolution;

/**
 * Reduces one Stream A `MisconceptionEvent` to the fold's normalized shape.
 * Exported so `./store.js` can interleave Stream B's own normalized entries
 * into the SAME chronologically-ordered fold, rather than projecting each
 * stream separately and unioning the results — which would get
 * `resolution-evidence` ordering wrong across streams (see this module's top
 * doc).
 */
export function normalizeMisconceptionEvent(
  event: MisconceptionEvent,
): NormalizedMisconceptionFoldEntry {
  if (event.kind === 'observed') {
    return {
      kind: 'observed',
      eventId: event.eventId,
      timestamp: event.timestamp,
      misconceptionId: event.misconceptionId,
      conceptId: event.conceptId,
      confusedWithConceptId: event.confusedWithConceptId,
      statement: event.statement,
      correction: event.correction,
      citation: event.citation,
      originInstrumentId: event.originInstrumentId,
    };
  }
  return {
    kind: 'resolution-evidence',
    eventId: event.eventId,
    timestamp: event.timestamp,
    conceptId: event.conceptId,
  };
}

/**
 * The actual fold — see this module's top doc for the full rule set
 * (observation folding, the sticky `citation`/`confusedWithConceptId`
 * merge, and M2 resolution). Generalised over `NormalizedMisconceptionFoldEntry`
 * so it can run over Stream A alone (`projectMisconceptions`, below) or over
 * Stream A interleaved with Stream B (`./store.js`).
 */
export function foldMisconceptionObservations(
  entries: readonly NormalizedMisconceptionFoldEntry[],
): readonly MisconceptionRecord[] {
  const ordered = [...entries].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    return ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0;
  });

  const seenEventIds = new Set<string>();
  const records = new Map<string, MisconceptionRecord>();

  for (const entry of ordered) {
    if (seenEventIds.has(entry.eventId)) continue;
    seenEventIds.add(entry.eventId);

    if (entry.kind === 'observed') {
      const prior = records.get(entry.misconceptionId);

      if (prior === undefined) {
        records.set(entry.misconceptionId, {
          id: entry.misconceptionId,
          conceptId: entry.conceptId,
          confusedWithConceptId: entry.confusedWithConceptId,
          statement: entry.statement,
          correction: entry.correction,
          citation: entry.citation,
          firstSeen: entry.timestamp,
          lastSeen: entry.timestamp,
          occurrenceCount: 1,
          status: 'active',
          originInstrumentId: entry.originInstrumentId,
        });
        continue;
      }

      // `ordered` is sorted ascending, so `entry.timestamp` is always >= the
      // timestamp of whatever set `prior` — no comparison needed to know
      // this entry is the new `lastSeen`. `citation`/`confusedWithConceptId`
      // are "sticky": a `null` on this entry never erases a real prior
      // value (see this module's top doc).
      records.set(entry.misconceptionId, {
        id: prior.id,
        conceptId: entry.conceptId,
        confusedWithConceptId: entry.confusedWithConceptId ?? prior.confusedWithConceptId,
        statement: entry.statement,
        correction: entry.correction,
        citation: entry.citation ?? prior.citation,
        firstSeen: prior.firstSeen,
        lastSeen: entry.timestamp,
        occurrenceCount: prior.occurrenceCount + 1,
        status: 'active',
        originInstrumentId: entry.originInstrumentId,
      });
      continue;
    }

    // resolution-evidence: downgrade every active/fading record on this concept.
    for (const [id, record] of records) {
      if (record.conceptId !== entry.conceptId) continue;
      if (record.status === 'resolved') continue;
      records.set(id, { ...record, status: DOWNGRADE[record.status] });
    }
  }

  return [...records.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Folds `events` (any order, any source) into current `MisconceptionRecord`s,
 * one per distinct `misconceptionId`. See this module's doc for the full
 * fold rules. Stream A only — `./store.js`'s `projectMisconceptionsFromAllSources`
 * is the Stream-A-plus-Stream-B equivalent.
 */
export function projectMisconceptions(
  events: readonly MisconceptionEvent[],
): readonly MisconceptionRecord[] {
  return foldMisconceptionObservations(events.map(normalizeMisconceptionEvent));
}
