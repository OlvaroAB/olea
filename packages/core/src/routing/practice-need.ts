/**
 * Routing with explicit deferral (`docs/dev/intelligence-build/pra.md` §2's
 * component-table change, `[ILB-PRA-4]`): "a concept routed to a format with
 * no generator (cards, cloze today) is recorded as an unmet practice need,
 * never silently dropped."
 *
 * **Not wired.** Today's production routing consultation
 * (`packages/plugin/src/generation/routing.ts`'s `decideConceptRouting`,
 * consumed by `pipeline.ts`) only ever reads `quizDeficit` — the `quiz`
 * group's own deficit — and silently counts every other group's deficit as
 * `skippedRouting` with no record of what was actually wanted. This module
 * is the fix, built as pure logic first; wiring it into `pipeline.ts` (a
 * `packages/plugin` file outside this bead's owned paths) is `[ILB-PRA-5]`'s
 * job.
 *
 * **`RoutingDecision` restates `decideConceptRouting`'s own return shape
 * (`ConceptRoutingDecision`, `packages/plugin/src/generation/routing.ts`)
 * structurally rather than importing it** — `olea-core` has no dependency on
 * `packages/plugin` (the dependency runs the other way), so this is a
 * structural type a real `ConceptRoutingDecision` already satisfies
 * field-for-field, the same "restate, don't import across the boundary"
 * discipline `authoring-outcome.ts` (this bead's sibling) documents for
 * `DraftQuizCardsResult`. Only `.gaps` is actually read — `.classification`
 * and `.mix` are carried on the type for fidelity with the real shape a
 * caller holds, and so a future richer `reason` (naming the knowledge kind,
 * say) has somewhere to read from without a signature change.
 *
 * **What counts as "wanted."** A routing group is wanted when
 * `InstrumentMixGap.deficit > 0` — the same reading `quizDeficit`
 * (`routing.ts`) already gives the `quiz` group alone; this module applies it
 * to all three groups in `../routing/instrument-mix.js`'s `ROUTING_GROUPS`
 * order, deterministically.
 *
 * **Two outcomes, never a silent third.** `selectPracticeFormat` always
 * returns either the one format to draft now, or a record naming what is
 * wanted and why nothing was drafted, or — when the concept's mix is already
 * fully met — an explicit `NothingWanted` record. A met mix is not an unmet
 * need, so it gets its own shape rather than a reason code on the deferral
 * record; it is still never `undefined`, because "nothing to report" is
 * exactly the silent disappearance this module exists to close.
 */

import type { KnowledgeKindClassification } from '../concept/knowledge-kind.js';
import type { InstrumentMix, InstrumentMixGap, RoutingGroup } from './instrument-mix.js';
import { ROUTING_GROUPS } from './instrument-mix.js';

/**
 * The structural shape of `packages/plugin/src/generation/routing.ts`'s
 * `decideConceptRouting` return value — see the module doc for why this is
 * restated rather than imported.
 */
export interface RoutingDecision {
  readonly classification: KnowledgeKindClassification;
  readonly mix: InstrumentMix;
  readonly gaps: readonly InstrumentMixGap[];
}

/**
 * Why `selectPracticeFormat` recorded a deferral: `'unmet-format'` — at least
 * one routing group is wanted (`deficit > 0`), and none of the wanted groups
 * is in `deliverableFormats`. This is pra.md §3's `deferred` reason of the
 * same name, at the routing layer.
 */
export type UnmetPracticeNeedReason = 'unmet-format';

/**
 * The explicit deferral record this module's whole doc is about — never
 * silently dropped, per pra.md §2's own change note.
 */
export interface UnmetPracticeNeed {
  readonly conceptKey: string;
  /** Every routing group with `deficit > 0`, in `ROUTING_GROUPS` order; never empty. */
  readonly wantedFormats: readonly RoutingGroup[];
  readonly reason: UnmetPracticeNeedReason;
}

/** The concept's mix is already met by its existing inventory: nothing is owed, nothing deferred. */
export interface NothingWanted {
  readonly conceptKey: string;
  readonly nothingWanted: true;
}

/**
 * Which routing groups Olea can currently generate an instrument for.
 * `'quiz'` (MCQ, `quiz.generate.v1`) is the only one with a real generation
 * caller today (`draftQuizCardsForConcept`) — `'retrieval'` (qa/cloze) and
 * `'explainBack'` both have no client-side drafting call yet (this module's
 * own doc, and `packages/plugin/src/commands/create-card.ts`'s module doc,
 * make the same "no generation task produces Q&A/cloze drafts client-side at
 * all" statement independently). A caller with a real generator for another
 * group passes its own set rather than this one — this constant is today's
 * honest default, not a ceiling this module enforces.
 */
export const MCQ_ONLY_DELIVERABLE_FORMATS: ReadonlySet<RoutingGroup> = new Set(['quiz']);

/**
 * Routes one concept's practice need to a format, or an explicit record of
 * what could not be delivered. Pure: the same `decision`/`conceptKey`/
 * `deliverableFormats` always produce the same result.
 *
 * When more than one wanted group is also deliverable (not possible with
 * `MCQ_ONLY_DELIVERABLE_FORMATS` today, since it has exactly one member, but
 * kept correct for a future caller with a richer set), the first in
 * `ROUTING_GROUPS` order wins — deterministic, and matching the order every
 * other per-group iteration in this directory already uses
 * (`instrumentMixGaps`).
 */
export function selectPracticeFormat(
  decision: RoutingDecision,
  conceptKey: string,
  deliverableFormats: ReadonlySet<RoutingGroup> = MCQ_ONLY_DELIVERABLE_FORMATS,
): RoutingGroup | UnmetPracticeNeed | NothingWanted {
  const wanted = ROUTING_GROUPS.filter(
    (group) => (decision.gaps.find((gap) => gap.group === group)?.deficit ?? 0) > 0,
  );

  const deliverableWanted = wanted.find((group) => deliverableFormats.has(group));
  if (deliverableWanted !== undefined) return deliverableWanted;

  if (wanted.length === 0) return { conceptKey, nothingWanted: true };
  return { conceptKey, wantedFormats: wanted, reason: 'unmet-format' };
}
