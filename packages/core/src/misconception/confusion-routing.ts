/**
 * F2.12 — confusion routing (`ol-p4t05`).
 *
 * "When a card is failed repeatedly (threshold tuned, ~4 lapses), do not
 * simply reschedule it harder — surface the option to explain the concept
 * back instead." The clause's own worked example:
 *
 *   "You've missed this four times. That's usually not forgetting — want to
 *   explain it back?"
 *
 * — cited by the vocabulary registry (V3) as "the streak case done right:
 * fact, evidence-grounded reinterpretation, one action." This module is the
 * one place that sentence, and the decision behind it, get built — the same
 * "framing is centralised, never inlined at a call site" discipline
 * `./framing.ts` (M3) already applies to a `MisconceptionRecord`'s status
 * line. `FORBIDDEN_VERDICT_PHRASES` from that module is the same mechanical
 * floor reused here (`confusion-routing.spec.ts`), because principle 12
 * binds this sentence exactly as it binds that one: a repeated failure is
 * described as evidence and reframed, never read back to her as a verdict on
 * her effort.
 *
 * **Scope, deliberately narrow.** This module decides WHETHER to offer —
 * given the rating just recorded and the resulting FSRS lapse count — and
 * what the offer says. It does not decide WHERE that offer is shown, does
 * not persist anything, and does not call the grading pipeline
 * (`../grading/gradingPipeline.js`'s `gradeExplainBack`) itself: routing an
 * instrument's repeated failure INTO the explain-back surface is one step;
 * grading whatever she then writes is a separate, already-built step
 * (`ol-drfy`) this module hands nothing to directly. See
 * `packages/plugin/src/grading/wiring.ts`'s module doc for the composition
 * that ties the two together, and its own doc for why the review-rating call
 * site that would invoke this function is a separate, concurrently-owned
 * lane's work (`packages/plugin/src/review/**`) rather than this bead's.
 *
 * **The threshold is DECLARED, not derived** (component register's
 * declared/derived line): the clause's own words are "threshold tuned, ~4
 * lapses" — an intentionally round, defensible-in-plain-English number, not
 * one fitted against a corpus or eval set. `CONFUSION_ROUTING_LAPSE_THRESHOLD`
 * is exported so a future derivation (were one ever run) has one named
 * constant to replace, per the register's constants-inventory discipline.
 *
 * **Only `SchedulerState.lapses` after `rating === 'again'` can trigger
 * this** — never a raw occurrence count, never elapsed time. F2.14 keeps
 * explain-back itself off FSRS scheduling entirely, so an explain-back
 * attempt never has a `lapses` count of its own to feed back in here; the
 * loop this module closes is strictly "a scheduled instrument's repeated
 * `again` ratings route to the on-demand surface," never the reverse. F2.15
 * additionally routes a repeated wrong MCQ pick through the same clause —
 * this function does not care which instrument type produced the rating,
 * only that scheduling is what handed it a `SchedulerState` to read.
 *
 * ## The prerequisite-aware offer ([D-265] ruling 2, amending F2.12 Sep 2026)
 *
 * The clause: *"A prerequisite-aware offer, read at trigger time, nothing
 * persisted about the judgement. Where the failing concept records a direct
 * prerequisite edge, this same trigger also reads that prerequisite's
 * current evidence from the local projection, fresh each time, never a
 * stored judgement. Four cases: where the prerequisite reads weak or
 * unknown, the offer names it as the alternative to explaining the failing
 * concept back; where it reads strong, the offer is the ordinary one above
 * and no detour is proposed on the failing concept's own lapses alone;
 * where the prerequisite's evidence is defective, provisional or inherited,
 * it counts as neither weak nor strong and the ordinary offer stands.
 * Direct prerequisites only, one at a time, never a tour of the chain."*
 *
 * **This rides F2.12's existing trigger and channel — it is not a second
 * intervention.** `[D-265]`'s own words, and the boundary document's §4a
 * prohibition this module is bound by: *"rides F2.12's existing trigger and
 * channel rather than adding a new intervention with its own proposal
 * path."* So `evaluateConfusionRouting` gains no new trigger condition —
 * `rating === 'again'` at or past the threshold is still the only gate —
 * and the prerequisite branch only changes WHAT the resulting offer says,
 * never WHETHER one fires.
 *
 * **Nothing here computes a prerequisite's evidence.** {@link
 * DirectPrerequisiteEvidence} is supplied already-read by the caller, from
 * whatever the local projection is at call time — the same "narrow slice a
 * caller already holds, none of it re-derived here" posture
 * `../study-session/strong-recall-proposal.ts`'s module doc states for its
 * own evidence input. This module never resolves a prerequisite edge
 * (`../concept/prerequisite-order.js`'s job), never folds a review log
 * (`../mastery/rollup.js`'s job), and never walks past the one edge it is
 * handed — "direct prerequisites only, one at a time, never a tour" is
 * enforced by this module's input SHAPE (one optional edge, not a list or a
 * graph), not by a loop that stops early.
 *
 * **Selection/intervention/measurement prohibitions (boundary doc §4a)
 * apply directly, and here is how this module keeps to them:**
 * - *"Intervention writes no retrievability, no mastery and no
 *   eligibility."* This module returns a decision object; it performs no
 *   write of any kind, prerequisite branch included.
 * - *"Selection diagnoses nothing."* Nothing produced here is "the failing
 *   concept's lapses trace to the prerequisite" — the offer proposes a
 *   different thing to look at, structurally identical in kind to the
 *   ordinary offer, and the clause's own stated limitation is honoured:
 *   the prerequisite edge is concept-level, so this module never claims the
 *   failing item itself depends on the prerequisite, only that the
 *   prerequisite concept may be worth a look.
 * - Recording an offer as provenance (D7.1, principle 16) and honouring
 *   "declining is not a state" (F2.21) are the CALLER's job, exactly as they
 *   already are for the ordinary offer — this module's output carries
 *   everything a caller needs to record it (see
 *   {@link ConfusionRoutingOffer.prerequisiteConceptId}) but performs no
 *   recording itself.
 *
 * **No new user-visible affordance.** The prerequisite branch reuses F2.12's
 * existing offer surface end to end — same trigger, same one-action shape,
 * same on-demand channel (F2.14) the clause names ("she chooses, through
 * F2.14's on-demand channel; nothing enters the queue"). Only the sentence
 * and the concept it points at change.
 */

/**
 * Declared (see module doc), not persisted. A Class B tunable default: raising
 * or lowering it changes only which future review outcomes route, never a
 * past event.
 */
export const CONFUSION_ROUTING_LAPSE_THRESHOLD = 4;

/**
 * The narrow slice of a just-completed review this module needs. `rating` is
 * the four-way `olea-contracts` rating (mirroring `ScheduleInput.rating` in
 * `../scheduler/types.js`) — deliberately typed as `string` rather than
 * importing `Rating` from `olea-contracts`, because the only value this
 * function ever branches on is the literal `'again'`; narrowing to that one
 * comparison keeps this module free of a contracts dependency for a single
 * string check. A caller already holds a real `Rating` and passes it through
 * unchanged.
 */
/**
 * The direct prerequisite's current evidence reading, as read fresh by the
 * caller from the local projection at F2.12's trigger ([D-265] ruling 2,
 * see module doc). Six names the clause distinguishes, only two
 * behaviours: `'weak'`/`'unknown'` route the offer onto the prerequisite;
 * `'strong'` keeps the ordinary offer; `'defective'` (an item-defect
 * exclusion has been applied to evidence behind this reading — knowledge
 * model §8, F2.23), `'provisional'` and `'inherited'` (a concept-split
 * prior not yet demonstrated on its own, functional scope §"course/concept
 * splits") each count as **neither** weak nor strong, so the ordinary offer
 * stands. Kept as six distinct literals, never collapsed to a boolean, so a
 * caller and a test can see WHICH reading applied — this module branches on
 * only the two groups, never the six, and never re-derives a reading from
 * anything else.
 */
export type PrerequisiteEvidenceReading =
  | 'weak'
  | 'unknown'
  | 'strong'
  | 'defective'
  | 'provisional'
  | 'inherited';

const PREREQUISITE_READINGS_THAT_ROUTE_THE_OFFER: ReadonlySet<PrerequisiteEvidenceReading> =
  new Set<PrerequisiteEvidenceReading>(['weak', 'unknown']);

/**
 * The failing instrument's concept's direct prerequisite edge, and that
 * prerequisite's current evidence — read fresh, never a stored judgement
 * ([D-265] ruling 2: *"reads that prerequisite's current evidence from the
 * local projection, fresh each time, never a stored judgement"*). **Direct
 * prerequisites only, one at a time**: this type holds a single edge, never
 * a list or a chain — a caller that resolved multiple direct prerequisites,
 * or a chain behind the direct one, picks the one edge to pass here rather
 * than handing this module anything to walk (F2.12: *"never a tour of the
 * chain"*).
 */
export interface DirectPrerequisiteEvidence {
  /** Opaque id of the direct prerequisite concept — never a display name (D-005). A rendering surface resolves this to a title; this module never does. */
  readonly conceptId: string;
  readonly reading: PrerequisiteEvidenceReading;
}

export interface ConfusionRoutingInput {
  /** The rating just recorded for this instrument, e.g. from `ScheduleInput.rating`. */
  readonly rating: string;
  /**
   * This instrument's lapse count AFTER the rating above was applied — e.g.
   * `ScheduleOutput.state.lapses`. Total times ever rated `again` from a
   * `review` state (`../scheduler/types.js`'s `SchedulerState.lapses` doc).
   */
  readonly lapses: number;
  /**
   * The failed instrument's concept's direct prerequisite and its current
   * evidence, when the concept records one ([D-265] ruling 2). Absent when
   * no direct prerequisite edge is recorded — the ordinary offer stands,
   * exactly as before this ruling. Supplying this never makes
   * `evaluateConfusionRouting` read or write anything: the reading arrives
   * already computed, once, by a caller holding the local projection.
   */
  readonly directPrerequisite?: DirectPrerequisiteEvidence;
}

/**
 * Which of F2.12's two offer shapes a decision produced ([D-265] ruling 2).
 * Optional on {@link ConfusionRoutingOffer} so a decision built the way
 * every caller and test predating this ruling already builds one — `{
 * shouldOffer: true, lapses, promptText }`, with no `offerKind` at all —
 * still satisfies the type; its absence reads as `'explain-back'`, which is
 * exactly the behaviour those callers already have.
 */
export type ConfusionRoutingOfferKind = 'explain-back' | 'prerequisite-alternative';

export interface ConfusionRoutingOffer {
  readonly shouldOffer: true;
  /** Echoes `ConfusionRoutingInput.lapses` — the count the prompt text is built from. */
  readonly lapses: number;
  /** F2.12's offer sentence — `confusionRoutingPromptLine` for `'explain-back'`, `prerequisiteAlternativePromptLine` for `'prerequisite-alternative'`. */
  readonly promptText: string;
  /** See {@link ConfusionRoutingOfferKind}. Absent reads as `'explain-back'`. */
  readonly offerKind?: ConfusionRoutingOfferKind;
  /**
   * The direct prerequisite named as the alternative. Present only when
   * {@link offerKind} is `'prerequisite-alternative'`. Opaque id, never a
   * display name (D-005) — same discipline as
   * {@link DirectPrerequisiteEvidence.conceptId}.
   */
  readonly prerequisiteConceptId?: string;
}

export interface ConfusionRoutingNoOffer {
  readonly shouldOffer: false;
}

export type ConfusionRoutingDecision = ConfusionRoutingOffer | ConfusionRoutingNoOffer;

const NO_OFFER: ConfusionRoutingNoOffer = { shouldOffer: false };

/**
 * Spelled out for the counts this clause actually reaches in v0.9 (a session
 * caps effort, so an instrument realistically racks up single digits of
 * lapses before other clauses intervene); a numeral is the honest fallback
 * past that rather than inventing more words. Index 0/1 are never reached by
 * `evaluateConfusionRouting` (the threshold is 4) but are kept so this
 * function is total over any non-negative input, including direct tests of
 * `confusionRoutingPromptLine`.
 */
const SMALL_NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const;

function spellLapseCount(lapses: number): string {
  if (Number.isInteger(lapses) && lapses >= 0 && lapses < SMALL_NUMBER_WORDS.length) {
    const word = SMALL_NUMBER_WORDS[lapses];
    if (word !== undefined) return word;
  }
  return String(lapses);
}

/**
 * F2.12's offer sentence, generalised over the lapse count that triggered it.
 * At `lapses === 4` this is the clause's own worked example, verbatim.
 *
 * Shape mirrors V3 exactly, in order: fact ("you've missed this N times"),
 * evidence-grounded reinterpretation ("that's usually not forgetting"), one
 * available action ("want to explain it back?"). Nothing here is a verdict on
 * her effort or discipline (principle 12) — `confusion-routing.spec.ts`
 * checks every generated line against `FORBIDDEN_VERDICT_PHRASES`
 * (`./framing.js`) as the same mechanical floor `framing.spec.ts` applies to
 * misconception-record framing.
 */
export function confusionRoutingPromptLine(lapses: number): string {
  return `You've missed this ${spellLapseCount(lapses)} times. That's usually not forgetting — want to explain it back?`;
}

/**
 * F2.12's prerequisite-aware offer sentence ([D-265] ruling 2) — the same V3
 * shape {@link confusionRoutingPromptLine} uses: fact, evidence-grounded
 * reinterpretation, one available action. Deliberately hedged ("may trace
 * to", never "is caused by") to match the clause's own stated limitation —
 * *"the offer proposes, it does not decide"* — and deliberately names no
 * concept, the same content-free discipline every prompt-line builder in
 * this package keeps (`confusionRoutingPromptLine` above,
 * `../study-session/strong-recall-proposal.ts`'s `strongRecallPromptLine`):
 * the prerequisite this offer is ABOUT travels structurally, on
 * {@link ConfusionRoutingOffer.prerequisiteConceptId}, for a rendering
 * surface that already knows how to resolve an id to a title — this
 * function never invents that resolution itself.
 */
export function prerequisiteAlternativePromptLine(lapses: number): string {
  return (
    `You've missed this ${spellLapseCount(lapses)} times. That's usually not forgetting — ` +
    'but it may trace to something earlier. Want to explain that back instead?'
  );
}

/**
 * F2.12's whole decision, in one pure function: does this just-recorded
 * outcome cross the repeated-failure line, and if so, what does the offer
 * say?
 *
 * Fires on `rating === 'again'` at or past
 * `CONFUSION_ROUTING_LAPSE_THRESHOLD` — every subsequent failure past the
 * threshold re-offers, not just the first crossing, matching the clause's
 * "when a card is failed repeatedly" rather than a one-shot notice. A rating
 * other than `'again'` (the instrument was NOT just failed) never offers,
 * regardless of `lapses` — a correct answer after a rough patch is progress,
 * not a fresh trigger.
 *
 * **The prerequisite branch ([D-265] ruling 2) decides only WHAT the offer
 * says, never WHETHER one fires** — it is evaluated only once the two gates
 * above have already decided to offer. `directPrerequisite` absent, or
 * present with a `'strong'`, `'defective'`, `'provisional'` or `'inherited'`
 * reading, all produce the ordinary explain-back offer unchanged; only
 * `'weak'`/`'unknown'` switch the offer onto the prerequisite. See the
 * module doc for the full clause and the boundary-document prohibitions
 * this keeps to.
 */
export function evaluateConfusionRouting(input: ConfusionRoutingInput): ConfusionRoutingDecision {
  if (input.rating !== 'again') return NO_OFFER;
  if (input.lapses < CONFUSION_ROUTING_LAPSE_THRESHOLD) return NO_OFFER;

  const { directPrerequisite } = input;
  if (
    directPrerequisite !== undefined &&
    PREREQUISITE_READINGS_THAT_ROUTE_THE_OFFER.has(directPrerequisite.reading)
  ) {
    return {
      shouldOffer: true,
      lapses: input.lapses,
      offerKind: 'prerequisite-alternative',
      prerequisiteConceptId: directPrerequisite.conceptId,
      promptText: prerequisiteAlternativePromptLine(input.lapses),
    };
  }

  return {
    shouldOffer: true,
    lapses: input.lapses,
    offerKind: 'explain-back',
    promptText: confusionRoutingPromptLine(input.lapses),
  };
}
