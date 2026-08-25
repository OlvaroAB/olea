/**
 * The generator: personas in, contracts-valid D7.1 streams out.
 *
 * ## Physical consistency is the requirement, not realism-as-decoration
 *
 * The intervals in these streams are not sampled from a plausible-looking
 * distribution. They are produced by **the product's own scheduler** —
 * `createFsrsScheduler()` from `olea-core`, the same instance the plugin uses —
 * fed the rating this persona just produced at the instant she produced it. The
 * generator holds the resulting `SchedulerState` per instrument and consults it
 * to decide what is even *available* to review the next day.
 *
 * That has one consequence worth stating in full, because it is the whole
 * argument for building this instead of a random-JSONL script: **`dueState` is
 * derived, never assigned.** The generator does not decide "this one will be
 * overdue"; it compares the day the session is happening against the due date
 * FSRS actually produced, and writes down what it finds. A stream whose
 * intervals contradict the scheduler is not a harder test, it is a different
 * and useless one — a detector that only fires on physically impossible input
 * has not been tested at all. `test/fsrs-coherence.spec.ts` re-derives every
 * record's `dueState` by replaying the stream through a fresh scheduler, which
 * is a check this module cannot pass by agreeing with itself.
 *
 * The personas earn their patterns *within* that constraint: a crammer pulls
 * items early (legal, and FSRS handles it), a skipper leaves cards to go
 * overdue (legal, and it is why the skip stays visible in
 * `instrumentTypesOffered` day after day), a returner comes back to a pile of
 * genuinely-overdue work. Not one of them contradicts the scheduler; see this
 * bead's report for the one place a persona and FSRS did pull against each
 * other.
 *
 * ## What is emitted
 *
 * Review records (`kind: 'review'`) and suspend/unsuspend records
 * (`kind: 'suspend' | 'unsuspend'`) in D-020's frozen shape, interleaved in one
 * chronological stream exactly as they would be in one day's vault file.
 * `planVersion` is `null` everywhere (pre-P5, C7.6) and `yieldRank` is `null`
 * everywhere (Phase A, pre-F2.8) — recorded as explicit nulls rather than
 * omitted, which is the property that makes a Phase A baseline and a Phase B
 * comparison the same shape.
 */

import type {
  InstrumentType,
  MasteryAtTime,
  MasteryState,
  Rating,
  ReviewLogEntry,
  ReviewLogRecord,
  SelectionContext,
  SelectionContextV4,
  SuspendLogRecord,
} from 'olea-contracts';
import type { SchedulerState } from 'olea-core';
import { createFsrsScheduler, mapMcqRating } from 'olea-core';
import type { Behaviour, PersonaId } from './personas.js';
import { PERSONAS } from './personas.js';
import { buildProvenance, type SyntheticProvenance, syntheticEventId } from './provenance.js';
import { Rng } from './rng.js';
import {
  addDays,
  daysBetweenDates,
  isoWithOffset,
  localDate,
  localMidnightUtcMs,
  parseUtcOffset,
} from './time.js';
import type { ScheduledType, SyntheticInstrument } from './vocabulary.js';
import { CARD_TYPES, conceptById, INSTRUMENTS } from './vocabulary.js';

/**
 * Concept-mastery bands over FSRS stability, in days.
 *
 * **`synthetic-provisional` (N-015).** C5.4's mastery rollup does not exist
 * yet, so this generator needs *some* rule to put a plausible `masteryAtTime`
 * on each record, and these boundaries were chosen to exercise all four of
 * F2.11's ratified stages (D-049; `VOC-1`/`ol-7efk`) across a 90-day stream.
 * They are a property of the fiction, not a finding about learning, and
 * nothing may calibrate against them: when the real rollup lands, this
 * constant is replaced by a call into it, and if anyone has meanwhile
 * derived a number from these bands, that number is measuring our own
 * assumptions.
 *
 * **Re-bucketed for the four-stage vocabulary.** The retired five-state
 * ordinal's `shaky` (< 4 days) and `coming` (< 12 days) bands merge into
 * `sprout`'s single band (< 12 days) — the ratified vocabulary has one word
 * for "practised, not holding yet" where the fiction previously drew two.
 * `seed`'s and `sapling`'s boundaries (1 and 45 days) are unchanged.
 *
 * Under review-log v4 (`ol-g6zg`) the value is recorded **per concept** rather
 * than as one number on the record. A synthetic instrument is evidence for
 * exactly one concept by construction, so the map this generator writes always
 * has a single entry — and the marking is unchanged by the move: a provisional
 * value in a new shape is still a provisional value.
 */
export const MASTERY_STABILITY_BANDS: readonly {
  readonly belowStabilityDays: number;
  readonly state: MasteryState;
}[] = [
  { belowStabilityDays: 1, state: 'seed' },
  { belowStabilityDays: 12, state: 'sprout' },
  { belowStabilityDays: 45, state: 'sapling' },
];

/** Above every band. */
const TOP_MASTERY: MasteryState = 'tree';

/** Per-instrument-type scaling of answer duration. MCQs are quick; recall is not. */
const DURATION_SCALE: Readonly<Record<InstrumentType, number>> = {
  mcq: 0.55,
  cloze: 0.9,
  qa: 1,
  'explain-back': 4,
};

export interface StreamSpec {
  readonly persona: PersonaId;
  readonly seed: string;
  /** First local calendar day of the stream, `YYYY-MM-DD`. */
  readonly startDate: string;
  /** Number of local days simulated, starting at `startDate`. */
  readonly days: number;
  /** Valid per `olea-core`'s `isValidDeviceId`; becomes part of the log file name. */
  readonly deviceId: string;
  /** The persona's UTC offset, `±HH:MM`. Every timestamp carries it (D7.1). */
  readonly utcOffset: string;
  /** Day offsets from `startDate` on which an assessment falls — what `examProximity` measures to, and what a crammer crams for. */
  readonly assessmentDayOffsets: readonly number[];
  /**
   * Behaviour overrides layered on the persona's own.
   *
   * This is the seam SYN-2 needs: a planted-effect pair is two specs from one
   * seed differing by exactly one entry here, and a null pair is one spec under
   * two seeds. See `./pairs.ts`.
   */
  readonly behaviour?: Partial<Behaviour>;
}

/** Defaults for everything but persona and seed. A semester-ish stream with two assessments. */
export const SPEC_DEFAULTS = {
  startDate: '2027-02-01',
  days: 90,
  deviceId: 'syn-laptop',
  utcOffset: '+01:00',
  assessmentDayOffsets: [42, 84] as readonly number[],
} as const;

export function streamSpec(
  persona: PersonaId,
  seed: string,
  overrides: Partial<Omit<StreamSpec, 'persona' | 'seed'>> = {},
): StreamSpec {
  return { ...SPEC_DEFAULTS, persona, seed, ...overrides };
}

/**
 * What the generator says it planted, in the vocabulary the tests measure in.
 *
 * Deliberately *not* a copy of `Behaviour`: a test comparing a measurement of
 * the stream against the knob that produced it proves only that the knob was
 * read. These are claims about the emitted stream — "sessions happened on these
 * dates", "these instruments were suspended" — that the generator has to
 * actually deliver on.
 */
export interface DeclaredGroundTruth {
  readonly persona: PersonaId;
  readonly description: string;
  /** Every local date the generator ran a session on. */
  readonly sessionDates: readonly string[];
  /** Session dates classified as pre-assessment cram bursts. Empty when the persona does not cram. */
  readonly burstDates: readonly string[];
  /** Dates deliberately skipped by a planned absence. Empty when there is none. */
  readonly blackoutDates: readonly string[];
  /** Local dates of the assessments the stream was built around. */
  readonly assessmentDates: readonly string[];
  /** Course ids the persona is failing (success rate below her default). */
  readonly strugglingCourseIds: readonly string[];
  /** Instrument ids suspended at least once (F2.6). */
  readonly suspendedInstrumentIds: readonly string[];
  /** Instrument ids unsuspended at least once (D-020: a second event, not a retraction). */
  readonly unsuspendedInstrumentIds: readonly string[];
  /** Concept ids routed to explain-back at least once (F2.12). */
  readonly explainBackConceptIds: readonly string[];
}

export interface SyntheticStream {
  readonly provenance: SyntheticProvenance;
  readonly spec: StreamSpec;
  /** Chronological, exactly as the day's vault file would hold it. */
  readonly entries: readonly ReviewLogEntry[];
  readonly groundTruth: DeclaredGroundTruth;
}

interface DeckSlot {
  readonly instrument: SyntheticInstrument;
  /** Real FSRS state, produced by `olea-core`'s scheduler. `null` before first exposure. */
  state: SchedulerState | null;
  /** True while an unretracted suspend event stands against this instrument (F2.6). */
  suspended: boolean;
  /** Day index this instrument becomes eligible again; `null` when not scheduled to unsuspend. */
  unsuspendOnDay: number | null;
  /** Day index it was introduced into the deck; `null` while still unseen. */
  introducedOnDay: number | null;
}

interface Candidate {
  readonly slot: DeckSlot;
  readonly dueState: SelectionContext['dueState'];
  /** Day index the item became/becomes due; `Number.POSITIVE_INFINITY` for a first exposure. */
  readonly dueDayIndex: number;
}

function masteryFromStability(stability: number): MasteryState {
  for (const band of MASTERY_STABILITY_BANDS) {
    if (stability < band.belowStabilityDays) return band.state;
  }
  return TOP_MASTERY;
}

/**
 * The review-log v4 shape for one concept's mastery (`ol-g6zg`), or `undefined`
 * when nothing was recorded.
 *
 * A synthetic instrument is evidence for exactly one concept by construction
 * (`SyntheticInstrument.conceptId`), so the map always has a single entry and
 * the record-level invariant — the map names exactly the record's `conceptIds`
 * — is satisfied by construction rather than by care. The
 * `not-attributable` arm is deliberately unreachable from here: it belongs to
 * the migration, which has records it cannot attribute, and this generator
 * knows exactly which concept every value describes.
 */
function perConceptMastery(
  conceptId: string,
  state: MasteryState | null,
): MasteryAtTime | undefined {
  if (state === null) return undefined;
  return { attribution: 'per-concept', byConcept: { [conceptId]: state } };
}

function mapCardOutcome(wasCorrect: boolean, wasUnsure: boolean, rng: Rng): Rating {
  if (!wasCorrect) return 'again';
  if (wasUnsure) return 'hard';
  return rng.chance(0.22) ? 'easy' : 'good';
}

function isCardType(type: ScheduledType): boolean {
  return CARD_TYPES.includes(type);
}

export function generateStream(spec: StreamSpec): SyntheticStream {
  const persona = PERSONAS[spec.persona];
  const behaviour: Behaviour = { ...persona.behaviour, ...(spec.behaviour ?? {}) };
  const offsetMinutes = parseUtcOffset(spec.utcOffset);
  const scheduler = createFsrsScheduler();

  // One Rng per decision family (see `Rng.derive`), so a change to one model
  // does not re-roll every other draw in the stream.
  const root = new Rng(`${spec.persona}:${spec.seed}:${spec.startDate}:${spec.days}`);
  const dayRng = root.derive('study-days');
  const skipRng = root.derive('instrument-skip');
  // A separate family from `instrument-skip` on purpose: the two filters are
  // different patterns in different personas, and interleaving their draws
  // would make either one's mutation experiment re-roll the other's.
  const courseRng = root.derive('course-attention');
  const outcomeRng = root.derive('outcome');
  const unsureRng = root.derive('unsure');
  const ratingRng = root.derive('rating');
  const durationRng = root.derive('duration');

  const deck: DeckSlot[] = INSTRUMENTS.map((instrument) => ({
    instrument,
    state: null,
    suspended: false,
    unsuspendOnDay: null,
    introducedOnDay: null,
  }));
  const deckByInstrumentId = new Map(deck.map((slot) => [slot.instrument.instrumentId, slot]));
  const consecutiveAgainByConcept = new Map<string, number>();

  const assessmentDates = [...spec.assessmentDayOffsets]
    .sort((a, b) => a - b)
    .map((offset) => addDays(spec.startDate, offset));

  const blackoutDates: string[] = [];
  if (behaviour.blackout) {
    for (let i = 0; i < behaviour.blackout.lengthDays; i += 1) {
      blackoutDates.push(addDays(spec.startDate, behaviour.blackout.startDayOffset + i));
    }
  }
  const blackoutSet = new Set(blackoutDates);

  const entries: ReviewLogEntry[] = [];
  const sessionDates: string[] = [];
  const burstDates: string[] = [];
  const suspendedInstrumentIds = new Set<string>();
  const unsuspendedInstrumentIds = new Set<string>();
  const explainBackConceptIds = new Set<string>();

  const streamTag = `${spec.persona}-${spec.seed}`;
  let eventCounter = 0;
  const nextEventId = (): string => {
    eventCounter += 1;
    return syntheticEventId(streamTag, eventCounter);
  };

  /** Days from `date` to the next assessment on or after it; null when none remains. */
  const examProximityOn = (dayIndex: number): number | null => {
    const upcoming = spec.assessmentDayOffsets.filter((o) => o >= dayIndex).sort((a, b) => a - b);
    const first = upcoming[0];
    return first === undefined ? null : first - dayIndex;
  };

  /** Concept mastery rolled up from whatever instruments of it have been reviewed. */
  const masteryOfConcept = (conceptId: string): MasteryState | null => {
    const concept = conceptById(conceptId);
    if (!concept) return null;
    let weakest: number | null = null;
    for (const inst of concept.instruments) {
      const slot = deckByInstrumentId.get(inst.instrumentId);
      const state = slot?.state;
      if (!state) continue;
      weakest = weakest === null ? state.stability : Math.min(weakest, state.stability);
    }
    return weakest === null ? null : masteryFromStability(weakest);
  };

  /**
   * The day index an instrument's FSRS due date falls on, in the persona's
   * local calendar. This is the only place dueness is decided, and it reads the
   * scheduler's own output — nothing in this file ever *chooses* a due state.
   */
  const dueDayIndexOf = (state: SchedulerState): number =>
    daysBetweenDates(spec.startDate, localDate(Date.parse(state.due), offsetMinutes));

  for (let dayIndex = 0; dayIndex < spec.days; dayIndex += 1) {
    const date = addDays(spec.startDate, dayIndex);
    if (blackoutSet.has(date)) continue;

    const proximity = examProximityOn(dayIndex);
    const isCramDay =
      behaviour.cramWindowDays > 0 && proximity !== null && proximity <= behaviour.cramWindowDays;
    // Every day draws exactly one study-day number, cram day or not, so
    // switching a persona's cram window on or off does not shift the rest of
    // the day sequence. That is what keeps a mutation experiment readable.
    const ordinaryStudyDay = dayRng.chance(behaviour.studyDayChance);
    const isStudyDay = isCramDay || ordinaryStudyDay;
    if (!isStudyDay) continue;

    // --- suspension expiry (D-020: a second event, never a retraction) ------
    const sessionStartMs =
      localMidnightUtcMs(date, offsetMinutes) + behaviour.sessionStartHour * 3_600_000;
    let cursorMs = sessionStartMs;
    const pendingEntries: ReviewLogEntry[] = [];

    for (const slot of deck) {
      if (!slot.suspended) continue;
      if (slot.unsuspendOnDay === null || slot.unsuspendOnDay > dayIndex) continue;
      slot.suspended = false;
      slot.unsuspendOnDay = null;
      unsuspendedInstrumentIds.add(slot.instrument.instrumentId);
      const record: SuspendLogRecord = {
        schemaVersion: 4,
        kind: 'unsuspend',
        eventId: nextEventId(),
        timestamp: isoWithOffset(cursorMs, offsetMinutes),
        instrumentId: slot.instrument.instrumentId,
        conceptIds: [slot.instrument.conceptId],
      };
      pendingEntries.push(record);
      cursorMs += 1_000;
    }

    // --- what the queue could offer today ----------------------------------
    const ready: Candidate[] = [];
    const notYetDue: Candidate[] = [];
    for (const slot of deck) {
      if (slot.suspended) continue;
      if (slot.state === null) {
        if (slot.introducedOnDay !== null) {
          ready.push({ slot, dueState: 'new', dueDayIndex: Number.POSITIVE_INFINITY });
        }
        continue;
      }
      const dueDayIndex = dueDayIndexOf(slot.state);
      if (dueDayIndex < dayIndex) ready.push({ slot, dueState: 'overdue', dueDayIndex });
      else if (dueDayIndex === dayIndex) ready.push({ slot, dueState: 'due', dueDayIndex });
      else notYetDue.push({ slot, dueState: 'early', dueDayIndex });
    }

    // Introduce today's new instruments, in deck order, before selection so a
    // first exposure is an ordinary candidate rather than a special case.
    let introduced = 0;
    for (const slot of deck) {
      if (introduced >= behaviour.newPerDay) break;
      if (slot.introducedOnDay !== null || slot.suspended) continue;
      slot.introducedOnDay = dayIndex;
      introduced += 1;
      ready.push({ slot, dueState: 'new', dueDayIndex: Number.POSITIVE_INFINITY });
    }

    ready.sort((a, b) => {
      if (a.dueDayIndex !== b.dueDayIndex) return a.dueDayIndex - b.dueDayIndex;
      return a.slot.instrument.instrumentId < b.slot.instrument.instrumentId ? -1 : 1;
    });
    notYetDue.sort((a, b) => {
      if (a.dueDayIndex !== b.dueDayIndex) return a.dueDayIndex - b.dueDayIndex;
      return a.slot.instrument.instrumentId < b.slot.instrument.instrumentId ? -1 : 1;
    });

    const offeredPool: Candidate[] = [...ready];
    if (isCramDay && behaviour.cramEarlyPull > 0) {
      offeredPool.push(...notYetDue.slice(0, behaviour.cramEarlyPull));
    }

    // `instrumentTypesOffered` is computed here — over the pool *before* the
    // skip filter — because that is what D7.1 asks for: "every instrument type
    // the queue could have offered for this concept". Computing it after the
    // filter would make an instrument-skipper indistinguishable from a queue
    // that never offered her a card, which is exactly the distinction the
    // second early-warning signal turns on.
    const offeredTypesByConcept = new Map<string, ScheduledType[]>();
    for (const candidate of offeredPool) {
      const { conceptId, instrumentType } = candidate.slot.instrument;
      const types = offeredTypesByConcept.get(conceptId);
      if (types) {
        if (!types.includes(instrumentType)) types.push(instrumentType);
      } else {
        offeredTypesByConcept.set(conceptId, [instrumentType]);
      }
    }
    for (const types of offeredTypesByConcept.values()) {
      types.sort();
    }

    // --- the instrument-skipper filter -------------------------------------
    //
    // Conditioned on the concept having a *live MCQ in the deck*, not on the
    // MCQ being due today — see `Behaviour.cardTakeRateWhenMcqAvailable` for
    // why. Note the filter runs before the daily cap, so leaving a card does
    // not just free a slot for another card.
    const conceptsWithLiveMcq = new Set<string>();
    for (const slot of deck) {
      if (slot.instrument.instrumentType !== 'mcq') continue;
      if (slot.suspended || slot.introducedOnDay === null) continue;
      conceptsWithLiveMcq.add(slot.instrument.conceptId);
    }

    const taken: Candidate[] = [];
    for (const candidate of offeredPool) {
      const { conceptId, courseId, instrumentType } = candidate.slot.instrument;
      if (conceptsWithLiveMcq.has(conceptId) && isCardType(instrumentType)) {
        if (!skipRng.chance(behaviour.cardTakeRateWhenMcqAvailable)) continue;
      }
      // --- the lopsided-effort filter -------------------------------------
      //
      // A course she is not spending her hours on. Only consulted for a course
      // that names a rate, so a persona with the neutral `{}` draws nothing
      // here and its stream is byte-identical to one generated before this knob
      // existed. Like the skip above, it runs BEFORE the daily cap: leaving a
      // vantrel item does not free the slot for another vantrel item.
      const courseTakeRate = behaviour.courseTakeRate[courseId];
      if (courseTakeRate !== undefined && !courseRng.chance(courseTakeRate)) continue;
      taken.push(candidate);
    }

    const cap = isCramDay ? behaviour.cramDailyCap : behaviour.dailyCap;
    const session = taken.slice(0, cap);
    if (session.length === 0 && pendingEntries.length === 0) continue;

    // --- emit the session ---------------------------------------------------
    for (const candidate of session) {
      const { slot } = candidate;
      const { instrument } = slot;
      const offered = offeredTypesByConcept.get(instrument.conceptId) ?? [
        instrument.instrumentType,
      ];

      const success = behaviour.successByCourse[instrument.courseId] ?? behaviour.defaultSuccess;
      const wasCorrect = outcomeRng.chance(success);
      const wasUnsure = unsureRng.chance(behaviour.unsureChance);
      const ratingValue: Rating =
        instrument.instrumentType === 'mcq'
          ? mapMcqRating({ type: 'mcq', correct: wasCorrect, wasUnsure })
          : mapCardOutcome(wasCorrect, wasUnsure, ratingRng);

      const [minMs, maxMs] = behaviour.answerMsRange;
      const durationMs = Math.round(
        durationRng.int(minMs, maxMs) * DURATION_SCALE[instrument.instrumentType],
      );

      // v4 (`ol-g6zg`): mastery is per concept and lives on the record, not in
      // the selection context. `masteryOfConcept` is keyed by the instrument's
      // single concept, so the map has one entry; `undefined` means the concept
      // had no history yet and nothing was recorded, which is what `null` used
      // to say in the same place.
      const masteryAtTime = masteryOfConcept(instrument.conceptId);
      const perConcept = perConceptMastery(instrument.conceptId, masteryAtTime);
      const selectionContext: SelectionContextV4 = {
        dueState: candidate.dueState,
        examProximity: proximity,
        // Phase A: prioritisation (F2.8) is not switched on, so there is no
        // yield rank to record. Explicit null, never omitted.
        yieldRank: null,
        instrumentTypesOffered: offered,
        // Pre-P5: no study plan exists to have selected this (C7.6).
        planVersion: null,
      };

      const record: ReviewLogRecord = {
        schemaVersion: 4,
        kind: 'review',
        eventId: nextEventId(),
        timestamp: isoWithOffset(cursorMs, offsetMinutes),
        instrumentId: instrument.instrumentId,
        instrumentType: instrument.instrumentType,
        // A synthetic instrument is evidence for exactly one concept by
        // construction (`SyntheticInstrument.conceptId`), so this is always a
        // singleton — but the record's shape is many-to-many (v3, D-020/`ol-t3sd`)
        // because a real instrument's note can name more than one.
        conceptIds: [instrument.conceptId],
        rating: ratingValue,
        wasUnsure,
        durationMs,
        selectionContext,
        ...(perConcept === undefined ? {} : { masteryAtTime: perConcept }),
      };
      pendingEntries.push(record);

      // The scheduler is driven for real, at the instant of the review.
      const output = scheduler.schedule({
        instrumentId: instrument.instrumentId,
        state: slot.state,
        rating: ratingValue,
        now: new Date(cursorMs),
      });
      const previousState = slot.state;
      slot.state = output.state;

      cursorMs +=
        durationMs +
        durationRng.int(behaviour.betweenItemsMsRange[0], behaviour.betweenItemsMsRange[1]);

      // --- F2.12: repeated failure routes her to explain-back --------------
      const priorAgain = consecutiveAgainByConcept.get(instrument.conceptId) ?? 0;
      const runOfAgain = ratingValue === 'again' ? priorAgain + 1 : 0;
      consecutiveAgainByConcept.set(instrument.conceptId, runOfAgain);

      if (
        behaviour.explainBackAfterConsecutiveAgain > 0 &&
        runOfAgain >= behaviour.explainBackAfterConsecutiveAgain
      ) {
        const concept = conceptById(instrument.conceptId);
        if (concept) {
          const explainMs = Math.round(
            durationRng.int(minMs, maxMs) * DURATION_SCALE['explain-back'],
          );
          // The explain-back is routed by this same concept's repeated
          // failures, so the value belongs to the concept the record names.
          // Re-keyed, not re-derived: it is the mastery at the moment the
          // routing happened, which is what `masteryAtTime` means.
          const explainBackMastery = perConceptMastery(concept.conceptId, masteryAtTime);
          const explainBack: ReviewLogRecord = {
            schemaVersion: 4,
            kind: 'review',
            eventId: nextEventId(),
            timestamp: isoWithOffset(cursorMs, offsetMinutes),
            instrumentId: concept.explainBackInstrumentId,
            instrumentType: 'explain-back',
            conceptIds: [concept.conceptId],
            // Explain-back produces no rating at all (F2.16).
            rating: null,
            wasUnsure: false,
            durationMs: explainMs,
            selectionContext: {
              // Explain-back is never FSRS-scheduled (contracts' `instrumentType`
              // doc: on-demand, routed on repeated failure, evidence into mastery
              // rather than a scheduled item). It therefore has no due date and no
              // honest answer to "was it due" — `'new'` is the only value in the
              // frozen enum that means "this item was not previously scheduled".
              // Flagged in the SYN-1 report rather than papered over.
              dueState: 'new',
              examProximity: proximity,
              yieldRank: null,
              instrumentTypesOffered: offered,
              planVersion: null,
            },
            ...(explainBackMastery === undefined ? {} : { masteryAtTime: explainBackMastery }),
          };
          pendingEntries.push(explainBack);
          explainBackConceptIds.add(concept.conceptId);
          cursorMs += explainMs + 30_000;
          consecutiveAgainByConcept.set(instrument.conceptId, 0);
        }
      }

      // --- F2.6 / D-020: she gives up on an instrument ----------------------
      const lapsesBefore = previousState?.lapses ?? 0;
      if (
        behaviour.suspendAfterLapses > 0 &&
        !slot.suspended &&
        slot.state.lapses >= behaviour.suspendAfterLapses &&
        lapsesBefore < behaviour.suspendAfterLapses
      ) {
        slot.suspended = true;
        slot.unsuspendOnDay =
          behaviour.unsuspendAfterDays === null ? null : dayIndex + behaviour.unsuspendAfterDays;
        suspendedInstrumentIds.add(instrument.instrumentId);
        pendingEntries.push({
          schemaVersion: 4,
          kind: 'suspend',
          eventId: nextEventId(),
          timestamp: isoWithOffset(cursorMs, offsetMinutes),
          instrumentId: instrument.instrumentId,
          conceptIds: [instrument.conceptId],
        });
        cursorMs += 1_000;
      }
    }

    if (pendingEntries.length > 0) {
      entries.push(...pendingEntries);
      sessionDates.push(date);
      if (isCramDay) burstDates.push(date);
    }
  }

  const strugglingCourseIds = Object.entries(behaviour.successByCourse)
    .filter(([, rate]) => rate < behaviour.defaultSuccess)
    .map(([courseId]) => courseId)
    .sort();

  return {
    provenance: buildProvenance(spec.persona, spec.seed),
    spec,
    entries,
    groundTruth: {
      persona: spec.persona,
      description: persona.planted.description,
      sessionDates,
      burstDates,
      blackoutDates,
      assessmentDates,
      strugglingCourseIds,
      suspendedInstrumentIds: [...suspendedInstrumentIds].sort(),
      unsuspendedInstrumentIds: [...unsuspendedInstrumentIds].sort(),
      explainBackConceptIds: [...explainBackConceptIds].sort(),
    },
  };
}
