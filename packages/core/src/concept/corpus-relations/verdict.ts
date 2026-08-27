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
 */

import type { Provenance } from '../../extract/types.js';
import type { ConceptRelation, RelationProvenanceKind, RelationType } from '../relation.js';
import type { CorpusConcept, CorpusRelationCandidate, CorpusRelationDropReason } from './types.js';
import { CORPUS_STAGE_EMITTABLE_TYPES } from './types.js';

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
  readonly relations: readonly ConceptRelation[];
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
 */
export function reconcileCorpusVerdicts(
  verdicts: readonly CorpusVerdict[],
  candidates: readonly CorpusRelationCandidate[],
): ReconcileCorpusVerdictsResult {
  const known = byName(candidates);
  const signalsIndex = signalsByPair(candidates);
  const dropped: Partial<Record<CorpusRelationDropReason, number>> = {};
  const bump = (reason: CorpusRelationDropReason) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };
  const relations: ConceptRelation[] = [];

  for (const verdict of verdicts) {
    if (!CORPUS_STAGE_EMITTABLE_TYPES.has(verdict.type)) {
      bump('not-corpus-eligible-type');
      continue;
    }

    const a = known.get(verdict.a);
    const b = known.get(verdict.b);
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

    relations.push({
      type: verdict.type,
      from: from.name,
      to: to.name,
      provenance: provenanceFor(signals),
      confidence: verdict.confidence,
      introducingPassages: { from: anchorOf(from), to: anchorOf(to) },
    });
  }

  return { relations, dropped };
}
