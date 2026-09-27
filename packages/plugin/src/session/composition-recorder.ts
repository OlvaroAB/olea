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
 * **A failed write never blocks her session.** Every outcome other than `'recorded'` returns the
 * session unrecorded (or, for an extension, still under its previous record) with a reason and
 * no content; the review tab serves the session as before. A start left unrecorded by a failed
 * write is retried the next time the tab opens onto that sitting, because it still carries no
 * record. The reasons carry no ids or text (D-005).
 */

import type { ComposedStudySession, VaultPath, VaultSource } from 'olea-core';
// Imported from their own module paths, never the `olea-core` barrel, which is another live
// lane's file this round — the same stance `./holder.ts` takes for its own source-path import.
import { appendCompositionRecord } from '../../../core/src/study-session/composition-log.js';
import {
  buildCompositionRecord,
  buildExtendedCompositionRecord,
  type CompositionRecord,
  mintOpaqueCompositionId,
} from '../../../core/src/study-session/composition-record.js';
import { isoWithLocalOffset } from '../review/ports.js';
import { localToday } from '../today/data-source.js';

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
  /** The vault append failed. */
  | 'write-failed';

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
   * She entered `session` (Start, or review opened onto an idle session): appends its first
   * record and returns the session carrying it. A session that already carries a record is
   * returned unchanged, never recorded twice.
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

export function createCompositionRecorder(deps: CompositionRecorderDeps): CompositionRecorder {
  const mint = deps.mintCompositionId ?? (() => mintOpaqueCompositionId());

  async function append(
    session: ComposedStudySession,
    record: CompositionRecord,
  ): Promise<CompositionRecordOutcome> {
    try {
      const { path } = await appendCompositionRecord(deps.vault, record, deps.deviceId);
      return {
        status: 'recorded',
        session: { ...session, compositionRecord: record },
        record,
        path,
      };
    } catch {
      return { status: 'not-recorded', session, reason: 'write-failed' };
    }
  }

  return {
    async recordStart(session, now) {
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
      return append(session, record);
    },

    async recordExtension(previous, extended, now) {
      const parent = previous.compositionRecord;
      if (parent === undefined) {
        return { status: 'not-recorded', session: extended, reason: 'parent-not-recorded' };
      }
      // An extension carries the record it grew until a new one is appended.
      const underParent: ComposedStudySession = { ...extended, compositionRecord: parent };
      if (sameServedList(parent, extended)) return { status: 'unchanged', session: underParent };
      if (extended.setAside === previous.setAside) {
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
        return { status: 'not-recorded', session: underParent, reason: 'invalid-composition' };
      }
      return append(extended, record);
    },
  };
}
