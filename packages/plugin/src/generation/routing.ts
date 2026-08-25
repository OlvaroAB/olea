/**
 * Component 2.2's routing consultation, wired into F3.3's generation sweep
 * (`ol-tz7v` / `[WIRE-7]`).
 *
 * `docs/dev/routing-policy.md` (olea-service, private) §10 names the gap
 * this module closes: `routeKnowledgeKindClassification` and
 * `instrumentMixGaps` (`olea-core`'s `routing/instrument-mix.js`) had no
 * production caller, and `ConceptInstrumentInventory` was "this module's own
 * minimal shape for the third input, not a claim that a real
 * inventory-tracking component exists." Both gaps close here:
 *
 * - `buildConceptInstrumentInventory` is the real inventory reader, built on
 *   `enumerateVaultInstruments` (component register row 2.5/session
 *   plumbing) rather than inventing a second vault walk. An instrument bound
 *   to several concepts (her multi-`topic:` case, D-031/`ol-t3sd`) counts as
 *   evidence for every one of them — the same reading `enumerateVaultInstruments`
 *   itself already gives `conceptIds`, so this module adds no new judgement,
 *   only the type-to-group fold.
 * - `classifyForRouting` reaches component 1.5's classifier
 *   (`classifyKnowledgeKind`) with a **disclosed, minimal** source-material
 *   builder: each of the concept's `sourcePaths`, read whole, one passage per
 *   note. This is deliberately NOT component 1's `readConcepts` (a
 *   model-assisted passage extraction with its own budget and its own
 *   not-yet-wired trigger, `concept/wiring.ts`'s `readConceptsFromVault`) —
 *   building that here would be a second bead's scope wearing this one's
 *   name. Whole-note text is the honest floor: real material, not invented,
 *   at the cost of coarser passages than a dedicated extractor would offer.
 *
 * **Never guessed, on either failure path.** A classifier that is
 * unavailable (`classifier === null`, F7.8), a call that could not run
 * (`outcome: 'not-run'` — no source material, offline, budget exhausted,
 * whatever the reason), and a call that ran but declined
 * (`status: 'unclassified'`) are three different facts upstream, and
 * `classifyForRouting` deliberately flattens all three to the same
 * `{ status: 'unclassified' }` **for routing purposes only** — this module's
 * output is fed straight to `routeKnowledgeKindClassification`, and every one
 * of those three cases must route the same way (KLI Application rule 4:
 * "unclassified routes to the retrieval baseline alone, never guessed").
 * Callers that need to distinguish *why* should read `classifyKnowledgeKind`
 * directly; this module answers "what should route" only.
 *
 * **What this deliberately does NOT do.** It does not call
 * `CARDS_FOR_EVERYTHING_NULL` a real fallback — that constant is
 * `instrument-mix.ts`'s own strawman comparator ("nothing here treats it as
 * a real routing option"), not a degraded path. The degraded path this
 * module actually uses when the classifier is unavailable or declines is
 * `UNCLASSIFIED_MIX` (`routeKnowledgeKind(null)`), which is the routing
 * policy's own documented answer to "nothing is known to route on" — §2 rule
 * 4 and §5 of the rationale document.
 */

import type {
  ConceptInstrumentInventory,
  ConceptRecord,
  InstrumentMix,
  InstrumentMixGap,
  KnowledgeKindClassification,
  KnowledgeKindClassifierPort,
  KnowledgeKindSourcePassage,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  classifyKnowledgeKind,
  EMPTY_INVENTORY,
  enumerateVaultInstruments,
  instrumentMixGaps,
  ROUTING_GROUP_INSTRUMENT_TYPES,
  ROUTING_GROUPS,
  routeKnowledgeKindClassification,
} from 'olea-core';
import { PROVISIONAL_CONFIDENCE_FLOOR } from './constants.js';

/**
 * Component 2.2's routing consultation, as opted into by a caller of
 * `runGenerationSweep`. Absent entirely, the sweep keeps its pre-`ol-tz7v`
 * unconditional-draft behaviour (see `pipeline.ts`'s module doc) — every
 * existing caller and every `pipeline.spec.ts` case predates routing and
 * never supplies this, so omission is not a degraded mode, it is "not asked
 * for."
 */
export interface GenerationRoutingDeps {
  /** `null` when the Worker (and therefore the classifier) is not configured — F7.8, `concept/wiring.ts`'s `KnowledgeKindWiring.classifier`. */
  readonly classifier: KnowledgeKindClassifierPort | null;
  /**
   * `ClassifyKnowledgeKindOptions.confidenceFloor` — DERIVED per the
   * component register (row 1.5), not yet ratified by a decision bead.
   * Caller-supplied so this module never hardcodes the number itself;
   * defaults to `PROVISIONAL_CONFIDENCE_FLOOR` (KCT-3's provisional 0.0,
   * `findings/KCT-3-confidence-floor.md` in olea-service) when omitted.
   */
  readonly confidenceFloor?: number;
}

/** One concept's routing verdict — everything a caller needs to decide whether to draft. */
export interface ConceptRoutingDecision {
  readonly classification: KnowledgeKindClassification;
  readonly mix: InstrumentMix;
  readonly gaps: readonly InstrumentMixGap[];
}

/**
 * Reads each of `concept.sourcePaths` whole, as one passage per note — the
 * disclosed minimal reading this module doc explains. A missing or empty
 * note contributes nothing (never fabricated); a concept with no readable
 * source note at all returns `[]`, which `classifyKnowledgeKind`'s own
 * INV-5 guard turns into a clean `'not-run'` — no network call is ever made
 * on empty context.
 */
export async function buildKnowledgeKindSourceMaterial(
  vault: VaultSource,
  concept: Pick<ConceptRecord, 'sourcePaths'>,
): Promise<readonly KnowledgeKindSourcePassage[]> {
  const passages: KnowledgeKindSourcePassage[] = [];
  for (const sourcePath of concept.sourcePaths) {
    if (!(await vault.exists(sourcePath))) continue;
    const text = await vault.read(sourcePath);
    if (text.trim().length === 0) continue;
    passages.push({
      text,
      anchor: {
        sourcePath,
        // `page: 1` mirrors `extract/types.ts`'s DOCX convention: a markdown
        // note has no page structure of its own, so it is one logical page,
        // same as `readConcepts`' own reading would treat it.
        location: { page: 1, charRange: { start: 0, end: text.length } },
      },
    });
  }
  return passages;
}

/**
 * Classifies one concept for routing purposes, flattening every "nothing
 * real is known" outcome to `status: 'unclassified'` — see the module doc's
 * "never guessed, on either failure path" section for why this collapse is
 * deliberate rather than a loss of information a caller needed.
 */
export async function classifyForRouting(
  routing: GenerationRoutingDeps,
  vault: VaultSource,
  concept: ConceptRecord,
): Promise<KnowledgeKindClassification> {
  const UNCLASSIFIED: KnowledgeKindClassification = {
    status: 'unclassified',
    confidence: undefined,
    method: 'model',
  };
  if (routing.classifier === null) return UNCLASSIFIED;

  const sourceMaterial = await buildKnowledgeKindSourceMaterial(vault, concept);
  const result = await classifyKnowledgeKind(
    routing.classifier,
    { conceptName: concept.name, sourceMaterial },
    { confidenceFloor: routing.confidenceFloor ?? PROVISIONAL_CONFIDENCE_FLOOR },
  );
  return result.outcome === 'classified' ? result.classification : UNCLASSIFIED;
}

/** `ROUTING_GROUP_INSTRUMENT_TYPES` inverted once, module-load time — the single source of truth stays the routing module's own table. */
const INSTRUMENT_TYPE_TO_GROUP = new Map(
  ROUTING_GROUPS.flatMap((group) =>
    ROUTING_GROUP_INSTRUMENT_TYPES[group].map((type) => [type, group] as const),
  ),
);

/**
 * The real per-concept instrument inventory (routing-policy.md §10's own
 * caveat, resolved): walks the vault once via `enumerateVaultInstruments`
 * and folds every found instrument into its concept(s) and routing group.
 *
 * **Disclosed gap, not silently dropped:** `enumerateVaultInstruments` only
 * ever produces `qa`/`cloze`/`mcq` records (`session/enumerate.ts` parses
 * card and MCQ blocks only) — nothing in either package enumerates
 * `explain-back` instruments from vault text today, so this inventory's
 * `explainBack` count is always `0`. That is an honest reading of "nothing
 * counts these yet," not a claim that explain-back attempts don't exist;
 * building that reader is out of this bead's scope (no explain-back vault
 * format exists to enumerate — grading is a live model exchange, not a
 * persisted block, per `grading/wiring.ts`).
 */
export async function buildConceptInstrumentInventory(
  vault: VaultSource,
  options: { readonly under?: VaultPath } = {},
): Promise<ReadonlyMap<string, ConceptInstrumentInventory>> {
  const { records } = await enumerateVaultInstruments(vault, options);

  const mutableCounts = new Map<string, { retrieval: number; quiz: number; explainBack: number }>();
  for (const record of records) {
    const group = INSTRUMENT_TYPE_TO_GROUP.get(record.instrumentType);
    if (group === undefined) continue; // a type this walk cannot currently produce — see the module doc's disclosed gap
    for (const conceptId of record.conceptIds) {
      const entry = mutableCounts.get(conceptId) ?? { retrieval: 0, quiz: 0, explainBack: 0 };
      mutableCounts.set(conceptId, { ...entry, [group]: entry[group] + 1 });
    }
  }

  const result = new Map<string, ConceptInstrumentInventory>();
  for (const [conceptId, counts] of mutableCounts) result.set(conceptId, counts);
  return result;
}

/**
 * The routing decision for one concept, pure once its inputs are in hand —
 * mirrors `instrument-mix.ts`'s own "pure, total" posture rather than mixing
 * judgement into the I/O above.
 */
export function decideConceptRouting(
  classification: KnowledgeKindClassification,
  inventory: ConceptInstrumentInventory,
): ConceptRoutingDecision {
  const mix = routeKnowledgeKindClassification(classification);
  const gaps = instrumentMixGaps(mix, inventory);
  return { classification, mix, gaps };
}

/** Convenience: does this concept's routing decision warrant this sweep's one generation capability (quiz/MCQ drafting)? */
export function quizDeficit(decision: ConceptRoutingDecision): number {
  return decision.gaps.find((gap) => gap.group === 'quiz')?.deficit ?? 0;
}

export { EMPTY_INVENTORY };
