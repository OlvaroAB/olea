/**
 * From a vault to a `ReviewSession` the view can render (F2.2, F2.5, F2.14,
 * F2.17, C5.2, D7.1).
 *
 * This is the join `view.ts` was missing. `ReviewView` has been a complete,
 * working `ItemView` since P2-T08 — seven screens, a real keymap, real ports —
 * and `main.ts` never registered it, never constructed it, and answered "Olea:
 * Start today's review" with a Notice saying the feature was not built. Every
 * piece it needed existed: `olea-core`'s `buildReviewSession` composes the
 * queue, `queue-adapter.ts` turns it into what the view renders, and
 * `obsidian-ports.ts`/`ports.ts` hold the real ports. Nothing joined them.
 *
 * **Obsidian-free on purpose.** `main.ts` and `view.ts` cannot be unit-tested —
 * `obsidian` has no runtime outside a real host — so the composition itself
 * lives here, where `open-session.spec.ts` drives it against an in-memory
 * `VaultSource` and real core. What is left in `main.ts` is workspace glue
 * (which leaf, which tab) and nothing that can be wrong about *what she is
 * shown*. Same split as `today/data-source.ts` vs `today/view.ts`.
 *
 * ## Three decisions this module makes, and one it refuses to
 *
 * **One clock for composition and for the session.** `now` is read once from
 * the injected `Clock` and used both as `buildReviewSession`'s instant and,
 * through the same port, by the running session. A queue composed at one
 * instant and rated against another is a queue that can offer an item its own
 * interval preview then disagrees with.
 *
 * **A failure is reported, not rendered as an empty queue.** If the walk throws,
 * this returns `{ ok: false }` rather than a session over zero items. The
 * difference is the whole point: an empty session renders *"You're caught up."*,
 * which is a claim, and a vault that could not be read supports no claim at all.
 * `today/panel.ts` draws the identical line between `null` and a computed zero,
 * for the identical reason.
 *
 * **An empty queue still opens.** `{ ok: true }` with nothing in it is the
 * normal, correct case for a caught-up morning, and `ReviewSession` already has
 * an `empty` phase for it. Refusing to open would make "nothing is due" and
 * "the command is broken" the same experience.
 *
 * **It does not decide what is offered.** Order, dedupe, filter, due-state and
 * suspension are all `composeQueue`'s, arriving settled — the same refusal
 * `queue-adapter.ts` states for itself.
 *
 * ## P5-T07: the plan, when there is one
 *
 * `composeQueue` never prioritises (see its own module doc). Ordering by a
 * published study plan is `olea-core`'s `executeStudyPlan` — C5.5's "core
 * executes it" — and this is the composition's only caller in production:
 * every composed queue is run through it, `plan` included or `null`. A
 * `null` plan is not a special case here; `executeStudyPlan`'s own doc calls
 * it "the Phase A shape", meaning the executed result is byte-for-byte the
 * queue's own order and its own (null, null, null) selection context. So
 * this function always executes, and Phase A is what "no plan cached yet"
 * produces through the same path Phase B does, rather than a second
 * branch that could drift from it.
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import type { QueueFilter, RandomSource, Scheduler, VaultPath, VaultSource } from 'olea-core';
import {
  buildReviewSession,
  calendarDaysEndingOn,
  executeStudyPlan,
  replayedStateOf,
  reviewLogPath,
} from 'olea-core';
import type { DraftAcceptPort } from '../generation/accept.js';
import type { DraftCacheStore } from '../generation/cache-store.js';
import { toDraftReviewQueueItem } from '../generation/review-adapter.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import { describeInterval } from './interval.js';
import type { Clock, EditPort, NoteExistsPort, ReviewLogPort, SuspendPort } from './ports.js';
import { adaptExecutedReviewQueue } from './queue-adapter.js';
import { ReviewSession } from './session.js';

/** The five side-effecting seams plus the clock, exactly as `ReviewSessionDeps` names them. */
export interface ReviewSessionPorts {
  readonly reviewLog: ReviewLogPort;
  readonly suspendPort: SuspendPort;
  readonly editPort: EditPort;
  readonly noteExists: NoteExistsPort;
  readonly clock: Clock;
  /** F3.3/`[D-097]`'s accept-at-first-presentation seam (`ol-p3t07a`, `ol-mfn0`). */
  readonly draftAcceptPort: DraftAcceptPort;
}

export interface OpenReviewSessionInput {
  readonly vault: VaultSource;
  readonly scheduler: Scheduler;
  /** Names this device's own log files for the probe below (C5.2). */
  readonly deviceId: string;
  readonly ports: ReviewSessionPorts;
  /** F2.5. Omitted means no filter — the whole due set. */
  readonly filter?: QueueFilter;
  /** Injected for deterministic MCQ sampling under test; production takes `Math.random`. */
  readonly random?: RandomSource;
  /** Overridable for tests. Defaults to the same window the Today panel probes. */
  readonly probeDays?: number;
  /**
   * The cached study plan, or `null`/omitted when there is none (F2.8's Phase
   * A: never configured, never refreshed successfully, or C5.5's plan simply
   * has not published for this vault yet). Always run through
   * `executeStudyPlan` — see the module doc for why `null` is not a special
   * case here.
   */
  readonly plan?: StudyPlanEnvelope | null;
  /**
   * F3.3/`[D-097]`'s "new" badge (`ol-p3t07a`): every `status: 'pending'`
   * record is read fresh and merged into today's queue, ahead of the
   * ordinarily-scheduled items. Omitted means no drafts are offered — a
   * caller with no generation pipeline wired (a test, the workbench) gets
   * exactly the queue `buildReviewSession` composed, unchanged.
   */
  readonly draftCache?: DraftCacheStore;
}

export type OpenReviewSessionOutcome =
  | {
      readonly ok: true;
      readonly session: ReviewSession;
      /** What she will actually be shown, for a caller that wants to say so. */
      readonly itemCount: number;
      /** F2.17's deferrals — a second instrument on a concept already represented. */
      readonly deferredCount: number;
    }
  | { readonly ok: false; readonly error: unknown };

/**
 * "today" / "tomorrow" / "in 6 days" for the empty screen's *next* item.
 *
 * **Whole local calendar days, not elapsed hours.** An item due at 18:00 when
 * it is 14:00 is due *today*, and an hours-based rounding would call it
 * tomorrow. Her day is a fact about the device she is sitting at (the same
 * reasoning `today/data-source.ts`'s `endOfLocalDay` gives), so both instants
 * are collapsed to local midnight before the difference is taken.
 *
 * This is the one forward-looking sentence in the review view, and it is safe
 * in exactly the state it appears in: the queue is empty, so there is nothing
 * she can rate that would move the date while she is reading it. Compare the
 * design-mock line §8.2 rejected, which named a specific future weekday as the
 * next scheduled point: that was both a completeness claim over the whole deck
 * and falsified by the next rating. This names one instant already on record
 * and claims nothing about what else exists.
 */
export function nextDueLabel(now: Date, nextDue: Date | null): string | null {
  if (nextDue === null) return null;
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(nextDue) - midnight(now)) / 86_400_000);
  return describeInterval(days);
}

/**
 * Compose today's session over a real vault.
 *
 * Never throws: every failure mode of the walk, the log read and the replay
 * comes back as `{ ok: false }` carrying the original error, so the caller
 * decides what to say rather than an exception escaping into a view's
 * `onOpen`.
 */
export async function openReviewSession(
  input: OpenReviewSessionInput,
): Promise<OpenReviewSessionOutcome> {
  const now = input.ports.clock.now();

  try {
    // `.olea/reviews/` is dot-prefixed, and Obsidian's `vault.getFiles()` does
    // not return dot-prefixed trees — so a listing-blind host finds this
    // device's own log only by exact path. The window is the Today panel's
    // constant rather than a second number: the panel counting one set and the
    // queue offering another is the failure F6.1's `@manual` scenario ("the
    // count she reads is the session she gets") exists to catch.
    const probeDays = input.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
    const additionalPaths: readonly VaultPath[] = calendarDaysEndingOn(
      localToday(now),
      probeDays,
    ).map((day) => reviewLogPath(day, input.deviceId));

    const composed = await buildReviewSession({
      vault: input.vault,
      scheduler: input.scheduler,
      now,
      reviewLog: { additionalPaths },
      ...(input.filter !== undefined ? { filter: input.filter } : {}),
    });

    // C5.5: "the Worker supplies the policy … core executes it". A `null`
    // plan is the Phase A shape, not a branch — see the module doc.
    const executed = executeStudyPlan({ queue: composed.queue, plan: input.plan ?? null });

    const scheduled = adaptExecutedReviewQueue({
      items: executed.items,
      recordsById: composed.recordsById,
      ...(input.random !== undefined ? { random: input.random } : {}),
    });

    // F3.3/`[D-097]`'s new-badge merge (`ol-p3t07a`): every still-pending
    // draft, read fresh, ahead of the ordinarily-scheduled items — see
    // `OpenReviewSessionInput.draftCache`'s doc. `[]` when no cache is
    // wired, so this is a pure addition and never removes or reorders
    // anything `composeQueue`/`executeStudyPlan` decided.
    const pendingDrafts = input.draftCache ? await input.draftCache.listPending() : [];
    const draftItems = pendingDrafts.map((record) => toDraftReviewQueueItem(record, input.random));
    const queue = [...draftItems, ...scheduled];

    const session = new ReviewSession({
      queue,
      scheduler: input.scheduler,
      reviewLog: input.ports.reviewLog,
      suspendPort: input.ports.suspendPort,
      editPort: input.ports.editPort,
      noteExists: input.ports.noteExists,
      clock: input.ports.clock,
      draftAcceptPort: input.ports.draftAcceptPort,
      nextDueLabel: nextDueLabel(now, earliestFutureDue(composed, now)),
    });

    return {
      ok: true,
      session,
      itemCount: queue.length,
      deferredCount: executed.deferred.length,
    };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * The soonest instant any enumerated, unsuspended instrument comes due after
 * `now`, or `null` when none does.
 *
 * Read off the *replayed* state, which is the only record of a due instant
 * there is (plan §7.1: scheduling state is a projection of the log, never
 * stored). A never-reviewed instrument has no state and is due immediately, so
 * it is never "later" and never wins this comparison — if one existed the queue
 * would have offered it and the empty screen would not be showing.
 */
function earliestFutureDue(
  composed: Awaited<ReturnType<typeof buildReviewSession>>,
  now: Date,
): Date | null {
  let earliest: number | null = null;
  for (const record of composed.instruments.records) {
    if (composed.suspended.has(record.instrumentId)) continue;
    const state = replayedStateOf(composed.replay, record.instrumentId);
    if (state === null) continue;
    const due = Date.parse(state.due);
    if (Number.isNaN(due) || due <= now.getTime()) continue;
    if (earliest === null || due < earliest) earliest = due;
  }
  return earliest === null ? null : new Date(earliest);
}
