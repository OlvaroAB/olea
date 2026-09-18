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
 *
 * **Rulings 1/4/7/8 — demand (`[D-262]`).** Input (b)'s reading of the course's own non-sealed
 * past papers now includes demand — what a question asks her to do, read from the paper itself
 * with the source that shows it (`flattenDemandReadings`) — and the composition's dominant demand
 * (`dominantDemand`, mirroring `dominantFormatClass`'s tally-and-rank shape) is what every
 * candidate slot in this composition intends, never the assessment-type word alone. Routing checks
 * `demandServedByGenerator` BEFORE the held-source check: a slot is `demand-unsupported` even
 * where a held source exists, because the gap is about what the routed generator kind can produce.
 * Where the composition's own intended demand goes unserved, every candidate this composition
 * ranked becomes a named `demand-unsupported` empty slot (`[D-258]`'s reason-code vocabulary,
 * extended) and the blueprint's own `unbuiltDemand`/`partial` fields carry ruling 4's face-statement
 * payload — never rendered to copy here (the vocabulary registry leaves the exact wording to a
 * later surface), only the shape: which demand, and a pointer at the held non-sealed past papers
 * that ask it. No item-level demand judge: the declaration plus this composition-wide intent is
 * the whole contract, per ruling 1's own text.
 */

import type {
  PaperAssessment,
  PaperBlueprint,
  PaperBlueprintSlot,
  PaperDemand,
  PaperDemandReading,
  PaperEmptySlot,
  PaperEmptySlotReasonCode,
  PaperFaceDemandGap,
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

/**
 * F4.11 ruling 1/7's per-generator declared demands (`[D-262]`) — "the declaration plus the
 * slot's intent is the contract," never a self-graded check against what a generator actually
 * produced. Both existing generators produce recall-style flashcard (`cards.generate.v1`) or MCQ
 * (`quiz.generate.v1`) items only; neither has any notion of calculation, comparison, transfer to
 * an unfamiliar case, or a printed-result stimulus — confirmed against
 * `findings/paper-run-2026-09-16.md` (private repo), whose measured course-E mismatch (a sealed
 * sitting entirely built from reading a printed statistical result, against generated cards that
 * could only ask bare conceptual definitions) is the exact case ruling 7 names as "the exact
 * mechanism of the measured miss."
 *
 * @provenance declared — a plain reading of what each generator's own request/response shape can
 * produce, never fitted against any corpus.
 */
export const PAPER_GENERATOR_DECLARED_DEMANDS: Readonly<
  Record<PaperGeneratorTaskId, readonly PaperDemand[]>
> = Object.freeze({
  'cards.generate.v1': Object.freeze(['recall-a-fact'] as const),
  'quiz.generate.v1': Object.freeze(['recall-a-fact'] as const),
});

/** `true` when `taskId`'s own declared demands (above) include `demand` — the whole of ruling 7's routing check; never an item-level judge of what a generator actually produced. */
export function demandServedByGenerator(
  taskId: PaperGeneratorTaskId,
  demand: PaperDemand,
): boolean {
  return PAPER_GENERATOR_DECLARED_DEMANDS[taskId].includes(demand);
}

/** The demand a composition intends when input (b) recovered nothing to read — the one demand every existing generator declares, so a course with no recovered past-paper demand data behaves exactly as it did before `[D-262]`. */
export const DEFAULT_INTENDED_DEMAND: PaperDemand = 'recall-a-fact';

/**
 * Every `{ demand, sourceRef }` reading `structure`'s own non-sealed sittings/sections carry —
 * F4.11 ruling 1, "read from the paper itself, with the source that shows it." A section's demand
 * is skipped, never guessed, when its sitting carries no `sourceRef` to cite — an unattributable
 * reading is not evidence.
 */
export function flattenDemandReadings(
  structure: PaperRecoveredStructure | null,
): readonly PaperDemandReading[] {
  const readings: PaperDemandReading[] = [];
  for (const sitting of structure?.sittings ?? []) {
    if (sitting.sourceRef === undefined) continue;
    const sourceRef = sitting.sourceRef;
    for (const section of sitting.sections) {
      for (const demand of section.demands ?? []) {
        readings.push({ demand, sourceRef });
      }
    }
  }
  return readings;
}

/**
 * The dominant demand across `structure`'s own recovered readings — mirrors `dominantFormatClass`'s
 * tally-and-rank shape exactly (most-frequent reading wins; a reading with no citable source never
 * enters the tally), falling to `DEFAULT_INTENDED_DEMAND` when nothing was recovered to read (no
 * past-paper demand data yet, or no non-holdout past papers at all).
 */
export function dominantDemand(structure: PaperRecoveredStructure | null): PaperDemand {
  const readings = flattenDemandReadings(structure);
  if (readings.length === 0) return DEFAULT_INTENDED_DEMAND;
  const tally = new Map<PaperDemand, number>();
  for (const { demand } of readings) tally.set(demand, (tally.get(demand) ?? 0) + 1);
  const [ranked] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  // `readings.length > 0` guarantees at least one tally entry — the fallback is type-only,
  // mirroring `dominantFormatClass`'s own unreachable `?? 'written'`.
  return (ranked ?? [DEFAULT_INTENDED_DEMAND])[0];
}

/** Ruling 4's pointer set for `demand` — deduped, in reading order, drawn only from readings this exact demand word matched. */
function pointerSourceRefsForDemand(
  readings: readonly PaperDemandReading[],
  demand: PaperDemand,
): readonly string[] {
  const seen = new Set<string>();
  for (const reading of readings) {
    if (reading.demand === demand) seen.add(reading.sourceRef);
  }
  return [...seen];
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

  // F4.11 ruling 1/7 (`[D-262]`): routing now asks which generator declares the slot's intended
  // demand, never the format-class/assessment-type word alone. `demandReadings`/`intendedDemand`
  // are read from input (b) — never from a sealed sitting, since `input.structure` is already the
  // caller's blinded, non-holdout-only read (module doc).
  const demandReadings = flattenDemandReadings(input.structure);
  const intendedDemand = dominantDemand(input.structure);
  const demandSupported = demandServedByGenerator(taskId, intendedDemand);

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

    // Ruling 4: checked BEFORE the held-source check — a slot is `demand-unsupported` even where
    // a held source exists, because the gap is about what the generator can produce, never about
    // grounding. Every candidate in this composition shares the same `intendedDemand`
    // (composition-wide, mirroring `formatClass`), so when the routed generator kind does not
    // declare it, no candidate this composition ranked is ever filled.
    if (!demandSupported) {
      emptySlots.push({
        slotId,
        conceptKey: concept.conceptKey,
        conceptName: concept.conceptName,
        reasonCode: 'demand-unsupported' satisfies PaperEmptySlotReasonCode,
        reason:
          `intended demand "${intendedDemand}" is not declared served by the routed generator ` +
          `kind "${taskId}" (declares: ${PAPER_GENERATOR_DECLARED_DEMANDS[taskId].join(', ')})`,
      });
      return;
    }

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
      intendedDemand,
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

  // Ruling 4: the face-statement payload — non-null exactly when the composition's own intended
  // demand went unserved. `pointerSourceRefs` is drawn from every reading of `intendedDemand`
  // across `demandReadings`, never only the one candidate cycled past — "points at the held
  // non-sealed past papers that ask it" (plural, and read wherever they were found).
  const unbuiltDemand: PaperFaceDemandGap | null = demandSupported
    ? null
    : {
        demand: intendedDemand,
        pointerSourceRefs: pointerSourceRefsForDemand(demandReadings, intendedDemand),
      };

  return {
    formatVersion: 'paper-blueprint-v1',
    course: input.course,
    asOf: input.asOf,
    alpha: input.alpha,
    formatClass,
    intendedDemand,
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
    unbuiltDemand,
    partial: unbuiltDemand !== null,
  };
}
