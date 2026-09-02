/**
 * The seams `ReviewSession` depends on instead of talking to Obsidian, the
 * vault, or the review log directly — same split as `commands/types.ts`'s
 * `CommandRegistrar` and `ingestion/wiring.ts`'s deps: narrow structural
 * ports a plain object can satisfy in tests, with `view.ts` supplying the
 * real, Obsidian-backed implementations.
 */

import type { ExplainBackOfferTrigger, Rating, SelectionContextV4 } from 'olea-contracts';
import type { VaultSource } from 'olea-core';
// `masteryAtTimeForConceptIds` (C5.4's rollup) had no consumer outside core
// and `packages/workbench` until this bead (`ol-rpr4`), so nothing had ever
// added it to core's public surface. The lane that wired it reached in by
// source path — `packages/workbench/src/oracle-bridge.ts` does exactly that —
// and the orchestrator added the barrel export instead: the workbench is dev
// tooling, this file is production code that gets bundled into the plugin, and
// this was the only one of the plugin's 43 core imports reaching past the
// barrel. A deep import here would also let the module be bundled twice.
import {
  appendExplainBackOfferRecord,
  appendReviewLogRecord,
  appendSuspendRecord,
  type BuildSchedulingObservationFieldInput,
  buildSchedulingObservationField,
  masteryAtTimeForConceptIds,
  type SupportLevelPresentation,
  supportLevelReviewFields,
} from 'olea-core';
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
  /**
   * Row 3.9's chooser decision for this review ([SUPP-2], `ol-95vv.4`) — the
   * support level actually shown, carried from composition
   * (`StudySessionItem.supportLevel` / a future wired
   * `ComposedExplainBackItem.supportLevel`) through to this write. `undefined`
   * for a review whose item carried no decision — an `'mcq'` item (out of
   * `[D-094]`'s ladder scope by rule) or a caller not yet wired to the
   * chooser — and the record is written with no `supportLevelShown` field at
   * all, exactly today's behaviour, never a fabricated value.
   *
   * Only `.level` is ever persisted, never `.provenance`: the frozen v5
   * schema has no provenance field
   * (`packages/core/src/support-level/record.ts`'s own doc), and
   * `supportLevelReviewFields` accepts nothing but a bare level, so there is
   * no parameter here a caller could route her self-rating through even by
   * mistake — principle 16's "record what was shown, never what she said" is
   * structural, not a discipline this port has to remember.
   */
  readonly supportLevel?: SupportLevelPresentation;
  /**
   * F5.3a / C5.11's scheduling observation (`[D-087]`, widened kind-general
   * by `[D-185]`, `ol-0r92.41`) — the caller's RAW decision about whether
   * this review demonstrated correct use of a neighbour concept, never the
   * already-built field. This port is what calls `olea-core`'s
   * `buildSchedulingObservationField` on it (see `createVaultReviewLogPort`
   * below), the same "caller decides, port writes" split `supportLevel` just
   * above already uses for `supportLevelReviewFields`. `undefined` for a
   * review whose item named no neighbour concept as context — which today is
   * every qa/cloze/mcq review (`session.ts`'s
   * `evaluateSchedulingObservationForGradeWrite` doc explains why no producer
   * is wired yet) — and the record is written with no `schedulingObservation`
   * field at all, never a fabricated one.
   */
  readonly schedulingObservationInput?: BuildSchedulingObservationFieldInput;
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
 * **`supportLevelShown` (row 3.9, `[SUPP-2]`/`ol-95vv.4`) is merged here,
 * not stamped.** Unlike `masteryAtTime` below, this port never computes it —
 * `input.supportLevel` is the caller's own chooser decision for the item
 * being reviewed, and `supportLevelReviewFields` is the one function
 * trusted to turn it into the record's field (see `RecordReviewInput.
 * supportLevel`'s doc for why only `.level` ever survives into the log).
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

      // F5.3a / C5.11 (`[D-185]`): built here, from the caller's RAW decision
      // — see `RecordReviewInput.schedulingObservationInput`'s doc for why
      // this port calls `olea-core`'s one producer rather than the caller.
      // `undefined` in, `undefined` out, when the item named no neighbour
      // concept as context.
      const schedulingObservation =
        input.schedulingObservationInput === undefined
          ? undefined
          : buildSchedulingObservationField(input.schedulingObservationInput);

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
          // Row 3.9's write seam ([SUPP-2]): merge `supportLevelShown` only
          // when this review's item carried a chooser decision — see
          // `RecordReviewInput.supportLevel`'s doc for why `undefined`
          // produces no field at all rather than a fabricated one.
          ...(input.supportLevel !== undefined
            ? supportLevelReviewFields(input.supportLevel.level)
            : {}),
          // Merged only when a scheduling observation was actually produced
          // above — never a fabricated one.
          ...(schedulingObservation !== undefined ? { schedulingObservation } : {}),
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

/**
 * The offer/decline half of an F2.12 (or a future F5.3a) explain-back offer
 * (`[D-178 / LOG-3]` item 2, `ol-0r92.28`) — a caller supplies which concepts
 * and trigger the offer concerned, and, present exactly on `instrumentId`,
 * which instrument routed to it.
 */
export interface ExplainBackOfferWriteInput {
  readonly conceptIds: readonly string[];
  readonly trigger: ExplainBackOfferTrigger;
  readonly instrumentId?: string;
}

/**
 * Records that an explain-back was offered, and — separately — that the
 * offer left the surface unaccepted (`[D-178 / LOG-3]` item 2). Both methods
 * are synchronous and fire the vault write in the background rather than
 * returning a `Promise` a caller must await: `view.ts`'s
 * `syncConfusionRoutingOffer` runs inside the synchronous `render()` path
 * (`ol-0r92.28`), and cannot block a re-render on a log write no screen ever
 * shows her the result of.
 *
 * **Why `recordOffered` returns the event id rather than nothing.** A
 * decline that goes untaken has to name the offer it answers
 * (`ExplainBackOfferLogRecordV5`'s pairing rule) — the id has to be on hand
 * the instant the offer is recorded, well before the (or if the) vault write
 * actually lands, so the caller can hold it and pass it back to
 * `recordDeclined` if the offer is later left unaccepted.
 */
export interface ExplainBackOfferLogPort {
  /** Fires the `explain-back-offered` write; returns its event id synchronously. */
  recordOffered(input: ExplainBackOfferWriteInput): string;
  /**
   * Fires the paired `explain-back-declined` write. `manner` is always
   * `'not-taken'` here — F2.12's banner offers one action and simply clears
   * itself (`view.ts`'s `syncConfusionRoutingOffer` doc); there is no
   * dismiss control to produce `'dismissed'` from (F2.14a).
   */
  recordDeclined(input: ExplainBackOfferWriteInput & { readonly answers: string }): void;
}

/**
 * The real `ExplainBackOfferLogPort`: `olea-core`'s `appendExplainBackOfferRecord`
 * over a `VaultSource`, mirroring `createVaultReviewLogPort`/
 * `createVaultSuspendPort` above except for the fire-and-forget shape their
 * doc explains. A write failure is reported, never thrown into `render()` —
 * same "best-effort, log and move on" posture `main.ts`'s
 * `registryOverridesCache` load already takes for a background failure
 * nothing else can act on.
 */
export function createVaultExplainBackOfferLogPort(
  vault: VaultSource,
  deviceId: string,
): ExplainBackOfferLogPort {
  function report(error: unknown): void {
    console.error('Olea: could not record explain-back offer', error);
  }

  return {
    recordOffered(input) {
      const eventId = globalThis.crypto.randomUUID();
      void appendExplainBackOfferRecord(
        vault,
        {
          kind: 'explain-back-offered',
          timestamp: isoWithLocalOffset(new Date()),
          conceptIds: [...input.conceptIds],
          trigger: input.trigger,
          ...(input.instrumentId !== undefined ? { instrumentId: input.instrumentId } : {}),
        },
        { deviceId, generateEventId: () => eventId },
      ).catch(report);
      return eventId;
    },
    recordDeclined(input) {
      void appendExplainBackOfferRecord(
        vault,
        {
          kind: 'explain-back-declined',
          timestamp: isoWithLocalOffset(new Date()),
          conceptIds: [...input.conceptIds],
          trigger: input.trigger,
          ...(input.instrumentId !== undefined ? { instrumentId: input.instrumentId } : {}),
          answers: input.answers,
          manner: 'not-taken',
        },
        { deviceId },
      ).catch(report);
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
