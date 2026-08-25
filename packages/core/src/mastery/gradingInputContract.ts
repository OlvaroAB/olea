/**
 * The grading rubric's INPUT CONTRACT (`ol-0r92.4` / `MAT-4`) — what fills the source slot, what
 * the omission denominator is, and which record receives the output, ruled by `[D-083]` /
 * `GRD-1` (`ol-2jod.13`) after `[D-080]` moved the grading unit question onto the critical path
 * and left it open.
 *
 * **What `[D-083]` settled, in one line: the concept stays the unit.** A relation-explanation is
 * prompted as *"explain X, including how it relates to Y"* — X is the subject and is fixed when
 * the prompt is composed, Y is context, and no grading outcome may reassign the scoring target or
 * add a second one (C5.11, R9, knowledge model §6). This module is the client-side shape of that
 * ruling: it decides what goes into a grading call and what comes back out of it that is *not*
 * scoring evidence, before any call is ever made. The grading core it feeds — the integration bar,
 * error citation, the SOLO verdict itself — was never in question and is not built here.
 *
 * ## Why this lives in `mastery/`, not `grading/`
 *
 * `./rollup.ts`, `./vitality.ts` and `./sprig.ts` already own the question "what counts as
 * evidence, and for which concept" — R3, R7, R9 are read from the evidence log by this package,
 * never asserted by a model. `[D-083]`'s ruling is exactly that question asked of a harder case
 * (an explanation whose subject is a relation): which concept is scored, what bounds the omission
 * denominator, and where a non-scoring by-product goes. `packages/core/src/grading/*` (P4-T02,
 * untouched by this task) owns the *wire* shapes and the grounding mechanics for the existing
 * correct/partial/incorrect judge; this module owns the *mastery-side* decision that a future SOLO
 * rubric task (`MAT-2` / `ol-95vv` §5) will build its request from. `SourceBlockRef` is imported
 * from `../grading/gradingPipeline.js` rather than redefined, for the same reason that file gives
 * for importing `MisconceptionDigestEntry` instead of re-declaring it: it is the one place this
 * package already holds the shape, and a second declaration would just be a second thing to keep
 * in sync with the Worker's zod schema by hand.
 *
 * ## The architectural rule this module preserves, structurally
 *
 * `MAT-2`'s charter (`R9`, knowledge model §6): *"the model grades an answer; the state holds the
 * estimate. No LLM ever holds, emits or adjusts a mastery estimate."* This module is the INPUT
 * half and carries no verdict, no depth level and no mastery estimate of any kind — every export
 * below describes what is *sent* or what is *not scoring evidence*, and nothing here has a field a
 * grading response could populate with a number. The response schema that must make a mastery
 * estimate unrepresentable is separate, not-yet-built work (the SOLO rubric itself); this module's
 * contribution to that property is that the two non-scoring outputs it names —
 * `SchedulingObservation` and `CandidateEdgeNomination` — are their own types, disjoint from
 * anything `./rollup.ts` folds, so a mastery fold cannot read either by accident. `R9`'s
 * strip-invariance test (knowledge model §8, test 5) is what would fail if that stopped being true.
 *
 * ## The six things `[D-083]` ruled, and where each lives below
 *
 * 1. **The subject is fixed at prompt time; no grading outcome may reassign or add a scoring
 *    target.** `GradingSubject` — the one field every export below is built around, and the only
 *    concept id `buildGradingSourceMaterial`'s output is ever evidence for.
 * 2. **Retrieval is a lookup, not a search** (F5.2a, C5.12): `GradingRelationContext` and
 *    `buildGradingSourceMaterial` assemble the subject's defining passages, the edge's own
 *    provenance passages, and the neighbour's defining passages as context — every one of those is
 *    a field already on a record C7.10/`[D-082]` requires to exist, never a fresh retrieval.
 * 3. **The three provenance cases, including both "written nowhere" sub-cases** — `RelationProvenance`'s
 *    three-armed union: `edge-provenance` (stated in one document, or implied across two — the same
 *    shape either way, per F5.2a), `asserted-no-provenance` (her own link, no textual provenance),
 *    and `no-edge` (she asserted a relation the graph does not have).
 * 4. **The omission denominator — subject material plus edge provenance, nothing wider** (F5.3):
 *    `GradingSourceMaterial.omissionDenominator`, built to exclude the neighbour's own defining
 *    passages even though they are sent as retrieval context.
 * 5. **The degradation: where no provenance exists, omissions are undefined and the rubric says
 *    so** (F5.3's one bounded, named exception): `omissionDenominator` is `null`, never `[]` — see
 *    that field's own doc for why the distinction is load-bearing.
 * 6. **Two outputs that are not scoring evidence** (F5.3a, C5.11, `[D-087]`): `CandidateEdgeNomination`
 *    (emitted by `buildGradingSourceMaterial` itself, in the `no-edge` case) and
 *    `SchedulingObservation` (constructed downstream, once a response exists, from a fact this
 *    module cannot know in advance — see that type's own doc for why it is declared here anyway).
 *
 * ## What is deliberately NOT here
 *
 * - **The SOLO verdict / response schema.** `[D-083]` explicitly leaves the grading core untouched;
 *   building the response shape that makes a mastery estimate unrepresentable is separate work.
 * - **Support level** (`[D-094]`, R7's discount arithmetic). A different ruling, answering a
 *   different question (how much a supported success counts, not what the grader is handed) —
 *   folding it in here would be scope creep past what `[D-083]` decided.
 * - **The persisted field for `SchedulingObservation`.** D-087 rules the *shape* (a non-scoring
 *   field on the review event that produced it) and this module gives that shape a concrete type,
 *   but the actual `contracts/review-log.ts` field addition is `ol-tka5`'s migration — open,
 *   Class C, and not this task's to pre-empt.
 * - **Reading the vault to build `ConceptDefiningPassages`/`RelationProvenance` in the first
 *   place.** That is retrieval-port wiring for whichever caller builds the SOLO rubric request;
 *   this module receives already-resolved passages and decides what to do with them.
 */

import type { SourceBlockRef } from '../grading/gradingPipeline.js';

// ---------------------------------------------------------------------------
// 1. The subject — fixed at prompt time, C5.11 / R9
// ---------------------------------------------------------------------------

/**
 * The concept a grading call scores. **Fixed when the prompt is composed, by ordinary
 * scheduling** — never by anything the grader later returns. Every export in this module is built
 * around exactly one `subjectConceptId`; nothing here accepts a grading outcome as an input to
 * *this* type, because the whole point of C5.11's prompt-time fixing is that there is no such
 * outcome to accept — the subject is settled before the model is ever called.
 */
export interface GradingSubject {
  readonly subjectConceptId: string;
}

/** A concept's defining passages — the identity-story material F5.2a hands the grader for it. */
export interface ConceptDefiningPassages {
  readonly conceptId: string;
  readonly passages: readonly SourceBlockRef[];
}

// ---------------------------------------------------------------------------
// 2 & 3. Retrieval and the three provenance cases (F5.2a)
// ---------------------------------------------------------------------------

/**
 * Where a concept ↔ concept edge's own evidence comes from, when the explanation being graded
 * names a relation — the three cases F5.2a rules, collapsed to the shapes that actually differ.
 *
 * **`edge-provenance` covers two of the contract's named cases with one shape**, because they
 * retrieve identically: "stated in one document" and "implied across two" both mean the edge
 * carries the introducing passages of both endpoints (one document → one passage typically covers
 * both mentions; two documents → the corpus stage's own combined-context pair, C7.10/`[D-082]`),
 * and in both cases retrieval is simply reading that record. Splitting them into two variants here
 * would invent a distinction the retrieval logic does not act on.
 */
export type RelationProvenance =
  | {
      /** The edge was minted with real textual evidence — one document or two, retrieved alike. */
      readonly kind: 'edge-provenance';
      /** The edge's own introducing passages (C7.10 §5: "the introducing passages of both endpoints"). Non-empty. */
      readonly passages: readonly SourceBlockRef[];
    }
  | {
      /** She linked the two concepts herself; the edge is real but carries no textual provenance. */
      readonly kind: 'asserted-no-provenance';
      /** Her own linking note, retrieved in place of provenance passages (F5.2a). */
      readonly linkingNote: SourceBlockRef;
    }
  | {
      /** She asserted a relation the graph does not have at all — no edge exists to read from. */
      readonly kind: 'no-edge';
    };

/**
 * What the prompt asks her to explain: a single concept, or a concept in relation to a named
 * neighbour. This is a property of how the prompt was composed (F2.21, F5.2a), decided upstream of
 * this module and handed in — never inferred from the answer, which would let a grading outcome
 * retroactively decide what was being asked, exactly the thing C5.11's prompt-time fixing forbids.
 */
export type GradingRelationContext =
  | { readonly kind: 'concept-only' }
  | {
      readonly kind: 'relation';
      readonly neighbourConceptId: string;
      readonly provenance: RelationProvenance;
    };

/** What `buildGradingSourceMaterial` needs to assemble one grading call's source material. */
export interface GradingRetrievalInput {
  readonly subject: GradingSubject;
  /** Must name `subject.subjectConceptId` — checked, not assumed (see the function's own doc). */
  readonly subjectDefiningPassages: ConceptDefiningPassages;
  readonly relation: GradingRelationContext;
  /**
   * Required exactly when `relation.kind === 'relation'`, and must name
   * `relation.neighbourConceptId` — both checked. Absent for `concept-only`, because a concept
   * that is not part of the prompt has no defining passages to retrieve for it here.
   */
  readonly neighbourDefiningPassages?: ConceptDefiningPassages;
}

// ---------------------------------------------------------------------------
// 6a. Candidate edge nomination — not scoring evidence
// ---------------------------------------------------------------------------

/**
 * F5.2a's `no-edge` case is **additionally** a candidate edge nomination — her correct inference
 * of a relation the graph does not have is exactly the kind of candidate the corpus stage's cheap
 * signals cannot produce (knowledge model R7). It waits in the same accept queue as any other
 * generated structure (INV-6); this type carries no statement, no confidence and no verdict — only
 * the two concept ids — because it is a proposal to review, never evidence to score.
 */
export interface CandidateEdgeNomination {
  readonly subjectConceptId: string;
  readonly neighbourConceptId: string;
}

// ---------------------------------------------------------------------------
// 4 & 5. Source material, the omission denominator, and its degradation
// ---------------------------------------------------------------------------

/**
 * What one grading call is built from, and what bounds its omission scoring.
 *
 * **`omissionDenominator` is `null`, never `[]`, exactly when F5.3's degradation applies.** The
 * two are different claims: an empty array would say "the denominator is defined and it is
 * empty" — nothing could ever be missing, which is false and would silently pass every answer on
 * omissions it never had a chance to fail. `null` says the denominator is **undefined**: omission
 * scoring does not run at all for this call, while errors stay citable against either concept's
 * material and integration stays gradable (F5.3). This is the same discipline `./vitality.ts` uses
 * for `early` and `masteryAtTime` uses for `not-attributable` — an explicit third state stands in
 * for "no honest value here" rather than a value chosen to fill the slot.
 */
export interface GradingSourceMaterial {
  /** Every source block sent to the grader — subject, plus edge/neighbour context when relational. */
  readonly sourceBlocks: readonly SourceBlockRef[];
  /**
   * Subject material plus edge provenance, nothing wider (F5.3) — `null` under the degradation
   * rule above. **Deliberately excludes the neighbour's own defining passages** even when they are
   * part of `sourceBlocks`: F5.3 is explicit that the neighbour contributes to the denominator only
   * what the edge's own provenance passages say about it, never its full defining material.
   */
  readonly omissionDenominator: readonly SourceBlockRef[] | null;
  /** Set only by the `no-edge` provenance case; `null` in every other case. */
  readonly candidateEdgeNomination: CandidateEdgeNomination | null;
}

/**
 * Asserts a `ConceptDefiningPassages` actually names the concept it is supplied for. A programmer
 * error, not a runtime condition arising from real data — the same posture `./vitality.ts`'s
 * `holdingCut` check takes for a value that should never have reached this module wrong.
 */
function assertNames(
  passages: ConceptDefiningPassages,
  expectedConceptId: string,
  label: string,
): void {
  if (passages.conceptId !== expectedConceptId) {
    throw new Error(
      `buildGradingSourceMaterial: ${label} names conceptId "${passages.conceptId}", expected ` +
        `"${expectedConceptId}" — a caller assembled defining passages for the wrong concept`,
    );
  }
}

/**
 * Assembles one grading call's source material from already-resolved passages — the retrieval
 * half of `[D-083]`'s ruling (F5.2a), and the omission-denominator half (F5.3), as one function
 * because both read the same case split.
 *
 * **A lookup, not a search.** Nothing here embeds, ranks or searches anything: every passage
 * arrives pre-resolved (the subject's defining passages, the edge's own provenance, the
 * neighbour's defining passages), because C7.10/`[D-082]` already requires every one of those to
 * exist as a direct reference before this function is ever called — retrieval is reading records
 * that are already there, which is what keeps C5.12's latency bound reachable for the folded
 * mid-review path.
 *
 * Pure and synchronous: same input, same output, no clock, no I/O — matching every other export in
 * this package (`./rollup.ts`'s module doc makes the same argument for the same reason).
 */
export function buildGradingSourceMaterial(input: GradingRetrievalInput): GradingSourceMaterial {
  assertNames(
    input.subjectDefiningPassages,
    input.subject.subjectConceptId,
    'subjectDefiningPassages',
  );

  if (input.relation.kind === 'concept-only') {
    const passages = input.subjectDefiningPassages.passages;
    return {
      sourceBlocks: passages,
      // F5.3's degradation is a named exception for the RELATION case; a concept-only explanation
      // is not the case that clause addresses, so the denominator here is simply the material
      // retrieved for it, whatever that is — never forced to `null` by this branch.
      omissionDenominator: passages,
      candidateEdgeNomination: null,
    };
  }

  const { neighbourConceptId, provenance } = input.relation;
  const neighbourDefiningPassages = input.neighbourDefiningPassages;
  if (!neighbourDefiningPassages) {
    throw new Error(
      'buildGradingSourceMaterial: relation.kind is "relation" but neighbourDefiningPassages was ' +
        'not supplied — required whenever the prompt names a neighbour (F5.2a)',
    );
  }
  assertNames(neighbourDefiningPassages, neighbourConceptId, 'neighbourDefiningPassages');

  const subjectPassages = input.subjectDefiningPassages.passages;
  const neighbourPassages = neighbourDefiningPassages.passages;

  switch (provenance.kind) {
    case 'edge-provenance': {
      // "Stated in one document, or implied across two" — F5.2a's first two cases, one shape.
      const edgePassages = provenance.passages;
      return {
        sourceBlocks: [...subjectPassages, ...edgePassages, ...neighbourPassages],
        // Subject material plus edge provenance, nothing wider (F5.3) — the neighbour's own
        // defining passages never enter the denominator, only what the edge itself states.
        omissionDenominator: [...subjectPassages, ...edgePassages],
        candidateEdgeNomination: null,
      };
    }
    case 'asserted-no-provenance': {
      // An edge she asserted herself, with no textual provenance — F5.2a's second "written
      // nowhere" sub-case. Retrieval still gets both concepts' defining passages plus her own
      // linking note; omission-scoring degrades because there is no provenance to bound it.
      return {
        sourceBlocks: [...subjectPassages, ...neighbourPassages, provenance.linkingNote],
        omissionDenominator: null,
        candidateEdgeNomination: null,
      };
    }
    case 'no-edge': {
      // No edge exists at all — F5.2a's third case. Both concepts' defining passages ground
      // logical-soundness and non-contradiction grading; there is no provenance for omissions,
      // and the event is additionally a candidate edge nomination (knowledge model R7).
      return {
        sourceBlocks: [...subjectPassages, ...neighbourPassages],
        omissionDenominator: null,
        candidateEdgeNomination: {
          subjectConceptId: input.subject.subjectConceptId,
          neighbourConceptId,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// 6b. Scheduling observation — not scoring evidence, rides the subject's own event
// ---------------------------------------------------------------------------

/**
 * F5.3a / C5.11 / `[D-087]`: her demonstrated use of the neighbour, while explaining the subject,
 * is kept as a **scheduling observation, never scoring evidence** — it marks the reciprocal prompt
 * (explaining the neighbour, with the subject as its context) as likely to succeed and worth
 * surfacing soon. It never moves the neighbour's stage, vitality or review state.
 *
 * **Declared here even though nothing in this module constructs one.** Whether her answer actually
 * demonstrated correct use of the neighbour is a property of the *response* — the grading core this
 * task does not build — so this module cannot produce the fact, only name where it goes once
 * something else does:
 *
 * - **It rides the SAME review event as the subject's own verdict** (D-087: "one review stays one
 *   event"). It is never a second event about the neighbour, and it is never scored against
 *   `neighbourConceptId` — C5.11's exception-free rule is what a second event scoring the
 *   neighbour would violate.
 * - **The mastery fold never reads it.** `./rollup.ts` and `./vitality.ts` compute their readings
 *   from `ReviewLogEntry` today, before this field exists on the schema at all; when `ol-tka5`'s
 *   migration adds it, the field's exclusion is what knowledge-model §8 test 5 (strip-invariance)
 *   exists to keep true — stripping it from a log must never change a scoring output.
 * - **The persisted field itself is `ol-tka5`'s to add**, not this module's: that bead is open,
 *   Class C, and carries five other pending review-log additions alongside it. This type is the
 *   shape a caller assembling that migration's payload has to match; it is deliberately not a zod
 *   schema, because the frozen contract (`packages/contracts/src/review-log.ts`) is the one place a
 *   persisted shape is allowed to live, and this is not that.
 */
export interface SchedulingObservation {
  /** The concept her demonstrated use was evidence about — never the subject being scored. */
  readonly neighbourConceptId: string;
}
