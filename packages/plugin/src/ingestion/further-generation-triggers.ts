/**
 * D-238/F3.7's THREE named further-call trigger signal sources, wired to
 * real state — GEN-3.5 (`ol-2zfj.136`).
 *
 * `packages/core/src/generation/triggers.ts`'s own module doc names exactly
 * this file's job as unbuilt follow-up work: "Wiring each real signal
 * source in is named, unbuilt follow-up work ... building it here would
 * mean this bead reaching into `plan/`, `review-log/`, `scheduler/` and
 * `mastery/`, none of which are its owned paths." Those four directories
 * (plus this plugin's `ingestion/`) ARE this bead's owned paths, and the
 * CANONICAL, tested signal-computing functions this file's logic mirrors
 * live there: `plan/generation-signals.ts#conceptEnteredTopBand`,
 * `review-log/generation-signals.ts#observedInstrumentTypeOrder`/
 * `requestedKindFor`, `scheduler/generation-signals.ts#deckServingSignal`.
 * **Mirrored, not imported** — none of the three is re-exported from
 * `olea-core`'s barrel (`index.ts`, not this bead's to edit either), for
 * the identical reason `generation/triggers.ts` itself is not (see "The
 * mirror" section below): these three files are new this bead, and adding
 * them to the barrel would be the same edit to the same locked file. Each
 * mirror below is a one-for-one restatement of its canonical counterpart,
 * cited by path; the canonical file is where the tests and the reasoning
 * live.
 *
 * ## Which three, and which one stays inactive (D-269)
 *
 * Per D-269 (`ol-2zfj.138`, David, 2026-09-25): top-band, format-ask and
 * deck-served-out-or-lapsed are wired to real state below. Nothing here
 * wires `repeatedRejectionTrigger` — `evaluateGenerationTriggers` (mirrored
 * below) requires a `threshold` on every call, so this file supplies
 * `Number.POSITIVE_INFINITY`, which makes the trigger structurally unable
 * to fire for ANY finite rejection count, now or ever, without that being a
 * threshold pick of its own (proved in this file's own spec: fuzzed
 * rejection counts up to a very large number never fire it). Replacing
 * `Number.POSITIVE_INFINITY` with any finite number is `ol-2zfj.138`'s own
 * decision to make, never this file's.
 *
 * ## The mirror, and why it exists (same reason as `generation-queue.ts`'s)
 *
 * `packages/core/src/generation/triggers.ts` is "deliberately NOT
 * re-exported from `index.ts`" (that module's own doc) — the barrel is not
 * this bead's owned path either (per this bead's brief: "NOT core
 * study-session/ or core index.ts (report)"), so
 * `evaluateGenerationTriggers` and its four named triggers cannot be
 * imported across the package boundary. `EVALUATE_GENERATION_TRIGGERS_MIRROR`
 * below is a faithful, minimal restatement of that module's logic — same
 * order (top-band, format-ask, deck-served-out-or-lapsed,
 * repeated-rejection), same dedup-by-`instrumentKind` rule ("the unit is the
 * call") — so this file can literally RUN the D-238 policy engine rather
 * than reimplement its judgment differently. **Follow-up filed** (this
 * bead's report, alongside `ol-2zfj.137` [GEN-3.6]'s own still-open
 * "delete the mirror once the barrel opens"): once `index.ts` exports
 * `generation/triggers.ts`, this mirror is deleted and this file imports
 * the real thing.
 *
 * ## Scope, honestly bounded
 *
 * Evaluated per COURSE, for every concept that course's own generation-
 * arrival deps already know how to list (`listConceptsForCourse` — the SAME
 * reading `enqueuePrimaryGenerationCallsForLandedUnits` uses), each time
 * that course's material lands (`enqueueFurtherGenerationCallsForLandedUnits`,
 * called from `wiring.ts` right alongside the primary-call sweep). D-238's
 * "each knowable a day ahead from the cached plan or the log" is satisfied
 * by reading the plan/log FRESH at evaluation time, never from a persisted
 * snapshot — but a course that lands no further material never gets
 * re-swept on its own. **Named follow-up** (this bead's report): a
 * time-based (not just arrival-based) re-sweep, once a caller exists that
 * ticks independently of ingestion.
 *
 * ## Spend stays at zero (D-261)
 *
 * This file only ENQUEUES (`enqueueTriggeredGenerationCall`,
 * `generation-queue.ts`) — it never calls, awaits, or references a model, a
 * Worker transport, or `IngestionWiringDeps.generation.draft`. The one seam
 * that turns an enqueued job into a paid call is `deps.generation.draft`,
 * reached only when a caller supplies `deps.generation` to
 * `buildIngestionRunner` at all — and `main.ts` (not this bead's file; the
 * production `buildIngestionRunner` call is
 * `packages/plugin/src/main.ts:1791`) does not supply it today, on purpose:
 * `ol-2zfj.135`'s own close evidence — "Production composition held by the
 * orchestrator: wiring it into main.ts would start arrival-triggered paid
 * generation calls under the Worker-configured gate while D-261 is open.
 * Filed `ol-2zfj.171`, blocked by D-261." So every job this file enqueues
 * sits in the queue, undrained into a real call, for exactly as long as
 * that gate holds — the same zero-spend state the arrival-triggered primary
 * call (this bead's sibling code) is already in.
 */

import type { ReviewLogEntry, StudyPlanCourse } from 'olea-contracts';
import {
  buildConceptInstrumentIndex,
  CONFUSION_ROUTING_LAPSE_THRESHOLD,
  type ConceptRecord,
  createFsrsScheduler,
  DEFAULT_COURSES_FOLDER,
  type ExtractedUnit,
  enumerateVaultInstruments,
  isRecallTier,
  type JobEnqueuer,
  loadCachedStudyPlan,
  readReviewLogHistory,
  replayedStateOf,
  replaySchedulerStates,
  type SchedulableInstrumentType,
  type SchedulerState,
  type StudyPlanStore,
  type VaultSource,
} from 'olea-core';
import { courseCodesForLandedUnits, enqueueTriggeredGenerationCall } from './generation-queue.js';

// -----------------------------------------------------------------------------
// The signal mirrors — see this file's module doc, "Mirrored, not imported".
// Each is a one-for-one restatement of its canonical counterpart; canonical
// source, tests and reasoning live at the cited path.
// -----------------------------------------------------------------------------

/** Mirrors `packages/core/src/plan/generation-signals.ts#GENERATION_TOP_BAND_DIVISOR`. */
const GENERATION_TOP_BAND_DIVISOR_MIRROR = 3;

/** Mirrors `packages/core/src/plan/generation-signals.ts#conceptEnteredTopBand`. */
function conceptEnteredTopBandMirror(course: StudyPlanCourse, conceptId: string): boolean {
  if (course.status !== 'ranked') return false;
  const entry = course.concepts.find((concept) => concept.conceptId === conceptId);
  if (entry === undefined) return false;
  const cutoff = Math.max(
    1,
    Math.ceil(course.concepts.length / GENERATION_TOP_BAND_DIVISOR_MIRROR),
  );
  return entry.rank <= cutoff;
}

/** Mirrors `packages/core/src/review-log/generation-signals.ts#observedInstrumentTypeOrder`. */
function observedInstrumentTypeOrderMirror(
  entries: readonly ReviewLogEntry[],
): readonly SchedulableInstrumentType[] {
  const listedOrder: readonly SchedulableInstrumentType[] = ['qa', 'cloze', 'mcq'];
  const counts = new Map<SchedulableInstrumentType, number>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (entry.instrumentType === 'explain-back') continue;
    counts.set(entry.instrumentType, (counts.get(entry.instrumentType) ?? 0) + 1);
  }
  return listedOrder
    .filter((kind) => (counts.get(kind) ?? 0) > 0)
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
}

/** Mirrors `packages/core/src/review-log/generation-signals.ts#requestedKindFor`. */
function requestedKindForMirror(
  formatMatch: SchedulableInstrumentType | null,
  recordedPreference: readonly SchedulableInstrumentType[],
): SchedulableInstrumentType | null {
  if (formatMatch !== null) return formatMatch;
  return recordedPreference[0] ?? null;
}

interface DeckServingSignalInputMirror {
  readonly deck: readonly {
    readonly instrumentType: SchedulableInstrumentType;
    readonly state: SchedulerState | null;
  }[];
}

/** Mirrors `packages/core/src/scheduler/generation-signals.ts#deckServingSignal` — `isRecallTier`/`CONFUSION_ROUTING_LAPSE_THRESHOLD` are the real, already-exported functions, not mirrored (only the fold combining them is). */
function deckServingSignalMirror(input: DeckServingSignalInputMirror): {
  readonly deckServedOut: boolean;
  readonly lapsed: boolean;
} {
  const deckServedOut = input.deck.length > 0 && input.deck.every((item) => item.state !== null);
  const lapsed = input.deck.some(
    (item) =>
      isRecallTier(item.instrumentType) &&
      item.state !== null &&
      item.state.lapses >= CONFUSION_ROUTING_LAPSE_THRESHOLD,
  );
  return { deckServedOut, lapsed };
}

// -----------------------------------------------------------------------------
// The mirror — see this file's module doc, "The mirror, and why it exists".
// Faithful restatement of `packages/core/src/generation/triggers.ts`, not a
// re-derivation: every branch below matches that file's own, one for one.
// -----------------------------------------------------------------------------

/** Mirrors `generation/triggers.ts`'s `GenerationTriggerKind` — the four further-call names plus `'arrival'`, never a fifth. */
type GenerationTriggerKindMirror =
  | 'arrival'
  | 'top-band'
  | 'format-ask'
  | 'deck-served-out-or-lapsed'
  | 'repeated-rejection';

/** Mirrors `generation/types.ts`'s `GenerationTrigger`. */
interface GenerationTriggerMirror {
  readonly kind: GenerationTriggerKindMirror;
  readonly instrumentKind: SchedulableInstrumentType;
}

interface OtherKindInputMirror {
  readonly builtKinds: readonly SchedulableInstrumentType[];
  readonly preferredOrder: readonly SchedulableInstrumentType[];
}

/** Mirrors `generation/triggers.ts#otherKindToDraft`. */
function otherKindToDraftMirror(input: OtherKindInputMirror): SchedulableInstrumentType | null {
  for (const kind of input.preferredOrder) {
    if (!input.builtKinds.includes(kind)) return kind;
  }
  return null;
}

interface GenerationTriggerSignalsMirror {
  readonly topBand: { readonly enteredTopBand: boolean; readonly other: OtherKindInputMirror };
  readonly formatAsk: {
    readonly requestedKind: SchedulableInstrumentType | null;
    readonly builtKinds: readonly SchedulableInstrumentType[];
  };
  readonly deckServedOutOrLapsed: {
    readonly deckServedOut: boolean;
    readonly lapsed: boolean;
    readonly other: OtherKindInputMirror;
  };
  readonly repeatedRejection: {
    readonly rejectionCount: number;
    readonly threshold: number;
    readonly other: OtherKindInputMirror;
  };
}

/** Mirrors `generation/triggers.ts#evaluateGenerationTriggers` — same order, same dedup-by-`instrumentKind` rule. */
function evaluateGenerationTriggersMirror(
  signals: GenerationTriggerSignalsMirror,
): readonly GenerationTriggerMirror[] {
  const candidates: (GenerationTriggerMirror | null)[] = [
    // top-band
    (() => {
      if (!signals.topBand.enteredTopBand) return null;
      const instrumentKind = otherKindToDraftMirror(signals.topBand.other);
      return instrumentKind === null ? null : { kind: 'top-band' as const, instrumentKind };
    })(),
    // format-ask
    (() => {
      const { requestedKind, builtKinds } = signals.formatAsk;
      if (requestedKind === null) return null;
      if (builtKinds.includes(requestedKind)) return null;
      return { kind: 'format-ask' as const, instrumentKind: requestedKind };
    })(),
    // deck-served-out-or-lapsed
    (() => {
      if (!signals.deckServedOutOrLapsed.deckServedOut && !signals.deckServedOutOrLapsed.lapsed) {
        return null;
      }
      const instrumentKind = otherKindToDraftMirror(signals.deckServedOutOrLapsed.other);
      return instrumentKind === null
        ? null
        : { kind: 'deck-served-out-or-lapsed' as const, instrumentKind };
    })(),
    // repeated-rejection — see module doc: never fires while D-269 stays open.
    (() => {
      if (signals.repeatedRejection.rejectionCount < signals.repeatedRejection.threshold) {
        return null;
      }
      const instrumentKind = otherKindToDraftMirror(signals.repeatedRejection.other);
      return instrumentKind === null
        ? null
        : { kind: 'repeated-rejection' as const, instrumentKind };
    })(),
  ];
  const seen = new Set<SchedulableInstrumentType>();
  const fired: GenerationTriggerMirror[] = [];
  for (const candidate of candidates) {
    if (candidate === null) continue;
    if (seen.has(candidate.instrumentKind)) continue;
    seen.add(candidate.instrumentKind);
    fired.push(candidate);
  }
  return fired;
}

/**
 * D-269's inert value for `repeatedRejectionTrigger`'s required `threshold`
 * — see module doc. Exported only for this file's own spec to assert
 * against by name rather than a bare literal.
 */
export const REPEATED_REJECTION_THRESHOLD_INACTIVE = Number.POSITIVE_INFINITY;

/**
 * D-238's preferred order for "the other kind" when nothing has told us
 * which she wants next: her own observed order first (D7.1), then F2.14's
 * declared listed order (`'qa'` first) for any kind never yet observed.
 * Declared, not derived — it only decides WHICH remaining kind a further
 * call offers next, never WHETHER one fires, so it carries none of D-269's
 * Class C weight.
 */
function preferredOrderFor(
  recordedPreference: readonly SchedulableInstrumentType[],
): readonly SchedulableInstrumentType[] {
  const listed: readonly SchedulableInstrumentType[] = ['qa', 'cloze', 'mcq'];
  return [...recordedPreference, ...listed.filter((kind) => !recordedPreference.includes(kind))];
}

// -----------------------------------------------------------------------------
// The real composition — reads real vault/plan/log state, never a constant.
// -----------------------------------------------------------------------------

export interface FurtherGenerationTriggerDeps {
  readonly vault: VaultSource;
  /** A2.5's cached plan (`plan/cache.ts#loadCachedStudyPlan`) — the top-band signal's source. Absent/expired/unreadable reads as "no plan", never a guessed top band (matches `loadCachedStudyPlan`'s own `plan: null` states). */
  readonly studyPlanStore: StudyPlanStore;
  readonly enqueuer: JobEnqueuer;
  readonly coursesFolder?: string;
  /** Same seam `GenerationArrivalDeps.listConceptsForCourse` already uses — every concept known for the course, not only newly-landed ones (see module doc, "Scope, honestly bounded"). */
  readonly listConceptsForCourse: (courseCode: string) => Promise<readonly ConceptRecord[]>;
  /** F4.8, opt-in — same shape as `GenerationArrivalDeps.formatMatchFor`. No production implementation exists yet for either caller (named follow-up, this bead's report): absent means no known format for every course, matching that field's own precedent. */
  readonly formatMatchFor?: (courseCode: string) => SchedulableInstrumentType | undefined;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now?: () => Date;
}

/**
 * Evaluates and enqueues every further-call trigger currently firing for
 * every concept `deps.listConceptsForCourse(courseCode)` names.
 *
 * Reads, per course (once, shared across every concept in it): the cached
 * plan's ranking (top-band), the WHOLE vault's review-log history and its
 * FSRS replay (deck-served-out-or-lapsed, and the format-ask trigger's D7.1
 * half — see `review-log/generation-signals.ts`'s module doc for why the
 * observed order is vault-wide rather than course-scoped), and this
 * course's own vault-instrument enumeration (which kinds are already
 * built, per concept).
 *
 * Never throws — an enqueue failure for one concept is logged and skipped,
 * matching `enqueuePrimaryGenerationCallsForLandedUnits`'s own posture.
 */
export async function enqueueFurtherGenerationCallsForCourse(
  courseCode: string,
  deps: FurtherGenerationTriggerDeps,
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;

  const { plan } = await loadCachedStudyPlan(deps.studyPlanStore, now);
  const course: StudyPlanCourse | null =
    plan?.body.courses.find((entry) => entry.course === courseCode) ?? null;

  const { entries } = await readReviewLogHistory(deps.vault);
  const recordedPreference = observedInstrumentTypeOrderMirror(entries);
  const preferredOrder = preferredOrderFor(recordedPreference);
  const replayResult = replaySchedulerStates(entries, createFsrsScheduler());
  const formatMatch = deps.formatMatchFor?.(courseCode) ?? null;
  const requestedKind = requestedKindForMirror(formatMatch, recordedPreference);

  let concepts: readonly ConceptRecord[];
  try {
    concepts = await deps.listConceptsForCourse(courseCode);
  } catch (error) {
    console.error('Olea: could not list concepts for a further-generation-trigger sweep', error);
    return;
  }

  const { records: instrumentRecords } = await enumerateVaultInstruments(deps.vault, {
    under: `${coursesFolder}/${courseCode}`,
  });
  const instrumentIndex = buildConceptInstrumentIndex(instrumentRecords);

  for (const concept of concepts) {
    if (!concept.courses.includes(courseCode)) continue;
    try {
      // `[ol-63e1]`: `VaultInstrumentRecord.conceptIds` (and this index) are
      // keyed by the concept's opaque `key`, not its display name — the
      // same key `plan/build.ts` writes into `PlannedConcept.conceptId`
      // (`entry.conceptKey`), despite that field's own doc still describing
      // it as "the verbatim display name" (stale; not this bead's to fix).
      const deck = instrumentIndex.instrumentsFor(concept.key);
      const builtKinds = [...new Set(deck.map((record) => record.instrumentType))];
      const other: OtherKindInputMirror = { builtKinds, preferredOrder };

      const deckWithStates = deck.map((record) => ({
        instrumentType: record.instrumentType,
        state: replayedStateOf(replayResult, record.instrumentId),
      }));
      const { deckServedOut, lapsed } = deckServingSignalMirror({ deck: deckWithStates });
      const enteredTopBand = course !== null && conceptEnteredTopBandMirror(course, concept.key);

      const fired = evaluateGenerationTriggersMirror({
        topBand: { enteredTopBand, other },
        formatAsk: { requestedKind, builtKinds },
        deckServedOutOrLapsed: { deckServedOut, lapsed, other },
        // D-269: inactive — see module doc. Real state (a genuine rejection
        // count) is never read for this signal while it stays structurally
        // unable to fire; there is nothing for a real count to decide yet.
        repeatedRejection: {
          rejectionCount: 0,
          threshold: REPEATED_REJECTION_THRESHOLD_INACTIVE,
          other,
        },
      });

      for (const trigger of fired) {
        await enqueueTriggeredGenerationCall(deps.enqueuer, {
          courseCode,
          conceptKey: concept.key,
          conceptName: concept.name,
          instrumentKind: trigger.instrumentKind,
          trigger: trigger.kind,
        });
      }
    } catch (error) {
      console.error('Olea: could not enqueue a further generation call', error);
    }
  }
}

/**
 * The arrival-tick entry point: every distinct course among `units` (the
 * SAME courses `enqueuePrimaryGenerationCallsForLandedUnits` just swept)
 * gets one further-call trigger sweep over every concept it lists — see
 * this file's module doc, "Scope, honestly bounded".
 */
export async function enqueueFurtherGenerationCallsForLandedUnits(
  units: readonly ExtractedUnit[],
  deps: FurtherGenerationTriggerDeps,
): Promise<void> {
  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const courseCodes = courseCodesForLandedUnits(units, coursesFolder);
  for (const courseCode of courseCodes) {
    await enqueueFurtherGenerationCallsForCourse(courseCode, deps);
  }
}
