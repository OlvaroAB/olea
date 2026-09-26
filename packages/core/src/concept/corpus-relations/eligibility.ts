/**
 * Per-reader eligibility — `docs/dev/intelligence-build/rel.md` §3's Default 4
 * (`olea-service`, `ol-egov.141.89.4.11`, from the 2026-09-25 external review's triage; gates
 * `[ILB-REL-4]`'s acceptance criterion added from that bead) and §2's diagram (`eligibility per
 * reader`), plus this module's read of the prerequisite cycle report (Default 2, `./graph-checks.ts`).
 *
 * **Per-endpoint freshness, computed for real.** `../relation.ts`'s `RelationEvidenceState` names
 * exactly `'current' | 'stale'` and is designed but never set (`deriveRelationSet` hardcodes
 * `'current'` on every entry) — rel.md's own words, "nothing has ever set the field to anything
 * but `'current'`, because no per-endpoint revision to compare against has ever been recorded or
 * read." This module is that missing computation: `evaluateEndpointFreshness` compares a stored
 * judgment-time revision against a current one; `evaluatePropositionFreshness` takes the worse of
 * the two endpoints (one stale or unverified is never hidden by the other being current); `unverified`
 * collapses into `'stale'` for the two-valued `RelationEvidenceState` the serve decision reads, but
 * is counted apart (`freshnessDetail`) for the benchmark's fresh/stale/unverified three-way
 * (rel.md §5), the same split `[DOS-I8]` already uses for instrument citations.
 *
 * **What this module deliberately does NOT do.** It never reads a vault, a source-revision store,
 * or `[ILB-CHG-4]`'s persisted revision records directly — `EndpointRevisionLookup` is an injected
 * port, exactly the shape rel.md §8 names as still testable independently of that store landing:
 * "the comparison logic itself is testable against fixture revisions independent of that build
 * landing first." Wiring a real lookup against `[ILB-CHG-4]`'s stored revisions is therefore a
 * separate, later composition step (see this bead's close notes for the exact gap), never invented
 * here as a guess at that store's shape.
 *
 * Pure: no I/O, no clock, no identity minting.
 */

import type { PrerequisiteCycleReport } from './graph-checks.js';
import { isEdgeBlockedByCycle } from './graph-checks.js';

/**
 * Per-endpoint freshness, rel.md §3 Default 4's three-way (before the two-valued collapse):
 * `'current'` (the source's revision still matches what the proposition was judged on), `'stale'`
 * (it has since changed), `'unverified'` (no revision record exists yet to compare against — never
 * read as current).
 */
export type EndpointFreshness = 'current' | 'stale' | 'unverified';

/** The revision this endpoint's source was on when a proposition was last judged against it, or `undefined` if no such record was kept (an old attestation, predating this field). */
export interface JudgedEndpointRevision {
  readonly key: string;
  readonly revisionAtJudgment: string | undefined;
}

/** Reads an endpoint's CURRENT source revision, or `undefined` when none is on record yet — the injected seam this module's own doc names. */
export type EndpointRevisionLookup = (key: string) => string | undefined;

/**
 * Compare one endpoint's judgment-time revision against its current one. A missing digest on
 * either side reads as `'unverified'`, never `'current'` — rel.md's own words, "a missing digest
 * is never read as current."
 */
export function evaluateEndpointFreshness(
  endpoint: JudgedEndpointRevision,
  currentRevision: string | undefined,
): EndpointFreshness {
  if (endpoint.revisionAtJudgment === undefined || currentRevision === undefined)
    return 'unverified';
  return endpoint.revisionAtJudgment === currentRevision ? 'current' : 'stale';
}

export interface PropositionFreshness {
  readonly from: EndpointFreshness;
  readonly to: EndpointFreshness;
  /** The worse of the two endpoints, three-way — for the benchmark's stale-vs-unverified split (rel.md §5). */
  readonly overall: EndpointFreshness;
  /** `overall` collapsed to the two-valued `RelationEvidenceState` the serve decision reads (`unverified` reads identically to `stale`: both abstain). */
  readonly evidenceState: 'current' | 'stale';
}

const FRESHNESS_RANK: Readonly<Record<EndpointFreshness, number>> = {
  current: 0,
  unverified: 1,
  stale: 1,
} as const;

/** The worse of two `EndpointFreshness` values — `'current'` only when both are `'current'`; `'stale'` and `'unverified'` are equally bad for THIS ranking (they abstain identically) but are returned distinctly rather than merged, since the caller still needs to know which happened. */
function worseOf(a: EndpointFreshness, b: EndpointFreshness): EndpointFreshness {
  if (a === 'current' && b === 'current') return 'current';
  const rankA = FRESHNESS_RANK[a];
  const rankB = FRESHNESS_RANK[b];
  if (rankA !== rankB) return rankA > rankB ? a : b;
  // Both non-current, same rank (either could be 'stale' or 'unverified'): a real `'stale'` result
  // outranks `'unverified'` for REPORTING purposes (a confirmed change is more informative than an
  // absent record), even though both abstain identically at the serve decision.
  return a === 'stale' || b === 'stale' ? 'stale' : a;
}

export function evaluatePropositionFreshness(
  fromEndpoint: JudgedEndpointRevision,
  fromCurrentRevision: string | undefined,
  toEndpoint: JudgedEndpointRevision,
  toCurrentRevision: string | undefined,
): PropositionFreshness {
  const from = evaluateEndpointFreshness(fromEndpoint, fromCurrentRevision);
  const to = evaluateEndpointFreshness(toEndpoint, toCurrentRevision);
  const overall = worseOf(from, to);
  return { from, to, overall, evidenceState: overall === 'current' ? 'current' : 'stale' };
}

/** Convenience: run `evaluatePropositionFreshness` through an injected {@link EndpointRevisionLookup} rather than pre-resolved current revisions. */
export function evaluatePropositionFreshnessWithLookup(
  fromEndpoint: JudgedEndpointRevision,
  toEndpoint: JudgedEndpointRevision,
  lookup: EndpointRevisionLookup,
): PropositionFreshness {
  return evaluatePropositionFreshness(
    fromEndpoint,
    lookup(fromEndpoint.key),
    toEndpoint,
    lookup(toEndpoint.key),
  );
}

/**
 * One reader's full eligibility verdict for one `prerequisite`-typed edge — the only predicate
 * that reads a cycle report (Default 2); every other predicate's eligibility is freshness alone
 * (plus scope and standing, which `../same-as.ts`/`../disposition.ts` already apply at read time
 * and this module does not duplicate — see this module's own doc on what it deliberately excludes).
 */
export interface EligibilityVerdict {
  readonly servable: boolean;
  readonly freshness: PropositionFreshness;
  readonly blockedByCycle: boolean;
}

/**
 * Evaluate one proposition's eligibility: current-on-both-endpoints freshness, AND — for
 * `prerequisite` edges read by a reader that needs acyclicity — not one of a reported cycle's own
 * internal edges (Default 2). `cycleReport` is omitted for a non-`prerequisite` proposition or a
 * reader that does not need acyclicity, in which case cycle-blocking never applies (rel.md §3:
 * "contrasts-with is symmetric... is-a and part-of have no reader that orders by them at all").
 */
export function evaluateEligibility(
  edge: { readonly fromKey: string; readonly toKey: string },
  freshness: PropositionFreshness,
  cycleReport?: PrerequisiteCycleReport,
): EligibilityVerdict {
  const blockedByCycle = cycleReport !== undefined && isEdgeBlockedByCycle(edge, cycleReport);
  return {
    servable: freshness.evidenceState === 'current' && !blockedByCycle,
    freshness,
    blockedByCycle,
  };
}
