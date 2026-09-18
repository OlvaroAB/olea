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
}

/** One recovered sitting, carrying F4.2's current/historical regime qualifier alongside its recovered sections (empty when only file existence, not content, was recoverable). */
export interface PaperRecoveredSitting {
  readonly regime: 'current' | 'historical';
  readonly sections: readonly PaperRecoveredSection[];
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
 */
export type PaperEmptySlotReasonCode = 'no-held-source' | 'generator-refused' | 'rank-excluded';

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
  readonly alpha: PaperWeightingAlpha;
  readonly formatClass: PaperFormatClass;
  readonly steering: PaperSteering;
  readonly structureSummary: {
    readonly sittingCount: number;
    readonly currentCount: number;
    readonly historicalCount: number;
  } | null;
  readonly eligibleCount: number;
  readonly slots: readonly PaperBlueprintSlot[];
  readonly emptySlots: readonly PaperEmptySlot[];
}
