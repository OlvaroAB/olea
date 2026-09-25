/**
 * Per-concept coverage classification (F8.2; `ol-o8eo`).
 *
 * The vocabulary registry (`docs/Olea_vocabulary_registry.md` §6, `[D-054]`)
 * ratifies exactly two olive nouns for a per-concept coverage READING —
 * **`ground`** and **`volunteer`** — and reuses the growth-stage axis's own
 * four words (F2.11, `../mastery/rollup.js`: `seed`/`sprout`/`sapling`/
 * `tree`) verbatim once a concept has an instrument built. `ol-o8eo`'s "six
 * states" is the union of those two vocabularies, never a fifth invented
 * word: `ground | seed | sprout | sapling | tree | volunteer`.
 *
 * **A `material gap` (F4.10) is deliberately NOT a seventh state here.** The
 * registry's §6 ruling is explicit and threefold: it already has a name
 * (F4.10), the metaphor argues against a fourth olive noun ("ground is soil
 * you can plant in; where the material is absent there is no soil"), and a
 * synonym in a controlled vocabulary is a defect. So `classifyDeclaredConcept`
 * below returns a distinct `'material-gap'` outcome rather than folding it
 * into `ground` — matching `../gap/build.ts`'s own `classifyGap`, which draws
 * the identical line for the identical reason (F4.5 vs F4.10, "a correctness
 * failure, not a simplification").
 *
 * **`ground` narrows to exactly one row (`[D-054]` §6's "ground correction"):
 * material present, in scope, nothing generated yet.** Material absent is a
 * material gap, never ground (F8.2's "week-one no-material" scenario). An
 * instrument that exists but is unpractised is `seed` (the mastery axis's own
 * floor), never ground — `ground` and `seed` are mutually exclusive by
 * construction below: `ground` fires only when `instrumentCount === 0`, and
 * `seed`/`sprout`/`sapling`/`tree` only ever apply once an instrument exists.
 *
 * ## The stall flag (F4.5, `[D-063]`)
 *
 * Under unbounded generation, `ground` is a *processing* state, not a
 * standing one — every in-scope concept with material is queued for
 * instrument generation, so `ground` should drain as the ingestion queue
 * drains. A `ground` cell that PERSISTS is therefore a fault to investigate,
 * never "Olea decided this one wasn't worth building" (no such judgement
 * exists under `[D-063]`). `classifyDeclaredConcept` flags this as `stall`
 * once a concept has read `ground` for at least
 * {@link GROUND_STALL_STREAK_THRESHOLD} consecutive evaluations.
 *
 * **This module holds no history of its own (§7.1: pure, no clock, no I/O).**
 * "Persisting across desktop sessions" needs a streak counter that survives
 * between evaluations, and this module cannot be the thing that survives —
 * so `priorGroundStreak` comes in from the caller and the (possibly
 * incremented) streak comes back out on every classification, for the caller
 * to persist and hand back next time. `./grove.ts`'s `buildGroveModel`
 * plumbs this per concept, and `../../../plugin/src/grove/ground-streak-
 * store.ts`'s `ObsidianGroveGroundStreakStore` is the durable store
 * `./grove.ts`'s own module doc once named as missing — it now closes that
 * gap (`ol-0r92.20`). `GROUND_STALL_STREAK_THRESHOLD` is a plain-English
 * default (declared, not derived — this project has no real semester of
 * ground-persistence data to fit against yet), reversible via an ordinary
 * Class B tuning pass.
 *
 * **"Every classification" was wrong, not just imprecise (`ol-egov.141.89.11.14`,
 * found by the standing-views trace, review 4.7).** The durable store above
 * closed "does the streak survive a restart" but not "what counts as ONE
 * evaluation" — `../../../plugin/src/grove/provider.ts`'s `load()` (the
 * grove's only production caller, unowned by this bead) runs once per grove
 * READ, i.e. once per time she opens or refreshes the pane, which has no
 * relationship to how often the generation/ingestion queue has actually
 * attempted to turn this concept's `ground` into a built instrument. Under
 * the ORIGINAL contract (`priorGroundStreak` in, `groundStreak` out,
 * unconditionally `+1` while still `ground`), reopening the grove twice with
 * no processing in between advanced the streak twice — "opening the grove
 * more often makes a course look stalled sooner," never what F4.5 or this
 * doc's own "consecutive evaluations" meant. `[D-063]`'s Class B default,
 * stated at review item 4.7: **a stall counts processing passes, not
 * renders.**
 *
 * `processingPassId` (optional, alongside `priorProcessingPassId` /
 * {@link DeclaredConceptClassification}'s `groundStreakProcessingPassId`) is
 * the fix: an opaque token the caller mints once per PROCESSING pass (the
 * generation/ingestion queue's own sweep — never a grove read), never
 * derived by this pure module itself (no clock, no I/O — see above). Two
 * calls carrying the SAME token are two READS of the same pass's outcome
 * and the streak holds; two calls carrying DIFFERENT tokens are two DISTINCT
 * passes and the streak advances — see `classifyDeclaredConcept`'s
 * implementation. **Omitting `processingPassId` preserves this function's
 * original, unconditional-`+1` behaviour exactly** — required so that
 * `./grove.ts` (owned by `ol-egov.141.89.7.4`, sequenced after this bead,
 * not this bead's to edit) keeps compiling and running unchanged: today's
 * only production caller does not pass this field yet, so today's
 * production behaviour, including this defect, is UNCHANGED by this bead
 * alone. The fix takes effect once `./grove.ts`/`provider.ts` are wired to
 * mint a real per-sweep token and thread `groundStreakProcessingPassId` back
 * through the ground-streak store's own new `loadProcessingPasses`/
 * `saveProcessingPasses` pair (see that module's doc) — that wiring is
 * `ol-egov.141.89.7.4`'s work, named here as the honest gap this bead leaves.
 *
 * ## The C7.9 part-of fold (`ol-5phn`, discovered from `ol-i8at`)
 *
 * "A broad area and its own parts are never counted as separate peers
 * against the denominator" (C7.9) needs a fold over `part-of` edges before
 * `./grove.ts` assembles its denominator, or a container concept and one of
 * its declared parts both land their own entry. `containerNamesToFold`
 * below is that fold, over concept NAMES (this module's own grain — see
 * `isVolunteer` below) rather than keys, because `./grove.ts` builds its
 * `declaredNames` set from `ConceptCitation.conceptName` before it ever
 * resolves a name to a `ConceptRecord`.
 *
 * **Same rule as the sibling consumer, not a new one.**
 * `../session/containment.ts`'s `filterContainmentCoPresence` (C7.9,
 * `ol-v7r5.5`) already made this call for session composition: `part-of` is
 * directed, `from` is the finer/part side, `to` is the coarser/container
 * side, and the container yields when both sides are present — the part is
 * the finer, recoverable reading and the container is not (the identical
 * asymmetry C7.9 states for concept size itself, two sentences before the
 * denominator sentence this fold implements). This function applies the
 * same direction and the same yielding side; it does not re-derive either.
 *
 * **Zero free parameters**, matching `containment.ts`'s own discipline: a
 * name's membership in the drop set is decided by set membership over
 * `edges`, nothing else. An edge naming a concept outside `declaredNames` is
 * dropped, not guessed at — the same posture `containment.ts` takes toward
 * an edge endpoint its own concept set does not resolve.
 *
 * ## The taught-signal chain (F8.2, `[D-247]`, CIM-3 / `ol-2zfj.81`)
 *
 * A material gap does not sit inert forever. F8.2 as amended: **"what turns a
 * material gap into a live concept: a taught signal, sought in this
 * order"** — her own note; the week's slide deck; a calendar session plus
 * slide sequence; the outcomes document's own order; manual confirmation in
 * the grove. Each step that fires yields a **teaching-arrival provenance**
 * ({@link TeachingArrivalProvenance}) — `yes` (direct, from her note or the
 * deck), `probable` (inferred from sequence), `possible` (from outcome
 * order) — and **only the first two open a concept automatically; the later
 * steps lower the provenance rather than change the rule.**
 *
 * **Step one is `hasMaterial`, unchanged.** "Her own note" is exactly the
 * `notePaths.length > 0` reading this module already used before this
 * amendment — no new field, just a second reading of the same fact. Steps
 * two through five are new evidence, carried on the optional
 * {@link TaughtSignalEvidence} input; `resolveTeachingArrival` below walks
 * the chain in order and stops at the first step that fires, so a weaker
 * later signal never overrides a stronger earlier one that also happens to
 * be present.
 *
 * **The calendar is optional, never a dependency, and never a signal by
 * itself.** F8.2's own wording pairs it with a slide sequence as one joint
 * step ("a calendar session plus slide sequence") — there is deliberately no
 * separate calendar-only field on {@link TaughtSignalEvidence}, so a caller
 * cannot accidentally treat the calendar alone as sufficient.
 *
 * **A past assessment never opens a concept.** Examiner attestation (a past
 * paper, an objectives document) is what makes a name a candidate for this
 * whole chain in the first place — it is the reason `./grove.ts` calls
 * `classifyDeclaredConcept` for this name at all — but it never doubles as
 * evidence that the material has been *taught*. This is enforced by
 * construction rather than by a runtime check: nothing about past-paper or
 * objectives citation counts is accepted anywhere in
 * {@link TaughtSignalEvidence} or `ClassifyDeclaredConceptInput`, so there is
 * no field through which "in scope" could leak into "taught".
 *
 * **The fifth step (manual confirmation) is not named its own provenance
 * word in F8.2's prose** — the clause names exactly three words (`yes`,
 * `probable`, `possible`) for its five steps, explicitly tying `probable` to
 * "inferred from sequence" (step three) and `possible` to "from outcome
 * order" (step four). This module reads the unnamed fifth step as sharing
 * the floor of the two steps CIM-3's own bead groups it with — "calendar+
 * slide-sequence, outcomes order and manual grove confirmation stop at
 * probable/possible provenance" — and assigns it `possible`: it is the step
 * of last resort, reached only once every automated signal above has found
 * nothing, and `probable` stays reserved for the one step the clause
 * actually calls "inferred from sequence". This reading is a Class B
 * vocabulary call, not a threshold; flagged here for visibility rather than
 * silently assumed.
 *
 * ## Thin coverage is a sentence, never a state (F8.2, `[D-247]`, CIM-6 / `ol-2zfj.83`)
 *
 * "Thin coverage" — material present but not carrying enough to support the
 * kind of question the course asks about a concept, judged against the
 * **breadth the concept is expected to require, never document length** —
 * reads today as a SENTENCE on an existing cell, not a new
 * {@link GroveDeclaredState} and not a new enum value anywhere in this
 * module. `[D-247]` is explicit that it becomes a further coverage *state*
 * only after a `[D-194]` pre-commitment on her own explain-back outcomes
 * survives (`findings/D194-thin-coverage-precommitment.md`, olea-service
 * repo) — **that pre-commitment has not run**, so this module deliberately
 * stops at the sentence.
 *
 * **The judgment is the caller's, not this module's** — same discipline as
 * `resolveTeachingArrival`: whether a concept's material is thin against its
 * expected breadth is a model read over the actual passages, which this
 * pure, no-I/O module cannot make. {@link ClassifyDeclaredConceptInput
 * .thinCoverageSignal} carries that already-resolved judgment in; when it is
 * `true` AND the concept opened (a material gap can never be "thin" —
 * thinness names material that is present but insufficient, never material's
 * absence), the returned cell carries {@link THIN_COVERAGE_SENTENCE}
 * verbatim, alongside its existing `state`. Omitting the signal (or a
 * caller that has not wired this judgment yet) yields today's behaviour
 * exactly — no sentence, nothing inferred from document length or any other
 * structural stand-in for it.
 *
 * ## Four confidences, never collapsed (F8.2, F8.3, `[D-247]`, CIM-6)
 *
 * `[D-247]` names four confidences that must never be merged into one figure
 * — scope, assessment, coverage and teaching-arrival confidence, each on its
 * own basis and in its own sentence. F8.3 already bans a single coverage
 * scalar; this is the same discipline applied to confidence. Scope and
 * assessment confidence are written elsewhere (F4.1/F4.2 — CIM-5 / CIM-1,
 * out of this bead's owned files) and arrive here as already-written
 * sentences to be assembled, never recomputed; this module contributes only
 * the assembly. {@link describeFourConfidences} does that assembling and is
 * deliberately arithmetic-free: it takes four sentences and returns four
 * sentences, with no numeric field anywhere on {@link FourConfidenceReading}
 * for a caller to accidentally average or score.
 */

import type { MasteryState } from 'olea-contracts';
import type { ConceptRelation } from '../concept/relation.js';

/**
 * The five states a concept WITH declared scope can read, before the
 * `volunteer` word ever applies (`volunteer` names a concept OUTSIDE the
 * declared scope entirely — see `./grove.ts`'s `isVolunteer`, not this
 * type). `'ground'` plus the four growth-stage words, verbatim.
 */
export type GroveDeclaredState = 'ground' | MasteryState;

/**
 * An opaque token naming ONE processing pass — one sweep of whatever process
 * actually attempts to turn a `ground` concept into a built instrument (the
 * generation/ingestion queue), never a grove read or a render. See the
 * module doc's "The stall flag" section for why `classifyDeclaredConcept`
 * needs this to tell "read twice" apart from "processed twice, still stuck".
 * The token's identity (a counter, a queue-run id, a timestamp) is entirely
 * the caller's choice — this module only ever compares two tokens for
 * equality, never interprets one.
 */
export type ProcessingPassToken = string;

/**
 * How many consecutive PROCESSING PASSES a concept must read `ground` before
 * it is flagged a stall (F4.5) rather than an ordinary in-flight reading —
 * see the module doc's "The stall flag" section for why this is passes, not
 * calls to this function, and why a caller that omits `processingPassId`
 * gets the pre-fix, per-call reading instead. Declared, not derived (see
 * module doc) — 2 is "more than the first time we looked", the smallest
 * count that actually says "persisting" rather than "just seen".
 */
export const GROUND_STALL_STREAK_THRESHOLD = 2;

/**
 * F8.2's thin-coverage sentence, verbatim (`[D-247]`, CIM-6 / `ol-2zfj.83`).
 * Rendered on a cell whose material opened it but whose caller-supplied
 * judgment reads that material as insufficient against the breadth the
 * concept is expected to require — **never against document length**. See
 * the module doc's "Thin coverage is a sentence, never a state" section for
 * why this is a sentence rather than a new {@link GroveDeclaredState}, and
 * `findings/D194-thin-coverage-precommitment.md` (olea-service repo) for
 * what must survive before it becomes one.
 */
export const THIN_COVERAGE_SENTENCE =
  'your material mentions this but does not yet give enough to support the kind of question the course asks about it';

/**
 * The three teaching-arrival provenance words F8.2 names, `[D-247]` — `yes`
 * (direct: her own note or the week's slide deck), `probable` (inferred: a
 * calendar session plus slide sequence), `possible` (the outcomes document's
 * own order, or manual confirmation in the grove — see the module doc's note
 * on why the fifth step shares this floor rather than getting a fourth
 * word). Never a fourth value — "no new word is needed", the same economy
 * F8.2 already applies to `volunteer`.
 */
export type TeachingArrivalProvenance = 'yes' | 'probable' | 'possible';

/**
 * Evidence for taught-signal steps TWO through FIVE (step one is
 * `ClassifyDeclaredConceptInput.hasMaterial` itself — "her own note", read
 * unchanged). Every field is a plain boolean: this module holds no clock and
 * no I/O, so whether a slide deck names a concept, whether a calendar
 * session paired with a slide sequence places it in a taught week, whether
 * the outcomes document's order reaches it, and whether it has been manually
 * confirmed in the grove are all facts the caller has already resolved
 * before this module ever runs — matching `containerNamesToFold`'s own
 * "zero free parameters, decided by the caller's input alone" discipline.
 *
 * Absent (the whole object, or any one field) reads as `false` — a caller
 * that has not wired a given step's evidence yet gets exactly today's
 * behaviour for that step, never a guess.
 */
export interface TaughtSignalEvidence {
  /** Step two: the week's slide deck names or covers this concept. Direct evidence — opens automatically, exactly like `hasMaterial`. */
  readonly inWeekSlideDeck: boolean;
  /**
   * Step three: a calendar session PLUS a slide sequence place this concept
   * in a taught week — F8.2's own joint signal. There is deliberately no
   * separate calendar-only field (see module doc): the calendar is never a
   * signal by itself, only ever paired with a slide sequence as this one
   * field.
   */
  readonly calendarSessionWithSlideSequence: boolean;
  /** Step four: the outcomes document's own order places this concept at or before the current point in the term. Inferred — lowers to `possible`, never opens automatically. */
  readonly outcomesDocumentOrder: boolean;
  /** Step five: manual confirmation in the grove — the step of last resort, reached only once every step above has found nothing. Lowers to `possible` alongside outcome order (module doc). Never opens automatically. */
  readonly manualGroveConfirmation: boolean;
}

/** `resolveTeachingArrival`'s result — see that function's doc. */
export interface TeachingArrival {
  /** `undefined` means no taught signal at all fired — not even the lowest tier. */
  readonly provenance: TeachingArrivalProvenance | undefined;
  /** `true` only when the provenance is `yes` — i.e. only for step one (her own note) or step two (the week's slide deck). Every other case, including no signal at all, is `false`. */
  readonly opensAutomatically: boolean;
}

/**
 * Walk F8.2's taught-signal chain in order and stop at the first step that
 * fires — see the module doc's "taught-signal chain" section for the full
 * argument. `hasOwnNote` is step one (`ClassifyDeclaredConceptInput
 * .hasMaterial`, read again under its taught-signal name); `signal` carries
 * steps two through five, and may be omitted entirely (every step then reads
 * `false`, so a caller that has not wired any of this yet behaves exactly as
 * it did before this chain existed — a plain material gap with no
 * provenance recorded).
 *
 * A past assessment (examiner attestation) is not a parameter here at all —
 * see the module doc's "a past assessment never opens a concept" note for
 * why that omission is the enforcement mechanism, not an incidental gap.
 */
export function resolveTeachingArrival(
  hasOwnNote: boolean,
  signal?: TaughtSignalEvidence,
): TeachingArrival {
  if (hasOwnNote) return { provenance: 'yes', opensAutomatically: true };
  if (signal?.inWeekSlideDeck) return { provenance: 'yes', opensAutomatically: true };
  if (signal?.calendarSessionWithSlideSequence) {
    return { provenance: 'probable', opensAutomatically: false };
  }
  if (signal?.outcomesDocumentOrder) return { provenance: 'possible', opensAutomatically: false };
  if (signal?.manualGroveConfirmation) return { provenance: 'possible', opensAutomatically: false };
  return { provenance: undefined, opensAutomatically: false };
}

/** What `classifyDeclaredConcept` needs to classify one in-scope concept. */
export interface ClassifyDeclaredConceptInput {
  /** Whether her vault has ANY material naming this concept — `ConceptMaterialPresence.notePaths.length > 0`. Also F8.2's taught-signal step one ("her own note"); see `resolveTeachingArrival`. `false` with no other taught signal means F4.10's material gap, never `ground` (the "week-one no-material" rule). */
  readonly hasMaterial: boolean;
  /** `ConceptMaterialPresence.instrumentCount` — INSTRUMENTS, not cards (a Q&A card, a cloze or an MCQ quiz item all count, per the registry's own correction). Zero with `hasMaterial: true` is `ground`. */
  readonly instrumentCount: number;
  /**
   * The growth-stage rollup (`../mastery/rollup.js#computeConceptMastery`) for
   * this concept — required once `instrumentCount > 0` (an instrument exists,
   * so a mastery reading must exist for it too), ignored otherwise. Passing
   * `instrumentCount > 0` with this `undefined` is this caller's own bug and
   * throws, matching `../registry/build.ts`'s own "unreachable given the
   * input contract, guarded rather than trusted" convention.
   */
  readonly masteryState?: MasteryState;
  /** The ground-streak this concept carried INTO this evaluation — 0 for "never read ground before, or this is the first evaluation". See module doc for why this is a caller-supplied value rather than internal state. */
  readonly priorGroundStreak: number;
  /**
   * `ol-egov.141.89.11.14`: which processing pass THIS evaluation's
   * `hasMaterial`/`instrumentCount` reading came from — see
   * {@link ProcessingPassToken} and the module doc's "The stall flag"
   * section for why a call count is the wrong thing to advance
   * `priorGroundStreak` on. **Omitted (today's only production caller, not
   * yet wired — see module doc) preserves this function's original,
   * unconditional `+1` behaviour exactly** — this field only ever changes
   * anything when supplied.
   */
  readonly processingPassId?: ProcessingPassToken;
  /**
   * The processing-pass identity {@link priorGroundStreak} was last advanced
   * against — the caller's own persisted value, mirroring
   * `priorGroundStreak`'s own "in, mutate, out, persist" contract (see
   * {@link DeclaredConceptClassification}'s `groundStreakProcessingPassId`
   * and `../../../plugin/src/grove/ground-streak-store.ts`'s
   * `loadProcessingPasses`/`saveProcessingPasses` for the durable half).
   * Omitted means "unknown" (a fresh install, or data predating this field)
   * — treated as "differs from `processingPassId`", so the FIRST call that
   * supplies `processingPassId` still advances the streak once. Ignored
   * entirely when `processingPassId` itself is omitted.
   */
  readonly priorProcessingPassId?: ProcessingPassToken;
  /** F8.2's taught-signal steps two through five (`[D-247]`) — see `TaughtSignalEvidence` and the module doc's "taught-signal chain" section. Absent means none of those steps have been checked yet; `hasMaterial` (step one) still applies on its own. */
  readonly taughtSignal?: TaughtSignalEvidence;
  /**
   * F8.2's thin-coverage judgment (`[D-247]`), already resolved by the
   * caller — `true` means the caller's model read found this concept's
   * material present but insufficient against the breadth it is expected to
   * require (never document length). This module never derives the
   * judgment itself; see the module doc's "Thin coverage is a sentence,
   * never a state" section. `undefined`/`false` yields today's behaviour —
   * no sentence. Ignored entirely for a concept that does not open (a
   * material gap is never "thin" — see {@link THIN_COVERAGE_SENTENCE}'s
   * doc).
   */
  readonly thinCoverageSignal?: boolean;
}

/** One concept's classification — a material gap, named in plain language per the registry (never a `GroveDeclaredState`), or a real coverage cell. */
export type DeclaredConceptClassification =
  | {
      readonly kind: 'material-gap';
      /** F8.2's teaching-arrival provenance (`[D-247]`) — absent means no taught signal fired at all, not even the lowest tier. Never `yes`: a `yes` provenance always opens the concept (see `resolveTeachingArrival`), so a material gap only ever carries `probable` or `possible` here. */
      readonly teachingArrivalProvenance?: TeachingArrivalProvenance;
    }
  | {
      readonly kind: 'cell';
      readonly state: GroveDeclaredState;
      /** F4.5's stall flag — always `false` for a growth-stage state; only ever `true` for `state: 'ground'`. */
      readonly stall: boolean;
      /** The ground-streak AFTER this evaluation — 0 for a growth-stage state (the streak resets the moment an instrument exists), advanced by one for `ground` (see module doc: unconditionally when `processingPassId` is omitted, only across a DISTINCT `processingPassId` when supplied). Hand this back to the next evaluation's `priorGroundStreak` for the same concept. */
      readonly groundStreak: number;
      /**
       * `ol-egov.141.89.11.14`: the processing-pass identity {@link groundStreak}
       * was just advanced (or held) against — present only when the caller
       * supplied `processingPassId` on this call, and always `undefined` for a
       * growth-stage state (mirrors `groundStreak: 0`'s own "resets the moment
       * an instrument exists" reasoning — there is no pass identity left to
       * carry once a concept leaves `ground`). Hand this back as the next
       * evaluation's `priorProcessingPassId` for the same concept, exactly
       * mirroring `groundStreak`/`priorGroundStreak`'s own contract.
       */
      readonly groundStreakProcessingPassId?: ProcessingPassToken;
      /** F8.2's teaching-arrival provenance (`[D-247]`) — always `yes` here: a cell only ever exists because step one (her own note) or step two (the week's slide deck) opened it (`resolveTeachingArrival`'s `opensAutomatically`). */
      readonly teachingArrivalProvenance: TeachingArrivalProvenance;
      /**
       * F8.2's thin-coverage sentence (`[D-247]`), present verbatim
       * ({@link THIN_COVERAGE_SENTENCE}) only when the caller supplied
       * `thinCoverageSignal: true` — absent otherwise. Layered on top of
       * `state`, never a state or enum value of its own; see the module
       * doc's "Thin coverage is a sentence, never a state" section.
       */
      readonly thinCoverageSentence?: string;
    };

/**
 * Classify one concept already known to be IN the declared scope (F8.1's
 * denominator) — `./grove.ts` is what decides denominator membership; this
 * function only ever sees a concept already inside it.
 */
export function classifyDeclaredConcept(
  input: ClassifyDeclaredConceptInput,
): DeclaredConceptClassification {
  const arrival = resolveTeachingArrival(input.hasMaterial, input.taughtSignal);

  if (!arrival.opensAutomatically) {
    return arrival.provenance === undefined
      ? { kind: 'material-gap' }
      : { kind: 'material-gap', teachingArrivalProvenance: arrival.provenance };
  }

  // `arrival.opensAutomatically` is only ever true for provenance `yes` — her
  // own note (`input.hasMaterial`) or the week's slide deck
  // (`input.taughtSignal?.inWeekSlideDeck`), F8.2's first two taught-signal
  // steps. Everything from here down is unchanged from before this chain
  // existed, except that every returned cell now carries that `yes`, and may
  // also carry `[D-247]`'s thin-coverage sentence (see the module doc). The
  // field is spread in only when the signal fires, rather than set to
  // `undefined`, so a caller that never wired this signal sees exactly
  // today's object shape — no key at all, not a key holding `undefined`.
  const thinCoverage = input.thinCoverageSignal
    ? { thinCoverageSentence: THIN_COVERAGE_SENTENCE }
    : {};

  if (input.instrumentCount === 0) {
    // `ol-egov.141.89.11.14`: advance only across a DISTINCT processing pass,
    // never merely because this function was called again (a grove
    // read/render) — see `processingPassId`'s own doc. Omitting
    // `processingPassId` (today's only production caller, not yet wired —
    // module doc) falls through to the ORIGINAL unconditional-`+1` reading,
    // unchanged.
    const advancesStreak =
      input.processingPassId === undefined ||
      input.processingPassId !== input.priorProcessingPassId;
    const groundStreak = advancesStreak ? input.priorGroundStreak + 1 : input.priorGroundStreak;
    return {
      kind: 'cell',
      state: 'ground',
      stall: groundStreak >= GROUND_STALL_STREAK_THRESHOLD,
      groundStreak,
      ...(input.processingPassId !== undefined
        ? { groundStreakProcessingPassId: input.processingPassId }
        : {}),
      teachingArrivalProvenance: 'yes',
      ...thinCoverage,
    };
  }

  if (input.masteryState === undefined) {
    throw new Error(
      'classifyDeclaredConcept: instrumentCount > 0 requires a masteryState — ' +
        'every concept with an instrument has a growth-stage rollup, even if it is `seed`.',
    );
  }
  return {
    kind: 'cell',
    state: input.masteryState,
    stall: false,
    groundStreak: 0,
    teachingArrivalProvenance: 'yes',
    ...thinCoverage,
  };
}

/**
 * F8.2's four confidences, `[D-247]` (CIM-6 / `ol-2zfj.83`) — scope,
 * assessment, coverage and teaching-arrival confidence, each a sentence on
 * its own basis. Exactly these four named fields, every one a `string`
 * (a sentence), and nothing else: F8.3's ban on a single coverage scalar
 * applies here with the same force, and this type is how it is enforced in
 * code rather than merely stated in a comment (see
 * `coverage.spec.ts`'s "never collapse to a scalar" test, which asserts
 * this shape directly and would fail the moment a fifth, numeric field were
 * added).
 */
export interface FourConfidenceReading {
  /** Confidence in the concept's own scope placement (F4.1/F4.2's basis — written elsewhere, carried here unchanged). */
  readonly scopeConfidence: string;
  /** Confidence in the assessment-directed ranking read for this concept (F4.2's basis — written elsewhere, carried here unchanged). */
  readonly assessmentConfidence: string;
  /** Confidence in this concept's coverage reading — this module's own basis (ground/growth-stage state, and F8.2's thin-coverage sentence where present). */
  readonly coverageConfidence: string;
  /** Confidence in this concept's teaching-arrival provenance — this module's own basis (`resolveTeachingArrival`'s `yes`/`probable`/`possible`, or its absence). */
  readonly teachingArrivalConfidence: string;
}

/**
 * Assembles the four confidence sentences into one {@link FourConfidenceReading}
 * — assembly only, never combination. This function does no arithmetic and
 * makes no judgment of its own: each sentence is written by whichever basis
 * produced it (two of the four are this module's own — see
 * `describeCoverageConfidence` and `describeTeachingArrivalConfidence` —
 * and two arrive from elsewhere, F4.1/F4.2) and is returned unchanged
 * alongside the other three. There is no path through this function, or
 * anywhere else in this module, that reduces the four to a single score.
 */
export function describeFourConfidences(input: FourConfidenceReading): FourConfidenceReading {
  return {
    scopeConfidence: input.scopeConfidence,
    assessmentConfidence: input.assessmentConfidence,
    coverageConfidence: input.coverageConfidence,
    teachingArrivalConfidence: input.teachingArrivalConfidence,
  };
}

/**
 * This module's own basis for coverage confidence — a sentence describing
 * how well-founded the coverage reading itself is, never a number. `ground`
 * carries a plain sentence naming Olea's own generation debt; a
 * thin-coverage sentence present lowers the confidence sentence to name the
 * breadth gap explicitly, because the coverage reading is then resting on a
 * model judgment about sufficiency rather than on the presence/absence of
 * material alone. A growth-stage state (an instrument exists, and mastery
 * has its own separate reading, F2.11) reads as confidently covered.
 */
export function describeCoverageConfidence(classification: DeclaredConceptClassification): string {
  if (classification.kind === 'material-gap') {
    return 'no material is present yet, so there is nothing to read a coverage confidence against';
  }
  if (classification.thinCoverageSentence !== undefined) {
    return 'material is present but its breadth against the course has not been confirmed — the reading rests on a model judgment, not yet on her own explain-back outcomes';
  }
  if (classification.state === 'ground') {
    return "material is present and in scope; Olea's own generation debt, not a judgment about the material's breadth";
  }
  return 'material is present and at least one instrument has been built and read against it';
}

/**
 * This module's own basis for teaching-arrival confidence — a sentence
 * naming which step of F8.2's taught-signal chain produced the provenance,
 * never a number. Mirrors `TeachingArrivalProvenance`'s three named steps
 * plus the no-signal-at-all case; see `resolveTeachingArrival`'s doc for the
 * chain itself.
 */
export function describeTeachingArrivalConfidence(
  provenance: TeachingArrivalProvenance | undefined,
): string {
  switch (provenance) {
    case 'yes':
      return "direct evidence — her own note or the week's slide deck names this concept as taught";
    case 'probable':
      return 'inferred from a calendar session paired with a slide sequence, not from direct evidence of teaching';
    case 'possible':
      return "inferred from the outcomes document's own order, or confirmed manually in the grove — the weakest of the three taught-signal tiers";
    default:
      return 'no taught signal has fired at all; being in scope is not evidence of teaching';
  }
}

/**
 * Whether `conceptName` is a `volunteer` (F8.2) — built from her notes, but
 * outside `declaredNames` (F8.1's denominator, read from registered sources).
 * Deliberately a name-level test, matching `../evidence-edge/build.ts`'s own
 * `ConceptCitation.conceptName` join: a citation carries no concept `key`,
 * only the vocabulary name it matched, so denominator membership can only
 * ever be decided by name (R2 — her exact wording).
 */
export function isVolunteer(conceptName: string, declaredNames: ReadonlySet<string>): boolean {
  return !declaredNames.has(conceptName);
}

/**
 * The C7.9 part-of fold for `./grove.ts`'s denominator (see module doc): the
 * declared-scope concept NAMES to drop before assembling `cells` and
 * `materialGaps` — every `part-of` edge whose part side (`from`) and
 * container side (`to`) are BOTH present in `declaredNames`. Edge types
 * other than `part-of` are ignored rather than rejected, so a caller may
 * hand over a whole edge set without pre-filtering by type — this fold is
 * C7.9's alone and `part-of`'s alone, matching `../session/containment.ts`'s
 * identical posture toward its own `edges` input.
 *
 * Pure and total: no clock, no I/O. A no-op whenever `edges` is empty —
 * which is every caller that has not yet threaded a relation set through
 * (`./grove.ts`'s `relations` field is optional for exactly this reason).
 */
export function containerNamesToFold(
  edges: readonly ConceptRelation[],
  declaredNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const drop = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== 'part-of') continue;
    if (declaredNames.has(edge.from) && declaredNames.has(edge.to)) drop.add(edge.to);
  }
  return drop;
}
