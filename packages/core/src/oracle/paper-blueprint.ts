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
 * **Purpose governs the ranking weight (`[D-277]`, F4.11 ruling (i), TARGET-4/ol-v7r5.58).** The
 * paper's declared purpose (`PaperPurpose`, `./paper-types.ts`) picks which weight function ranks
 * candidates — `slotWeightForPurpose`, below. It is the ONLY thing purpose changes here: which
 * asks are selected and in what proportions, never eligibility, never held-source grounding, never
 * demand routing (see `slotWeightForPurpose`'s own doc, and `PaperPurpose`'s doc for the three
 * things ruling (i) says purpose never does). `input.purpose` is optional
 * (`DEFAULT_PAPER_PURPOSE` when omitted) but the returned blueprint always states one — see that
 * constant's doc for why the default is a safe, presently-inert no-op.
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
 * (`dominantDemand`) is what every candidate slot in this composition intends, never the
 * assessment-type word alone. Routing checks `demandServedByGenerator` BEFORE the held-source
 * check: a slot is `demand-unsupported` even where a held source exists, because the gap is about
 * what the routed generator kind can produce. Where the composition's own intended demand goes
 * unserved, every candidate this composition ranked becomes a named `demand-unsupported` empty
 * slot (`[D-258]`'s reason-code vocabulary, extended). No item-level demand judge: the declaration
 * plus this composition-wide intent is the whole contract, per ruling 1's own text.
 *
 * **`[DEMAND-7]` (ol-egov.141.6.11) — dominant is weighed by marks, and the gap check reads more
 * than the dominant demand.** `[DEMAND-6]`'s real per-question readings measured a course whose
 * sitting is overwhelmingly short recall-a-fact questions BY COUNT, but which also carries a
 * two-item apply-to-unfamiliar-case section worth a quarter of the sitting's marks — a share large
 * enough that she would notice its absence, invisible to a per-question tally either way (recall
 * stays dominant under a mark-weighted tally too, on that course's numbers: the fix is not the
 * unit alone). `dominantDemand` now tallies by marks (`demandMarkShares`) rather than by question
 * count — still used, unchanged, for what a slot intends and what generator it routes to, since
 * there is no per-concept join to a specific past-paper question to assign a finer-grained demand
 * from. Separately, `unbuiltDemand`/`partial` no longer ask only whether the dominant demand is
 * served: `significantDemands` names every demand crossing `SIGNIFICANT_DEMAND_MARK_SHARE_DECLARED`
 * of the sitting's marks, and the gap fires for the highest-share SIGNIFICANT demand that goes
 * unserved — dominant or not. A paper can therefore be dominant-demand-served (its slots still
 * fill, with recall items) and still be marked `partial` for a substantial minority demand the
 * routed generator cannot touch. The schema this module does not own (`paper-types.ts`) still
 * carries only ONE `unbuiltDemand`; when more than one significant demand is unserved, the
 * highest-share one is named (see `significantDemands`'s doc) — naming both is a real
 * `paper-types.ts` change, out of this file's ownership, and is not attempted here.
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
  PaperPurpose,
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
 * F4.11 ruling (i) (`[D-277]`) — the purpose a caller has not yet declared one for.
 * `'assessment-simulation'` is the safe default: it is the mode ruling (i) itself describes as
 * "never weights selection by her weakness," so a caller silent on purpose gets the STRICTER of
 * the two behaviours rather than one that reads a weakness signal it never asked for.
 *
 * This is also, today, a no-op default for the one real production caller
 * (`packages/plugin/src/paper/provider.ts`'s `requestPaper`, via `assemble.ts`'s
 * `buildScopeConceptsForCourse`): every concept it builds carries `masteryScore: null` (C5.4's
 * mastery rollup has no reader wired into the plugin yet — that module's own doc), and
 * `conceptWeight`'s `masteryScore === null` branch already falls back to coverage alone
 * regardless of purpose. Declared, not fitted — see this module's own `EMPHASIS_WEIGHT_BOOST_DECLARED`
 * for the same posture.
 *
 * @provenance declared.
 */
export const DEFAULT_PAPER_PURPOSE: PaperPurpose = 'assessment-simulation';

/**
 * The ranking weight for `concept` under `purpose` — F4.11 ruling (i), the one place purpose
 * governs composition (module doc). `'assessment-simulation'` reads `conceptCoverageScore` alone
 * and NEVER `concept.masteryScore`, mirroring `conceptWeight`'s own "mastery absent" fallback
 * shape exactly (`masteryFallback: true`) regardless of whether a real mastery reading exists for
 * this concept — the weakness signal is not merely down-weighted for this purpose, it is never
 * read at all. `'focused-practice'` is the unmodified `conceptWeight` blend, the only purpose that
 * reads `masteryScore` — "evidence gaps and demonstrated weakness," ruling (i)'s own words.
 *
 * Deliberately the ONLY thing purpose changes inside `buildPaperBlueprint`: eligibility
 * (`isEligibleConcept`), held-source grounding (`no-held-source`) and demand routing
 * (`demand-unsupported`) are computed identically for both purposes — see this module's own
 * `buildPaperBlueprint` and `./paper-types.ts`'s `PaperPurpose` doc for the three things ruling
 * (i) says purpose never does, each with its own test in `./paper-blueprint.spec.ts`.
 */
export function slotWeightForPurpose(
  concept: PaperScopeConcept,
  alpha: number,
  purpose: PaperPurpose,
): PaperConceptWeight {
  if (purpose === 'assessment-simulation') {
    const coverageScore = conceptCoverageScore(concept);
    return { weight: coverageScore, coverageScore, masteryScore: null, masteryFallback: true };
  }
  return conceptWeight(concept, alpha);
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
 * Per-demand share of `structure`'s own attributed marks (`[DEMAND-7]`, ol-egov.141.6.11) — marks,
 * not question count, because a mark-heavy minority demand is exactly what a per-question tally
 * hides (a two-item section worth a quarter of the sitting's marks reads as noise against seventy
 * short recall questions). Mirrors `flattenDemandReadings`'s own attribution rule: a sitting with
 * no `sourceRef` contributes nothing, never a guessed source.
 *
 * Marks are recovered at SECTION grain only (`PaperRecoveredSection.marks`) — no per-question mark
 * exists to read (the private repo's own recovery ceiling: full sub-part structure recovers for a
 * minority of papers). A section carrying more than one demand splits its marks evenly across its
 * own `itemCount` — the least-assumption reading available at this grain, and exact (not an
 * assumption at all) for the common case this bead's five-course sample mostly is: a section whose
 * every question shares one demand. `itemCount` is the denominator rather than the recovered
 * `demands` array's own length, so a section only partially read for demand does not inflate the
 * marks attributed to the items that were.
 *
 * Returns an empty map when nothing is attributable — the same "no evidence" case `dominantDemand`
 * falls to `DEFAULT_INTENDED_DEMAND` for and `significantDemands` returns `[]` for.
 */
function demandMarkShares(
  structure: PaperRecoveredStructure | null,
): ReadonlyMap<PaperDemand, number> {
  const totals = new Map<PaperDemand, number>();
  let totalMarks = 0;
  for (const sitting of structure?.sittings ?? []) {
    if (sitting.sourceRef === undefined) continue;
    for (const section of sitting.sections) {
      const demands = section.demands ?? [];
      if (demands.length === 0) continue;
      const denom = section.itemCount > 0 ? section.itemCount : demands.length;
      const perItemMarks = section.marks / denom;
      for (const demand of demands) {
        totals.set(demand, (totals.get(demand) ?? 0) + perItemMarks);
        totalMarks += perItemMarks;
      }
    }
  }
  if (totalMarks <= 0) return new Map();
  const shares = new Map<PaperDemand, number>();
  for (const [demand, marks] of totals) shares.set(demand, marks / totalMarks);
  return shares;
}

/**
 * DECLARED, not derived (`[DEMAND-7]`, ol-egov.141.6.11) — a demand carrying at least a fifth of a
 * sitting's own marks is not a rounding error in what she experiences the paper as testing; it is
 * the order of share this bead's own motivating course crosses (a two-item section worth a quarter
 * of that sitting's marks). This value is NOT fitted to that 25% figure: a sensitivity check
 * against the bead's own five-course sample (four courses carry recovered demand data; the fifth
 * has no past papers registered) shows every value from just above 0 up to 0.25 produces the
 * IDENTICAL classification on this evidence — the motivating course's minority clears any bar at
 * or below 0.25, the two single-demand courses sit at a full 1.0 and are insensitive to any bar
 * below that, and the one course with several minor demands alongside its dominant one tops out
 * its largest minority around 0.16, below even a substantially lower bar. The exact number in that
 * range is therefore not load-bearing on the evidence in hand; 0.2 (one-fifth) is a plain, round
 * choice inside it. Flagged for retroactive review (Class B, threshold tuning) rather than parked
 * whole: the mechanism this gates — checking every substantial demand for support, not only the
 * single dominant one — is what this bead is about, and only the number would move on review.
 *
 * @provenance declared — a bounded, round choice inside a range a sensitivity check found flat on
 * the evidence in hand, not a value obtained by fitting; see this module's own
 * `EMPHASIS_WEIGHT_BOOST_DECLARED` for the same declared-constant posture.
 */
export const SIGNIFICANT_DEMAND_MARK_SHARE_DECLARED = 0.2;

/**
 * The dominant demand across `structure`'s own recovered readings, weighted by marks
 * (`demandMarkShares`) rather than by question count (`[DEMAND-7]`) — highest mark-share wins,
 * falling to `DEFAULT_INTENDED_DEMAND` when nothing was recovered to read (no past-paper demand
 * data yet, or no non-holdout past papers at all). Still the single demand every slot in a
 * composition intends and routes on (module doc) — the gap check below reads more than just this
 * one demand.
 */
export function dominantDemand(structure: PaperRecoveredStructure | null): PaperDemand {
  const shares = demandMarkShares(structure);
  if (shares.size === 0) return DEFAULT_INTENDED_DEMAND;
  const [ranked] = [...shares.entries()].sort((a, b) => b[1] - a[1]);
  // `shares.size > 0` guarantees at least one entry — the fallback is type-only, mirroring
  // `dominantFormatClass`'s own unreachable `?? 'written'`.
  return (ranked ?? [DEFAULT_INTENDED_DEMAND])[0];
}

/**
 * Every demand `structure`'s own evidence carries at `minShare` (default
 * `SIGNIFICANT_DEMAND_MARK_SHARE_DECLARED`) or more of its attributed marks — ranked highest share
 * first, ties broken by first appearance in `structure`'s own reading order (`Map` insertion order,
 * `Array#sort`'s stability). `[]` when nothing was recovered to read, the same case `dominantDemand`
 * falls to `DEFAULT_INTENDED_DEMAND` for.
 *
 * This is `[DEMAND-7]`'s actual fix: a per-question OR per-mark tally of the single dominant demand
 * both miss a substantial minority (on the motivating course, recall-a-fact stays dominant under
 * either unit — the unit was never the whole defect). `buildPaperBlueprint` checks every demand
 * named here for generator support, not only `dominantDemand`, so a paper can be dominant-demand
 * -served and still be marked partial for a minority demand the routed generator cannot touch.
 * Never consulted for routing or slot composition — `dominantDemand` alone still decides what a
 * slot intends (module doc); this is read only for the gap check.
 */
export function significantDemands(
  structure: PaperRecoveredStructure | null,
  minShare: number = SIGNIFICANT_DEMAND_MARK_SHARE_DECLARED,
): readonly PaperDemand[] {
  const shares = demandMarkShares(structure);
  return [...shares.entries()]
    .filter(([, share]) => share >= minShare)
    .sort((a, b) => b[1] - a[1])
    .map(([demand]) => demand);
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
  /**
   * F4.11 ruling (i) (`[D-277]`) — declared purpose, frozen onto the returned blueprint
   * (`PaperBlueprint.purpose`). Optional here so a caller that has not yet been updated to choose
   * one (today, every real caller — see `DEFAULT_PAPER_PURPOSE`'s doc) still compiles and composes;
   * omitting it is never silent about WHICH purpose was used, since the returned blueprint always
   * states one (`DEFAULT_PAPER_PURPOSE` when omitted here).
   */
  readonly purpose?: PaperPurpose;
  readonly alpha: PaperWeightingAlpha;
  readonly steering?: PaperSteering;
  /** F4.8's word→class table (`../assessment/format-class.js`'s `formatClassOf`), injected so this module has no opinion of its own about the mapping. */
  readonly formatClassOf: (type: string) => PaperFormatClass;
}

/** Assembles the blueprint. See the module doc for ruling 3's steering and the blinding responsibility this function does not itself enforce. */
export function buildPaperBlueprint(input: BuildPaperBlueprintInput): PaperBlueprint {
  validatePaperScope(input.concepts);
  const steering = input.steering ?? {};
  const purpose = input.purpose ?? DEFAULT_PAPER_PURPOSE;
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

  // `[DEMAND-7]` (ol-egov.141.6.11): the gap check reads every SIGNIFICANT demand the evidence
  // carries, not only `intendedDemand` — a mark-heavy minority the dominant tally would never
  // surface (module doc). `intendedDemand`/`demandSupported` above are UNCHANGED and still the
  // only things that decide whether a candidate's slot gets filled; this is a second, separate
  // read of the same evidence for the face-statement fields only. Falls back to `[intendedDemand]`
  // when nothing cleared the significance bar (e.g. no recovered evidence at all), so a course
  // with no demand data keeps exactly its pre-`[DEMAND-7]` behaviour.
  const significant = significantDemands(input.structure);
  const demandsForGapCheck = significant.length > 0 ? significant : [intendedDemand];
  // Already ranked highest-share-first (`significantDemands`'s own doc), so the first unsupported
  // entry is the highest-share significant demand the routed generator cannot serve.
  const gapDemand = demandsForGapCheck.find((demand) => !demandServedByGenerator(taskId, demand));

  const eligible = input.concepts.filter(isEligibleConcept);
  const ranked = eligible
    .map((concept) => {
      const base = slotWeightForPurpose(concept, input.alpha, purpose);
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

  // Ruling 4 + `[DEMAND-7]`: the face-statement payload — non-null exactly when SOME significant
  // demand (not only the composition's intended one) went unserved (see `gapDemand` above).
  // `pointerSourceRefs` is drawn from every reading of `gapDemand` across `demandReadings`, never
  // only the one candidate cycled past — "points at the held non-sealed past papers that ask it"
  // (plural, and read wherever they were found).
  const unbuiltDemand: PaperFaceDemandGap | null =
    gapDemand === undefined
      ? null
      : {
          demand: gapDemand,
          pointerSourceRefs: pointerSourceRefsForDemand(demandReadings, gapDemand),
        };

  return {
    formatVersion: 'paper-blueprint-v1',
    course: input.course,
    asOf: input.asOf,
    purpose,
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
