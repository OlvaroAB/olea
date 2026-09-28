/**
 * The composition recorder (`[D-395]`, `[D-331]`, `ol-egov.141.89.10.65`): the one writer of
 * composition records, and the one place that decides a composition has become **actual**.
 *
 * **What counts as actual** (`[D-395]` choice 2, option a; C5.5 as amended). A session becomes
 * actual when she enters it — Start on Home, or opening review onto an idle session — and an
 * extension becomes actual when a keep going changed the list. Nothing else writes: a preview she
 * did not start (Home's live next-session preview, the session builder's leaf) goes through the
 * same composer and carries its {@link ComposedStudySession.provenance}, but never reaches this
 * module, so it writes nothing (condition 3). The review tab (`review/open-session.ts`) is the
 * one caller, because it is the one door every answer passes through: it records a fresh
 * composition as it enters the holder, records a sitting Start entered without one (Start on Home
 * enters the shared holder in `main.ts` and reveals the review tab at once, so the record is
 * written as that tab opens, before any answer is possible), and records an extension that
 * changed the list.
 *
 * **One record per session, an extension its own record** (conditions 1 and 2). A start mints a
 * fresh opaque id that is both the record's `compositionId` and its `sessionId`; an extension
 * mints a new `compositionId` and names the same `sessionId`, and is appended after the first
 * record, which is never rewritten. An extension whose served list is identical, in order, to
 * the record it would extend appends nothing.
 *
 * **Never study activity** (condition 4). The record goes to its own stream
 * (`olea-core`'s `study-session/composition-log.ts`), never the review log, so no review,
 * attention, mastery, window, effort or streak reading ever sees it.
 *
 * **A failed write never blocks her session, and never costs her its explanation**
 * (`ol-egov.141.89.10.93`, David's ruling 2026-09-28 on `ol-egov.141.89.10.65`). The frozen
 * in-memory composition the shared holder carries is the one source both screens read
 * ({@link explainActiveSession}); the record is its durable copy, not a gate on it. Every outcome
 * other than `'recorded'` returns the session with a reason and no content; the review tab serves
 * it as before.
 *
 * **A failed write is retried under the same composition identity, bounded.** The record is built
 * once, when the composition becomes actual: its `compositionId` and `composedAt` are fixed then.
 * A write that fails leaves that exact record queued against the session object the caller now
 * holds, and the next occasion — the review tab opening onto the sitting again, or a keep going —
 * writes the same record, never a freshly minted one. A retry first looks for the id in its daily
 * file, so a write that landed but reported failure is never appended twice (an id must resolve to
 * exactly one record, `[D-395]` condition 5). At most {@link MAX_COMPOSITION_WRITE_ATTEMPTS}
 * attempts are made for one session's unwritten records; after that nothing more is tried, the
 * session is still served and explained from memory, and no new identity is minted for it. A keep
 * going over a session whose record is still unwritten builds its extension record on that
 * pending record and queues it behind it, so the two land in order.
 *
 * **The identity travels whether or not the write has landed** ({@link compositionIdentityOf}):
 * a review served from a session whose record is still pending carries the id the record will be
 * written under, so it resolves once the retry lands, and never needs a join by time. If the
 * bound is exhausted the id resolves to nothing, which every reader already treats as no record.
 * The reasons carry no ids or text (D-005).
 */

import type { ComposedStudySession, VaultPath, VaultSource } from 'olea-core';
// Imported from their own module paths, never the `olea-core` barrel, which is another live
// lane's file this round — the same stance `./holder.ts` takes for its own source-path import.
import {
  appendCompositionRecord,
  compositionLogPath,
} from '../../../core/src/study-session/composition-log.js';
import {
  buildCompositionRecord,
  buildExtendedCompositionRecord,
  type CompositionRecord,
  mintOpaqueCompositionId,
  parseCompositionLog,
} from '../../../core/src/study-session/composition-record.js';
import { isoWithLocalOffset } from '../review/ports.js';
import { groupingWhySentence } from '../session-builder/copy.js';
import { localToday } from '../today/data-source.js';
import type { StudySessionSitting } from './holder.js';

/**
 * The active session's explanation (`[D-331]`, `[D-382]`, `[D-421]`; `ol-egov.141.89.10.93`), read
 * from the frozen in-memory composition the shared holder carries — the one source Home
 * (`../home/provider.ts`) and the review tab's first-item sentence (`main.ts`'s
 * `VIEW_TYPE_OLEA_REVIEW` registration) share, so the two can never state two different reasons
 * for one session. The composition record is this composition's durable copy (its `branch` and
 * `groupingSignal` are copied from these same fields), so a record whose write failed, or has not
 * been attempted yet, changes nothing here.
 *
 * - `undefined`: no session is active; there is nothing to explain.
 * - `'unavailable'`: the held session carries no composer account at all (`groupingSignal`, which
 *   `buildComposedStudySession` always sets, is absent: a hand-built session). Nothing is stated,
 *   and nothing is recomputed from anything else.
 * - `'available'`: `courseReason` is the composition's own `focusReason`, the sentence body the
 *   composer rendered from its `focusBranch` (and, once the course-naming sentence lands, its
 *   course) — the same two facts the record persists, so the record's own rendering of them
 *   states the same string. Absent when the composer chose no course (the every-course baseline);
 *   `groupingSentence` is `groupingWhySentence`'s proposed sentence for the recorded grouping
 *   signal, absent when no grouping decision occurred (`'none'`, `[D-421]`).
 *
 * A pure read of the sitting: nothing is entered, grown, exited or recomposed.
 */
export type ActiveSessionExplanation =
  | {
      readonly status: 'available';
      readonly courseReason?: string;
      readonly groupingSentence?: string;
    }
  | { readonly status: 'unavailable' };

export function explainActiveSession(
  sitting: StudySessionSitting,
): ActiveSessionExplanation | undefined {
  if (sitting.status !== 'active') return undefined;
  const composition = sitting.items;
  if (composition.groupingSignal === undefined) return { status: 'unavailable' };
  const courseReason = composition.focusReason;
  const groupingSentence = groupingWhySentence(composition.groupingSignal);
  return {
    status: 'available',
    ...(courseReason !== undefined ? { courseReason } : {}),
    ...(groupingSentence !== null ? { groupingSentence } : {}),
  };
}

/**
 * The course sentence of {@link explainActiveSession}, for the two readers that render only that
 * sentence today. `undefined` when no session is active, when the explanation is unavailable, or
 * when the composition chose no course. Named for the record whose `branch` it equals; it reads
 * the frozen composition, never the log.
 */
export function recordedSessionReason(sitting: StudySessionSitting): string | undefined {
  const explanation = explainActiveSession(sitting);
  return explanation?.status === 'available' ? explanation.courseReason : undefined;
}

/**
 * How many attempts are made at writing one session's unwritten composition records before
 * nothing more is tried. **Declared**, never fitted: a transient failure (a sync client holding
 * the daily file, a momentary lock) clears within a try or two, while one that survives three
 * separate occasions is persistent (a read-only or full vault), where further tries only add
 * churn. Counted across occasions, one attempt per occasion, reset when everything queued lands.
 */
export const MAX_COMPOSITION_WRITE_ATTEMPTS = 3;

/** One session's records not yet confirmed written, in append order, and the attempts spent. */
interface UnwrittenRecords {
  readonly records: readonly CompositionRecord[];
  readonly failedAttempts: number;
}

// Keyed by the session object the caller holds (the shared holder keeps exactly that object), so
// a retry finds the record first built for it whichever recorder instance runs the retry. Weak:
// a session the holder has let go of takes its queue with it.
const unwrittenBySession = new WeakMap<ComposedStudySession, UnwrittenRecords>();
const inFlightBySession = new WeakMap<ComposedStudySession, Promise<CompositionRecordOutcome>>();

/**
 * The composition identity `session` is served under: its latest record, whether that record is
 * written or still queued for a retry. `undefined` for a session that never became actual (a
 * preview) or could not be recorded at all. The review tab stamps this on every review it serves
 * (`[D-395]` condition 5).
 */
export function compositionIdentityOf(session: ComposedStudySession): string | undefined {
  const unwritten = unwrittenBySession.get(session)?.records;
  return (
    unwritten?.[unwritten.length - 1]?.compositionId ?? session.compositionRecord?.compositionId
  );
}

export interface CompositionRecorderDeps {
  readonly vault: VaultSource;
  /** This install's device id: the daily file is `<day>.<deviceId>.jsonl`. */
  readonly deviceId: string;
  /** Mints each new `compositionId`; defaults to `mintOpaqueCompositionId`. Injectable for tests. */
  readonly mintCompositionId?: () => string;
}

/** Why a composition was not recorded. Never carries an id or any content. */
export type CompositionNotRecordedReason =
  /** The session was not composed through the plugin's composition door, so what composed it is unknown. */
  | 'no-provenance'
  /** An extension of a session that was never recorded: there is no record for it to extend. */
  | 'parent-not-recorded'
  /**
   * An extension whose session kept its parent's set-aside account unchanged while its list
   * changed: the extension was grown without `extendComposedStudySessionWithAccount`, so its
   * set-asides would state facts nobody computed. Nothing is written rather than a wrong record.
   */
  | 'account-not-carried'
  /** The record builder refused the session (no account, a malformed value): a caller bug, never written. */
  | 'invalid-composition'
  /** The vault append failed; the record stays queued under its own identity for the next occasion. */
  | 'write-failed'
  /** {@link MAX_COMPOSITION_WRITE_ATTEMPTS} attempts failed; nothing more is tried for this session. */
  | 'retries-exhausted';

export type CompositionRecordOutcome =
  | {
      readonly status: 'recorded';
      /** The session, now carrying the record just appended as its `compositionRecord`. */
      readonly session: ComposedStudySession;
      readonly record: CompositionRecord;
      readonly path: VaultPath;
    }
  | {
      /** Nothing new to record: a start already recorded, or an extension that changed nothing. */
      readonly status: 'unchanged';
      readonly session: ComposedStudySession;
    }
  | {
      readonly status: 'not-recorded';
      readonly session: ComposedStudySession;
      readonly reason: CompositionNotRecordedReason;
    };

export interface CompositionRecorder {
  /**
   * She entered `session` (Start, or review opened onto an idle session), or is back at it: appends
   * its first record and returns the session carrying it. A session with records still queued from
   * a failed write has those same records retried instead (never a fresh identity). A session
   * already carrying its record, with nothing queued, is returned unchanged, never recorded twice.
   */
  readonly recordStart: (
    session: ComposedStudySession,
    now: Date,
  ) => Promise<CompositionRecordOutcome>;
  /**
   * She outran the target and `extended` grew `previous` (C5.8): appends an extension record
   * naming `previous`'s session when the served list changed, and nothing when it did not.
   */
  readonly recordExtension: (
    previous: ComposedStudySession,
    extended: ComposedStudySession,
    now: Date,
  ) => Promise<CompositionRecordOutcome>;
}

function sameServedList(record: CompositionRecord, session: ComposedStudySession): boolean {
  const items = session.model.items;
  return (
    record.chosen.length === items.length &&
    record.chosen.every((chosen, index) => chosen.instrumentId === items[index]?.instrumentId)
  );
}

/** `session` without its `compositionRecord`, or carrying `record` in its place. */
function withLatestWritten(
  session: ComposedStudySession,
  record: CompositionRecord | undefined,
): ComposedStudySession {
  const { compositionRecord: _replaced, ...rest } = session;
  return record !== undefined ? { ...rest, compositionRecord: record } : rest;
}

/** One write in flight per held session: a second caller waits on the first instead of racing it. */
function once(
  session: ComposedStudySession,
  run: () => Promise<CompositionRecordOutcome>,
): Promise<CompositionRecordOutcome> {
  const existing = inFlightBySession.get(session);
  if (existing !== undefined) return existing;
  const pending = run().finally(() => inFlightBySession.delete(session));
  inFlightBySession.set(session, pending);
  return pending;
}

export function createCompositionRecorder(deps: CompositionRecorderDeps): CompositionRecorder {
  const mint = deps.mintCompositionId ?? (() => mintOpaqueCompositionId());

  /** Writes `record` unless a retry finds it already landed (a write that reported failure). */
  async function writeOnce(record: CompositionRecord, isRetry: boolean): Promise<VaultPath> {
    if (isRetry) {
      const path = compositionLogPath(record.composedAt.slice(0, 10), deps.deviceId);
      if (await deps.vault.exists(path)) {
        const { records } = parseCompositionLog(await deps.vault.read(path));
        if (records.some((landed) => landed.compositionId === record.compositionId)) return path;
      }
    }
    return (await appendCompositionRecord(deps.vault, record, deps.deviceId)).path;
  }

  /**
   * Writes `queued.records` in order onto `base`, stopping at the first failure. Whatever is left
   * is queued against the session object returned, which the caller holds from then on.
   */
  async function flush(
    base: ComposedStudySession,
    queued: UnwrittenRecords,
  ): Promise<CompositionRecordOutcome> {
    if (queued.failedAttempts >= MAX_COMPOSITION_WRITE_ATTEMPTS) {
      unwrittenBySession.set(base, queued);
      return { status: 'not-recorded', session: base, reason: 'retries-exhausted' };
    }
    let session = base;
    let written: { readonly record: CompositionRecord; readonly path: VaultPath } | undefined;
    for (const [index, record] of queued.records.entries()) {
      try {
        const path = await writeOnce(record, queued.failedAttempts > 0);
        session = withLatestWritten(session, record);
        written = { record, path };
      } catch {
        unwrittenBySession.set(session, {
          records: queued.records.slice(index),
          failedAttempts: queued.failedAttempts + 1,
        });
        return { status: 'not-recorded', session, reason: 'write-failed' };
      }
    }
    if (written === undefined) return { status: 'unchanged', session };
    return { status: 'recorded', session, record: written.record, path: written.path };
  }

  return {
    async recordStart(session, now) {
      const queued = unwrittenBySession.get(session);
      if (queued !== undefined) return once(session, () => flush(session, queued));
      if (session.compositionRecord !== undefined) return { status: 'unchanged', session };
      const provenance = session.provenance;
      if (provenance === undefined) {
        return { status: 'not-recorded', session, reason: 'no-provenance' };
      }
      let record: CompositionRecord;
      try {
        record = buildCompositionRecord(session, {
          ...provenance,
          compositionId: mint(),
          composedAt: isoWithLocalOffset(now),
        });
      } catch {
        return { status: 'not-recorded', session, reason: 'invalid-composition' };
      }
      return once(session, () => flush(session, { records: [record], failedAttempts: 0 }));
    },

    async recordExtension(previous, extended, now) {
      const queued = unwrittenBySession.get(previous);
      // The identity the extension grows: `previous`'s latest record, written or still queued.
      const parent = queued?.records[queued.records.length - 1] ?? previous.compositionRecord;
      if (parent === undefined) {
        return { status: 'not-recorded', session: extended, reason: 'parent-not-recorded' };
      }
      // An extension carries the latest record written for it until a new one is written.
      const underParent = withLatestWritten(extended, previous.compositionRecord);
      if (sameServedList(parent, extended)) {
        // Nothing new to record, but this is an occasion: retry anything still queued.
        if (queued !== undefined) return once(underParent, () => flush(underParent, queued));
        return { status: 'unchanged', session: underParent };
      }
      if (extended.setAside === previous.setAside) {
        if (queued !== undefined) unwrittenBySession.set(underParent, queued);
        return { status: 'not-recorded', session: underParent, reason: 'account-not-carried' };
      }
      let record: CompositionRecord;
      try {
        record = buildExtendedCompositionRecord(parent, extended, {
          compositionId: mint(),
          composedAt: isoWithLocalOffset(now),
          asOf: localToday(now),
          budgetMinutes: extended.model.budgetMinutes,
        });
      } catch {
        if (queued !== undefined) unwrittenBySession.set(underParent, queued);
        return { status: 'not-recorded', session: underParent, reason: 'invalid-composition' };
      }
      return once(underParent, () =>
        flush(underParent, {
          records: [...(queued?.records ?? []), record],
          failedAttempts: queued?.failedAttempts ?? 0,
        }),
      );
    },
  };
}
