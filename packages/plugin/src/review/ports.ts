/**
 * The seams `ReviewSession` depends on instead of talking to Obsidian, the
 * vault, or the review log directly — same split as `commands/types.ts`'s
 * `CommandRegistrar` and `ingestion/wiring.ts`'s deps: narrow structural
 * ports a plain object can satisfy in tests, with `view.ts` supplying the
 * real, Obsidian-backed implementations.
 */

import type { Rating, SelectionContextV4 } from 'olea-contracts';
import type { VaultSource } from 'olea-core';
// `masteryAtTimeForConceptIds` (C5.4's rollup) had no consumer outside core
// and `packages/workbench` until this bead (`ol-rpr4`), so nothing had ever
// added it to core's public surface. The lane that wired it reached in by
// source path — `packages/workbench/src/oracle-bridge.ts` does exactly that —
// and the orchestrator added the barrel export instead: the workbench is dev
// tooling, this file is production code that gets bundled into the plugin, and
// this was the only one of the plugin's 43 core imports reaching past the
// barrel. A deep import here would also let the module be bundled twice.
import { appendReviewLogRecord, appendSuspendRecord, masteryAtTimeForConceptIds } from 'olea-core';
import {
  localToday,
  readReviewHistory,
  SCHEDULING_HISTORY_PROBE_DAYS,
} from '../today/data-source.js';
import type { ReviewInstrument } from './types.js';

export interface RecordReviewInput {
  readonly instrument: ReviewInstrument;
  readonly rating: Rating;
  readonly wasUnsure: boolean;
  readonly durationMs: number | null;
  readonly selectionContext: SelectionContextV4;
}

/** Writes one D7.1 review-log record. The real implementation is `createVaultReviewLogPort` below. */
export interface ReviewLogPort {
  recordReview(input: RecordReviewInput): Promise<void>;
}

/**
 * ISO-8601 with the *local* UTC offset (never bare `Z`) — the review-log
 * schema's doc is explicit that the offset is what makes "which day did she
 * study" a local-time question, not a UTC one.
 */
export function isoWithLocalOffset(date: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  const stamp = local.toISOString().slice(0, -1); // drop the trailing 'Z'
  return `${stamp}${sign}${pad(Math.trunc(offsetMin / 60))}:${pad(offsetMin % 60)}`;
}

/**
 * The real `ReviewLogPort`: `olea-core`'s `appendReviewLogRecord` over a
 * `VaultSource`, and the one write path this view is trusted to use for the
 * authoritative D7.1 event.
 *
 * **It lives here, not in `obsidian-ports.ts`, for `ol-t5lj`'s reason and one
 * more.** It needs a `VaultSource` and a device id; there is no Obsidian in
 * it. Sitting next to the ports that do need a host made it unimportable
 * under Vitest — `obsidian` has no runtime outside a real host — which meant
 * the review loop's single most consequential write, the one INV-4 exists to
 * protect, had no test that could reach it. Being obsidian-free is the point,
 * not a side effect.
 *
 * `timestamp` is read from the clock at write time rather than passed in,
 * because the log records *when the event happened*, and the only honest
 * answer to that is "now" at the moment of appending.
 *
 * **`masteryAtTime` (C5.4, `ol-rpr4`) is stamped here, and the ordering below
 * is the whole correctness argument, not a comment describing it.**
 * `mastery/rollup.ts`'s own docblock names the trap: the field must reflect
 * what the system believed when it *offered* her the item, computed from the
 * log **excluding** the event this call is about to append. That exclusion is
 * not implemented as a filter someone could get wrong — it falls out of doing
 * the log read (`readReviewHistory`) and the mastery build
 * (`masteryAtTimeForConceptIds`) to completion *before* `appendReviewLogRecord`
 * is ever called. The not-yet-written event cannot appear in a log read that
 * finished before it was written. Reordering these two calls is the one edit
 * that would silently break this; `open-session.spec.ts` has a test built to
 * go red if it ever does.
 *
 * The window read is `SCHEDULING_HISTORY_PROBE_DAYS`, the same bound
 * `open-session.ts` already reads to replay scheduler state for this same
 * session — not the shorter streak window, which is a display concern with no
 * bearing on what mastery this event should carry.
 */
export function createVaultReviewLogPort(vault: VaultSource, deviceId: string): ReviewLogPort {
  return {
    async recordReview(input) {
      const now = new Date();
      const conceptIds = input.instrument.conceptIds;

      // Read to completion BEFORE the append below — see this function's doc.
      const history = await readReviewHistory(vault, deviceId, {
        today: localToday(now),
        windowDays: SCHEDULING_HISTORY_PROBE_DAYS,
      });
      const masteryAtTime = masteryAtTimeForConceptIds(history.entries, conceptIds);

      await appendReviewLogRecord(
        vault,
        {
          timestamp: isoWithLocalOffset(now),
          instrumentId: input.instrument.instrumentId,
          instrumentType: input.instrument.type,
          // Copied, not passed by reference: the frozen record's inferred type
          // is a mutable `string[]` and the presentation shape carries a
          // `readonly` one. Spreading is also the honest thing here — nothing
          // downstream should be able to mutate the list this view holds.
          conceptIds: [...conceptIds],
          rating: input.rating,
          wasUnsure: input.wasUnsure,
          durationMs: input.durationMs,
          selectionContext: input.selectionContext,
          masteryAtTime,
        },
        { deviceId },
      );
    },
  };
}

/**
 * Suspends an instrument beyond this session (F2.6's durable half, D-020).
 *
 * Carries `conceptIds` alongside the instrument id, not just the id alone —
 * that used to be the whole of this bug (`ol-xvmx`). The frozen suspend
 * record (`olea-contracts`' `SuspendLogRecord`) has needed the concept set
 * since D-020 and, as of v3, requires it non-empty; a port that could only
 * name the instrument could never produce a conforming record no matter what
 * called it. `ReviewInstrumentCommon.conceptIds` already carries the value at
 * every call site, so widening the signature is the whole fix — see
 * `createVaultSuspendPort` below for why the id alone was never
 * reconstructible after the fact.
 *
 * `ReviewSession` calls this port on every suspend, but **does not depend on
 * it for the in-session guarantee** — F2.6's suspend has two halves, and the
 * first, that a suspended item is not offered again for the rest of the
 * sitting, comes from `ReviewSession` removing the item from its own working
 * queue, which needs no persistence at all. This port is where the *durable*
 * half attaches — the item stays out of the queue on later days too, until it
 * is unsuspended.
 */
export interface SuspendPort {
  suspend(instrumentId: string, conceptIds: readonly string[]): Promise<void>;
}

/**
 * The real `SuspendPort`: `olea-core`'s `appendSuspendRecord` over a
 * `VaultSource` — F2.6's durable half, finally wired (`ol-xvmx`).
 *
 * Lives here, not in `obsidian-ports.ts`, for exactly `createVaultReviewLogPort`'s
 * reason: it needs a `VaultSource` and a device id, no Obsidian, and the module
 * that used to hold it (`createObsidianSuspendPort`) could not be loaded under
 * Vitest at all. This replaces that placeholder outright rather than sitting
 * beside it — once the port can carry enough to write a conforming record,
 * an honest "not built yet" `Notice` is no longer honest.
 *
 * Every call here writes `kind: 'suspend'`. Nothing in the product offers
 * unsuspending yet (no `SuspendPort` caller ever asks for it), so this port
 * only ever produces one half of the pair — `appendSuspendRecord` itself
 * stays symmetric, and `kind` is part of its input for exactly that reason,
 * so the day an unsuspend command exists it is a caller of the same writer,
 * not a new one.
 *
 * `conceptIds` is copied, not passed by reference, for the same reason
 * `createVaultReviewLogPort` copies it: the frozen record's inferred type is a
 * mutable `string[]` and callers hand this a `readonly` one.
 */
export function createVaultSuspendPort(vault: VaultSource, deviceId: string): SuspendPort {
  return {
    async suspend(instrumentId, conceptIds) {
      await appendSuspendRecord(
        vault,
        {
          kind: 'suspend',
          timestamp: isoWithLocalOffset(new Date()),
          instrumentId,
          conceptIds: [...conceptIds],
        },
        { deviceId },
      );
    },
  };
}

/** Opens the instrument's source note for editing, without losing the review session's place (F2.6). */
export interface EditPort {
  edit(instrument: ReviewInstrument): Promise<void>;
}

/** Whether an instrument's source note still exists in the vault (F2.6's "source note deleted since scheduling" scenario). */
export interface NoteExistsPort {
  exists(sourcePath: string): Promise<boolean>;
}

/**
 * The real implementation of `NoteExistsPort`, and the reason it lives here
 * rather than in `obsidian-ports.ts` with the others (`ol-t5lj`).
 *
 * It used to be `createObsidianNoteExistsPort(app)`, asking
 * `app.vault.getAbstractFileByPath(path) !== null`. `VaultSource.exists` is
 * the same question with no Obsidian in it, and `ObsidianSource` already
 * answers it against exactly that API — so taking an `App` bought nothing
 * and cost the review wiring a dependency it did not need.
 *
 * This was found by running rather than by inspection: the component
 * workbench mounts the real views against a deliberately shallow chrome-only
 * shim, and this port was the **only** thing in the review path that wanted
 * `App` in that shim — i.e. wanted it to grow from "facts about the window"
 * to "the vault API". Living in an Obsidian-free module is the point, not a
 * side effect: a caller with a `VaultSource` and no Obsidian can now build
 * this port, which is precisely the case that surfaced it.
 */
export function createVaultNoteExistsPort(vault: VaultSource): NoteExistsPort {
  return {
    async exists(sourcePath: string) {
      return vault.exists(sourcePath);
    },
  };
}

/** Injectable so `now()` is deterministic in tests — same discipline `core/dates.ts` and `ScheduleInput.now` already use. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
