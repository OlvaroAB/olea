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
 *
 * **Endpoints resolve to an identity, not only a wording (`[D-402]`,
 * `ol-egov.141.89.4.19`).** Since `[D-402]` one wording can name several
 * identities in one read: `./extract.js` mints one per course for a topic
 * wording cited in two courses, and `./read.js` corroborates each proposal
 * against the identity of the course its passages sit in, so the concept set
 * holds one entry per identity under the same name. A relation still names
 * its endpoints by wording (`ProposedRelation`), so a wording that matches
 * entries of more than one identity (`ReconcilableConcept.key`) is resolved by
 * the document the relation was proposed in: a reader call reads one document
 * (`[D-210]`) and every anchored concept's passages come from the one
 * proposal that introduced it, so the identity whose passages sit in that
 * document is the one the call was talking about — the same course scoping
 * the read path applies to the concepts themselves. When the proposal says
 * which document it came from (`ScopedProposedRelation.sourcePath`), that
 * document decides; when it does not, the other endpoint's documents do (the
 * pair that shares a document). **If more than one identity is still left,
 * the relation is dropped and counted as `'ambiguous-concept'`, never
 * resolved to the first identity** — a wrong endpoint is silent downstream,
 * a drop is counted. A wording with one identity resolves exactly as it
 * always has: first concept to claim the wording (with the proposing
 * document known, the first whose passages sit in it).
 *
 * Every emitted edge carries its endpoints' keys (`fromKey`/`toKey`, the
 * `./related-concept-keys.js` shape) whenever the concepts carry one, so a
 * reader downstream joins by identity rather than repeating the name join
 * this module has already disambiguated.
 */

import type { Provenance } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';
import type { RelationWithEndpointKeys } from './related-concept-keys.js';
import { PER_DOCUMENT_EMITTABLE_TYPES, type ProposedRelation } from './relation.js';

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
  /**
   * The opaque identity key (`[D-088]`) — matches `ReadConcept.key`. Two
   * entries with one wording and different keys are two identities
   * (`[D-402]`, module doc); entries sharing a key are one. Optional so a
   * fixture may omit it: entries without a key count as one identity, which
   * is exactly the pre-`[D-402]` behaviour.
   */
  readonly key?: string;
  /** This concept's other passages — matches `ReadConcept.alsoIn`. Read with `anchor` to place the concept in a document. */
  readonly alsoIn?: readonly Provenance[];
}

/**
 * A proposed relation plus the document whose reader call proposed it
 * (`[D-210]`: a call never mixes documents). `./read.js` knows the document of
 * every call; when it passes it here, a wording naming several identities
 * resolves to the one whose passages sit in that document (module doc).
 * Absent, the pair of endpoints that share a document decides instead.
 */
export interface ScopedProposedRelation extends ProposedRelation {
  readonly sourcePath?: VaultPath;
}

/**
 * Every way a proposed relation fails to become an edge. A closed set on
 * purpose — this is the vocabulary a caller reports against, and a reason
 * that is not one of these is a bug in this module, not a new kind of drop to
 * add ad hoc. `'ambiguous-concept'` (`ol-egov.141.89.4.19`): an endpoint's
 * wording names more than one identity and nothing about the relation says
 * which (module doc).
 */
export type RelationDropReason =
  | 'unknown-concept'
  | 'ambiguous-concept'
  | 'not-per-document-eligible'
  | 'missing-passage-provenance';

const DROP_REASONS: readonly RelationDropReason[] = [
  'unknown-concept',
  'ambiguous-concept',
  'not-per-document-eligible',
  'missing-passage-provenance',
];

export interface ReconcileRelationsResult {
  /** Each edge carries `fromKey`/`toKey` whenever its endpoint concepts carry a `key`. */
  readonly relations: readonly RelationWithEndpointKeys[];
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
 * could have named them (`ProposedRelation`'s doc). Every claimant is kept,
 * in concept order, so the first entry is the concept that claimed the
 * wording first — the resolution this module has always used, and still uses
 * unless that concept's name is split across identities (`sameNamed`).
 */
function indexByWording(
  concepts: readonly ReconcilableConcept[],
): ReadonlyMap<string, readonly ReconcilableConcept[]> {
  const index = new Map<string, ReconcilableConcept[]>();
  for (const concept of concepts) {
    for (const wording of new Set([concept.name, ...concept.aliases])) {
      const claimants = index.get(wording);
      if (claimants === undefined) index.set(wording, [concept]);
      else claimants.push(concept);
    }
  }
  return index;
}

/**
 * The concepts a wording can mean: the first claimant and every other
 * claimant carrying the same name. A `[D-402]` split is one name held by
 * several identities (`./read.js` keeps each identity's entry under the
 * shared name, and a reader's own wording as an alias of each), so this is
 * the set `scopeClaimants` chooses among. A claimant of the wording under a
 * different name is a different concept whose alias happens to collide; that
 * case keeps the first-claimant rule this module has always applied, and is
 * not this change's to re-rule.
 */
function sameNamed(claimants: readonly ReconcilableConcept[]): readonly ReconcilableConcept[] {
  const first = claimants[0];
  if (first === undefined) return claimants;
  return claimants.filter((concept) => concept.name === first.name);
}

/** How many identities the claimants hold; entries without a key count as one. */
function identityCount(claimants: readonly ReconcilableConcept[]): number {
  return new Set(claimants.map((concept) => concept.key)).size;
}

/** The documents a concept's own passages sit in — empty for a concept the read never anchored. */
function documentsOf(concept: ReconcilableConcept): ReadonlySet<VaultPath> {
  if (concept.anchor === undefined) return new Set();
  return new Set([concept.anchor, ...(concept.alsoIn ?? [])].map((passage) => passage.sourcePath));
}

function sharesDocument(a: ReconcilableConcept, b: ReconcilableConcept): boolean {
  const theirs = documentsOf(b);
  for (const path of documentsOf(a)) if (theirs.has(path)) return true;
  return false;
}

/**
 * Narrow each endpoint's claimants to the identity the relation meant
 * (module doc). With the proposing document known, every side keeps its
 * claimants whose passages sit in that document, when it has any. Without
 * it, a side whose claimants hold more than one identity keeps those that
 * share a document with some claimant of the other side; a side with one
 * identity is left alone, so an unsplit wording resolves as it always has.
 * Returns the narrowed claimants; the caller decides whether one identity is
 * left on each side.
 */
function scopeClaimants(
  from: readonly ReconcilableConcept[],
  to: readonly ReconcilableConcept[],
  sourcePath: VaultPath | undefined,
): { readonly from: readonly ReconcilableConcept[]; readonly to: readonly ReconcilableConcept[] } {
  if (sourcePath !== undefined) {
    const inDocument = (claimants: readonly ReconcilableConcept[]) => {
      const here = claimants.filter((concept) => documentsOf(concept).has(sourcePath));
      return here.length > 0 ? here : claimants;
    };
    return { from: inDocument(from), to: inDocument(to) };
  }
  const fromSplit = identityCount(from) > 1;
  const toSplit = identityCount(to) > 1;
  if (!fromSplit && !toSplit) return { from, to };
  return {
    from: fromSplit ? from.filter((f) => to.some((t) => sharesDocument(f, t))) : from,
    to: toSplit ? to.filter((t) => from.some((f) => sharesDocument(f, t))) : to,
  };
}

/**
 * Turn a stage's proposed relations into real edges, against the concepts
 * that same stage actually returned. **The concept set is authoritative**:
 * nothing here ever adds to it, widens it, or infers a member for it from a
 * relation's own wording.
 */
export function reconcileRelations(
  proposed: readonly ScopedProposedRelation[],
  concepts: readonly ReconcilableConcept[],
): ReconcileRelationsResult {
  const byWording = indexByWording(concepts);
  const dropped = emptyDropCounts();
  const relations: RelationWithEndpointKeys[] = [];

  for (const candidate of proposed) {
    if (!PER_DOCUMENT_EMITTABLE_TYPES.has(candidate.type)) {
      dropped['not-per-document-eligible'] += 1;
      continue;
    }

    const fromClaimants = byWording.get(candidate.from);
    const toClaimants = byWording.get(candidate.to);
    // THE RULE: a relation naming a concept the concept call did not return
    // is dropped and logged, never used to mint a concept.
    if (fromClaimants === undefined || toClaimants === undefined) {
      dropped['unknown-concept'] += 1;
      continue;
    }

    // `[D-402]`: a wording naming several identities resolves by the
    // document the relation came from, or not at all — never to the first.
    const scoped = scopeClaimants(
      sameNamed(fromClaimants),
      sameNamed(toClaimants),
      candidate.sourcePath,
    );
    const from = scoped.from[0];
    const to = scoped.to[0];
    if (
      from === undefined ||
      to === undefined ||
      identityCount(scoped.from) > 1 ||
      identityCount(scoped.to) > 1
    ) {
      dropped['ambiguous-concept'] += 1;
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
      ...(from.key !== undefined ? { fromKey: from.key } : {}),
      ...(to.key !== undefined ? { toKey: to.key } : {}),
    });
  }

  return { relations, dropped };
}
