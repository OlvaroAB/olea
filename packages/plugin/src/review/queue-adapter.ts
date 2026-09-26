/**
 * From a composed session to what the review view renders (F2.14, F2.15, F2.17, D7.1).
 *
 * `types.ts` has said since P2-T08 that `ReviewQueueItem` is "what that composer
 * is expected to hand the view once it exists", and that until then callers
 * build the array by hand. The composer exists now (`olea-core`'s
 * `buildReviewSession`), and this file is the join it was waiting for: queue
 * items in, presentation shapes out.
 *
 * ## Three things this adapter is forbidden to do
 *
 * **It does not decide what is offered.** The order, the dedupe, the filter and
 * the due-state are all decided in core and arrive settled. This walks
 * `queue.items` in the order it was given and never reorders, drops or adds.
 *
 * **It does not invent a selection context.** `QueueSelectionContext` carries
 * `yieldRank: null` and `examProximity: null` as *statements* — D7.1's own doc
 * is explicit that recording them as explicit nulls is what makes the Phase A
 * baseline and the Phase B comparison the same shape. This fills the one
 * context field the queue does not own (`planVersion`, null until P5 publishes
 * a plan) with a null for the same reason, and copies the queue's four through
 * untouched. An adapter that guessed here would quietly become the thing the
 * A→B checkpoint measures.
 *
 * `masteryAtTime` is not in the context at all since `ol-g6zg`: it moved onto
 * the record, keyed by `conceptIds`. It is still not the adapter's to know —
 * C5.4's rollup (`ol-p4t06`) does not exist yet — so nothing here writes it,
 * and an absent field says "not recorded", which is the true statement.
 *
 * **It does not cache a presentation.** `presentMcq` runs on every adaptation,
 * because F2.15's sampling is per *showing*: three distractors drawn from the
 * pool and all four positions shuffled, so that meeting the same item a second
 * time still tests the answer rather than where the answer sat last time.
 * Sampling once per instrument and reusing it would satisfy the type and
 * defeat the requirement.
 *
 * ## `[D-220 / DIST-3]` distractor provenance — read here, fetched by the caller
 *
 * `McqOption.believes`/`source_says` (`[D-202]`, `[D-220]`) are populated from
 * `olea-core`'s distractor-provenance sidecar (`instrument/distractor-provenance-store.ts`),
 * keyed by `instrumentId`, but that sidecar is vault I/O (`readDistractorProvenance` is `async`)
 * and every function in this file is a pure, synchronous `input -> presentation` map — the same
 * reason `recordsById` itself arrives pre-built rather than being walked here. So
 * `distractorProvenanceById` is a third pre-fetched map, exactly the same shape and the same
 * caller-supplies-it convention as `recordsById` and (below) `supportHistory`: whichever caller
 * assembles the queue's input (`open-session.ts`, out of this lane's ownership — see this file's
 * existing `supportHistory` doc for the identical precedent) reads the sidecar for every `mcq`
 * record in the batch and hands the results in. Omitted entirely (today's every caller) means no
 * option gets `believes`/`source_says` — the same "absent means not carried forward" the field's
 * own doc already states, not a regression this file introduces.
 *
 * Matched by the presented option's own TEXT, never by index: `presentMcq` samples up to
 * `PRESENTED_DISTRACTORS` from the pool and shuffles positions on every showing
 * (`mcq-present.ts`'s own module doc), so a distractor's position in `McqInstrument.distractors`
 * is not preserved into a presentation. The correct answer never gets a lookup — it is never a key
 * in the sidecar (`distractor-provenance-store.ts`'s own doc) and this file does not try.
 *
 * ## F2.22's `rankedReason` — a fourth pre-fetched map, and where the production path loses it today
 *
 * `ol-3ux7.5.57.14.58`: `olea-core`'s `study-session/build.ts` computes
 * `StudySessionItem.rankedReason` (oracle.rank.v1's one-clause "why this
 * concept" for a row) at COMPOSITION time, keyed by concept. Neither
 * `ComposedQueue`'s `QueueItem` (`queue/types.ts`) nor `PlannedQueueItem`
 * (`plan/execute.ts`) carries a field for it, so — same shape as
 * `distractorProvenanceById` just above — `rankedReasonsById` is a fourth
 * pre-fetched map, keyed by `instrumentId`, that whichever caller assembles
 * this adapter's input would build from the `StudySessionItem[]` it already
 * has in hand (each row names its own `instrumentId`) and pass in.
 *
 * **No caller does this today, and the field is lost on the production path
 * before it would ever reach this file.** Traced from composition to the
 * review screen (`ol-3ux7.5.57.14.58`'s own investigation step):
 * `buildComposedStudySession` produces `StudySessionItem[]` carrying
 * `rankedReason` (`study-session/build.ts`), but `session/build.ts`'s
 * `queueItemsFromComposedSession` (the one production translator from that
 * shape into this adapter's `QueueItem[]` input, `open-session.ts:527`'s
 * `executeStudyPlanOverComposedRows({ items: queueItems, ... })`) builds each
 * `QueueItem` from an EXPLICIT field list — `instrumentId`, `instrumentType`,
 * `conceptIds`, `priorState`, `selectionContext`, `dedupeReason` — that does
 * not name `rankedReason`, and `QueueItem`/`PlannedQueueItem` have no field
 * to carry it even if it did. So today, `rankedReasonsById` is always
 * omitted in production, and every item's `rankedReason` reads `undefined` —
 * honest, not a regression this file introduces. Closing that gap (either
 * widening `queueItemsFromComposedSession`'s field list plus a `rankedReason`
 * field on `QueueItem`/`PlannedQueueItem`, or having `open-session.ts` build
 * `rankedReasonsById` itself from the same `StudySessionItem[]` and pass it
 * to `adaptExecutedReviewQueue`) is outside this lane's file ownership
 * (`session/build.ts`, `queue/types.ts`, `plan/execute.ts` and
 * `open-session.ts` all belong to other beads) — filed as a follow-up.
 *
 * ## `adaptExecutedReviewQueue` — P5-T07's addition, `adaptReviewQueue` untouched
 *
 * `adaptReviewQueue`'s `toSelectionContext` states `planVersion: null` because
 * until P5-T07, nothing upstream of it could have produced anything else — no
 * caller executed a queue against a plan. That is no longer true for
 * `open-session.ts`, which now runs `olea-core`'s `executeStudyPlan` before
 * adapting, and `executeStudyPlan`'s `PlannedQueueItem` already carries a
 * *complete* `SelectionContextV4` (planVersion included, from the plan when
 * one ranked the item and stated `null` — not omitted — when none did, exactly
 * the same "state the absence" discipline this file's own doc describes).
 * Rebuilding that object here a second time would either duplicate
 * `executeStudyPlan`'s join or, worse, silently overwrite its `planVersion`
 * with the hard-coded `null` above — which is precisely what would have
 * happened had this file's *existing* export been pointed at planned items
 * instead of composed ones.
 *
 * So this is a second, additive function rather than a signature change to
 * `adaptReviewQueue`: `packages/workbench` calls the original with a raw
 * `ComposedQueue` and is untouched by this bead (out of this lane's file
 * ownership), and `open-session.ts` calls the new one with an executed
 * queue's items. Both share every presentation helper below; only which
 * `selectionContext` reaches the view differs.
 *
 * ## Row 3.9's chooser, threaded here rather than in `queue/compose.ts` ([SUPP-3], `ol-lpl4`)
 *
 * `study-session/build.ts` already folds a concept's review history through
 * `chooseSupportLevel` at COMPOSITION time (`[SUPP-2]`, `ol-95vv.4`), but this
 * queue has a different production caller downstream: `open-session.ts` always
 * runs `composeQueue`'s output through `plan/execute.ts`'s `executeStudyPlan`
 * before it ever reaches an adapter, and that module rebuilds `PlannedQueueItem`
 * from an explicit field list rather than a spread (`{ instrumentId, ...,
 * planWeight }` — see its own source) — it is out of this lane's ownership, and
 * any field added to `QueueItem` in `queue/compose.ts` would be silently
 * dropped there before `adaptExecutedReviewQueue` ever saw it. Computing the
 * decision here, in ADAPTATION, sidesteps that: `PlannedQueueItem` (and
 * `QueueItem`) both carry `instrumentType`/`conceptIds` verbatim regardless,
 * which is all {@link supportLevelForRecord} needs.
 *
 * {@link buildSupportLevelHistoryLookup} is this queue's equivalent of what
 * `session-builder/provider.ts` demonstrates for the F4.6 preview path
 * (folding `readReviewLogHistory`'s entries through `deriveFailureShape`) —
 * built from raw `ReviewLogEntry[]`, which `buildReviewSession`'s own return
 * shape (`ReviewSession.entries`, `packages/core/src/session/build.ts`)
 * already carries, so the live caller has this data in hand without a second
 * vault read. Wiring `open-session.ts` to actually pass it is outside this
 * lane's ownership — see that file's hand-back note in the lane report.
 *
 * ## `createFrozenReviewQueue` — C5.8's freeze (`ol-v7r5.35`, `[D-193]`)
 *
 * Both adapters above are pure `input -> ReviewQueueItem[]` maps with no
 * memory of a prior call — correct for a one-shot read, but C5.8's "the
 * session holds still" cannot be discharged by a stateless function; it
 * needs something that remembers what a session already showed her and
 * refuses to let a fresh read move it. `createFrozenReviewQueue`, near the
 * bottom of this file, is that something — see its own section doc for the
 * three verbs (`open`/`extend`/`close`) and how it reuses `rebuild-
 * controller.ts`'s `SittingState`/`decideRebuild` rather than a second freeze
 * mechanism invented here.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type {
  ComposedQueue,
  DistractorProvenance,
  FailureShape,
  GradedReviewEvidence,
  McqInstrumentRecord,
  PlannedQueueItem,
  QueueItem,
  RandomSource,
  SchedulableInstrumentType,
  SelfAssessmentFeeling,
  SessionSupportOutcome,
  SittingStalenessInput,
  SittingState,
  SupportLadderTier,
  SupportLevelPresentation,
  VaultInstrumentRecord,
} from 'olea-core';
import {
  chooseSupportLevel,
  clusterReviewSessions,
  decideRebuild,
  deriveFailureShape,
  enterSitting,
  exitSitting,
  IDLE_SITTING,
  mathRandomSource,
  presentMcq,
} from 'olea-core';
import { localToday } from '../today/data-source.js';
import type { McqOption, ReviewInstrument, ReviewQueueItem, SelectionContextV4 } from './types.js';

/** Option keys in presentation order — the same letters `keymap.ts` binds. */
const OPTION_IDS = 'abcdefghij';

/**
 * Row 3.9's chooser input for this queue ([SUPP-3], `ol-lpl4`) — the same
 * shape `study-session/build.ts`'s `SupportLevelHistoryLookup` states,
 * re-declared here rather than imported: `study-session/` is a sibling
 * branch of `packages/core`'s pipeline, not a dependency of `queue/`, and
 * this interface's only two members are cheap to restate rather than reach
 * across that boundary for.
 */
export interface SupportLevelHistoryLookup {
  outcomesFor(conceptId: string, tier: SupportLadderTier): readonly SessionSupportOutcome[];
}

/**
 * `[D-094]`'s scope clause, restated for this queue's instrument types:
 * recognition (`mcq`) has no ladder at all ("its options are its
 * scaffolding"), and `qa`/`cloze` are both scored at the `'recall'` tier —
 * this queue never renders `explain-back` (F2.14) so `'explanation'` never
 * arises here. Mirrors `study-session/build.ts`'s private
 * `supportLadderTierFor`, which this module cannot import (`study-session/`
 * is out of this lane's ownership).
 */
function supportLadderTierFor(instrumentType: SchedulableInstrumentType): SupportLadderTier | null {
  return instrumentType === 'mcq' ? null : 'recall';
}

/**
 * `[D-094]`'s two escalation-triggering shapes rank equally, above a minor
 * slip, which ranks above a clean pass — the ordering `att.md` §2.6's fold
 * needs when one session holds more than one review of the same concept at
 * the same tier: *"outcome = escalate on any blank or wrong-concept failure
 * in the session; clean only when every answer was clean with no hint
 * taken."* `deriveFailureShape` never returns `'blank'` for a `qa`/`cloze`
 * review (only `'none'`/`'wrong-concept'` are reachable from a recall
 * rating), but an `explain-back` review (`ol-egov.141.89.9.20`) can land on
 * any of `'none'`/`'minor-slip'`/`'wrong-concept'` — an unknown-correctness
 * or partial-depth answer folded alongside a clean recall answer in the same
 * sitting must still read as the worse of the two, which is exactly what
 * this severity order is for. `'blank'` stays unreachable through this
 * fold's two entry kinds today (see {@link buildSupportLevelHistoryLookup}'s
 * doc), but the ranking is written generally rather than assuming that stays
 * true.
 */
const FAILURE_SHAPE_SEVERITY: Readonly<Record<FailureShape, number>> = {
  none: 0,
  'minor-slip': 1,
  blank: 2,
  'wrong-concept': 2,
};

/** The worse (more support-triggering) of two failure shapes, per {@link FAILURE_SHAPE_SEVERITY}. */
function worseFailureShape(a: FailureShape, b: FailureShape): FailureShape {
  return FAILURE_SHAPE_SEVERITY[b] > FAILURE_SHAPE_SEVERITY[a] ? b : a;
}

/**
 * Build a `SupportLevelHistoryLookup` from raw review-log entries — this
 * queue's equivalent of what `session-builder/provider.ts` demonstrates for
 * the F4.6 preview path.
 *
 * **One outcome per SESSION, never per review** (`att.md` item 9; `[D-094]`
 * counts whole sessions, C5.4 defines a session as `clusterReviewSessions`'
 * maximal cluster of reviews separated by less than the declared 45-minute
 * gap). Entries are clustered exactly as C5.5's own rule requires — sorted
 * to the ruled total order internally, so this needs no pre-sorted input —
 * and every past `qa`/`cloze` review's outcome (`deriveFailureShape`) inside
 * one session is folded, per concept it names at the `'recall'` tier, into
 * the single worst shape that session showed ({@link worseFailureShape}):
 * two clean answers minutes apart are one clean session, not two, and a
 * clean answer alongside a miss in the same sitting is one failing session,
 * not a clean one that happens to sit next to a failing one. Sessions are
 * emitted oldest first, matching `chooseSupportLevel`'s fold requirement
 * (see its own module doc's "ordering rule").
 *
 * `mcq` review-kind entries are skipped: recognition has no ladder tier to
 * attribute (see {@link supportLadderTierFor}). `qa`/`cloze` entries fold at
 * the `'recall'` tier; a `null` rating is skipped too rather than guessed
 * at — the schema's own doc says `rating` is nullable only for
 * `explain-back`, so a null rating on a recall-tier entry is not a shape
 * this fold has an honest reading for.
 *
 * **`explain-back` entries fold at the `'explanation'` tier** (`ol-egov.
 * 141.89.9.20`; att.md §2.6, `[D-094]`, `[D-286]`, `[D-281]`) — this queue
 * never OFFERS an explain-back instrument (see {@link supportLadderTierFor}'s
 * own doc: `SchedulableInstrumentType` excludes it), but her past
 * explain-back reviews are still real evidence for row 3.9's chooser, read
 * from `review.explainBackGrade` rather than `review.rating` (always `null`
 * for this kind, F2.16). `deriveFailureShape` reads `correctness` before
 * `soloLevel` (`[D-286]`'s two-pass split): an `'incorrect'` verdict lowers
 * the ladder however deep the (possibly absent) depth pass went, and a
 * record with no `correctness` at all (`[D-281]`: unknown, never read as
 * correct) is capped at `'minor-slip'` — it never reads as the clean pass a
 * relational-but-unverified answer would otherwise produce. An
 * `explain-back` entry with no `soloLevel` at all (an ungraded or declined
 * attempt — `deriveFailureShape` throws on that shape, see its own doc's
 * "blank" section) is skipped, the same "no honest reading" treatment a
 * null recall rating gets.
 *
 * Because `qa`/`cloze` and `explain-back` reviews of the SAME concept in one
 * sitting occupy different tiers (`[D-094]`'s ladders are per-tier), the
 * per-session fold below is keyed by concept AND tier, not concept alone —
 * a clean recall answer must never paper over a failing explanation of the
 * same concept in the same sitting, or the reverse.
 *
 * `hintUptake` is always `false` — `deriveFailureShape`'s own module doc: no
 * review-log field records hint use, so the honest default is "not used",
 * never a fabricated positive.
 */
export function buildSupportLevelHistoryLookup(
  entries: readonly ReviewLogEntry[],
): SupportLevelHistoryLookup {
  const byKey = new Map<string, SessionSupportOutcome[]>();

  for (const session of clusterReviewSessions(entries)) {
    const shapeByKey = new Map<string, FailureShape>();
    for (const review of session.reviews) {
      let tier: SupportLadderTier;
      let evidence: GradedReviewEvidence;

      if (review.instrumentType === 'qa' || review.instrumentType === 'cloze') {
        if (review.rating === null) continue;
        tier = 'recall';
        evidence = { instrumentType: review.instrumentType, rating: review.rating };
      } else if (review.instrumentType === 'explain-back') {
        const grade = review.explainBackGrade;
        if (grade === undefined || grade.soloLevel === undefined) continue;
        tier = 'explanation';
        evidence = {
          instrumentType: 'explain-back',
          // `GradedReviewEvidence.rating` is required by its own shape but
          // `deriveFailureShape` never reads it on the explain-back branch —
          // `review.rating` is always `null` for this kind (F2.16) and the
          // interface has no nullable variant, so a placeholder is supplied
          // here, matching `support-level-signal.spec.ts`'s own precedent
          // for this exact case.
          rating: 'again',
          soloLevel: grade.soloLevel,
          ...(grade.correctness !== undefined ? { correctness: grade.correctness } : {}),
        };
      } else {
        continue;
      }

      const shape = deriveFailureShape(evidence);
      for (const conceptId of review.conceptIds) {
        const key = `${conceptId}:${tier}`;
        const existing = shapeByKey.get(key);
        shapeByKey.set(key, existing === undefined ? shape : worseFailureShape(existing, shape));
      }
    }

    for (const [key, failureShape] of shapeByKey) {
      const outcome: SessionSupportOutcome = { failureShape, hintUptake: false };
      const bucket = byKey.get(key);
      if (bucket === undefined) byKey.set(key, [outcome]);
      else bucket.push(outcome);
    }
  }

  return {
    outcomesFor(conceptId, tier) {
      return byKey.get(`${conceptId}:${tier}`) ?? [];
    },
  };
}

/**
 * Row 3.9's chooser decision for one instrument, or `undefined` when no
 * decision was made — an `'mcq'` record (out of `[D-094]`'s ladder scope) or
 * a caller that supplied no `supportHistory` at all. Mirrors
 * `study-session/build.ts`'s fill-loop call exactly: fold `outcomesFor` for
 * the concept, apply the transient self-assessment for this offer only.
 *
 * **The first of the record's `conceptIds`, not all of them** — the same
 * reversible, stated convention this file's own `courseCodeOf` and
 * `queue/compose.ts`'s `blockedBy` already use for a multi-concept
 * instrument (R1/R2: her authored order, never re-sorted). A concept-level
 * decision has to name one concept when an instrument is evidence for
 * several, and "the first she listed" is the convention already established
 * twice over in this exact pipeline rather than a new one invented here.
 */
function supportLevelForRecord(
  record: VaultInstrumentRecord,
  supportHistory: SupportLevelHistoryLookup | undefined,
  supportSelfAssessment: SelfAssessmentFeeling | undefined,
): SupportLevelPresentation | undefined {
  if (supportHistory === undefined) return undefined;
  const tier = supportLadderTierFor(record.instrumentType);
  if (tier === null) return undefined;
  const conceptId = record.conceptIds[0];
  if (conceptId === undefined) return undefined;
  return chooseSupportLevel(
    supportHistory.outcomesFor(conceptId, tier),
    supportSelfAssessment ?? null,
  );
}

export interface AdaptReviewQueueInput {
  /** What `buildReviewSession` composed. Only `items` is read; `deferred` is the caller's to report. */
  readonly queue: ComposedQueue;
  /** `instrumentId` -> record, from the same walk that produced the queue. */
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
  /** Injected for deterministic tests. Production takes the default, which is `Math.random`. */
  readonly random?: RandomSource;
  /**
   * Row 3.9's chooser input ([SUPP-3], `ol-lpl4`) — see
   * {@link buildSupportLevelHistoryLookup}. Omitted entirely means no support
   * level is computed for any item, exactly today's (pre-`ol-lpl4`) behaviour
   * — every existing caller and fixture needs no change.
   */
  readonly supportHistory?: SupportLevelHistoryLookup;
  /**
   * The session's one pre-session self-assessment (F2.20), applied to every
   * item this adapter scores — same singular reading `study-session/build.ts`
   * gives `BuildStudySessionInput.supportSelfAssessment`. Ignored entirely
   * when {@link AdaptReviewQueueInput.supportHistory} is not supplied.
   */
  readonly supportSelfAssessment?: SelfAssessmentFeeling;
  /**
   * `[D-220 / DIST-3]`: `instrumentId` -> distractor-provenance sidecar, pre-fetched by the caller
   * from the same walk that produced `recordsById` — see this file's module doc section. Omitted
   * entirely (every caller today) means no `mcq` option gets `believes`/`source_says`.
   */
  readonly distractorProvenanceById?: ReadonlyMap<string, DistractorProvenance>;
  /**
   * F2.22 (`[D-331]`, `[D-374]`, `ol-3ux7.5.57.14.58`): `instrumentId` ->
   * `olea-core`'s `StudySessionItem.rankedReason`, pre-fetched by the
   * caller — same "caller supplies it, this file only maps it" convention
   * `recordsById` and `distractorProvenanceById` already use, because
   * `StudySessionItem` is a different composer's output shape (see this
   * file's module doc) that neither `ComposedQueue` nor `PlannedQueueItem`
   * carries a field for. Omitted entirely (every caller today — see the
   * module doc's "where the production path loses it" section) means no
   * item gets a `rankedReason`.
   */
  readonly rankedReasonsById?: ReadonlyMap<string, string>;
}

/**
 * The course shown in the review view's meta line.
 *
 * A concept's course membership is M:N (R1/R2) and the meta line has room for
 * one code, so the first is shown — the same reversible default, and the same
 * stated question, as `toDueInstruments`. An empty string where a concept names
 * no course: the view renders a card with no course rather than dropping a due
 * instrument, and there is nothing here to invent one from (INV-3).
 */
function courseCodeOf(record: VaultInstrumentRecord): string {
  return record.courses[0] ?? '';
}

function common(record: VaultInstrumentRecord, supportLevel: SupportLevelPresentation | undefined) {
  return {
    instrumentId: record.instrumentId,
    conceptIds: record.conceptIds,
    courseCode: courseCodeOf(record),
    noteTitle: record.noteTitle,
    sourcePath: record.notePath,
    blockId: record.blockId,
    // Every instrument this adapter enumerates already exists in the vault
    // (`buildReviewSession` walked it) — never a cached, unreviewed draft.
    // `ol-p3t07a`'s new-badge items come from `generation/review-adapter.ts`
    // instead, which sets this to the draft's own id.
    draftId: null,
    // Row 3.9's chooser decision ([SUPP-3], `ol-lpl4`) — `undefined` (never a
    // fabricated value) produces no field at all under `exactOptionalPropertyTypes`,
    // matching `RecordReviewInput.supportLevel`'s own "absent means no decision"
    // discipline (`review/ports.ts`).
    ...(supportLevel !== undefined ? { supportLevel } : {}),
  } as const;
}

/**
 * `[D-220 / DIST-3]`: matches a presented, non-correct option's own text against the sidecar's
 * entries — see this file's module doc section for why text, never position. `undefined` for the
 * correct option always, and for any distractor the sidecar has no entry for.
 */
function distractorGroundingFor(
  optionText: string,
  correct: boolean,
  provenance: DistractorProvenance | undefined,
): { believes: string; source_says: string } | undefined {
  if (correct || provenance === undefined) return undefined;
  const entry = provenance.entries.find((e) => e.text === optionText);
  if (entry === undefined) return undefined;
  return { believes: entry.believes, source_says: entry.source_says };
}

/** One showing of an MCQ: sampled and shuffled now, not when the instrument was parsed. */
function presentOptions(
  record: McqInstrumentRecord,
  random: RandomSource,
  distractorProvenance?: DistractorProvenance,
): readonly McqOption[] {
  const presentation = presentMcq(record.mcq, random);
  return presentation.options.map((option, index) => {
    const grounding = distractorGroundingFor(option.text, option.correct, distractorProvenance);
    return {
      id: OPTION_IDS[index] ?? String(index),
      label: option.text,
      correct: option.correct,
      ...(grounding !== undefined ? grounding : {}),
    };
  });
}

/**
 * The presentation shape for one enumerated instrument.
 *
 * `supportLevel` is row 3.9's chooser decision for this instrument
 * ([SUPP-3], `ol-lpl4`), computed by the caller (`adaptReviewQueue`/
 * `adaptExecutedReviewQueue` below, via {@link supportLevelForRecord}) and
 * passed in rather than derived here — this function stays a pure
 * `record -> instrument` mapping, unaware of history lookups or self-assessment.
 *
 * `distractorProvenance` is `[D-220]`'s sidecar entry for this one instrument (see this file's
 * module doc section), similarly pre-fetched and passed in rather than read here — this function
 * has no vault access (INV-1) and stays synchronous. Ignored for `qa`/`cloze` records.
 */
export function toReviewInstrument(
  record: VaultInstrumentRecord,
  random: RandomSource = mathRandomSource,
  supportLevel?: SupportLevelPresentation,
  distractorProvenance?: DistractorProvenance,
): ReviewInstrument {
  if (record.instrumentType === 'qa') {
    return {
      ...common(record, supportLevel),
      type: 'qa',
      question: record.card.front,
      answer: record.card.back,
    };
  }
  if (record.instrumentType === 'cloze') {
    return {
      ...common(record, supportLevel),
      type: 'cloze',
      before: record.card.before,
      clozeText: record.card.clozeText,
      after: record.card.after,
      // The optional context line under the sentence. The heading a cloze sits
      // under is the note's own words about it — her question-headed outline —
      // and is the only context the vault offers without generating one.
      noteContext: record.heading,
    };
  }
  return {
    ...common(record, supportLevel),
    type: 'mcq',
    stem: record.mcq.stem,
    options: presentOptions(record, random, distractorProvenance),
    // `McqItem.feedback` is shown after she answers regardless of correctness.
    // The block's `feedback:` field is optional, and an absent one is an empty
    // string rather than a sentence this adapter wrote.
    feedback: record.mcq.feedback ?? '',
  };
}

/**
 * The full D7.1 context: the queue's four fields verbatim, plus the one it does
 * not own, stated as null rather than omitted.
 */
export function toSelectionContext(item: QueueItem): SelectionContextV4 {
  return {
    dueState: item.selectionContext.dueState,
    examProximity: item.selectionContext.examProximity,
    yieldRank: item.selectionContext.yieldRank,
    instrumentTypesOffered: item.selectionContext.instrumentTypesOffered,
    // C7.6: no study plan has been published, so none selected this item.
    planVersion: null,
  };
}

/**
 * Every offered item, in the order the queue offered it.
 *
 * An item whose record is missing is skipped rather than rendered blank — the
 * two are produced by one walk in `buildReviewSession`, so a miss means the
 * caller assembled the two halves from different enumerations, and a view
 * showing an empty card is a worse report of that than a shorter queue.
 */
export function adaptReviewQueue(input: AdaptReviewQueueInput): readonly ReviewQueueItem[] {
  const random = input.random ?? mathRandomSource;
  const items: ReviewQueueItem[] = [];

  for (const item of input.queue.items) {
    const record = input.recordsById.get(item.instrumentId);
    if (record === undefined) continue;
    const rankedReason = input.rankedReasonsById?.get(item.instrumentId);
    items.push({
      instrument: toReviewInstrument(
        record,
        random,
        supportLevelForRecord(record, input.supportHistory, input.supportSelfAssessment),
        input.distractorProvenanceById?.get(item.instrumentId),
      ),
      priorState: item.priorState,
      selectionContext: toSelectionContext(item),
      ...(item.dedupeReason !== undefined ? { dedupeReason: item.dedupeReason } : {}),
      ...(rankedReason !== undefined ? { rankedReason } : {}),
    });
  }

  return items;
}

export interface AdaptExecutedReviewQueueInput {
  /** `executeStudyPlan`'s items — already ordered, already carrying a complete D7.1 context. */
  readonly items: readonly PlannedQueueItem[];
  /** `instrumentId` -> record, from the same walk that produced the queue. */
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
  /** Injected for deterministic tests. Production takes the default, which is `Math.random`. */
  readonly random?: RandomSource;
  /**
   * Row 3.9's chooser input ([SUPP-3], `ol-lpl4`) — see
   * {@link AdaptReviewQueueInput.supportHistory}. This is the field
   * `open-session.ts` (the live "Olea: Start today's review" caller) needs to
   * pass — see this file's module doc for why it must build it from
   * `ReviewSession.entries` (`buildReviewSession`'s own return) rather than
   * from anything `executeStudyPlan` hands over.
   */
  readonly supportHistory?: SupportLevelHistoryLookup;
  /** See {@link AdaptReviewQueueInput.supportSelfAssessment}. */
  readonly supportSelfAssessment?: SelfAssessmentFeeling;
  /** See {@link AdaptReviewQueueInput.distractorProvenanceById}. */
  readonly distractorProvenanceById?: ReadonlyMap<string, DistractorProvenance>;
  /** See {@link AdaptReviewQueueInput.rankedReasonsById}. */
  readonly rankedReasonsById?: ReadonlyMap<string, string>;
}

/**
 * Every executed item, in the order `executeStudyPlan` placed it.
 *
 * The plan-shaped sibling of `adaptReviewQueue` — see this file's module doc
 * for why it exists separately rather than as a signature change. Its
 * `selectionContext` is passed through verbatim: `executeStudyPlan` is the
 * one place that decides it (the plan's join, or the queue's own nulls when
 * there is no plan), and rebuilding it here would be a second, and possibly
 * disagreeing, opinion about what selected the item.
 */
export function adaptExecutedReviewQueue(
  input: AdaptExecutedReviewQueueInput,
): readonly ReviewQueueItem[] {
  const random = input.random ?? mathRandomSource;
  const items: ReviewQueueItem[] = [];

  for (const item of input.items) {
    const record = input.recordsById.get(item.instrumentId);
    if (record === undefined) continue;
    const rankedReason = input.rankedReasonsById?.get(item.instrumentId);
    items.push({
      instrument: toReviewInstrument(
        record,
        random,
        supportLevelForRecord(record, input.supportHistory, input.supportSelfAssessment),
        input.distractorProvenanceById?.get(item.instrumentId),
      ),
      priorState: item.priorState,
      selectionContext: item.selectionContext,
      ...(item.dedupeReason !== undefined ? { dedupeReason: item.dedupeReason } : {}),
      ...(rankedReason !== undefined ? { rankedReason } : {}),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// `ol-v7r5.35` — C5.8's freeze, held here rather than assumed of the caller.
//
// Before this, both adapters above were pure `input -> ReviewQueueItem[]`
// maps with no memory: every call recomposed from whatever `input` carried,
// which is honest and correct for a ONE-SHOT read but leaves C5.8's "the
// session holds still" resting entirely on `open-session.ts`/`view.ts` never
// calling this twice for the same sitting — a discipline this file could not
// see, let alone enforce. `ol-egov.81`'s close note names exactly that gap.
//
// `createFrozenReviewQueue` is the seam `rebuild-controller.ts`'s own module
// doc already names as owed here ("still composes the review queue with no
// freeze at all ... filed as a follow-up"): it wraps `adaptExecutedReviewQueue`
// in the SAME `SittingState`/`decideRebuild` controller `session-builder/
// provider.ts` already proves out for the study-session builder, rather than
// inventing a second freeze mechanism for this queue.
//
// Three verbs, matching C5.8's three "changes only by her own action" cases:
//
//  - `open` — session entry, or an idempotent re-render of one already open.
//    A sitting that is active and not stale returns the SAME frozen array by
//    reference, no recompute, regardless of what a fresh `input` would now
//    produce (a new due item mid-session is exactly what this refuses to
//    surface). A sitting that has gone stale (`decideRebuild`'s
//    `'sitting-stale'`) ENDS per `[D-162]` — never a recompose of the
//    unreviewed tail — and this composes a fresh sitting in its place, same
//    as an idle one.
//  - `extend` — C5.5's "she outran the target": always composes a fresh
//    candidate list and APPENDS whatever it offers that is not already in
//    the frozen list, onto the end, never reordering or dropping what is
//    already there. It does not re-derive "the same plan's shares" itself —
//    that redistribution is `composeQueue`/`executeStudyPlan`'s job (C5.5's
//    own text: "the extension is composed under the same plan's shares"),
//    already done by the time an `input` reaches this adapter; `extend`'s
//    contract is only "grow, never replace, never reorder, never duplicate".
//  - `close` — she finished or left. Releases the freeze; the next `open`
//    recomposes unconditionally, which is C5.8's "between sessions it
//    recomputes on anything that changes the answer" read at this component's
//    scope: an ended sitting has nothing left to hold.
//
// Held per instance, the same "one `SittingState` per surface across
// renders/opens, not just per call" scope `ol-e228`'s acceptance criteria
// state for the study-session builder — a caller (`open-session.ts`/
// `main.ts`, outside this lane's owned paths) constructs one
// `FrozenReviewQueue` per opened review tab and calls `open`/`extend`/`close`
// through its own lifecycle, exactly the shape `createLocalSessionBuilderProvider`
// already demonstrates for `SessionBuilderState`. Wiring that caller is
// tracked as a follow-up rather than done here, across this lane's file
// ownership boundary (`packages/plugin/src/review/queue-adapter.ts` and its
// spec only) — see this bead's close notes.
// ---------------------------------------------------------------------------

export interface FrozenReviewQueueDeps {
  /** The caller's own clock reading — never read internally (INV-1). */
  readonly now: () => Date;
  /**
   * Gates when a frozen sitting's staleness may even be evaluated — defaults
   * to {@link DEFAULT_SITTING_IDLE_THRESHOLD_MS} (`rebuild-controller.ts`).
   * Overridable for tests; production leaves it at the default.
   */
  readonly idleThresholdMs?: number;
}

export interface OpenFrozenReviewQueueInput extends AdaptExecutedReviewQueueInput {
  /**
   * The frozen sitting's own material-change facts
   * (`rebuild-controller.ts`'s `SittingStalenessInput`), scoped to its
   * composition — the caller resolves these (a `SittingScopeSnapshot` diff,
   * same shape `session-builder/provider.ts` builds), never this module,
   * which has no vault or review-log access of its own (INV-1). Omitted
   * reads as "nothing changed" — honest whenever the caller has not (yet)
   * wired scope-tracking, and `decideRebuild` never consults it before the
   * idle threshold has elapsed regardless.
   */
  readonly staleness?: SittingStalenessInput;
}

const NOT_STALE: SittingStalenessInput = Object.freeze({
  itemsDueInScope: false,
  materialArrivedInScope: false,
  assessmentProximityBandCrossedInScope: false,
});

export interface FrozenReviewQueue {
  /**
   * Session entry, or an idempotent re-render of the sitting already open —
   * see this section's module doc for the three cases (hold / stale-so-end
   * / idle-so-compose).
   */
  readonly open: (input: OpenFrozenReviewQueueInput) => readonly ReviewQueueItem[];
  /**
   * C5.5's "she outran the target": composes `input` fresh and appends every
   * item it offers that the frozen list does not already carry (matched by
   * `instrument.instrumentId`), in the order the fresh composition offered
   * them. A no-op sitting-wise if every candidate is already present.
   * Extending an idle holder (no sitting open) is the same as `open` with no
   * staleness input — there is nothing to append onto.
   */
  readonly extend: (input: AdaptExecutedReviewQueueInput) => readonly ReviewQueueItem[];
  /** She finished or left. Releases the freeze; the next `open` recomposes unconditionally. */
  readonly close: () => void;
}

/**
 * Row 3.9's chooser inputs, captured at the instant a sitting is COMPOSED
 * (`open`'s fresh-compose path, or `extend`'s when it finds no sitting open)
 * and reused for the lifetime of that sitting — never refreshed from a later
 * call's `input`. See {@link withFrozenSupport} for why.
 */
interface FrozenSupportInputs {
  readonly supportHistory?: SupportLevelHistoryLookup;
  readonly supportSelfAssessment?: SelfAssessmentFeeling;
}

function captureFrozenSupport(input: AdaptExecutedReviewQueueInput): FrozenSupportInputs {
  return {
    ...(input.supportHistory !== undefined ? { supportHistory: input.supportHistory } : {}),
    ...(input.supportSelfAssessment !== undefined
      ? { supportSelfAssessment: input.supportSelfAssessment }
      : {}),
  };
}

/**
 * `[D-186]`: *"the level shown on every review in a session is folded from
 * sessions that closed before this one was composed ... and never reads the
 * session in progress."* `extend` (below) still composes its CANDIDATE list
 * fresh every call — that is C5.5's "outran the target" contract, and it is
 * correct: due-ness, dedupe and ordering all change legitimately mid-sitting.
 * What must NOT change is row 3.9's decision for any one concept × tier
 * cell, because a fresh `supportHistory`/`supportSelfAssessment` handed to
 * `extend` reflects "the log as it now stands" — which, mid-sitting,
 * includes this very sitting's own reviews (`att.md` item 9). Substituting
 * the frozen support inputs here, in place of whatever `extend`'s own caller
 * fed it, is what keeps an appended item's level the one fixed when the
 * sitting was composed rather than one re-derived from the sitting in
 * progress.
 */
function withFrozenSupport(
  input: AdaptExecutedReviewQueueInput,
  frozen: FrozenSupportInputs,
): AdaptExecutedReviewQueueInput {
  const { supportHistory: _liveSupportHistory, supportSelfAssessment: _liveSupportSelfAssessment, ...rest } =
    input;
  return { ...rest, ...frozen };
}

/**
 * C5.8's freeze, made real: one `SittingState<readonly ReviewQueueItem[]>`
 * per instance, driven by `rebuild-controller.ts`'s own `decideRebuild` —
 * see this section's module doc for why this exists and what each verb does.
 */
export function createFrozenReviewQueue(deps: FrozenReviewQueueDeps): FrozenReviewQueue {
  let sitting: SittingState<readonly ReviewQueueItem[]> = IDLE_SITTING;
  let frozenSupport: FrozenSupportInputs = {};

  function open(input: OpenFrozenReviewQueueInput): readonly ReviewQueueItem[] {
    const now = deps.now();

    if (sitting.status === 'active') {
      const today = localToday(now);
      const decision = decideRebuild(sitting, {
        now,
        ...(deps.idleThresholdMs !== undefined ? { idleThresholdMs: deps.idleThresholdMs } : {}),
        // `decideRebuild` never reads `trigger` while a sitting is active
        // (rebuild-controller.ts's own doc) — this satisfies the required
        // field honestly (today's own date, both sides, every named fact
        // `false`) rather than fabricating a between-sittings fact this
        // adapter has no way to observe, the same posture `session-builder/
        // provider.ts`'s `load()` takes for the identical shape of call.
        trigger: {
          lastRebuiltDay: today,
          today,
          materialLandedSinceLastRebuild: false,
          assessmentDatePassedSinceLastRebuild: false,
        },
        staleness: input.staleness ?? NOT_STALE,
      });
      if (decision.action === 'hold') return sitting.items;
      // `'sitting-stale'`: `[D-162]` rules the sitting ENDS — never a
      // recompose of the unreviewed tail — so this falls through to the
      // fresh composition below exactly as the idle case does.
      sitting = exitSitting();
    }

    frozenSupport = captureFrozenSupport(input);
    const items = adaptExecutedReviewQueue(input);
    sitting = enterSitting(now, items);
    return items;
  }

  function extend(input: AdaptExecutedReviewQueueInput): readonly ReviewQueueItem[] {
    const now = deps.now();

    if (sitting.status !== 'active') {
      // Nothing composed yet this sitting — this call IS the composition
      // instant, so its own support inputs are what gets frozen (`open`'s
      // fresh-compose path, mirrored).
      frozenSupport = captureFrozenSupport(input);
      const candidates = adaptExecutedReviewQueue(input);
      sitting = enterSitting(now, candidates);
      return candidates;
    }

    // `[D-186]`: a live sitting's own support decisions are already fixed —
    // see `withFrozenSupport`'s doc. Only the candidate LIST is fresh.
    const candidates = adaptExecutedReviewQueue(withFrozenSupport(input, frozenSupport));

    const known = new Set(sitting.items.map((item) => item.instrument.instrumentId));
    const additions = candidates.filter((item) => !known.has(item.instrument.instrumentId));
    const extended = additions.length === 0 ? sitting.items : [...sitting.items, ...additions];
    // The freeze clock does not restart on an extension — `enteredAt` still
    // marks when SHE opened this sitting, which is what the idle threshold
    // (C5.8's "long enough that coming back is a return") must keep
    // measuring against, not when it was last topped up.
    sitting = enterSitting(sitting.enteredAt, extended);
    return extended;
  }

  function close(): void {
    sitting = exitSitting();
  }

  return { open, extend, close };
}
