/**
 * The per-proposition judge outcome — `docs/dev/intelligence-build/rel.md` §3's Default 1 and
 * Default 5 (`olea-service`, `[D-297]`, `ol-egov.141.89.4.10`/`.4.12`), and `pipelines/rel.json`'s
 * `judge` step: "Judge every corpus-eligible predicate a pair could hold, each independently: one
 * result per proposition (pair, predicate, direction) — a relation with type and direction, no
 * relation, insufficient evidence, or an operational failure."
 *
 * **Structurally separate from `./verdict.ts`'s `reconcileCorpusVerdicts`, on purpose.** That
 * function reconciles TODAY's production wire shape (`CorpusVerdict`, one relation type per pair,
 * an optional key round-trip that falls back to an exact-name join when absent — deliberately
 * lenient, because `CorpusConcept.key` is not yet threaded through every production caller; see
 * that module's own doc). This module is the TARGET shape rel.md §2 and §3 describe: nomination
 * identifies pairs by opaque key (not yet built — `[ONT-R8]`'s remaining piece), every
 * corpus-eligible predicate is judged independently on the same pair (Default 1), and a verdict
 * missing either endpoint's key round-trip is *never* resolved by name, however unique within the
 * call (Default 5) — the exact leniency `./verdict.ts` still needs today, withdrawn here because
 * this module answers only once every candidate already carries a key. **The two modules serve two
 * different eras of the same pipeline and must not be merged**: doing so before nomination
 * universally threads keys would silently drop every edge in production.
 *
 * Pure: no I/O, no clock, no identity minting.
 *
 * **Also stamps `endpointRevisions` at judgment time (`ol-egov.141.89.4.14`), the same computation
 * `./verdict.ts`'s `reconcileCorpusVerdicts` does for today's production path.** This module never
 * holds a `CorpusConcept` — only opaque `aKey`/`bKey` strings — so its stamping port is keyed by
 * string rather than by concept object; see `EndpointRevisionStampingOptions` below. `./verdict.ts`'s
 * own module doc has the full argument for why the SAME `computeConceptRevision`
 * (`./endpoint-revision-lookup.ts`) must be used on both the judgment side (here) and the read side
 * (`buildEndpointRevisionLookup`) for a later comparison to ever read `'current'`; that argument
 * applies to this module identically and is not restated.
 */

import type { VaultPath } from '../../vault/types.js';
import type { RelationType } from '../relation.js';
import { computeConceptRevision, type PathRevisionLookup } from './endpoint-revision-lookup.js';
import { corpusEligiblePredicates } from './types.js';

export { corpusEligiblePredicates };

/**
 * Resolves the full introducing-path set for one endpoint, by its opaque concept key — the
 * key-shaped counterpart to `./verdict.ts`'s `IntroducingPathsLookup` (that one takes a
 * `CorpusConcept`; this module has no such object, only `aKey`/`bKey`, module doc).
 */
export type KeyIntroducingPathsLookup = (key: string) => readonly VaultPath[];

/** Judgment-time stamping port — same two-part shape as `./verdict.ts`'s `EndpointRevisionStampingOptions`, restated over keys (module doc). */
export interface PropositionEndpointRevisionStampingOptions {
  readonly introducingPaths: KeyIntroducingPathsLookup;
  readonly pathRevision: PathRevisionLookup;
}

/** One related proposition's `endpointRevisions`, or `undefined` when either endpoint's revision cannot be computed — never a partial pair, same discipline `./verdict.ts`'s `computeEndpointRevisions` uses. */
function computeEndpointRevisionsForKeys(
  fromKey: string,
  toKey: string,
  stamping: PropositionEndpointRevisionStampingOptions,
): { readonly from: string; readonly to: string } | undefined {
  const fromRevision = computeConceptRevision(
    stamping.introducingPaths(fromKey),
    stamping.pathRevision,
  );
  const toRevision = computeConceptRevision(
    stamping.introducingPaths(toKey),
    stamping.pathRevision,
  );
  if (fromRevision === undefined || toRevision === undefined) return undefined;
  return { from: fromRevision, to: toRevision };
}

/** One candidate pair, identified by both endpoints' opaque keys — the target nomination shape (rel.md §2). */
export interface PropositionCandidate {
  readonly pairId: string;
  readonly aKey: string;
  readonly bKey: string;
}

/**
 * The judge's wire answer for one proposition (one candidate, one predicate). Structurally
 * mirrors `CorpusVerdict` (`./verdict.ts`) but scoped to a single predicate and REQUIRING the key
 * round-trip to be present for any non-operational outcome — `aKey`/`bKey` are how this module
 * attaches the answer back to `candidate`, never `pairId` alone, so a verdict that garbles which
 * pair it is answering cannot be attached by guesswork either.
 */
export interface PropositionVerdictWire {
  readonly pairId: string;
  readonly predicate: RelationType;
  readonly outcome: 'related' | 'none' | 'insufficient-evidence';
  /** `contrasts-with` is symmetric and carries no direction (`RELATION_DIRECTEDNESS`); every other corpus-eligible predicate must supply it when `outcome` is `'related'`. */
  readonly direction?: 'a-to-b' | 'b-to-a';
  readonly confidence?: number;
  /** The candidate's own key, echoed back — see this module's own doc, Default 5. */
  readonly aKey?: string;
  readonly bKey?: string;
}

/** Every way a proposition fails to become a real result, closed like `./types.ts`'s `CorpusRelationDropReason`. */
export type PropositionFailureReason =
  | 'no-response'
  | 'keyless-verdict'
  | 'unknown-pair'
  | 'malformed';

export type PropositionOutcome =
  | {
      readonly kind: 'related';
      readonly fromKey: string;
      readonly toKey: string;
      readonly confidence: number;
      /** Module doc: present only when a stamping port was given AND both endpoints' revisions could be computed. Never a partial pair. */
      readonly endpointRevisions?: { readonly from: string; readonly to: string };
    }
  | { readonly kind: 'none' }
  | { readonly kind: 'insufficient-evidence' }
  | { readonly kind: 'failed'; readonly reason: PropositionFailureReason };

const DIRECTED_PREDICATES: ReadonlySet<RelationType> = new Set(['prerequisite']);

/**
 * Classify one predicate's verdict for one candidate. Default 5: a verdict that omits either
 * endpoint's key, or whose keys do not match this candidate's own, is `'failed'` —
 * `'keyless-verdict'` — never resolved through `candidate`'s or anything else's name, even when,
 * within this one call, only one candidate carries the missing name (this module never receives
 * names at all, which makes that failure mode structurally impossible rather than merely avoided).
 * `outcome === 'none'` and `'insufficient-evidence'` carry no direction or key claim to check, so
 * they are honoured directly — a verdict has no way to garble which proposition it answers when
 * `pairId`+`predicate` already scope this call to exactly one.
 */
export function classifyPropositionVerdict(
  candidate: PropositionCandidate,
  verdict: PropositionVerdictWire | undefined,
  stamping?: PropositionEndpointRevisionStampingOptions,
): PropositionOutcome {
  if (verdict === undefined) return { kind: 'failed', reason: 'no-response' };
  if (verdict.pairId !== candidate.pairId) return { kind: 'failed', reason: 'unknown-pair' };

  if (verdict.outcome === 'none') return { kind: 'none' };
  if (verdict.outcome === 'insufficient-evidence') return { kind: 'insufficient-evidence' };

  // outcome === 'related'
  if (verdict.aKey === undefined || verdict.bKey === undefined) {
    return { kind: 'failed', reason: 'keyless-verdict' };
  }
  const keysMatch =
    (verdict.aKey === candidate.aKey && verdict.bKey === candidate.bKey) ||
    (verdict.aKey === candidate.bKey && verdict.bKey === candidate.aKey);
  if (!keysMatch) return { kind: 'failed', reason: 'keyless-verdict' };

  if (verdict.confidence === undefined) return { kind: 'failed', reason: 'malformed' };
  const directed =
    DIRECTED_PREDICATES.has(verdict.predicate) ||
    verdict.predicate === 'causes' ||
    verdict.predicate === 'is-a' ||
    verdict.predicate === 'part-of';
  if (directed && verdict.direction === undefined) return { kind: 'failed', reason: 'malformed' };

  const [fromKey, toKey] =
    !directed || verdict.direction === 'a-to-b'
      ? [candidate.aKey, candidate.bKey]
      : [candidate.bKey, candidate.aKey];
  // `ol-egov.141.89.4.14` (module doc): computed over the WIDER path set a
  // stamping port resolves for each key — `undefined` when no port was given,
  // or when either endpoint's revision cannot be computed (never a guess).
  const endpointRevisions =
    stamping === undefined ? undefined : computeEndpointRevisionsForKeys(fromKey, toKey, stamping);
  return {
    kind: 'related',
    fromKey,
    toKey,
    confidence: verdict.confidence,
    ...(endpointRevisions !== undefined ? { endpointRevisions } : {}),
  };
}

/**
 * Default 1: every corpus-eligible predicate a candidate could hold, judged independently. Builds
 * the request set a caller sends to the judge port — one entry per (pair, predicate) — and is the
 * companion `classifyPropositionVerdict` reads answers back against.
 */
export function propositionsForCandidates(
  candidates: readonly PropositionCandidate[],
): readonly { readonly candidate: PropositionCandidate; readonly predicate: RelationType }[] {
  const predicates = corpusEligiblePredicates();
  const out: { readonly candidate: PropositionCandidate; readonly predicate: RelationType }[] = [];
  for (const candidate of candidates) {
    for (const predicate of predicates) {
      out.push({ candidate, predicate });
    }
  }
  return out;
}
