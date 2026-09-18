/**
 * `buildPaperBlueprint` — F4.11's four-input composition (`[D-250]`), as a pure, production-typed
 * function.
 *
 * Mirrors `scripts/harness/playback-paper.mjs`'s `buildBlueprint` (private repo, `[NEW-E4]`) on
 * the mechanism — eligible-concept ranking by a coverage/mastery blend, filled from a held source
 * up to a declared slot cap, F4.10's never-invent rule applied at slot grain — but operates on
 * this package's own domain types (`ConceptRecord`-shaped scope, `OutcomeRecord`-shaped parents)
 * rather than ad hoc harness JSON, and adds ruling 3's steering (emphasis, extent), left out of
 * the harness tier's own scope.
 *
 * **What this function does NOT do.** It never calls a generator — see `./paper-items.ts` for
 * turning a blueprint's slots into generated items. It never reads a sealed judge-reference
 * sitting — `structure` is the CALLER's responsibility to have already excluded one (this
 * function has no vault access and cannot enforce that itself; the caller mirrors
 * `playback-paper.mjs`'s `assertNotSealedPath`/`nonHoldoutPastPaperSources`).
 *
 * **Ruling 3 — emphasis.** A scope area the examiner already attests (an Outcome's own label, or
 * a concept's own name) is matched case-insensitively and substring-wise against
 * `steering.emphasis`; a match multiplies that concept's pre-emphasis weight by
 * `EMPHASIS_WEIGHT_BOOST_DECLARED`. **Never adds a concept outside eligibility** — the match runs
 * only over concepts `isEligibleConcept` already accepted, so an emphasis string naming something
 * the examiner does not attest simply matches nothing and changes no ranking.
 *
 * **Ruling 3 — extent.** `shorter`/`standard`/`longer` map to a slot-count target from the
 * course's OWN recovered structure (median/min/max of `sittings[*].sections[*].itemCount`,
 * summed per sitting) when any sitting carries recovered sections; otherwise a declared fallback
 * table (`EXTENT_FALLBACK_SLOT_COUNT_DECLARED`). Either way the result is clamped to
 * `MAX_BLUEPRINT_SLOTS_DECLARED` — a product-sanity ceiling, declared and unfitted, matching the
 * harness tier's own value so a dry run and a real composition never disagree about "how large is
 * too large for a practice paper."
 *
 * **Format class and a specific past sitting are never steering dials** — ruling 3's own text.
 * `formatClass` is derived from `assessments` exactly as `dominantFormatClass` does in the harness
 * tier; nothing in `steering` can change it.
 */

import type {
  PaperAssessment,
  PaperBlueprint,
  PaperBlueprintSlot,
  PaperEmptySlot,
  PaperEmptySlotReasonCode,
  PaperFormatClass,
  PaperGeneratorTaskId,
  PaperGroundingLabel,
  PaperHeldSource,
  PaperRecoveredStructure,
  PaperScopeConcept,
  PaperScopeOutcome,
  PaperSteering,
  PaperWeightingAlpha,
} from './paper-types.js';

/** F8.2's eligible taught signals — `'possible'` never opens a concept automatically (F4.11: "a concept the course does not teach never appears"). */
export const PAPER_TAUGHT_ELIGIBLE_SIGNALS = Object.freeze(['yes', 'probable'] as const);

export function isEligibleConcept(concept: PaperScopeConcept): boolean {
  return (PAPER_TAUGHT_ELIGIBLE_SIGNALS as readonly string[]).includes(concept.taughtSignal);
}

/**
 * Held-source kinds a blueprint slot may ground in. `'past-paper'` is deliberately absent — this
 * module's own stricter blinding rule (mirrors `playback-paper.mjs`'s `ALLOWED_HELD_SOURCE_KINDS`
 * / `validateScope`): structure and composition may inform the blueprint (`structure`,
 * separately), but a past paper's TEXT never becomes a generated item's grounding here.
 *
 * @provenance declared — the same "structure yes, text no" line the harness tier already drew,
 * restated for this module rather than re-derived.
 */
export const ALLOWED_HELD_SOURCE_KINDS = Object.freeze([
  'objectives',
  'lecturer-material',
  'notes',
  'textbook',
] as const);

/** Throws when a concept cites a disallowed held-source kind (past-paper, or unrecognised). */
export function validatePaperScope(concepts: readonly PaperScopeConcept[]): void {
  for (const concept of concepts) {
    for (const held of concept.heldSources) {
      if (!(ALLOWED_HELD_SOURCE_KINDS as readonly string[]).includes(held.kind)) {
        throw new Error(
          `buildPaperBlueprint: concept "${concept.conceptKey}" cites a held source of kind ` +
            `"${held.kind}", which this pipeline never grounds a generated item in. Allowed: ` +
            `${ALLOWED_HELD_SOURCE_KINDS.join(', ')}.`,
        );
      }
    }
  }
}

/** `1` when a concept carries at least one allowed held source, else `0` — declared, binary; mirrors the harness tier's `conceptCoverageScore`. No richer graded coverage signal exists to compute from (component register row 2.11's own "Undecided"). */
export function conceptCoverageScore(concept: PaperScopeConcept): 0 | 1 {
  return concept.heldSources.length > 0 ? 1 : 0;
}

export interface PaperConceptWeight {
  readonly weight: number;
  readonly coverageScore: 0 | 1;
  readonly masteryScore: number | null;
  readonly masteryFallback: boolean;
}

/** Composite slot weight at weighting `alpha` — mirrors the harness tier's `conceptWeight` exactly (mastery-absent falls back to coverage alone, flagged `masteryFallback`). */
export function conceptWeight(concept: PaperScopeConcept, alpha: number): PaperConceptWeight {
  const coverageScore = conceptCoverageScore(concept);
  if (concept.masteryScore === null) {
    return { weight: coverageScore, coverageScore, masteryScore: null, masteryFallback: true };
  }
  const weight = alpha * coverageScore + (1 - alpha) * concept.masteryScore;
  return { weight, coverageScore, masteryScore: concept.masteryScore, masteryFallback: false };
}

/**
 * Ruling 3's emphasis boost. DECLARED, not fitted — a plain "an emphasised area counts for more"
 * argument, the same order of magnitude choice `../misconception/matcher.ts`'s threshold doc
 * argues from a stated principle rather than a corpus.
 *
 * @provenance declared.
 */
export const EMPHASIS_WEIGHT_BOOST_DECLARED = 2;

function normaliseForMatch(value: string): string {
  return value.trim().toLowerCase();
}

/** `true` when `emphasis` names this concept — case-insensitive substring match against the concept's own name, or against the label of the Outcome it is parented under (when `outcomes` resolves one). Never matches a concept outside `isEligibleConcept` — the caller only ever calls this over already-eligible concepts. */
export function matchesEmphasis(
  concept: PaperScopeConcept,
  emphasis: string | undefined,
  outcomesById: ReadonlyMap<string, PaperScopeOutcome>,
): boolean {
  if (emphasis === undefined || emphasis.trim().length === 0) return false;
  const needle = normaliseForMatch(emphasis);
  if (normaliseForMatch(concept.conceptName).includes(needle)) return true;
  const outcome = concept.outcomeId !== undefined ? outcomesById.get(concept.outcomeId) : undefined;
  return outcome !== undefined && normaliseForMatch(outcome.label).includes(needle);
}

/** Ruling 3's extent → slot-count target when no recovered structure exists to derive one from. DECLARED, not fitted — bounded so both branches of `MAX_BLUEPRINT_SLOTS_DECLARED`'s clamp are exercisable. */
export const EXTENT_FALLBACK_SLOT_COUNT_DECLARED = Object.freeze({
  shorter: 4,
  standard: 6,
  longer: 8,
});

/** Product-sanity ceiling on a blueprint's slot count — declared, unfitted, matching the harness tier's own `MAX_BLUEPRINT_SLOTS_DECLARED` so a dry run and a real composition never disagree. */
export const MAX_BLUEPRINT_SLOTS_DECLARED = 8;

function sittingItemTotal(sitting: PaperRecoveredStructure['sittings'][number]): number {
  return sitting.sections.reduce((sum, section) => sum + section.itemCount, 0);
}

/** The extent-steered slot-count target, clamped to `[1, MAX_BLUEPRINT_SLOTS_DECLARED]`. */
export function extentSlotCountTarget(
  extent: PaperSteering['extent'],
  structure: PaperRecoveredStructure | null,
): number {
  const key = extent ?? 'standard';
  const totals = (structure?.sittings ?? [])
    .map(sittingItemTotal)
    .filter((total) => total > 0)
    .sort((a, b) => a - b);

  const target: number =
    totals.length === 0
      ? EXTENT_FALLBACK_SLOT_COUNT_DECLARED[key]
      : (totals[
          key === 'shorter'
            ? 0
            : key === 'longer'
              ? totals.length - 1
              : Math.floor((totals.length - 1) / 2)
        ] ?? EXTENT_FALLBACK_SLOT_COUNT_DECLARED[key]);
  return Math.max(1, Math.min(MAX_BLUEPRINT_SLOTS_DECLARED, Math.round(target)));
}

/** The dominant F4.8 format class across the course's own assessments — mirrors the harness tier's `dominantFormatClass` (falls to `'written'`, the least format-committal class, with no assessments at all). Never steerable (ruling 3). */
export function dominantFormatClass(
  assessments: readonly PaperAssessment[],
  formatClassOf: (type: string) => PaperFormatClass,
): PaperFormatClass {
  const tally = new Map<PaperFormatClass, number>();
  for (const assessment of assessments) {
    const cls = formatClassOf(assessment.type);
    tally.set(cls, (tally.get(cls) ?? 0) + 1);
  }
  if (tally.size === 0) return 'written';
  const [ranked] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  // `tally.size > 0` guarantees at least one entry — the `?? 'written'` is an unreachable,
  // type-only fallback (noUncheckedIndexedAccess cannot see the guard above correlates with it).
  return (ranked ?? ['written'])[0];
}

/** `recall-style` routes to the one existing generator with a real MCQ accept path; `written`/`practical` both fall to `cards.generate.v1` — the same documented gap `playback-paper.mjs`'s `taskIdForFormatClass` names (neither generator produces a free-response or practical-process item today). */
export function taskIdForFormatClass(formatClass: PaperFormatClass): PaperGeneratorTaskId {
  return formatClass === 'recall-style' ? 'quiz.generate.v1' : 'cards.generate.v1';
}

function groundingLabelFor(held: PaperHeldSource): PaperGroundingLabel {
  return held.kind === 'notes' ? 'covered-by-her-material' : 'course-scope-only';
}

export interface BuildPaperBlueprintInput {
  readonly course: string;
  readonly asOf: string;
  readonly concepts: readonly PaperScopeConcept[];
  /** Resolved Outcome parents, for ruling 3's emphasis match — omit when the caller has none resolved yet (emphasis then only matches concept names). */
  readonly outcomes?: readonly PaperScopeOutcome[];
  readonly assessments: readonly PaperAssessment[];
  /** Recovered NON-holdout structure (see module doc) — `null` when nothing was recoverable (e.g. no past papers registered for the course). */
  readonly structure: PaperRecoveredStructure | null;
  readonly alpha: PaperWeightingAlpha;
  readonly steering?: PaperSteering;
  /** F4.8's word→class table (`../assessment/format-class.js`'s `formatClassOf`), injected so this module has no opinion of its own about the mapping. */
  readonly formatClassOf: (type: string) => PaperFormatClass;
}

/** Assembles the blueprint. See the module doc for ruling 3's steering and the blinding responsibility this function does not itself enforce. */
export function buildPaperBlueprint(input: BuildPaperBlueprintInput): PaperBlueprint {
  validatePaperScope(input.concepts);
  const steering = input.steering ?? {};
  const outcomesById = new Map((input.outcomes ?? []).map((o) => [o.outcomeId, o]));
  const formatClass = dominantFormatClass(input.assessments, input.formatClassOf);
  const taskId = taskIdForFormatClass(formatClass);

  const eligible = input.concepts.filter(isEligibleConcept);
  const ranked = eligible
    .map((concept) => {
      const base = conceptWeight(concept, input.alpha);
      const emphasised = matchesEmphasis(concept, steering.emphasis, outcomesById);
      const weight = emphasised ? base.weight * EMPHASIS_WEIGHT_BOOST_DECLARED : base.weight;
      return { concept, ...base, weight, emphasised };
    })
    .sort(
      (a, b) => b.weight - a.weight || a.concept.conceptName.localeCompare(b.concept.conceptName),
    );

  const slotCap = extentSlotCountTarget(steering.extent, input.structure);
  const candidates = ranked.slice(0, slotCap);
  const rankExcluded = ranked.slice(slotCap);

  const slots: PaperBlueprintSlot[] = [];
  const emptySlots: PaperEmptySlot[] = [];

  candidates.forEach(({ concept, weight, emphasised }, index) => {
    const slotId = `slot-${index}`;
    const held = concept.heldSources[0];
    if (held === undefined) {
      emptySlots.push({
        slotId,
        conceptKey: concept.conceptKey,
        conceptName: concept.conceptName,
        reasonCode: 'no-held-source' satisfies PaperEmptySlotReasonCode,
        reason:
          'no held source (T2 exhausted); the labelled model-extended margin (6d) is not ' +
          'reachable through the existing card/quiz generators — see ./paper-items.ts',
      });
      return;
    }
    slots.push({
      slotId,
      conceptKey: concept.conceptKey,
      conceptName: concept.conceptName,
      ...(concept.outcomeId !== undefined ? { outcomeId: concept.outcomeId } : {}),
      formatClass,
      taskId,
      groundingTier: 'T2',
      groundingLabel: groundingLabelFor(held),
      heldSourceKind: held.kind,
      heldSourceId: held.sourceId,
      sourceChunks: held.chunks,
      weight,
      emphasised,
    });
  });

  // [D-258]: every eligible concept the slot cap excluded is named here, never silently dropped —
  // the same F4.10 "never invent, never disappear" discipline applied one step earlier, to ranking
  // rather than to sourcing.
  rankExcluded.forEach(({ concept }, offset) => {
    const overallRank = slotCap + offset;
    emptySlots.push({
      slotId: `excluded-${overallRank}`,
      conceptKey: concept.conceptKey,
      conceptName: concept.conceptName,
      reasonCode: 'rank-excluded' satisfies PaperEmptySlotReasonCode,
      reason:
        `ranked ${overallRank + 1} of ${eligible.length} eligible concepts; the extent-steered ` +
        `slot cap (${slotCap}) excluded it before a held-source check was reached`,
    });
  });

  return {
    formatVersion: 'paper-blueprint-v1',
    course: input.course,
    asOf: input.asOf,
    alpha: input.alpha,
    formatClass,
    steering,
    structureSummary: input.structure
      ? {
          sittingCount: input.structure.sittingCount,
          currentCount: input.structure.currentCount,
          historicalCount: input.structure.historicalCount,
        }
      : null,
    eligibleCount: eligible.length,
    slots,
    emptySlots,
  };
}
