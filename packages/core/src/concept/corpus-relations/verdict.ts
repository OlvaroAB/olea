/**
 * The combined-passage verdict — the second of the corpus stage's three
 * ruled things (`[D-082]`), and the clause-compliance mechanism itself.
 *
 * **The verdict comes from the passages, not from the two names.** Every
 * candidate this module sends to a `CorpusRelationVerdictPort` carries the
 * FULL introducing-passage text of both endpoints, in working context —
 * never just their names — so the port is structurally unable to infer a
 * relation from label adjacency. Written this way the filter is
 * clause-compliant by construction rather than by discipline (the bead's
 * own phrase for this, and the reason this module's request shape below
 * has no "name-only" path at all). This holds for a `her-link`-nominated
 * pair exactly as much as any other: her link says the two ideas belong
 * together, never what the relationship IS, so the port still reads both
 * passages to decide `type`/`direction`/`confidence` — see the provenance
 * note below for the one thing that DOES change for such a pair.
 *
 * **Provenance is stamped from the nomination signal, not from the model
 * (`[D-070]`, `ol-9qwy`).** A candidate nominated (at least in part) by her
 * own wikilink between the two concept notes reconciles to
 * `RelationProvenanceKind: 'hers'` — the strongest provenance tier the
 * system has, because the expensive judgement ("these two ideas belong
 * together") is a link she authored, not an inference from adjacency. Every
 * other candidate still reconciles to `'model-proposed'`. The TYPE
 * (`prerequisite` / `contrasts-with`) is model-inferred from the sentence
 * either way — provenance answers "who vouches this pair is related", type
 * answers "what the relation is", and this module keeps the two answers
 * separate rather than letting one imply the other. This is `reconcileCorpusVerdicts`
 * reading `CorpusRelationCandidate.signals`, computed after the port
 * returns — the port itself never sees a signal kind and cannot be asked to
 * self-report authorship it has no way to know.
 *
 * **The boundary compliance argument lives in this shape, not only in a
 * document.** `CorpusRelationVerdictPort.verdict` takes a transient batch
 * and returns a transient result — nothing here retains a concept set, an
 * index or embeddings between calls, and nothing here is a class with
 * instance state. A production implementation calls the Worker once per
 * batch and forgets it, the same shape `../read.js`'s `ConceptReaderPort`
 * already uses.
 *
 * **Has a production implementation, as of `[EXT-11]`/`ol-kw4a` (`[D-118]`,
 * 2026-08-25) — corrected 2026-08-26, `ol-2zfj.16`.** The task id
 * (`concepts.relations.v1`) was ratified and entered the frozen catalogue,
 * and `WorkerCorpusRelationVerdict`
 * (`packages/plugin/src/concept/workerCorpusRelationVerdict.ts`) implements
 * this port, wired to a real caller on the existing ingestion-tick interval
 * (`OleaPlugin.tickIngestionAndMaybeRunCorpusRelations`,
 * `packages/plugin/src/main.ts`; see `olea-service/docs/dev/
 * wiring-register.md`'s `CorpusRelationVerdictPort` row). This module still
 * only declares the port and reconciles whatever an implementation returns
 * — it does not itself construct or call one — but "no production
 * implementation" is no longer true of the port as a whole.
 *
 * **Reconciliation mirrors `../reconcile.js` deliberately, not by
 * coincidence.** The concept set is authoritative there; it is
 * authoritative here too — a verdict naming a concept, or a type, this run
 * does not recognise is dropped and counted, never used to mint a concept
 * or smuggle in a seventh type. Duplicating the shape (rather than
 * factoring a shared helper) keeps each module's own drop-reason
 * vocabulary closed and independently testable, the same call
 * `../reconcile.js`'s own doc makes about its DROP_REASONS being "a bug in
 * this module, not a new kind of drop to add ad hoc."
 *
 * **Closes the client half of `ol-2zfj.79` [REL-8]'s key round-trip --
 * `ol-l40p` [REL-9], 2026-09-11.** `CorpusVerdict.aKey`/`.bKey` (new,
 * optional) let `reconcileCorpusVerdicts` resolve an endpoint by
 * `CorpusConcept.key` directly when the service echoed one back, instead of
 * only ever matching `verdict.a`/`.b` against a candidate's own `name` --
 * see `findings/relations-join-2026-09.md` (`olea-service`) for what that
 * name-only join was measured failing on. Falls back to the exact-name join
 * when a key is absent, so this is additive, not a replacement.
 *
 * **Stamps `RelationCacheAttestation.endpointRevisions` at judgment time
 * (`ol-egov.141.89.4.14`, rel.md §3 Default 4), over the SAME introducing-path
 * set `./endpoint-revision-lookup.ts`'s lookup reads later -- not `anchorOf`'s
 * one passage below.** `anchorOf` (just below) stamps
 * `introducingPassages.from`/`.to` from a `CorpusConcept`'s single `Provenance`
 * -- the one passage a given verdict call happened to read. That is narrower
 * than a topic-only concept's full `TopicAnchor.introducingPaths`
 * (`../key-store.ts`), which is what `buildEndpointRevisionLookup` composes a
 * CURRENT revision over. If judgment time hashed only the one passage while
 * read time hashes every introducing path, an unchanged concept could still
 * compare unequal -- the exact failure `computeConceptRevision`'s own doc
 * warns two independent callers must avoid by agreeing bit-for-bit. So
 * `reconcileCorpusVerdicts` takes an optional `EndpointRevisionStampingOptions`
 * whose `introducingPaths` resolves the WIDER set for a `CorpusConcept` (a
 * caller's own bridge to `ConceptKeyRecord.anchor`, mirroring
 * `introducingPathsOfAnchor`, never invented here -- this module has no
 * `ConceptKeyRecord` in hand, only whatever `CorpusConcept` the caller built),
 * and calls the SAME `computeConceptRevision` the lookup uses. Omitted
 * (the default), nothing is stamped -- every existing caller and test keeps
 * today's behaviour (no `endpointRevisions`, reads `'unverified'` downstream).
 *
 * **Never a guess, at the whole-attestation grain.** `RelationCacheAttestation.
 * endpointRevisions` (`../relation-cache.ts`, REL-4) is `{ from: string; to:
 * string }` -- both sides required together once the field is present at all;
 * it does not yet support recording one endpoint's revision while leaving the
 * other's a genuine unknown. `computeEndpointRevisions` below honours that:
 * when EITHER endpoint's revision cannot be computed (an unknown path, or
 * zero introducing paths), it omits the field entirely rather than write a
 * half-fabricated pair -- both endpoints then read `'unverified'` on the next
 * comparison, never `'current'`. This is coarser than per-endpoint omission
 * would be (a concept whose own paths ARE all known still loses its
 * verifiable revision when its partner's are not), and widening the shape to
 * `{ from?: string; to?: string }` would recover that precision -- a
 * persisted-schema change beyond what REL-4 ruled, so it is not made here;
 * see this bead's close notes for the proposed decision.
 */

import type { Provenance } from '../../extract/types.js';
import type { VaultPath } from '../../vault/types.js';
import type { RelationProvenanceKind, RelationType } from '../relation.js';
import type { PathRevisionLookup } from './endpoint-revision-lookup.js';
import { computeConceptRevision } from './endpoint-revision-lookup.js';
import type {
  CorpusConcept,
  CorpusReconciledRelation,
  CorpusRelationCandidate,
  CorpusRelationDropReason,
} from './types.js';
import { CORPUS_STAGE_EMITTABLE_TYPES } from './types.js';

/**
 * Resolves the FULL introducing-path set for one `CorpusConcept` -- the same
 * set `./endpoint-revision-lookup.ts`'s `introducingPathsOfAnchor` would read
 * from that concept's `ConceptKeyRecord.anchor`, had this module a
 * `ConceptKeyRecord` in hand (it does not: `CorpusConcept.anchor` is one
 * `Provenance` passage, module doc above). An injected function, the same
 * "caller already holds the wider context" discipline `./batch.ts`'s
 * `PassageTextLookup` already uses, so this module gains no vault or
 * key-store dependency of its own.
 */
export type IntroducingPathsLookup = (concept: CorpusConcept) => readonly VaultPath[];

/**
 * The judgment-time stamping port (module doc): `introducingPaths` resolves
 * each endpoint's full path set, `pathRevision` reads one path's CURRENT
 * revision -- the exact `PathRevisionLookup` shape `buildEndpointRevisionLookup`
 * (`./endpoint-revision-lookup.ts`) also takes, so a caller wires one revision
 * reader to both the write side (here) and the read side (that module) and the
 * two are guaranteed to agree.
 */
export interface EndpointRevisionStampingOptions {
  readonly introducingPaths: IntroducingPathsLookup;
  readonly pathRevision: PathRevisionLookup;
}

/**
 * A reconciled corpus relation additionally carrying `endpointRevisions` --
 * the same optional field `../relation-cache.ts`'s `KeyedConceptRelation`
 * already defines (REL-4), attached here rather than widening
 * `CorpusReconciledRelation` itself (`./types.ts`, outside this bead's owns):
 * every field below is optional, so this is a strict superset -- anything
 * that only knows `CorpusReconciledRelation` (`./batch.ts`'s own return type)
 * keeps working unchanged, and `writeRelationCache` (`../relation-cache.ts`),
 * which already reads `edge.endpointRevisions` off its `KeyedConceptRelation`
 * parameter type, picks the field up with no further change on that side.
 */
export interface CorpusReconciledRelationWithEndpointRevisions extends CorpusReconciledRelation {
  readonly endpointRevisions?: { readonly from: string; readonly to: string };
}

/**
 * One proposition's `endpointRevisions`, or `undefined` when either
 * endpoint's revision cannot be computed -- never a partial pair (module doc:
 * "never a guess, at the whole-attestation grain").
 */
function computeEndpointRevisions(
  from: CorpusConcept,
  to: CorpusConcept,
  stamping: EndpointRevisionStampingOptions,
): { readonly from: string; readonly to: string } | undefined {
  const fromRevision = computeConceptRevision(
    stamping.introducingPaths(from),
    stamping.pathRevision,
  );
  const toRevision = computeConceptRevision(stamping.introducingPaths(to), stamping.pathRevision);
  if (fromRevision === undefined || toRevision === undefined) return undefined;
  return { from: fromRevision, to: toRevision };
}

/**
 * One candidate, with both endpoints' introducing passage TEXT attached —
 * what actually reaches the model, as transient context (C6, D-005). Never
 * persisted by this module or by any production implementation.
 */
export interface CorpusVerdictRequestCandidate {
  readonly a: CorpusConcept & { readonly passageText: string };
  readonly b: CorpusConcept & { readonly passageText: string };
}

export interface CorpusVerdictRequest {
  /**
   * Never empty — the same INV-5 refusal `../read.js` enforces for an
   * empty-context call: a verdict port handed no candidates has nothing to
   * be faithful to, so `./batch.js` never calls a port with an empty batch.
   */
  readonly candidates: readonly CorpusVerdictRequestCandidate[];
}

/**
 * One candidate's outcome. `type`/`direction`/`confidence` are present only
 * when the model found a relation; an abstention (the material does not
 * support any of the two corpus-eligible types) is a candidate with no
 * verdict entry at all, not a zero-confidence one — silence is the honest
 * value, same posture `../read.js`'s empty-list handling already takes.
 */
export interface CorpusVerdict {
  readonly a: string;
  readonly b: string;
  readonly type: RelationType;
  /**
   * `contrasts-with` is symmetric (`../relation.js`'s
   * `RELATION_DIRECTEDNESS`) — direction is meaningless for it and MUST be
   * omitted. `prerequisite` is directed and MUST supply it: `'a-to-b'` reads
   * as "a is prerequisite to b" (a must be solid before b).
   */
  readonly direction?: 'a-to-b' | 'b-to-a';
  readonly confidence: number;
  /**
   * The candidate endpoint's own `CorpusConcept.key`, echoed back by the
   * service (`olea-service`'s `src/tasks/conceptsRelations.ts`,
   * `groundCorpusVerdicts`) once resolved server-side from the SAME
   * candidate whose `name` this verdict already had to echo exactly --
   * never invented by the model, never present unless the request's
   * matching endpoint sent one (`ol-l40p` [REL-9]).
   *
   * **Optional, and absence is the ordinary case until every candidate in a
   * batch carries a key** (e.g. replaying an older cassette entry recorded
   * before the client threaded `key` through `CorpusConcept` at all).
   * `reconcileCorpusVerdicts` below keys the join on this field directly
   * when present, falling back to the existing exact-name join
   * (`verdict.a`/`.b` against a candidate's own `name`) only when it is
   * absent -- never the reverse, and never a silent preference for
   * whichever happens to resolve.
   */
  readonly aKey?: string;
  /** Same contract as {@link aKey}, for endpoint `b`. */
  readonly bKey?: string;
}

export interface CorpusVerdictResponse {
  readonly verdicts: readonly CorpusVerdict[];
}

/**
 * The service seam for the corpus stage's model call. See this module's
 * doc: it now has a production implementation, `WorkerCorpusRelationVerdict`
 * (`[EXT-11]`/`ol-kw4a`, `[D-118]`, 2026-08-25) — corrected 2026-08-26,
 * `ol-2zfj.16`.
 */
export interface CorpusRelationVerdictPort {
  verdict(request: CorpusVerdictRequest): Promise<CorpusVerdictResponse>;
}

export interface ReconcileCorpusVerdictsResult {
  readonly relations: readonly CorpusReconciledRelationWithEndpointRevisions[];
  readonly dropped: Readonly<Partial<Record<CorpusRelationDropReason, number>>>;
}

function byName(
  candidates: readonly CorpusRelationCandidate[],
): ReadonlyMap<string, CorpusConcept> {
  const index = new Map<string, CorpusConcept>();
  for (const candidate of candidates) {
    index.set(candidate.a.name, candidate.a);
    index.set(candidate.b.name, candidate.b);
  }
  return index;
}

function anchorOf(concept: CorpusConcept): Provenance {
  return concept.anchor;
}

/**
 * Same candidate set as {@link byName}, indexed by `CorpusConcept.key`
 * instead of `.name` -- `ol-l40p` [REL-9]. Only candidates that actually
 * carry a key are indexed, so a verdict's `aKey`/`bKey` that names a key no
 * candidate in THIS batch supplied misses here exactly as an unrecognised
 * name misses `byName`, and is dropped as `'unknown-concept'` by the same
 * check rather than silently falling back to a name lookup -- "the
 * candidate set is authoritative" applies to the key join precisely as much
 * as the name one.
 */
function byKey(candidates: readonly CorpusRelationCandidate[]): ReadonlyMap<string, CorpusConcept> {
  const index = new Map<string, CorpusConcept>();
  for (const candidate of candidates) {
    if (candidate.a.key !== undefined) index.set(candidate.a.key, candidate.a);
    if (candidate.b.key !== undefined) index.set(candidate.b.key, candidate.b);
  }
  return index;
}

/** Unordered, same key shape `./nominate.js` uses — restated rather than
 * imported across a module boundary for one string-joining helper (that
 * module's own `pairKey` is not exported, and this file already duplicates
 * `./nominate.js`'s reconciliation posture deliberately; see this file's
 * own doc). */
function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/**
 * Which nomination signal kinds backed each candidate pair — the input
 * `reconcileCorpusVerdicts` needs to decide provenance, since a verdict
 * itself carries only two concept names and never a signal kind.
 */
function signalsByPair(
  candidates: readonly CorpusRelationCandidate[],
): ReadonlyMap<string, CorpusRelationCandidate['signals']> {
  const index = new Map<string, CorpusRelationCandidate['signals']>();
  for (const candidate of candidates) {
    index.set(pairKey(candidate.a.name, candidate.b.name), candidate.signals);
  }
  return index;
}

/**
 * `[D-070]`: a pair nominated (in part or wholly) by her own wikilink
 * reconciles at the strongest provenance tier, regardless of what else also
 * nominated it — the type may still be model-inferred; provenance answers a
 * different question (`./types.js`'s `NominationSignalKind` doc).
 */
function provenanceFor(signals: CorpusRelationCandidate['signals']): RelationProvenanceKind {
  return signals.includes('her-link') ? 'hers' : 'model-proposed';
}

/**
 * Turn a port's verdicts into real edges, against the SAME candidate set
 * that was sent — never against a wider concept universe. A verdict naming
 * a pair that was not among the candidates offered (a hallucinated name,
 * or a real concept this run never nominated) is dropped and counted,
 * mirroring `../reconcile.js`'s "the concept set is authoritative" rule
 * one level up: here, the CANDIDATE set is authoritative over what a
 * verdict may resolve against.
 *
 * **Resolves each endpoint by key when the verdict carries one, by name
 * otherwise -- `ol-l40p` [REL-9], never the reverse.** `verdict.aKey`
 * (`.bKey`) is only ever present because the SAME candidate's own `key`
 * travelled through the request unread by the model (`CorpusVerdict.aKey`'s
 * own doc) and was echoed back by the service, so a present key is strictly
 * more trustworthy than the name join it replaces -- a paraphrase or a
 * length-bound truncation can still change what `verdict.a`/`.b` says, but
 * cannot change which key rode along with it. An absent key (e.g. replaying
 * an older cassette entry recorded before either side threaded `key`
 * through) falls back to exactly the pre-`ol-l40p` exact-name join, so this
 * change is additive: a candidate set and verdict batch with no keys at all
 * behaves identically to before.
 */
export function reconcileCorpusVerdicts(
  verdicts: readonly CorpusVerdict[],
  candidates: readonly CorpusRelationCandidate[],
  stamping?: EndpointRevisionStampingOptions,
): ReconcileCorpusVerdictsResult {
  const known = byName(candidates);
  const knownByKey = byKey(candidates);
  const signalsIndex = signalsByPair(candidates);
  const dropped: Partial<Record<CorpusRelationDropReason, number>> = {};
  const bump = (reason: CorpusRelationDropReason) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };
  const relations: CorpusReconciledRelationWithEndpointRevisions[] = [];

  for (const verdict of verdicts) {
    if (!CORPUS_STAGE_EMITTABLE_TYPES.has(verdict.type)) {
      bump('not-corpus-eligible-type');
      continue;
    }

    const a = verdict.aKey !== undefined ? knownByKey.get(verdict.aKey) : known.get(verdict.a);
    const b = verdict.bKey !== undefined ? knownByKey.get(verdict.bKey) : known.get(verdict.b);
    if (a === undefined || b === undefined) {
      bump('unknown-concept');
      continue;
    }

    // Belt-and-braces with `./types.js`'s `CorpusConcept.anchor` being
    // required, not optional: a concept that reached this point without an
    // anchor is a defect in the caller, not something to emit silently.
    if (a.anchor === undefined || b.anchor === undefined) {
      bump('missing-passage-provenance');
      continue;
    }

    const directed = verdict.type !== 'contrasts-with';
    if (directed && verdict.direction === undefined) {
      // A directed type with no stated direction is not a fact the material
      // supports — the same "fully provenanced or it does not ship"
      // discipline `../reconcile.js` states for passage grain applies here
      // to direction.
      bump('no-relation');
      continue;
    }

    const [from, to] = !directed || verdict.direction === 'a-to-b' ? [a, b] : [b, a];

    // `[D-082]`'s own text scopes "the verdict must come from reading the
    // combined passages" to EVERY candidate, hers included — the port was
    // called and both passages were read regardless of provenance. What
    // `[D-070]` (`ol-9qwy`) changes is what happens AFTER: a pair her own
    // wikilink nominated stamps as `'hers'`, the strongest provenance tier,
    // rather than being flattened to `'model-proposed'` like every other
    // candidate. Signals are looked up by pair, not by endpoint, since a
    // signal kind belongs to the CANDIDATE, not to either concept alone.
    const signals = signalsIndex.get(pairKey(a.name, b.name)) ?? [];

    // `ol-egov.141.89.4.14` (module doc): computed over the WIDER
    // introducing-path set `stamping.introducingPaths` resolves for `from`/`to`
    // — never `anchorOf`'s one passage — so a later read through
    // `buildEndpointRevisionLookup` (`./endpoint-revision-lookup.ts`) can ever
    // compare equal. `undefined` when `stamping` is omitted, or when either
    // endpoint's revision cannot be computed (module doc: never a guess).
    const endpointRevisions =
      stamping === undefined ? undefined : computeEndpointRevisions(from, to, stamping);

    relations.push({
      type: verdict.type,
      from: from.name,
      to: to.name,
      provenance: provenanceFor(signals),
      confidence: verdict.confidence,
      introducingPassages: { from: anchorOf(from), to: anchorOf(to) },
      // `ol-l40p` [REL-9]: carried post-swap, so `fromKey`/`toKey` name the
      // SAME endpoints `from`/`to` already do, regardless of which of `a`/`b`
      // each came from. Omitted entirely (never `key: undefined`) when the
      // resolved concept has none, matching every other optional-field
      // discipline in this file family.
      ...(from.key !== undefined ? { fromKey: from.key } : {}),
      ...(to.key !== undefined ? { toKey: to.key } : {}),
      ...(endpointRevisions !== undefined ? { endpointRevisions } : {}),
    });
  }

  return { relations, dropped };
}
