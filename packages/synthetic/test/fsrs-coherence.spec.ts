/**
 * Physical consistency: the intervals in these streams are the intervals the
 * product's scheduler actually produces.
 *
 * The test is a **replay**. It walks each stream in order with a fresh
 * `createFsrsScheduler()`, feeds it the rating each record carries at the
 * instant that record carries, and checks that the `dueState` written on the
 * record is the one the replayed state implies. Nothing here trusts the
 * generator's bookkeeping — the generator could be lying about its own state
 * and this would catch it, because the only inputs are the emitted bytes.
 *
 * Why this is the load-bearing test of the whole package: a stream whose
 * intervals contradict the scheduler is not a harder input for a detector, it
 * is a *different* input, drawn from a distribution the product can never
 * produce. A cramming detector that fires only on such a stream has not been
 * tested at all. Everything the personas do — pulling items early, letting
 * cards go overdue, vanishing for ten days — happens inside what FSRS allows,
 * and this is where that claim is checked rather than asserted.
 */

import type { SchedulerState } from 'olea-core';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  generateStream,
  PERSONA_IDS,
  reviewsOf,
  type SyntheticStream,
  streamSpec,
} from '../src/index.js';
import { localDate, parseUtcOffset } from '../src/time.js';

const STREAMS = PERSONA_IDS.map((persona) =>
  generateStream(streamSpec(persona, 'coherence', { days: persona === 'single-session' ? 1 : 90 })),
);
const CASES = STREAMS.map((s) => [s.spec.persona, s] as const);

function expectedDueState(
  prior: SchedulerState | null,
  reviewDay: string,
  offsetMinutes: number,
): string {
  if (prior === null) return 'new';
  const dueDay = localDate(Date.parse(prior.due), offsetMinutes);
  if (dueDay < reviewDay) return 'overdue';
  if (dueDay === reviewDay) return 'due';
  return 'early';
}

/** Replays a stream through a fresh scheduler and reports every disagreement. */
function replayDisagreements(stream: SyntheticStream): readonly string[] {
  const scheduler = createFsrsScheduler();
  const offsetMinutes = parseUtcOffset(stream.spec.utcOffset);
  const states = new Map<string, SchedulerState>();
  const problems: string[] = [];

  for (const record of reviewsOf(stream.entries)) {
    if (record.instrumentType === 'explain-back') {
      // Explain-back is never FSRS-scheduled (contracts' `instrumentType` doc),
      // so it must neither have nor create scheduling state.
      if (states.has(record.instrumentId)) {
        problems.push(`${record.eventId}: explain-back instrument acquired scheduler state`);
      }
      if (record.selectionContext.dueState !== 'new') {
        problems.push(
          `${record.eventId}: explain-back dueState ${record.selectionContext.dueState}, expected 'new'`,
        );
      }
      if (record.rating !== null) {
        problems.push(`${record.eventId}: explain-back carries a rating (F2.16 forbids it)`);
      }
      continue;
    }

    const prior = states.get(record.instrumentId) ?? null;
    const reviewDay = record.timestamp.slice(0, 10);
    const expected = expectedDueState(prior, reviewDay, offsetMinutes);
    if (record.selectionContext.dueState !== expected) {
      problems.push(
        `${record.eventId} (${record.instrumentId} on ${reviewDay}): dueState ` +
          `${record.selectionContext.dueState}, replay says ${expected}` +
          (prior ? ` (due ${prior.due})` : ''),
      );
    }
    if (record.rating === null) {
      problems.push(`${record.eventId}: a scheduled instrument logged with no rating`);
      continue;
    }
    const output = scheduler.schedule({
      instrumentId: record.instrumentId,
      state: prior,
      rating: record.rating,
      now: new Date(record.timestamp),
    });
    if (Date.parse(output.state.due) <= Date.parse(record.timestamp)) {
      problems.push(`${record.eventId}: FSRS returned a due date at or before the review instant`);
    }
    states.set(record.instrumentId, output.state);
  }

  return problems;
}

describe('FSRS coherence', () => {
  it.each(CASES)('%s: every dueState is the one a replay of the stream implies', (_p, stream) => {
    expect(replayDisagreements(stream)).toEqual([]);
  });

  it.each(CASES)(
    '%s: masteryAtTime is absent exactly when the concept had no history',
    (_p, stream) => {
      // Retargeted by `ol-g6zg`: the field moved out of `selectionContext` onto
      // the record, and "no mastery was recorded" is now an absent field rather
      // than a null. The property being asserted is the same one — the
      // generator records a mastery value exactly when it has a history to
      // derive one from, and never fabricates one for a first exposure.
      const seenConcepts = new Set<string>();
      for (const record of reviewsOf(stream.entries)) {
        // A synthetic instrument is evidence for exactly one concept, so
        // `conceptIds` is a singleton here, but "had history" is read the
        // many-to-many way (v3): true if *any* named concept was seen before.
        const hadHistory = record.conceptIds.some((c) => seenConcepts.has(c));
        if (hadHistory) {
          expect(record.masteryAtTime).toBeDefined();
        } else {
          expect(record.masteryAtTime).toBeUndefined();
        }
        if (record.instrumentType !== 'explain-back') {
          for (const c of record.conceptIds) seenConcepts.add(c);
        }
      }
    },
  );

  it.each(CASES)(
    '%s: every recorded mastery is keyed by the concept the record names, never left unattributed',
    (_p, stream) => {
      // `ol-g6zg`. The generator always knows which concept a value describes —
      // an instrument is evidence for exactly one — so the `not-attributable`
      // arm must never appear here. That arm belongs to the migration, which
      // reads records whose attribution was never captured.
      for (const record of reviewsOf(stream.entries)) {
        const mastery = record.masteryAtTime;
        if (mastery === undefined) continue;
        expect(mastery.attribution).toBe('per-concept');
        if (mastery.attribution !== 'per-concept') continue;
        expect(Object.keys(mastery.byConcept)).toEqual([...new Set(record.conceptIds)]);
      }
    },
  );

  it.each(CASES)(
    '%s: instrumentTypesOffered always contains the type she answered',
    (_p, stream) => {
      for (const record of reviewsOf(stream.entries)) {
        if (record.instrumentType === 'explain-back') {
          // Explain-back is on-demand, never queued — it is deliberately absent
          // from the offered set, which lists what the *queue* could have chosen.
          expect(record.selectionContext.instrumentTypesOffered).not.toContain('explain-back');
          continue;
        }
        expect(record.selectionContext.instrumentTypesOffered).toContain(record.instrumentType);
      }
    },
  );

  it.each(CASES)('%s: no instrument is reviewed twice within one local day', (_p, stream) => {
    const seen = new Set<string>();
    for (const record of reviewsOf(stream.entries)) {
      if (record.instrumentType === 'explain-back') continue;
      const key = `${record.timestamp.slice(0, 10)}::${record.instrumentId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('a suspended instrument is not reviewed until it is unsuspended (F2.6 / D-020)', () => {
    const stream = generateStream(streamSpec('struggler', 'suspension', { days: 90 }));
    const suspended = new Set<string>();
    let sawSuspend = false;
    let sawUnsuspend = false;
    for (const entry of stream.entries) {
      if (entry.kind === 'suspend') {
        suspended.add(entry.instrumentId);
        sawSuspend = true;
        continue;
      }
      if (entry.kind === 'unsuspend') {
        // Unsuspending is a second event, never a retraction of the first: the
        // suspend record is still in the stream above this line.
        expect(suspended.has(entry.instrumentId)).toBe(true);
        suspended.delete(entry.instrumentId);
        sawUnsuspend = true;
        continue;
      }
      expect(suspended.has(entry.instrumentId)).toBe(false);
    }
    expect(sawSuspend).toBe(true);
    expect(sawUnsuspend).toBe(true);
  });
});
