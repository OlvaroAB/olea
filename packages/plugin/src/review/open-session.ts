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
 * **It does not decide what is offered.** `[SESS-8.4]` (`ol-egov.132.4`,
 * `docs/dev/one-assembly-path.md` — F4.6/F6.4's "one assembly path, not
 * two", `[D-033]` as amended by `[D-223]`): order and selection are the
 * study-session composer's, arriving settled through {@link
 * OpenReviewSessionInput.studySessionHolder} — this module runs no
 * `composeQueue` selection step of its own. What `buildReviewSession` still
 * does here is the KEPT half: the vault enumeration and its by-id records
 * (`instruments`, `recordsById`, `entries`, `candidates`, `replay`,
 * `suspended`) — an enumeration a plan join needs, not a composition (see
 * the design note §4). Due-state and suspension for an item the composer
 * chose are read off that kept enumeration by {@link
 * queueItemsFromComposedSession}, never recomputed here.
 *
 * ## `[SESS-8.4]`: she gets a composition, not a different one
 *
 * The held sitting is read when active; when {@link
 * OpenReviewSessionInput.studySessionHolder} is idle, this module calls
 * {@link OpenReviewSessionInput.composeDefaultStudySession} — the SAME
 * composer Home and the session builder call, with no steering and the
 * default budget (design note §3c) — exactly once, and enters the result
 * into the holder before reading it, so a second call this same open never
 * composes twice. `null` back from that port (the study plan is not
 * configured) is treated as a composition failure, the same `{ ok: false }`
 * posture an unreadable vault already gets — see "a failure is reported"
 * above.
 *
 * ## P5-T07 / `[SESS-8.3]`: the plan, when there is one
 *
 * The study-session composer never prioritises across courses by a plan
 * (see its own module doc). Ordering by a published study plan is
 * `olea-core`'s `executeStudyPlanOverComposedRows` (`[SESS-8.3]`,
 * `ol-egov.132.3`) — C5.5's "core executes it", and the composed-rows twin
 * of `executeStudyPlan` that adds no cross-course sort of its own (C5.7,
 * F6.4) — and this is the composition's only caller in production: every
 * composed session's rows are run through it, `plan` included or `null`. A
 * `null` plan is not a special case here; `execute.ts`'s own doc calls the
 * `executeStudyPlan` twin's null-plan result "the Phase A shape", and the
 * composed-rows entry produces the identical shape (rows' own order, an
 * explicit `(null, null, null)` selection context) through the same path
 * Phase B does, rather than a second branch that could drift from it.
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import type {
  AssessmentRecord,
  ComposedStudySession,
  ConceptRelation,
  ConfusionRoutingDecision,
  ConfusionRoutingInput,
  DistractorProvenance,
  QueueFilter,
  RandomSource,
  Scheduler,
  SittingScopeSnapshot,
  SittingStalenessInput,
  VaultInstrumentRecord,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  buildReviewSession,
  calendarDaysEndingOn,
  diffSittingScopeSnapshots,
  EMPTY_SITTING_SCOPE_SNAPSHOT,
  executeStudyPlanOverComposedRows,
  queueItemsFromComposedSession,
  readDistractorProvenance,
  replayedStateOf,
  replayUnconsumedSchedulingObservations,
  reviewLogPath,
} from 'olea-core';
import type { DraftAcceptPort } from '../generation/accept.js';
import type { DraftCacheStore } from '../generation/cache-store.js';
import { toDraftReviewQueueItem } from '../generation/review-adapter.js';
import { evaluateSchedulingObservationRouting } from '../grading/wiring.js';
import { createStampOnFirstSightPort } from '../instrument-stamping/port.js';
import type { StudySessionHolder } from '../session/holder.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import type { GradeContestPort } from './contest.js';
import type { ExplainWhyPort } from './explainWhy.js';
import { describeInterval } from './interval.js';
import type {
  Clock,
  EditPort,
  ExplainBackOfferLogPort,
  NoteExistsPort,
  ReviewLogPort,
  SuspendPort,
} from './ports.js';
import {
  adaptExecutedReviewQueue,
  buildSupportLevelHistoryLookup,
  createFrozenReviewQueue,
  type FrozenReviewQueue,
} from './queue-adapter.js';
import { ReviewSession } from './session.js';
import { createStrongRecallProposalReader } from './strong-recall-wiring.js';
import type { ReviewQueueItem } from './types.js';

/** The five side-effecting seams plus the clock, exactly as `ReviewSessionDeps` names them. */
export interface ReviewSessionPorts {
  readonly reviewLog: ReviewLogPort;
  readonly suspendPort: SuspendPort;
  readonly editPort: EditPort;
  readonly noteExists: NoteExistsPort;
  readonly clock: Clock;
  /** F3.3/`[D-097]`'s accept-at-first-presentation seam (`ol-p3t07a`, `ol-mfn0`). */
  readonly draftAcceptPort: DraftAcceptPort;
  /**
   * F2.7's on-demand explain-why port (`ol-sn1q`). Optional; absent means AI
   * features are "greyed" (F7.8, plan §7.1) — same posture
   * `ReviewSessionDeps.explainWhyPort` documents, threaded straight through.
   */
  readonly explainWhyPort?: ExplainWhyPort;
  /**
   * F2.12's confusion-routing decision (`ol-h2bx`). Optional; absent reads
   * as "never offer" — same posture `ReviewSessionDeps.evaluateConfusionRouting`
   * documents, threaded straight through.
   */
  readonly evaluateConfusionRouting?: (input: ConfusionRoutingInput) => ConfusionRoutingDecision;
  /**
   * `[D-046]` clause 4 / `[D-095]` (`ol-fgba` [DISP-1]): the grade the session
   * asserts about an answered MCQ carries the same contest gesture every other
   * claim carries. Optional; absent means the gesture is not drawn at all —
   * never drawn and inert. Threaded straight through, same posture as the two
   * ports above.
   */
  readonly gradeContestPort?: GradeContestPort;
  /**
   * The D7.1 write path for F2.12's explain-back offer and its paired
   * decline (`[D-178 / LOG-3]` item 2, `ol-0r92.28`). Optional; absent means
   * the offer still renders and simply writes nothing — same posture
   * `ReviewSessionDeps.explainBackOfferLog` documents, threaded straight
   * through. `ports.ts`'s `createVaultExplainBackOfferLogPort(vault,
   * deviceId)` is the real implementation; wiring it into this field is the
   * caller's job (`main.ts`, alongside `reviewLog`/`suspendPort` a few lines
   * above it), not this module's.
   */
  readonly explainBackOfferLog?: ExplainBackOfferLogPort;
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
  /**
   * `part-of` edges available at composition time (C7.9; `ol-v7r5.7`) —
   * forwarded straight to `buildReviewSession`'s `relations` input, which
   * runs `session/build.ts`'s containment co-presence filter over them.
   * Omitted means none, the same real no-op `buildReviewSession` itself
   * documents rather than a degraded mode this module invents.
   */
  readonly relations?: readonly ConceptRelation[];
  /**
   * F2.19 (`ol-vr8z`): assessment records, forwarded straight to
   * `buildReviewSession`'s `assessments` input, which resolves them (against
   * its own concept enumeration) into the `assessmentContext` map
   * `session/build.ts`'s containment-adjacent F2.19 grouping reads — the same
   * real no-op posture `relations` above documents when omitted. This module
   * has no settings store of its own to source the assignments-base path
   * `session-builder/provider.ts` reads assessments from (`ObsidianStudyPlanSettingsStore`
   * via `ObsidianDataHost`) — deliberately, per this file's own "Obsidian-free
   * on purpose" doc — so the caller (`main.ts`, which already holds that host)
   * is the one that resolves the array and hands it over, same shape as
   * `relations`.
   */
  readonly assessments?: readonly AssessmentRecord[];
  /**
   * C5.8's freeze seam (`ol-v7r5.35`, `[D-193]`): when supplied, the queue's
   * already-executed items route through this queue's `open`/`extend` verb
   * (per {@link OpenReviewSessionInput.frozenQueueMode}) instead of a bare,
   * always-recomposing `adaptExecutedReviewQueue` call — see
   * `queue-adapter.ts`'s `createFrozenReviewQueue`. Omitted (every test in
   * `open-session.spec.ts`, and the workbench) keeps today's per-call
   * recompose; only a caller that constructs ONE instance per opened tab
   * ({@link createReviewSessionOpener} below) and threads it through every
   * call for that tab actually holds a session still.
   */
  readonly frozenQueue?: FrozenReviewQueue;
  /** `'open'` (the default) or `'extend'` — which {@link frozenQueue} verb this call routes through. Ignored when `frozenQueue` is omitted. */
  readonly frozenQueueMode?: 'open' | 'extend';
  /**
   * `'open'`-mode-only: the frozen sitting's own material-change facts,
   * computed by the caller ({@link createReviewSessionOpener}) from data this
   * module has no way to remember between calls. See `queue-adapter.ts`'s
   * `OpenFrozenReviewQueueInput.staleness` doc.
   */
  readonly frozenQueueStaleness?: SittingStalenessInput;
  /**
   * `[SESS-8.4]` (`ol-egov.132.4`, `docs/dev/one-assembly-path.md` §3a/§3c):
   * the one plugin-wide `SittingState<ComposedStudySession>` holder — "Home,
   * the session builder, Today and the review tab all read that one
   * holder." When it already holds an active sitting (Start committed one,
   * or an earlier open of this tab composed one via {@link
   * composeDefaultStudySession} below), this module reads it verbatim and
   * runs no selection step of its own. `main.ts` constructs exactly one
   * instance for the whole plugin and passes it here unchanged.
   */
  readonly studySessionHolder: StudySessionHolder;
  /**
   * `[SESS-8.4]` (§3c): composes a fresh `ComposedStudySession` with no
   * course/topic/concept steering and C5.5's default budget — the SAME
   * assembly Home and the session builder use
   * (`session-builder/provider.ts`'s `composeStudySessionForRequest`),
   * reached through `main.ts`'s own port rather than a second, differently-
   * assembled call. Called ONLY when {@link studySessionHolder} is found
   * idle, and the result is entered into it before this module reads it —
   * "she gets a composition, not a different one." `null` means the study
   * plan is not configured yet (the same `'unavailable'` state Home and the
   * session builder already surface); this module treats that as a
   * composition failure, the same posture an unreadable vault already gets
   * (see the module doc).
   */
  readonly composeDefaultStudySession: () => Promise<ComposedStudySession | null>;
  /**
   * `[SESS-8.6]` (`ol-egov.132.6`, `[SESS-11]`'s own close notes): F2.17/
   * C5.8's "outrun the target" growth for the held composition. Called ONLY
   * when {@link studySessionHolder} holds an active sitting AND
   * {@link frozenQueueMode} is `'extend'` — the "Keep going" path
   * ({@link ReviewSessionOpener.extend}) — with the sitting's own
   * `ComposedStudySession` as `previous`. Composes a wider candidate list
   * through the SAME assembly {@link composeDefaultStudySession} uses
   * (`session-builder/provider.ts`'s `composeStudySessionForRequest`) and
   * calls `olea-core`'s `extendComposedStudySession(input, previous)` at a
   * wider `budgetMinutes` — see `main.ts`'s `extendDefaultStudySession` for
   * the wiring. `null` means the same "nothing to compose" condition
   * {@link composeDefaultStudySession} already reports (vault wiring not up,
   * or the study plan is not configured); this module then keeps the
   * sitting's existing items unchanged rather than treating it as a
   * failure — an outrun that finds nothing new is not an error, the same
   * posture `queue-adapter.ts`'s own `FrozenReviewQueue.extend` already
   * takes for "every candidate already present." Omitted entirely (every
   * test in `open-session.spec.ts` that does not exercise this path) keeps
   * today's behaviour: an active sitting's items never grow on `extend`.
   */
  readonly extendDefaultStudySession?: (
    previous: ComposedStudySession,
  ) => Promise<ComposedStudySession | null>;
}

export type OpenReviewSessionOutcome =
  | {
      readonly ok: true;
      readonly session: ReviewSession;
      /** What she will actually be shown, for a caller that wants to say so. */
      readonly itemCount: number;
      /**
       * The frozen-eligible portion of the session's queue — `scheduled`
       * below, BEFORE any pending drafts are prepended. {@link
       * createReviewSessionOpener} reads this to track what the freeze
       * already holds (`extend`'s diff base) and to build the next
       * material-arrival watermark. Never rendered directly by a view.
       */
      readonly scheduledQueue: readonly ReviewQueueItem[];
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

    // `[SESS-8.4]`: kept for its vault enumeration ONLY — `instruments`,
    // `recordsById`, `entries`, `candidates`, `replay`, `suspended`. Its own
    // `composed.queue` (`composeQueue`'s selection) is deliberately never
    // read below; row 6 (`ol-egov.132.6`) retires the call once nothing
    // production reads it anywhere. See the module doc.
    const composed = await buildReviewSession({
      vault: input.vault,
      scheduler: input.scheduler,
      now,
      reviewLog: { additionalPaths },
      ...(input.filter !== undefined ? { filter: input.filter } : {}),
      ...(input.relations !== undefined ? { relations: input.relations } : {}),
      ...(input.assessments !== undefined ? { assessments: input.assessments } : {}),
    });

    // `[SESS-8.4]` (design note §3a/§3c): she gets the ONE composition, not
    // a private selection step. Reads the held sitting when active; composes
    // once through the port when idle and enters the result before reading
    // it — see the module doc's "she gets a composition, not a different
    // one".
    const sitting = input.studySessionHolder.getSitting();
    let composedSession: ComposedStudySession;
    if (sitting.status === 'active') {
      // `[SESS-8.6]`: outrunning the target (`frozenQueueMode === 'extend'`,
      // the "Keep going" path) is the one case an active sitting's own items
      // may grow — never reorder, never drop, never duplicate, per C5.8 and
      // `extendComposedStudySession`'s own contract. Every other read of an
      // active sitting (a plain re-`open`, Home's preview, Today's render)
      // takes `sitting.items` verbatim, unchanged.
      const extended =
        input.frozenQueueMode === 'extend' && input.extendDefaultStudySession !== undefined
          ? await input.extendDefaultStudySession(sitting.items)
          : null;
      if (extended !== null) {
        composedSession = extended;
        // The freeze clock does not restart on an extension — `enteredAt`
        // still marks when she opened THIS sitting, the same discipline
        // `queue-adapter.ts`'s own `FrozenReviewQueue.extend` states for the
        // identical reason (C5.8's idle threshold measures from when she
        // opened, not when the list was last topped up).
        input.studySessionHolder.enter(sitting.enteredAt, composedSession);
      } else {
        composedSession = sitting.items;
      }
    } else {
      const fresh = await input.composeDefaultStudySession();
      if (fresh === null) {
        throw new Error(
          'openReviewSession: the study plan is not configured, so there is nothing for the study-session composer to build from',
        );
      }
      composedSession = fresh;
      input.studySessionHolder.enter(now, composedSession);
    }

    // `[SESS-8.4]`/`[SESS-8.3]`: the composer's own ordered rows, translated
    // into the plan join's input off the SAME kept enumeration above (no
    // second vault walk, no second replay), then executed — C5.5's "core
    // executes it", with no cross-course sort of its own (C5.7, F6.4). A
    // `null` plan is the Phase A shape, not a branch — see the module doc.
    const queueItems = queueItemsFromComposedSession({
      items: composedSession.model.items,
      recordsById: composed.recordsById,
      candidates: composed.candidates,
      now,
    });
    const executed = executeStudyPlanOverComposedRows({
      items: queueItems,
      plan: input.plan ?? null,
    });

    // `[D-220]`'s read side (`ol-yfyi`): one vault read per `mcq` instrument
    // in this enumeration, off the SAME `composed.instruments.records` this
    // module already has in hand — no second walk. Absent for every
    // instrument with no sidecar (nothing generated it, or it predates
    // D-220), which `queue-adapter.ts` reads as "no provenance" and never
    // fabricates.
    const distractorProvenanceById = await distractorProvenanceLookupFor(
      input.vault,
      composed.instruments.records,
    );

    const adapterInput = {
      items: executed.items,
      recordsById: composed.recordsById,
      supportHistory: buildSupportLevelHistoryLookup(composed.entries),
      distractorProvenanceById,
      ...(input.random !== undefined ? { random: input.random } : {}),
    };
    // `ol-v7r5.35` (`[D-193]`): a caller-supplied `frozenQueue` routes this
    // call through C5.8's freeze instead of a bare, always-recomposing
    // `adaptExecutedReviewQueue` — see `OpenReviewSessionInput.frozenQueue`'s
    // doc. Every existing caller (this suite, the workbench) omits it and
    // gets today's unfrozen behaviour, unchanged.
    const scheduled =
      input.frozenQueue === undefined
        ? adaptExecutedReviewQueue(adapterInput)
        : input.frozenQueueMode === 'extend'
          ? input.frozenQueue.extend(adapterInput)
          : input.frozenQueue.open({
              ...adapterInput,
              ...(input.frozenQueueStaleness !== undefined
                ? { staleness: input.frozenQueueStaleness }
                : {}),
            });

    // F5.3a / R7's third trigger (`ol-0r92.11`, `[D-083]`/`[D-087]`): read
    // once per opened session, off the SAME `composed.entries` this module
    // already reads for `buildSupportLevelHistoryLookup` above — no second
    // vault or log read. This is the composition site `grading/wiring.ts`'s
    // module doc names: `evaluateSchedulingObservationRouting` there is
    // per-call pure, but the `liveObservations` map it needs is per-vault,
    // so it is closed over HERE rather than threaded in from a caller the
    // way `ReviewSessionPorts.evaluateConfusionRouting` is — no `VaultSource`
    // exists at `main.ts`'s plugin-construction time to read it from there.
    // Never queue composition: this changes nothing about `scheduled`,
    // `queue`, `executed` or `composed` above — only whether `ReviewSession`
    // proposes the reciprocal offer once she reaches the neighbour concept.
    const liveSchedulingObservations = replayUnconsumedSchedulingObservations(composed.entries);

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
      ...(input.ports.explainWhyPort ? { explainWhyPort: input.ports.explainWhyPort } : {}),
      ...(input.ports.evaluateConfusionRouting
        ? { evaluateConfusionRouting: input.ports.evaluateConfusionRouting }
        : {}),
      ...(input.ports.gradeContestPort ? { gradeContestPort: input.ports.gradeContestPort } : {}),
      ...(input.ports.explainBackOfferLog
        ? { explainBackOfferLog: input.ports.explainBackOfferLog }
        : {}),
      // Always wired, unconditionally — unlike the caller-supplied ports
      // above, this is computed HERE (see `liveSchedulingObservations`
      // above) rather than threaded in through `ReviewSessionPorts`, so
      // there is no caller-omission case to guard with a conditional
      // spread: every real session this module opens gets a real evaluator.
      evaluateSchedulingObservationRouting: (routingInput) =>
        evaluateSchedulingObservationRouting({
          conceptIds: routingInput.conceptIds,
          liveObservations: liveSchedulingObservations,
        }),
      // `ol-2zfj.53`'s first-sight stamping trigger: closes over the SAME
      // `composed.recordsById` this module already built for
      // `adaptExecutedReviewQueue` above — no second vault walk just to make
      // stamping possible. Always wired, unconditionally, same posture as
      // `evaluateSchedulingObservationRouting` just above: this is not an AI
      // feature with an "un-greyed" gate, only a durability upgrade to an id
      // a real vault write already exists for.
      stampOnFirstSight: createStampOnFirstSightPort(input.vault, composed.recordsById),
      // F2.21's third trigger (`ol-v7r5.40`): closes over the SAME
      // `composed.entries` `buildSupportLevelHistoryLookup` and
      // `liveSchedulingObservations` above already read — no third log read,
      // and no vault walk. Always wired, unconditionally, same posture as
      // `evaluateSchedulingObservationRouting` above: the decision is pure
      // and synchronous, not an AI feature with an un-greying gate.
      //
      // Never queue composition (F2.21's own words): this changes nothing
      // about `queue`, `scheduled`, `executed` or `composed` — only whether
      // `ReviewSession` proposes an explain-back after a grade. The reader
      // itself replays the scheduler once, on the first grade, and folds one
      // concept at a time; see its module doc for the cost argument and for
      // why the review being written right now is deliberately not in
      // `entries`.
      evaluateStrongRecallProposal: createStrongRecallProposalReader({
        entries: composed.entries,
        scheduler: input.scheduler,
        now,
      }),
    });

    return {
      ok: true,
      session,
      itemCount: queue.length,
      scheduledQueue: scheduled,
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

/**
 * D-220's read side (`ol-yfyi`, discovered-from `ol-0r92.52`): one
 * `readDistractorProvenance` call per `mcq` instrument in the composed
 * enumeration, folded into the `instrumentId -> DistractorProvenance` map
 * `queue-adapter.ts`'s `distractorProvenanceById` expects.
 *
 * Vault I/O, so it happens here rather than inside `queue-adapter.ts`'s pure
 * sync functions — the same reason `supportHistory` above is built by this
 * module and only handed in. Every non-`mcq` record is skipped without a
 * read; an `mcq` record with no sidecar reads as `undefined` and is simply
 * omitted from the map, the same "absent, never fabricated" posture
 * `readDistractorProvenance` itself documents — never a second place that
 * decides what counts as missing.
 */
async function distractorProvenanceLookupFor(
  vault: VaultSource,
  records: readonly VaultInstrumentRecord[],
): Promise<ReadonlyMap<string, DistractorProvenance>> {
  const mcqIds = records
    .filter((record) => record.instrumentType === 'mcq')
    .map((record) => record.instrumentId);
  const entries = await Promise.all(
    mcqIds.map(async (id) => [id, await readDistractorProvenance(vault, id)] as const),
  );
  const byId = new Map<string, DistractorProvenance>();
  for (const [id, provenance] of entries) {
    if (provenance !== undefined) byId.set(id, provenance);
  }
  return byId;
}

// ---------------------------------------------------------------------------
// `ol-v7r5.35` (`[D-193]`) — the reachable wiring `queue-adapter.ts`'s own
// `createFrozenReviewQueue` doc names as owed here: ONE frozen queue per
// opened review tab, composing through its three verbs across the tab's own
// lifecycle. `main.ts` constructs one `ReviewSessionOpener` per leaf, inside
// its `registerView` factory; `view.ts` routes `onOpen` through `open`, the
// "Keep going" continue path through `extend`, and `onClose` through
// `close` — see each of those call sites for the wiring itself.
// ---------------------------------------------------------------------------

/** One opened review tab's frozen-queue lifecycle — see this section's module doc. */
export interface ReviewSessionOpener {
  /** `view.ts`'s `onOpen` — the tab's own `ReviewSessionProvider`. */
  readonly open: (input: OpenReviewSessionInput) => Promise<OpenReviewSessionOutcome>;
  /**
   * `view.ts`'s "Keep going" continue path (`ReviewView.continueSessionAfterComplete`):
   * composes a fresh candidate list under the SAME frozen sitting and
   * returns only what is genuinely new — never the whole merged list, which
   * is what `queue-adapter.ts`'s `FrozenReviewQueue.extend` itself returns.
   * A caller handing `FrozenReviewQueue.extend`'s raw return straight to
   * `ReviewSession.continueWith` would re-append everything the session
   * already holds; this diffs against what THIS opener already handed out
   * (`knownCount` below) so the caller never has to.
   */
  readonly extend: (input: OpenReviewSessionInput) => Promise<readonly ReviewQueueItem[]>;
  /** `view.ts`'s `onClose` — releases the freeze; the next `open` recomposes unconditionally. */
  readonly close: () => void;
}

export interface CreateReviewSessionOpenerDeps {
  /** Same posture as every other production `now` in this package (`session-builder/provider.ts`'s own `deps.now`): `() => new Date()`. Injected for deterministic tests. */
  readonly now: () => Date;
  /** Overridable for tests; production leaves it at `createFrozenReviewQueue`'s own default. */
  readonly idleThresholdMs?: number;
}

/** The frozen sitting's own material-arrival scope — see {@link buildReviewScopeSnapshot}. */
interface FrozenReviewScope {
  readonly vault: VaultSource;
  readonly notePaths: readonly VaultPath[];
}

/**
 * A `SittingScopeSnapshot` carrying only the material-arrival-watermark half
 * of `[D-162]`'s three facts — `dueConceptKeys`/`assessmentProximityBands`
 * stay at `EMPTY_SITTING_SCOPE_SNAPSHOT`'s empty values, since this module
 * has no obligation-classifier or assessment join of its own (those live in
 * `session-builder/provider.ts`, over a different candidate shape; wiring
 * them here is a follow-up, not this bead). Reuses `session-builder/
 * provider.ts`'s own `Math.min(vault.firstSeen(...))` reading rather than
 * inventing a second one, over the frozen scope's own note paths —
 * `firstSeen` absent (a host that cannot say) reads as "no arrival signal",
 * never a fabricated day, same as that module.
 */
async function buildReviewScopeSnapshot(scope: FrozenReviewScope): Promise<SittingScopeSnapshot> {
  const firstSeen = scope.vault.firstSeen?.bind(scope.vault);
  if (firstSeen === undefined) return EMPTY_SITTING_SCOPE_SNAPSHOT;

  const stats = await Promise.all(scope.notePaths.map((path) => firstSeen(path)));
  const known = stats.filter((ms): ms is number => ms !== null);
  if (known.length === 0) return EMPTY_SITTING_SCOPE_SNAPSHOT;

  return {
    ...EMPTY_SITTING_SCOPE_SNAPSHOT,
    materialArrivalWatermark: localToday(new Date(Math.min(...known))),
  };
}

/**
 * `main.ts` constructs ONE of these per opened review tab, inside its
 * `registerView` leaf factory — the same "one per surface across
 * renders/opens, not just per call" scope `ol-e228`'s acceptance criteria
 * already state for `createLocalSessionBuilderProvider`. Everything below is
 * held in THIS closure, never on the plugin instance, which is shared
 * across every open tab — the same "held per instance" scope
 * `createFrozenReviewQueue`'s own doc requires of it.
 */
export function createReviewSessionOpener(
  deps: CreateReviewSessionOpenerDeps,
): ReviewSessionOpener {
  const frozenQueue: FrozenReviewQueue = createFrozenReviewQueue({
    now: deps.now,
    ...(deps.idleThresholdMs !== undefined ? { idleThresholdMs: deps.idleThresholdMs } : {}),
  });
  // The frozen sitting's own material-arrival scope and its freeze-time
  // snapshot — `undefined` exactly when nothing has been composed yet (or
  // since the last `close()`). Refreshed after every successful `open`/
  // `extend`, over that call's OWN `scheduledQueue` — never a second,
  // independent vault walk.
  let scope: FrozenReviewScope | undefined;
  let snapshot: SittingScopeSnapshot | undefined;
  // How many of `scheduledQueue`'s items were already frozen as of the last
  // `open`/`extend` — `extend`'s own diff base, so ITS caller is handed only
  // what is genuinely new (see `ReviewSessionOpener.extend`'s own doc).
  let knownCount = 0;

  /** `undefined` exactly when there is nothing yet to compare against — an honest "nothing changed" the same way an omitted `staleness` already reads to `queue-adapter.ts`. */
  async function stalenessSinceLastCall(): Promise<SittingStalenessInput | undefined> {
    if (scope === undefined || snapshot === undefined) return undefined;
    const current = await buildReviewScopeSnapshot(scope);
    return diffSittingScopeSnapshots(snapshot, current);
  }

  async function rememberScope(
    scheduledQueue: readonly ReviewQueueItem[],
    vault: VaultSource,
  ): Promise<void> {
    const notePaths = [...new Set(scheduledQueue.map((item) => item.instrument.sourcePath))];
    scope = { vault, notePaths };
    snapshot = await buildReviewScopeSnapshot(scope);
  }

  return {
    async open(input) {
      const staleness = await stalenessSinceLastCall();
      const outcome = await openReviewSession({
        ...input,
        frozenQueue,
        frozenQueueMode: 'open',
        ...(staleness !== undefined ? { frozenQueueStaleness: staleness } : {}),
      });
      if (outcome.ok) {
        knownCount = outcome.scheduledQueue.length;
        await rememberScope(outcome.scheduledQueue, input.vault);
      }
      return outcome;
    },
    async extend(input) {
      const outcome = await openReviewSession({
        ...input,
        frozenQueue,
        frozenQueueMode: 'extend',
      });
      if (!outcome.ok) return [];
      const merged = outcome.scheduledQueue;
      const additions = merged.slice(knownCount);
      knownCount = merged.length;
      await rememberScope(merged, input.vault);
      return additions;
    },
    close() {
      frozenQueue.close();
      scope = undefined;
      snapshot = undefined;
      knownCount = 0;
    },
  };
}
