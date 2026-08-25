/**
 * The reconciliation contract — a relation naming an unknown concept is
 * dropped and logged, never used to mint one (`[EXT-6]`, `ol-2zfj.8`).
 *
 * `[D-082]` permits several model calls inside the per-document extraction
 * stage, and separate calls can disagree: a relation may name a concept the
 * concept call did not return. **The rule is asymmetric and ruled, not
 * discovered in production: the concept set is authoritative.** Such a
 * relation is dropped and logged. It is never used to mint a concept —
 * doing so would be label-inference through the back door, arriving via our
 * own plumbing rather than via a later pass, which is exactly what C7.10
 * forbids a model from doing by naming a concept from adjacency alone.
 *
 * **The drop counters are not decoration.** A silently dropped relation is
 * indistinguishable from one that was never proposed, and the drop rate is
 * the health signal that tells a caller the concept call and the relation
 * call have diverged. Per D-005 this module counts and reasons; it never
 * carries a concept name or identifier anywhere in its output — the return
 * shape below is the proof: `dropped` is a fixed record of numbers keyed by
 * a closed set of reasons, so there is no field a name could travel through.
 * Turning that count into an actual telemetry line (D7.1) is the composition
 * root's job, the same as every other measurement `./read.js` already
 * reports (`ConceptReadCoverage` and friends) rather than logging itself.
 *
 * **This module is also where C7.10's "every edge carries provenance"
 * requirement is enforced for the per-document stage**, not only the
 * unknown-concept half `[EXT-6]` names: a relation whose named type is not
 * one the per-document stage may emit (`./relation.js`'s
 * `PER_DOCUMENT_EMITTABLE_TYPES`), or whose endpoint concept has no
 * introducing passage of its own, is dropped on the same terms — a relation
 * is either fully provenanced or it does not ship, there is no partial edge.
 */

import type { Provenance } from '../extract/types.js';
import {
  type ConceptRelation,
  PER_DOCUMENT_EMITTABLE_TYPES,
  type ProposedRelation,
} from './relation.js';

/**
 * What `reconcileRelations` needs from each concept the same read already
 * corroborated — deliberately narrow rather than the full `ReadConcept`, so
 * this module does not create an import-cycle dependency on `./read.js` and
 * so its own tests can build the minimum fixture rather than a whole concept
 * record.
 */
export interface ReconcilableConcept {
  /** Post-corroboration identity — matches `ReadConcept.name`. */
  readonly name: string;
  /** Every other wording seen for this concept, verbatim — matches `ReadConcept.aliases`. */
  readonly aliases: readonly string[];
  /**
   * This concept's own introducing passage, or `undefined` for a
   * filing-only concept the read never anchored — see `ReadConcept.anchor`'s
   * doc for why that is the honest value there. An edge naming this concept
   * as an endpoint cannot carry passage-grain provenance for that endpoint
   * and is dropped (`'missing-passage-provenance'`).
   */
  readonly anchor: Provenance | undefined;
}

/**
 * Every way a proposed relation fails to become an edge. A closed set on
 * purpose — this is the vocabulary a caller reports against, and a reason
 * that is not one of these three is a bug in this module, not a new kind of
 * drop to add ad hoc.
 */
export type RelationDropReason =
  | 'unknown-concept'
  | 'not-per-document-eligible'
  | 'missing-passage-provenance';

const DROP_REASONS: readonly RelationDropReason[] = [
  'unknown-concept',
  'not-per-document-eligible',
  'missing-passage-provenance',
];

export interface ReconcileRelationsResult {
  readonly relations: readonly ConceptRelation[];
  /** Counts only, per reason (D-005) — see this module's doc. */
  readonly dropped: Readonly<Record<RelationDropReason, number>>;
}

function emptyDropCounts(): Record<RelationDropReason, number> {
  const counts = {} as Record<RelationDropReason, number>;
  for (const reason of DROP_REASONS) counts[reason] = 0;
  return counts;
}

/** Sum of every drop reason — the one number a caller usually wants for a health signal. */
export function totalDropped(dropped: ReconcileRelationsResult['dropped']): number {
  return DROP_REASONS.reduce((sum, reason) => sum + dropped[reason], 0);
}

/**
 * Index concepts by every wording that should resolve to them: their own
 * name and every alias, exactly the two places a relation's `from`/`to`
 * could have named them (`ProposedRelation`'s doc). First concept to claim a
 * wording wins ties — a wording collision across two distinct concepts in
 * one read would itself be a corroboration defect upstream, not something
 * this module resolves by any rule of its own.
 */
function indexByWording(
  concepts: readonly ReconcilableConcept[],
): ReadonlyMap<string, ReconcilableConcept> {
  const index = new Map<string, ReconcilableConcept>();
  for (const concept of concepts) {
    if (!index.has(concept.name)) index.set(concept.name, concept);
    for (const alias of concept.aliases) {
      if (!index.has(alias)) index.set(alias, concept);
    }
  }
  return index;
}

/**
 * Turn a stage's proposed relations into real edges, against the concepts
 * that same stage actually returned. **The concept set is authoritative**:
 * nothing here ever adds to it, widens it, or infers a member for it from a
 * relation's own wording.
 */
export function reconcileRelations(
  proposed: readonly ProposedRelation[],
  concepts: readonly ReconcilableConcept[],
): ReconcileRelationsResult {
  const byWording = indexByWording(concepts);
  const dropped = emptyDropCounts();
  const relations: ConceptRelation[] = [];

  for (const candidate of proposed) {
    if (!PER_DOCUMENT_EMITTABLE_TYPES.has(candidate.type)) {
      dropped['not-per-document-eligible'] += 1;
      continue;
    }

    const from = byWording.get(candidate.from);
    const to = byWording.get(candidate.to);
    // THE RULE: a relation naming a concept the concept call did not return
    // is dropped and logged, never used to mint a concept.
    if (from === undefined || to === undefined) {
      dropped['unknown-concept'] += 1;
      continue;
    }

    if (from.anchor === undefined || to.anchor === undefined) {
      dropped['missing-passage-provenance'] += 1;
      continue;
    }

    relations.push({
      type: candidate.type,
      from: from.name,
      to: to.name,
      provenance: 'model-proposed',
      confidence: candidate.confidence,
      introducingPassages: { from: from.anchor, to: to.anchor },
    });
  }

  return { relations, dropped };
}
