/**
 * KC-type-to-instrument routing — component register row 2.2, "choose which
 * type suits which concept" (`ol-tqd5`, `ol-dlr1`).
 *
 * **This is a PRE-REGISTERED DEFAULT, not a measured baseline.** At n=1
 * (one student, one vault, one term) there is no statistical power to test a
 * routing policy against delayed retention or transfer. `ol-tqd5` adopts it
 * now on the research argument in `docs/research/GLOSSARY.md`'s KLI
 * Application (a TENET) and `docs/dev/routing-policy.md` (the rationale
 * document, private repo — cite by path, this module does not restate it),
 * with the comparator it must eventually beat recorded alongside it
 * (`CARDS_FOR_EVERYTHING_NULL` below) so the eventual comparison is not
 * designed after the fact against whichever result looks better.
 *
 * **Pure, total, INV-1-clean.** No I/O, no model call, no vault read.
 * Mirrors `../concept/size.js`'s posture: everything here is arithmetic over
 * an already-classified label plus an inventory count, never a judgement
 * this module makes itself.
 *
 * ## The tenet this module implements literally
 *
 * KLI Application, rule 1: routing is **1:MANY BY DESIGN** and **1:1 is
 * FORBIDDEN**. The reason is structural, not aesthetic — mastery has two
 * dimensions fed by different evidence. Vitality (the retrievability
 * reading, `../mastery/vitality.js`) is fed by recall-tier instruments;
 * depth (the growth-stage top, gated by a SOLO verdict) is fed **only** by a
 * graded explain-back — `../mastery/vitality.js`'s own doc: `mcq` is
 * recognition-tier and excluded from the vitality fold, `explain-back` is
 * excluded for the unrelated reason that it is never FSRS-scheduled. A 1:1
 * routing starves one dimension for every concept it touches, whichever way
 * the assignment falls.
 *
 * Rule 2 says KC-type sets **emphasis within the mix, never membership**.
 * This module reads that literally: for every real (non-`unclassified`)
 * `KnowledgeKind`, all three routing groups stay present in the returned
 * mix — none is ever `'none'` — and only their relative emphasis moves. The
 * one case that DOES narrow membership is `unclassified` (rule 4: "routes to
 * the retrieval baseline alone, never guessed"), which is deliberately a
 * different thing from a KC-type assignment: it is the fallback for *nothing
 * classified*, not a routing decision about a classified concept.
 *
 * **Why membership must stay constant for real types (an argument this
 * module adds, not restated from the source).** `docs/research/GLOSSARY.md`'s
 * SOLO Application rule 2: "only a graded explain-back response can carry a
 * SOLO verdict — cards and MCQs cannot." The BKT Application rule 2: "the top
 * stage is never reachable by BKT accumulation alone." Read together, a
 * concept whose mix permanently excludes `explainBack` can **never** reach
 * the top growth stage, for as long as the classifier's label stands —
 * regardless of what "mastery" means for that KC type in the abstract. A
 * table that set `fact → { explainBack: 'none' }` would not be a cheaper
 * variant of the right policy; it would structurally lock every fact-typed
 * concept out of the top stage forever. So every real label keeps a `'floor'`
 * presence in every group; only the group the type itself argues for gets
 * elevated to `'weighted'` or `'dominant'`.
 *
 * ## What this buys under measured classifier error (KCT-3, `ol-3ux7.6`)
 *
 * The knowledge-kind classifier measured κ = 0.424 against a careful human
 * reader on the real vault's 102-concept census, with **principle → fact**
 * the single largest error cell (11 of 36 principle concepts mislabelled
 * `fact`) — exactly the direction that would starve depth practice if this
 * module's mix for `fact` excluded `explainBack`. Because it does not
 * (§ above), a principle concept misclassified as `fact` still keeps
 * `explainBack: 'floor'` in its mix rather than `'none'` — misrouted in
 * *emphasis*, never cut off from the evidence its own growth stage needs.
 * That is the graceful-degradation property `ol-tqd5` asks this module to
 * state plainly: under the worst error mode actually measured, routing
 * degrades toward the cards-for-everything null's *emphasis*, not toward its
 * *exclusions* — depth stays reachable, only slower to prioritise.
 *
 * ## Deferred, not decided (recorded so a later reader does not assume this settled it)
 *
 * `docs/research/GLOSSARY.md`'s KLI Application leaves one question open and
 * explicitly charter-owned: whether a single instrument **item** may span
 * multiple concepts (true many:many, as opposed to one concept carrying a
 * mix of several single-concept instruments). This module does not decide
 * it — every `InstrumentMix` here is per-concept, and nothing here assumes
 * or forecloses multi-concept items. `ol-tqd5`'s notes: ruling it in has a
 * bookkeeping consequence for `MAT-2` (`ol-95vv`), because multi-KC items are
 * exactly where AFM/PFA-style models outperform plain BKT.
 *
 * The effort-share constraint N-030 names (session-minutes and effort
 * density, not just a KC-type table) is also out of scope here — this module
 * answers "which types", not "how many minutes"; that is a separate,
 * not-yet-filed bead.
 *
 * ## Where it runs, and what has no caller yet
 *
 * `docs/Olea_component_register.md` row 2.2: boundary **service**... but this
 * module itself is pure arithmetic with no model call, no different from
 * `../concept/size.js`'s "honest floor" posture — it is placed under
 * `packages/core` because that is where every other pure routing/derivation
 * module in this register lives, and because its two real inputs (a
 * `KnowledgeKind` label from 1.5, an inventory count) are both already
 * client-side values by the time 2.2 would run. Nothing in this module makes
 * a network call.
 *
 * **No caller exists yet, deliberately** (same shape `../concept/knowledge-kind.js`
 * documents for its own entry point). Component register row 2.2's three
 * named inputs — the knowledge-type label from 1.5, concept size from 1.3,
 * and the concept's existing instrument inventory — are, in the register's
 * own words, "themselves unbuilt, so this sits two hops behind ready
 * inputs." `ConceptInstrumentInventory` below is this module's own minimal
 * shape for the third input, not a claim that a real inventory-tracking
 * component exists; wiring `routeKnowledgeKind` to `../concept/knowledge-kind.js`'s
 * output and to a real inventory reader is future work, not this bead's.
 */

import type { InstrumentType } from 'olea-contracts';
import type { KnowledgeKind, KnowledgeKindClassification } from '../concept/knowledge-kind.js';

/**
 * The three groups this module routes across. Coarser than `InstrumentType`
 * on purpose — `qa` versus `cloze` is a vault-authoring format choice
 * (C5.3), never a routing decision, so both fold into one `retrieval` group.
 */
export type RoutingGroup = 'retrieval' | 'quiz' | 'explainBack';

/** Every routing group, for iteration. */
export const ROUTING_GROUPS: readonly RoutingGroup[] = ['retrieval', 'quiz', 'explainBack'];

/**
 * Which contract `InstrumentType`s each routing group covers. Derived
 * one-to-one from `../mastery/vitality.js`'s own recall/recognition/depth
 * split (`RecallTierInstrumentType`, `isRecallTier`) rather than re-decided
 * here, so a fifth instrument type added to `olea-contracts` disagrees with
 * exactly one place if it is not also a recall-tier retrieval format.
 */
export const ROUTING_GROUP_INSTRUMENT_TYPES: Readonly<
  Record<RoutingGroup, readonly InstrumentType[]>
> = {
  retrieval: ['qa', 'cloze'],
  quiz: ['mcq'],
  explainBack: ['explain-back'],
};

/**
 * How strongly a routing group is emphasised within a concept's mix.
 * `'none'` is reserved for the `unclassified` fallback (see module doc) —
 * no real `KnowledgeKind` ever produces `'none'` for any group.
 */
export type InstrumentEmphasis = 'none' | 'floor' | 'weighted' | 'dominant';

/**
 * A concept's target instrument-type mix. One entry per routing group,
 * always present — reading a group's emphasis never requires checking
 * whether the key exists, which is what "membership never varies" means at
 * the type level, not just the policy-prose level.
 */
export interface InstrumentMix {
  readonly retrieval: InstrumentEmphasis;
  readonly quiz: InstrumentEmphasis;
  readonly explainBack: InstrumentEmphasis;
}

/**
 * DECLARED (not derived — `docs/Olea_component_register.md`'s
 * declared/derived rule; n=1 cannot fit this, same reasoning `[D-066]`
 * applies to `../concept/size.js`'s single number).
 *
 * **Plain-English defence.** The scale is ordinal, not proportional: each
 * step is "meaningfully more of this group's practice than the step below,"
 * not a fitted ratio. `'floor'` names one minimally-present instrument of
 * the group — enough that the group is never structurally absent (the
 * argument in the module doc above). `'weighted'` and `'dominant'` are
 * `floor`'s multiples in name only, standing in for "more than the floor,
 * revisited by the effort-share work N-030 names" rather than claiming a
 * measured target count. A consumer that needs a real generation quota
 * should not read numeric precision into these values beyond their
 * ordering.
 */
export const EMPHASIS_ORDER: Readonly<Record<InstrumentEmphasis, number>> = {
  none: 0,
  floor: 1,
  weighted: 2,
  dominant: 3,
};

/**
 * The KC-type-to-emphasis table. Candidate emphases are **charter-owned**
 * (`ol-tqd5`'s notes, KLI Application rule 2) — this module does not invent
 * them, it makes them a checkable value. If a later ruling changes an
 * emphasis, this is the one place that changes.
 */
const KIND_MIX: Readonly<Record<KnowledgeKind, InstrumentMix>> = {
  // "fact → retrieval-dominant." Mastery is reliable recall (KCT-3 §3's
  // operational definition). explainBack stays at floor rather than none —
  // see the module doc's depth-gate-reachability argument.
  fact: { retrieval: 'dominant', quiz: 'floor', explainBack: 'floor' },
  // "category/concept → quiz-weighted, with FCI-discipline distractors and
  // contrasting examples." Mastery is classifying a new instance correctly.
  category: { retrieval: 'floor', quiz: 'weighted', explainBack: 'floor' },
  // "rule/principle/mechanism → explain-back-weighted." Mastery is transfer
  // to a new situation, which only a graded explain-back can evidence
  // (SOLO Application rule 2).
  principle: { retrieval: 'floor', quiz: 'floor', explainBack: 'weighted' },
};

/**
 * The fallback mix for a concept the classifier declined to label —
 * KLI Application rule 4, `ol-m5wp`'s guard requirement: "routes to the
 * retrieval baseline alone, never guessed." The one place `quiz` and
 * `explainBack` are legitimately `'none'`: there is nothing in the label to
 * argue for elevating either, and guessing is exactly what this fallback
 * exists to avoid.
 */
export const UNCLASSIFIED_MIX: InstrumentMix = {
  retrieval: 'floor',
  quiz: 'none',
  explainBack: 'none',
};

/**
 * The null this policy must eventually beat, per `ol-tqd5`'s acceptance
 * criteria and the product notebook's N-029: route every concept, regardless
 * of KC type, to the cheapest instrument alone. Written down now, before any
 * comparison is runnable, so a later measurement is not designed after
 * seeing which result looks better. Deliberately violates the "1:many, 1:1
 * forbidden" tenet — that is the whole point of a naive comparator, not an
 * oversight; nothing in this module treats it as a real routing option.
 */
export const CARDS_FOR_EVERYTHING_NULL: InstrumentMix = {
  retrieval: 'dominant',
  quiz: 'none',
  explainBack: 'none',
};

/**
 * The routing decision. `kind` is `null` for a concept the classifier
 * declined to label (mirrors `../concept/knowledge-kind.js`'s
 * `KnowledgeKindClassification` discriminated union — callers reading a
 * `'unclassified'`-status classification pass `null` here, never a fourth
 * string literal smuggled into `KnowledgeKind`).
 */
export function routeKnowledgeKind(kind: KnowledgeKind | null): InstrumentMix {
  if (kind === null) return UNCLASSIFIED_MIX;
  return KIND_MIX[kind];
}

/**
 * Convenience wrapper reading `../concept/knowledge-kind.js`'s own result
 * shape directly, so a future caller narrows `status` once (there, at the
 * classification boundary) rather than re-deriving `KnowledgeKind | null`
 * at every call site. Equivalent to `routeKnowledgeKind(classification.status
 * === 'classified' ? classification.kind : null)`.
 */
export function routeKnowledgeKindClassification(
  classification: KnowledgeKindClassification,
): InstrumentMix {
  return routeKnowledgeKind(classification.status === 'classified' ? classification.kind : null);
}

/**
 * The stated reason routing proposes this mix — KLI Application rule 3:
 * "routing PROPOSES; the student disposes. The proposed emphasis surfaces at
 * triage WITH ITS REASON... naming the type is what makes it contestable."
 * This function is the reason text; **nothing composes it to a surface
 * yet** — no triage view exists to read it (see the module doc's wiring
 * note). Written now so the reason is a checkable value the day a surface
 * does exist, rather than invented at the UI layer against no source of
 * truth.
 */
export function routingReason(kind: KnowledgeKind | null): string {
  switch (kind) {
    case 'fact':
      return 'this is a discrete fact, so Olea emphasises recall practice';
    case 'category':
      return 'this is a category, so Olea emphasises quiz practice that tells it apart from neighbours';
    case 'principle':
      return 'this is a mechanism, so Olea suggests explain-back';
    case null:
      return 'Olea could not tell what kind of knowledge this is, so it keeps to recall practice until it can';
    default: {
      const exhaustive: never = kind;
      throw new Error(`routingReason: unhandled KnowledgeKind ${String(exhaustive)}`);
    }
  }
}

/**
 * A concept's existing instrument counts, grouped the same way
 * `ROUTING_GROUP_INSTRUMENT_TYPES` groups `InstrumentType`. This module's own
 * minimal shape for component register row 2.2's third input ("the
 * concept's existing instrument inventory") — **not a claim that a real
 * inventory-tracking component exists yet.** See the module doc's wiring
 * note.
 */
export interface ConceptInstrumentInventory {
  readonly retrieval: number;
  readonly quiz: number;
  readonly explainBack: number;
}

/** An inventory reading every group at zero — the honest starting point for a concept with no instruments yet. */
export const EMPTY_INVENTORY: ConceptInstrumentInventory = {
  retrieval: 0,
  quiz: 0,
  explainBack: 0,
};

/**
 * One routing group's gap between its target emphasis and what already
 * exists. `deficit` is what a generation orchestrator (component 2.1) would
 * read to decide what to make next — **this module does not decide
 * generation order itself**, it only reports the gap; see `EMPHASIS_ORDER`'s
 * doc for why a numeric deficit here should not be read as a measured
 * quota.
 */
export interface InstrumentMixGap {
  readonly group: RoutingGroup;
  readonly emphasis: InstrumentEmphasis;
  /** `EMPHASIS_ORDER[emphasis]`, carried alongside so a caller never has to re-look it up. */
  readonly target: number;
  readonly existing: number;
  /** `Math.max(0, target - existing)`. Zero means this group's floor (or higher) is already met. */
  readonly deficit: number;
}

/**
 * Compares a mix's targets against an inventory, one entry per routing
 * group, in `ROUTING_GROUPS` order. A group at emphasis `'none'` always
 * reports `target: 0` and therefore `deficit: 0` — nothing is ever "missing"
 * for a group the mix deliberately excludes.
 */
export function instrumentMixGaps(
  mix: InstrumentMix,
  inventory: ConceptInstrumentInventory,
): readonly InstrumentMixGap[] {
  return ROUTING_GROUPS.map((group) => {
    const emphasis = mix[group];
    const target = EMPHASIS_ORDER[emphasis];
    const existing = inventory[group];
    return { group, emphasis, target, existing, deficit: Math.max(0, target - existing) };
  });
}
