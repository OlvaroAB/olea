/**
 * Shared types for the practice-paper generation pipeline (F4.11, `[D-250]`/`[D-252]`,
 * component register row 2.11, `[H-blueprint]` / `ol-0r92.75`).
 *
 * This module names the shapes `./paper-unlock.ts`, `./paper-blueprint.ts`, `./paper-items.ts`
 * and `./paper-store.ts` share, so the four stay one pipeline rather than four modules agreeing
 * on a shape by convention. Nothing here does I/O or reaches a model — same discipline
 * `./types.ts` (F4.2's ranking types) already holds for this directory.
 *
 * **Two different "coverage" grains, not one number reused.** The unlock rule's material-coverage
 * leg (`./paper-unlock.ts`) reads `OutcomeConceptCoverage.outcomeCoverageShare`
 * (`../outcome/reconcile-coverage.js`) — a share of the course's EXAMINER-DECLARED scope
 * (Outcomes, `[ONT-R5]`) that carries at least one attached concept. The blueprint's per-slot
 * weighting (`./paper-blueprint.ts`) reads a binary, per-CONCEPT held-source flag instead — "does
 * this one eligible concept have material behind it." F4.11 keeps these on separate bases ("never
 * folded into one denominator"); this module keeps them as separate fields for the same reason.
 * (`./paper-unlock.ts` imports `OutcomeConceptCoverage` directly from `../outcome/reconcile-
 * coverage.js` — not restated here, since it is already the exact shape needed.)
 */

/** F8.2's taught-signal provenance enum. Eligibility (F4.11: "a concept the course does not teach never appears") requires `'yes'` or `'probable'` — `'possible'` is excluded, matching the harness tier's `TAUGHT_ELIGIBLE_SIGNALS`. */
export type PaperTaughtSignal = 'yes' | 'probable' | 'possible';

/**
 * A source held for the course that a blueprint slot may ground in (F4.11's grounding tier, C4.7).
 * `'past-paper'` is a valid *kind* generally, but `./paper-blueprint.ts`'s own blinding rule
 * (mirroring `playback-paper.mjs`'s stricter input condition) never grounds a generated item in
 * one — see that module's doc.
 */
export interface PaperHeldSource {
  readonly kind: 'objectives' | 'lecturer-material' | 'notes' | 'textbook' | 'past-paper';
  readonly sourceId: string;
  readonly chunks: readonly string[];
}

/**
 * One concept within the course's declared scope, as the blueprint stage needs to see it.
 * `outcomeId` is the parent Outcome (`[ONT-R5]`) when the caller's own outcome→concept join
 * (`../outcome/reconcile.js`) has resolved one — absent for a concept the reconciliation has not
 * (yet) attached to any Outcome, which is an honest state, not an error.
 */
export interface PaperScopeConcept {
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly outcomeId?: string;
  readonly taughtSignal: PaperTaughtSignal;
  readonly heldSources: readonly PaperHeldSource[];
  /** `null` when no real mastery evidence exists for this concept (TRD-1's corpus-wide case today) — never a fabricated midpoint. */
  readonly masteryScore: number | null;
}

/** One Outcome, restated at the field grain the blueprint's emphasis matching needs (F4.11 ruling 3) — never the whole `OutcomeRecord` shape, so this module does not need to import `../outcome/types.js`'s persisted schema to do arithmetic over a label and a child list. */
export interface PaperScopeOutcome {
  readonly outcomeId: string;
  readonly label: string;
  readonly conceptKeys: readonly string[];
}

/** Her assignments-table row, restated at the two fields F4.11 and F4.8 need. */
export interface PaperAssessment {
  readonly type: string;
  /** ISO `YYYY-MM-DD`. */
  readonly due: string;
}

/**
 * F4.11 ruling 1's declared demand vocabulary (`[D-262]`, vocabulary registry §13) — what a
 * question asks her to do, independent of which generator serves it. Distinct from
 * `PaperFormatClass` (§11): format class is coarse and derived mechanically from her assignments
 * table; demand is finer-grained and read from the past papers' own questions, never from the
 * `type` word alone. Named as a "small, extensible vocabulary" by the ruling — these five are all
 * this release reads; a sixth is a Class C addition to this array, not a silent extension.
 */
export const PAPER_DEMANDS = Object.freeze([
  'recall-a-fact',
  'calculate',
  'compare-or-choose',
  'apply-to-unfamiliar-case',
  'interpret-printed-result',
] as const);

/** One word from `PAPER_DEMANDS`. */
export type PaperDemand = (typeof PAPER_DEMANDS)[number];

/**
 * One demand reading recovered from a non-sealed past paper's own question — F4.11 input (b),
 * "read from the paper itself, with the source that shows it" (`[D-262]` ruling 1). `sourceRef`
 * is an opaque pointer (never opened by this pipeline) to the sitting the reading came from, so a
 * demand that ends up unbuilt (ruling 4) can be pointed at rather than merely named.
 */
export interface PaperDemandReading {
  readonly demand: PaperDemand;
  readonly sourceRef: string;
}

/**
 * Ruling 4's face-statement payload: the one demand kind the composition's own evidence names
 * that no generator declares, plus where it was read. `pointerSourceRefs` is deduped and never
 * empty when this type is constructed — a demand with no citable source is never surfaced (see
 * `./paper-blueprint.ts`'s `dominantDemand`/`flattenDemandReadings`).
 */
export interface PaperFaceDemandGap {
  readonly demand: PaperDemand;
  /** Opaque pointers (never opened by this pipeline) to the held, non-sealed past papers whose questions ask this demand — "points at the held non-sealed past papers that ask it." */
  readonly pointerSourceRefs: readonly string[];
}

/**
 * One section of a recovered, NON-holdout past paper — the shape `outcomes.extract.v1`'s
 * `paperStructure.sections` response emits (`olea-service/src/tasks/outcomesExtract.ts`,
 * private), restated here since this package has no dependency on that Worker task's schema
 * (same "restate the shape, never import the private source" discipline
 * `draft-quiz-cards.ts`'s `QuizGenerateRequestPayload` already documents for a sibling task).
 */
export interface PaperRecoveredSection {
  readonly label: string;
  readonly questionForm: string;
  readonly itemCount: number;
  readonly marks: number;
  /**
   * F4.11 ruling 1 — the demand(s) this section's own questions ask, read from the past paper
   * itself. `undefined`/empty when not (yet) recovered at this grain — the same honest-placeholder
   * posture `sections: []` already carries at the sitting level (`playback-paper.mjs`'s
   * `recoverStructure` doc): full sub-part recovery, and now demand recovery within it, stays a
   * real, named limitation rather than a guess.
   */
  readonly demands?: readonly PaperDemand[];
}

/** One recovered sitting, carrying F4.2's current/historical regime qualifier alongside its recovered sections (empty when only file existence, not content, was recoverable). */
export interface PaperRecoveredSitting {
  readonly regime: 'current' | 'historical';
  readonly sections: readonly PaperRecoveredSection[];
  /**
   * An opaque pointer to this sitting's own source (never opened by this pipeline) — carried so a
   * demand read from one of its sections can be named and pointed at from the paper's face
   * (ruling 4, "with the source that shows it"). `undefined` when the caller has none to give; a
   * section's `demands` are then never attributable to a source and `flattenDemandReadings`
   * (`./paper-blueprint.ts`) skips them rather than pointing at nothing.
   */
  readonly sourceRef?: string;
}

/**
 * The composition of the course's own past assessment evidence — F4.11 input (b), NEVER including
 * a sealed judge-reference sitting (the caller's own responsibility; see `./paper-blueprint.ts`'s
 * blinding note, mirroring `playback-paper.mjs`'s `assertNotSealedPath`).
 */
export interface PaperRecoveredStructure {
  readonly sittingCount: number;
  readonly currentCount: number;
  readonly historicalCount: number;
  readonly sittings: readonly PaperRecoveredSitting[];
}

/** F4.11 ruling 3's two steerable inputs. Format class and a specific past sitting are deliberately absent — never dials, per that ruling's own text. */
export type PaperExtent = 'shorter' | 'standard' | 'longer';

export interface PaperSteering {
  /** A scope area the examiner already attests — matched against an Outcome's label or a concept's own name (see `./paper-blueprint.ts`'s `matchesEmphasis`). Reweights only; never adds a concept outside eligibility. */
  readonly emphasis?: string;
  readonly extent?: PaperExtent;
}

/**
 * F4.11's amended ruling (i) (`[D-277]`, ol-egov.141.87, TARGET-4/ol-v7r5.58) — the paper's
 * declared purpose, frozen with the paper, governing composition. Two modes this release; blends
 * are deferred ("two clearly governed modes are easier to explain and to verify than a spectrum").
 *
 * - `'assessment-simulation'` — follows the declared blueprint's own supported proportions and
 *   **never** weights selection by her weakness: `./paper-blueprint.ts`'s ranking reads
 *   `PaperScopeConcept.masteryScore` for this purpose not at all, regardless of whether a real
 *   value is present.
 * - `'focused-practice'` — selects inside the SAME declared scope (eligibility, held-source
 *   grounding and demand routing are all purpose-blind — see below), using evidence gaps and
 *   demonstrated weakness: `./paper-blueprint.ts`'s `focusedPracticeWeight` is read, not the
 *   general `conceptWeight` blend — the purpose-specific complement that inverts `conceptWeight`'s
 *   mastery-favours-mastery direction so a WEAKER concept (a low `masteryScore`) ranks higher
 *   (`ol-egov.141.6.17`, client `7e3639d`; selecting what she already knows best is the opposite
 *   of focused practice on her weakness).
 *
 * Purpose changes **which asks are selected and in what proportions, and nothing else** (ruling
 * (i)'s own text) — three things it never does, each with its own regression test in
 * `./paper-blueprint.spec.ts`:
 *   1. it never widens the taught boundary (`isEligibleConcept`'s gate runs before purpose is
 *      ever consulted, identically for both modes);
 *   2. it never supplies missing source support (a concept with no held source is `no-held-source`
 *      under both modes — a high weakness signal never manufactures grounding that is not there);
 *   3. it never turns thin evidence into a weakness claim (`masteryScore: null` — "no real mastery
 *      evidence exists," never a fabricated midpoint — still falls back to the coverage-only,
 *      undiscounted weight `conceptWeight`'s own `masteryFallback` path already gives it; it is
 *      never scored as though a real, low mastery reading had been read).
 *
 * A student-visible affordance to CHOOSE a purpose is out of this module's scope (no wording lives
 * here — `packages/plugin/src/paper/copy.ts` is the student-facing surface, not owned by this
 * bead); see `./paper-blueprint.ts`'s `DEFAULT_PAPER_PURPOSE` doc for what a caller that does not
 * yet choose one gets, and why.
 */
export const PAPER_PURPOSES = Object.freeze(['assessment-simulation', 'focused-practice'] as const);

/** One word from `PAPER_PURPOSES`. */
export type PaperPurpose = (typeof PAPER_PURPOSES)[number];

/** F4.8's three format classes, restated (see `../assessment/format-class.js`'s `AssessmentFormatClass` — identical values, restated here so this directory's public shape does not couple to that module's own type identity). */
export type PaperFormatClass = 'recall-style' | 'written' | 'practical';

/** The two existing generators this pipeline may call (F4.11/6d; the T3-margin gap this repo already names means nothing else fills a slot today). */
export type PaperGeneratorTaskId = 'cards.generate.v1' | 'quiz.generate.v1';

/** `'T2'` — every item this pipeline can currently produce; `'T3'` (the labelled model-extended margin, 6d) is named for completeness but never reachable through `./paper-items.ts` today — see that module's doc. */
export type PaperGroundingTier = 'T2' | 'T3';

/** Per-item coverage label (F8.3, F4.11) — a label, never a rate. */
export type PaperGroundingLabel =
  | 'covered-by-her-material'
  | 'course-scope-only'
  | 'model-extended';

/** One filled slot in a blueprint — everything `./paper-items.ts` needs to call a generator, plus the labels the paper object (`./paper-store.ts`) carries forward onto the finished item. */
export interface PaperBlueprintSlot {
  readonly slotId: string;
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly outcomeId?: string;
  readonly formatClass: PaperFormatClass;
  /** F4.11 ruling 1/7 (`[D-262]`) — the demand this slot intends, read from input (b)'s non-sealed past-paper evidence. Composition-wide today: every slot in one paper shares the same reading, mirroring `formatClass`'s own uniform-per-composition shape (see `./paper-blueprint.ts`'s `dominantDemand`) — there is no per-concept question join to read a finer-grained assignment from. */
  readonly intendedDemand: PaperDemand;
  readonly taskId: PaperGeneratorTaskId;
  readonly groundingTier: PaperGroundingTier;
  readonly groundingLabel: PaperGroundingLabel;
  readonly heldSourceKind: PaperHeldSource['kind'];
  readonly heldSourceId: string | null;
  readonly sourceChunks: readonly string[];
  readonly weight: number;
  /** Whether ruling 3's emphasis steering boosted this slot's weight — recorded so the composition account can say so, per "recorded in the composition's account as her assertion." */
  readonly emphasised: boolean;
}

/**
 * Machine-readable partition of WHY a slot could not be filled (`[D-258]` / `PAPER-5`) — kept
 * alongside the existing free-text `reason` so a caller (an audit, or a future composition-account
 * copy) can switch on the reason without string-matching prose (D-005: `reason` stays descriptive
 * text; `reasonCode` is the field anything mechanical may branch on).
 *
 * - `'no-held-source'` — F4.10: the concept reached ranking inside the slot cap but carries no
 *   held source at all (T2 exhausted; T3, the labelled model-extended margin, is not reachable
 *   through the existing card/quiz generators — see `./paper-items.ts`).
 * - `'generator-refused'` — the slot reached generation but the port refused (`./paper-items.ts`'s
 *   `fillPaperBlueprintSlots`, e.g. a schema-validation failure or the task's own INV-5
 *   groundedness/emptyContextGuard check).
 * - `'rank-excluded'` — the concept was eligible (`isEligibleConcept`) but ranked at or below
 *   `extentSlotCountTarget`'s slot cap, and so never became a candidate at all. Distinct from
 *   `'no-held-source'`: a rank-excluded concept may well hold a source — it simply ranked too low
 *   this time. This is the reason code `[D-258]` adds; the other two already existed as prose.
 * - `'demand-unsupported'` — F4.11 ruling 4 (`[D-262]`): the slot's intended demand
 *   (`PaperBlueprintSlot.intendedDemand`) is not declared served by the generator kind the slot
 *   would otherwise route to. Checked BEFORE the held-source check — a slot can be
 *   `demand-unsupported` even where a held source exists, since the gap is about what the
 *   generator can produce, never about grounding. Distinct from `'generator-refused'`: that code
 *   means the generator was asked and refused at generation time; this one means no generator
 *   kind was ever asked, because none declares the demand.
 */
export type PaperEmptySlotReasonCode =
  | 'no-held-source'
  | 'generator-refused'
  | 'rank-excluded'
  | 'demand-unsupported';

/** A ranked, eligible concept the blueprint could not fill — F4.10's never-invent rule, named rather than silently dropped (mirrors `playback-paper.mjs`'s `emptySlots`). */
export interface PaperEmptySlot {
  readonly slotId: string;
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly reasonCode: PaperEmptySlotReasonCode;
  readonly reason: string;
}

/** The blueprint's own free parameter — the coverage/mastery weighting share (mirrors `playback-paper.mjs`'s `BLUEPRINT_WEIGHTING_SETTINGS_DECLARED`; the same three declared points, not re-declared as a distinct constant — see `./paper-blueprint.ts`). */
export type PaperWeightingAlpha = 0.25 | 0.5 | 0.75;

/**
 * The blueprint: slots filled and left empty, plus everything a composition account (F6.11(c))
 * needs to state what was chosen and what was set aside. Never itself a persisted object — the
 * paper (`./paper-store.ts`'s `PaperRecord`) is what gets written to the vault, built FROM one of
 * these plus its generated items.
 */
export interface PaperBlueprint {
  readonly formatVersion: 'paper-blueprint-v1';
  readonly course: string;
  readonly asOf: string;
  /**
   * F4.11 ruling (i) (`[D-277]`) — declared, frozen with the paper, governing composition
   * (`./paper-blueprint.ts`'s ranking; see `PaperPurpose`'s own doc for exactly what it does and
   * does not change). `buildPaperBlueprint` ALWAYS populates this — it is optional on the type
   * only so hand-built `PaperCompositionAccount`/`PaperBlueprint` fixtures elsewhere in this
   * codebase that predate this field (outside this bead's `owns`, so not edited here) stay valid
   * without a mechanical, unrelated edit; every blueprint the function itself builds carries a
   * real value, never omits one. Once this blueprint's fields land on the persisted `PaperRecord`
   * (`./paper-store.ts`'s `PaperCompositionAccount = Omit<PaperBlueprint, 'slots' | 'emptySlots'>`,
   * a structural derivation from this exact interface), `purpose` is carried through automatically
   * — no edit to `paper-store.ts` was needed to satisfy ruling (i)'s "frozen with the paper."
   * "Frozen" itself is this value's own immutability plus the caller's discipline of never
   * recomposing an existing paper (ruling (i): "a frozen paper may be annotated ... never
   * recomposed") — this module has no mutation path for an already-built blueprint to begin with.
   */
  readonly purpose?: PaperPurpose;
  readonly alpha: PaperWeightingAlpha;
  readonly formatClass: PaperFormatClass;
  /** F4.11 ruling 1/7 (`[D-262]`) — the demand this composition's slots intend (see `PaperBlueprintSlot.intendedDemand`). `'recall-a-fact'` when input (b) recovered nothing to read — the honest default every existing generator already serves, so a course with no demand data behaves exactly as it did before this ruling. */
  readonly intendedDemand: PaperDemand;
  readonly steering: PaperSteering;
  readonly structureSummary: {
    readonly sittingCount: number;
    readonly currentCount: number;
    readonly historicalCount: number;
  } | null;
  readonly eligibleCount: number;
  readonly slots: readonly PaperBlueprintSlot[];
  readonly emptySlots: readonly PaperEmptySlot[];
  /**
   * F4.11 ruling 4 (`[D-262]`) — non-null exactly when `intendedDemand` is not declared served by
   * the routed generator kind (every filled candidate becomes a `demand-unsupported` empty slot
   * instead of an item): the demand kind and the held non-sealed past papers that ask it, for the
   * paper's face statement. `null` when the composition's evidence names no demand any generator
   * fails to serve — the vocabulary registry's "no such statement" case.
   */
  readonly unbuiltDemand: PaperFaceDemandGap | null;
  /** `true` exactly when `unbuiltDemand !== null` — a named field for the word the ruling and vocabulary registry §13/§4 both use ("the paper is partial"), rather than asking every reader to null-check `unbuiltDemand` to learn it. */
  readonly partial: boolean;
}
