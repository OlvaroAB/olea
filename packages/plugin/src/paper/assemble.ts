/**
 * Assembles F4.11's four `buildPaperBlueprint` inputs for one course, from whatever real,
 * already-wired, ZERO-Worker-call production readers exist in this plugin today.
 *
 * **What is real here, and what is an honest, declared, filed gap — read before trusting a
 * composed paper's fidelity.** `docs/dev/paper-blueprint-design.md` (private repo) found, at the
 * harness tier, that three of F4.11's inputs have "zero code representation anywhere": F8.2's
 * taught-signal chain, C5.4's mastery rollup, and real past-paper structure recovery. That is
 * still true of `packages/plugin/src` specifically (confirmed by search before writing this
 * module: `scope/coverage.ts`'s `resolveTeachingArrival` and `mastery/rollup.ts`'s
 * `computeConceptMastery` have no call site anywhere under `packages/plugin/src`, and no function
 * named `recoverStructure` exists in either package). Building those three readers from scratch
 * is a real, separate, multi-bead effort — F8.2's chain alone reads her slide decks and calendar,
 * and past-paper structure recovery needs the text-segmentation pass
 * `findings/H4-past-paper-question-structure.md` found only 10 of 42 real papers support. This
 * bead's own scope is the command/view surface (`ol-egov.141.6.1`'s `owns`:
 * `packages/plugin/src/paper/`), not those three readers, so each is degraded HONESTLY rather
 * than invented — named below, not silently absorbed. **`outcomes` is no longer one of these
 * gaps** (wired 2026-09-25, `ol-2zfj.172` — see its own bullet below).
 *
 * - **taughtSignal.** Every `ConceptRecord` this function is given already required a real
 *   note evidencing it (`courses`/`sourcePaths`/`definition` — `enumerateVaultInstruments`'s own
 *   vault walk, no Worker call, wired in `gap/provider.ts`/`registry/provider.ts`/
 *   `session-builder/provider.ts` already). F8.2's own ranking puts "her own note" at the TOP of
 *   its five-step chain — the step that "auto-opens a material gap into a live, ground-eligible
 *   cell" with no further evidence needed. Reading every such concept as `taughtSignal: 'yes'`
 *   is therefore not a guess: it is F8.2's own strongest step, restated for a concept this reader
 *   already confirms by the same evidence F8.2's step 1 would look for. **Declared, Class B,
 *   flagged for retroactive review** once F8.2's own chain is wired into the plugin — this
 *   function's degradation of the eligibility gate is one specific answer to a broader
 *   under-built area, not a claim that F8.2's other four steps do not matter.
 * - **heldSources / grounding chunks.** `ConceptRecord.definition` — her own bound note's body,
 *   read verbatim at extraction time — is used as the concept's one held-source chunk when
 *   present (kind `'notes'`, the same class `groundingLabelFor` already reads as
 *   `covered-by-her-material`). When no `definition` exists (no bound note, or an empty body),
 *   the FIRST `sourcePaths` entry's raw file text is read as a fallback chunk instead — still a
 *   real note she wrote, just not the canonical bound-note text. A concept with neither is left
 *   with no held source at all, which `buildPaperBlueprint` already handles honestly
 *   (`emptySlots`, reasonCode `no-held-source` — F4.10's never-invent rule, unmodified).
 * - **masteryScore.** Always `null` — C5.4's mastery rollup is not wired into this plugin at all
 *   (confirmed above), and `null` is the type's own honest "no real mastery evidence exists for
 *   this concept" state (`PaperScopeConcept.masteryScore`'s own doc), not a fabricated midpoint.
 *   `conceptWeight` already falls back to coverage alone when this is `null`
 *   (`masteryFallback: true`), so `alpha` (`PRACTICE_PAPER_ALPHA_DECLARED` below) has no live
 *   effect on ranking today — restated honestly rather than silently ignored.
 * - **outcomes (wired 2026-09-25, `ol-2zfj.172`, F4.11 ruling 3).** `buildScopeConceptsForCourse`
 *   and `buildBlueprintInputForCourse` now both take the course's active `OutcomeRecord`s
 *   (read by the caller via `listOutcomeRecords`, the same real reader `unlock.ts`'s coverage leg
 *   now uses) and restate them as `PaperScopeOutcome[]` for the `outcomes` field, and set each
 *   in-scope concept's `outcomeId` from the outcome→concept containment edge
 *   (`OutcomeRecord.conceptKeys`) when one attaches it. `buildPaperBlueprint`'s `matchesEmphasis`
 *   then matches a steering emphasis string against an Outcome's own label, not only the
 *   concept's name (`paper-blueprint.ts`'s own doc). Omitting the parameter (or passing `[]`,
 *   the default) reproduces the old degraded behaviour exactly — no concept gets an `outcomeId`,
 *   `outcomes` is empty, and emphasis matches concept names only, same as before this wiring.
 * - **structure (past-paper structure/composition, `[D-262]`'s demand reading).** Always `null`
 *   — no `recoverStructure`-equivalent production reader exists in either package. `null` is the
 *   type's own legal "nothing was recoverable" state
 *   (`PaperRecoveredStructure | null`'s own doc). **This is the one degradation that changes
 *   what the surface can DEMONSTRATE, not only its fidelity**: with no real demand readings,
 *   `dominantDemand` always falls to `DEFAULT_INTENDED_DEMAND` ('recall-a-fact'), which both
 *   existing generators declare, so `buildPaperBlueprint`'s `partial`/`unbuiltDemand` fields can
 *   never fire against a REAL course composed by this module today. The mechanism and its render
 *   are still fully built and unit-tested (`copy.spec.ts`, `provider.spec.ts`) against an
 *   INJECTED `PaperRecoveredStructure` — this module's `structure: null` default is what a real
 *   composition gets until a structure-recovery reader is wired; a follow-on bead is the honest
 *   next step, not a fix owed by this one.
 *
 * **Coverage share for the unlock rule** is also wired now, one level up (`unlock.ts`'s own
 * module doc, `ol-2zfj.172`): `provider.ts`'s `loadCourseState` reads the same
 * `listOutcomeRecords`/concept-key registry this module reads and computes a real
 * `outcomeConceptCoverage` for `evaluatePracticePaperUnlockForCourse`, replacing the old policy
 * zero.
 */

import {
  type BuildPaperBlueprintInput,
  type ConceptRecord,
  DEFAULT_PAPER_PURPOSE,
  formatClassOf,
  type OutcomeRecord,
  type PaperAssessment,
  type PaperHeldSource,
  type PaperScopeConcept,
  type PaperScopeOutcome,
  type VaultPath,
  type VaultSource,
} from 'olea-core';

/** F4.11 ruling 3's free parameter — declared, not derived (see this module's doc: mastery is always `null` today, so ranking falls back to coverage alone regardless of this value). The middle of the three declared points (`BLUEPRINT_WEIGHTING_SETTINGS_DECLARED`, `olea-core`), chosen for no reason stronger than "no basis yet to prefer either end." */
export const PRACTICE_PAPER_ALPHA_DECLARED = 0.5;

/** A rough word-count ceiling on a fallback (non-`definition`) grounding chunk, so a whole lecture-note file is never sent as one "chunk" — mirrors the order of magnitude `draft-quiz-cards.ts`'s own retrieval chunks already target, without importing that module's retrieval machinery for a single fallback read. Declared, not fitted. */
const FALLBACK_CHUNK_MAX_CHARS = 4000;

/** One held source per eligible concept, built from real note text only — see the module doc for exactly which text and why. `undefined` when neither a `definition` nor a readable `sourcePaths[0]` exists. */
export async function buildHeldSourceForConcept(
  vault: VaultSource,
  concept: ConceptRecord,
): Promise<PaperHeldSource | undefined> {
  if (concept.definition !== undefined && concept.definition.trim().length > 0) {
    return {
      kind: 'notes',
      sourceId: concept.boundNotePath ?? concept.key,
      chunks: [concept.definition],
    };
  }
  const fallbackPath: VaultPath | undefined = concept.sourcePaths[0];
  if (fallbackPath === undefined) return undefined;
  try {
    const text = await vault.read(fallbackPath);
    const trimmed = text.trim();
    if (trimmed.length === 0) return undefined;
    return {
      kind: 'notes',
      sourceId: fallbackPath,
      chunks: [trimmed.slice(0, FALLBACK_CHUNK_MAX_CHARS)],
    };
  } catch {
    // A file the walk listed but cannot now be read (deleted/renamed mid-walk): no held source,
    // never a thrown error out of blueprint assembly — matches `listPaperRecords`'s own
    // skip-rather-than-throw posture for exactly this class of race.
    return undefined;
  }
}

/**
 * Active, course-attached `OutcomeRecord`s narrowed to this course, and the concept-key →
 * outcome-id map their `conceptKeys` containment edge implies (first-attaching outcome wins on a
 * duplicate — the schema does not forbid two outcomes naming the same concept key, and ruling 3's
 * emphasis match only needs ONE parent to test a label against).
 */
function activeCourseOutcomes(
  outcomes: readonly OutcomeRecord[],
  course: string,
): readonly OutcomeRecord[] {
  return outcomes.filter(
    (outcome) => outcome.status === 'active' && outcome.courses.includes(course),
  );
}

function outcomeIdByConceptKey(
  courseOutcomes: readonly OutcomeRecord[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const outcome of courseOutcomes) {
    for (const key of outcome.conceptKeys) {
      if (!map.has(key)) map.set(key, outcome.id);
    }
  }
  return map;
}

/**
 * `PaperScopeConcept[]` for one course, from real `ConceptRecord`s already walked by
 * `enumerateVaultInstruments` (no second vault walk, no Worker call). See the module doc for the
 * `taughtSignal`/`heldSources`/`masteryScore` degradations this applies, and for `outcomes`
 * (`ol-2zfj.172`, F4.11 ruling 3): each in-course concept whose key is contained by one of the
 * course's active Outcomes gets that Outcome's id on `outcomeId`, so `buildPaperBlueprint`'s
 * emphasis match can test the Outcome's own label, not only the concept's name.
 */
export async function buildScopeConceptsForCourse(
  vault: VaultSource,
  concepts: readonly ConceptRecord[],
  course: string,
  outcomes: readonly OutcomeRecord[] = [],
): Promise<readonly PaperScopeConcept[]> {
  const inCourse = concepts.filter((concept) => concept.courses.includes(course));
  const outcomeIdForKey = outcomeIdByConceptKey(activeCourseOutcomes(outcomes, course));
  const out: PaperScopeConcept[] = [];
  for (const concept of inCourse) {
    const held = await buildHeldSourceForConcept(vault, concept);
    const outcomeId = outcomeIdForKey.get(concept.key);
    out.push({
      conceptKey: concept.key,
      conceptName: concept.name,
      ...(outcomeId === undefined ? {} : { outcomeId }),
      taughtSignal: 'yes',
      heldSources: held === undefined ? [] : [held],
      masteryScore: null,
    });
  }
  return out;
}

/**
 * `PaperScopeOutcome[]` for one course — the field grain `buildPaperBlueprint`'s emphasis match
 * needs (F4.11 ruling 3), restated from the course's active `OutcomeRecord`s. `[]` when the
 * course has none, which reproduces the pre-`ol-2zfj.172` degraded behaviour exactly (emphasis
 * then matches concept names only — see `buildPaperBlueprintInput`'s own use of this).
 */
export function buildScopeOutcomesForCourse(
  outcomes: readonly OutcomeRecord[],
  course: string,
): readonly PaperScopeOutcome[] {
  return activeCourseOutcomes(outcomes, course).map((outcome) => ({
    outcomeId: outcome.id,
    label: outcome.label,
    conceptKeys: outcome.conceptKeys,
  }));
}

/** `PaperAssessment[]` for one course, from `readAssessments`'s real report — `course`/`type`/`due` all present (records missing any are dropped, never guessed). */
export function buildAssessmentsForCourse(
  records: readonly {
    readonly course: string | undefined;
    readonly type: string | undefined;
    readonly due: string | undefined;
  }[],
  course: string,
): readonly PaperAssessment[] {
  const out: PaperAssessment[] = [];
  for (const record of records) {
    if (record.course !== course) continue;
    if (record.type === undefined || record.due === undefined) continue;
    out.push({ type: record.type, due: record.due });
  }
  return out;
}

/**
 * Assembles the whole `buildPaperBlueprint` input for one course from real, already-walked data
 * — see the module doc for what is real and what is a named, filed gap.
 *
 * **`purpose` (ol-egov.141.6.17, `[D-277]` ruling (i)).** Passed explicitly as
 * `DEFAULT_PAPER_PURPOSE` (`'assessment-simulation'`) rather than left for `buildPaperBlueprint`
 * to default silently. Checked against F4.11 as amended and against `[D-277]` itself before
 * writing this: neither names how she would choose a purpose — F4.11's own "what she can invoke"
 * and "what she may steer" paragraphs name exactly one affordance (request a paper for the
 * course) and exactly two steering dials (emphasis, extent), with no third dial for purpose, and
 * ruling (i) explicitly places "a student-visible affordance to CHOOSE a purpose" out of the
 * blueprint module's scope without granting it to any other surface either
 * (`paper-types.ts`'s `PaperPurpose` doc). There is therefore no cited clause to build a choice
 * surface from — see this repo's proposed-decision note (ol-egov.141.6.17's report) rather than
 * inventing one here. `'assessment-simulation'` is also, independent of that gap, the one purpose
 * this caller's own `masteryScore: null` degradation (module doc) makes a true no-op either way.
 */
export async function buildBlueprintInputForCourse(
  vault: VaultSource,
  concepts: readonly ConceptRecord[],
  assessmentRecords: readonly {
    readonly course: string | undefined;
    readonly type: string | undefined;
    readonly due: string | undefined;
  }[],
  course: string,
  asOf: string,
  outcomes: readonly OutcomeRecord[] = [],
): Promise<BuildPaperBlueprintInput> {
  return {
    course,
    asOf,
    concepts: await buildScopeConceptsForCourse(vault, concepts, course, outcomes),
    outcomes: buildScopeOutcomesForCourse(outcomes, course),
    assessments: buildAssessmentsForCourse(assessmentRecords, course),
    structure: null,
    purpose: DEFAULT_PAPER_PURPOSE,
    alpha: PRACTICE_PAPER_ALPHA_DECLARED,
    formatClassOf,
  };
}
