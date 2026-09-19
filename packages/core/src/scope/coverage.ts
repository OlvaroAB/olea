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
 * plumbs this per concept; **no production caller yet has a durable store for
 * it** (there is no local ground-streak persistence built this round) — see
 * that module's doc and this bead's close notes for the honest gap.
 * `GROUND_STALL_STREAK_THRESHOLD` is a plain-English default (declared, not
 * derived — this project has no real semester of ground-persistence data to
 * fit against yet), reversible via an ordinary Class B tuning pass.
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
 * How many consecutive evaluations a concept must read `ground` before it is
 * flagged a stall (F4.5) rather than an ordinary in-flight reading. Declared,
 * not derived (see module doc) — 2 is "more than the first time we looked",
 * the smallest count that actually says "persisting" rather than "just
 * seen".
 */
export const GROUND_STALL_STREAK_THRESHOLD = 2;

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
  /** F8.2's taught-signal steps two through five (`[D-247]`) — see `TaughtSignalEvidence` and the module doc's "taught-signal chain" section. Absent means none of those steps have been checked yet; `hasMaterial` (step one) still applies on its own. */
  readonly taughtSignal?: TaughtSignalEvidence;
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
      /** The ground-streak AFTER this evaluation — 0 for a growth-stage state (the streak resets the moment an instrument exists), incremented by one for `ground`. Hand this back to the next evaluation's `priorGroundStreak` for the same concept. */
      readonly groundStreak: number;
      /** F8.2's teaching-arrival provenance (`[D-247]`) — always `yes` here: a cell only ever exists because step one (her own note) or step two (the week's slide deck) opened it (`resolveTeachingArrival`'s `opensAutomatically`). */
      readonly teachingArrivalProvenance: TeachingArrivalProvenance;
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
  // existed, except that every returned cell now carries that `yes`.
  if (input.instrumentCount === 0) {
    const groundStreak = input.priorGroundStreak + 1;
    return {
      kind: 'cell',
      state: 'ground',
      stall: groundStreak >= GROUND_STALL_STREAK_THRESHOLD,
      groundStreak,
      teachingArrivalProvenance: 'yes',
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
  };
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
