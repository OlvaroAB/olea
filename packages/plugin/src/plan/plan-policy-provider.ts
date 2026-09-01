/**
 * `fetchPlanPolicy` — the client-side reader for `olea-service`'s
 * `POST /v1/plan-policy` (`ol-v7r5.23`), the production caller for
 * `assemblePlanPolicy` (`olea-service`'s `src/plan/assemble.ts`,
 * `ol-v7r5.17` [ALLOC-2]).
 *
 * Follows `rank/rank-weights-provider.ts`'s own precedent, adapted for a
 * `POST` carrying a body: build the URL, send the request, decode the
 * response, and collapse EVERY failure mode — offline, an unconfigured
 * Worker, a non-2xx response, an unparseable body, a body that doesn't
 * shape-check — to `undefined`. No throw reaches a caller, same F7.8
 * degrade-not-half-work posture: this policy's absence means the plan
 * carries no `allocation` field (`StudyPlanBody.allocation`'s own doc: "no
 * allocation policy travelled with this plan," never "every course got
 * zero") and the caller falls back exactly as it already does when
 * `allocation` is absent for any other reason.
 *
 * **Not a `rankWeightsEnvelope`/`studyPlanEnvelope` read.** The response
 * this endpoint returns is not cached under its own versioned-artifact
 * kind (`olea-service`'s `src/plan/policyEnvelope.ts` explains why: nothing
 * here is persisted client-side under a fresh contract kind — the
 * rank-weights half is folded into `RankOracleOptions` exactly the way
 * `fetchRankWeightsOptions` already does, and the allocation half is meant
 * to fold into `StudyPlanBody.allocation` the same way `plan/provider.ts`
 * folds rank-weights into `composeOracleRanking`'s `options`). This module
 * only shape-checks the response by hand — no zod schema exists for this
 * wire shape on the client side, on purpose: adding a NEW schema to
 * `packages/contracts` is out of `ol-v7r5.23`'s granted ownership (a Class C
 * contract-schema surface), and this response, unlike `rank-weights` and
 * `study-plan`, is never itself cached — see `policyEnvelope.ts`'s doc for
 * the fuller argument and the follow-up this defers to if that ever
 * changes.
 *
 * **Deliberately obsidian-free**, same split every other provider in this
 * package uses: the HTTP primitive is injected so this loads and is tested
 * under plain Vitest.
 */

import type { HttpResponseLike, WorkerConfig } from '../worker/transport.js';

/**
 * The Worker route this reads. Mirrors `olea-service`'s
 * `src/plan/policyEnvelope.ts`'s `PLAN_POLICY_ENDPOINT_PATH` constant by
 * hand — not imported, because that file is service-internal (not part of
 * `packages/contracts`) and `ol-v7r5.23`'s client ownership does not extend
 * to the service repo. Keep the two literals in sync by hand until (or
 * unless) this endpoint's path is promoted into the shared contract.
 */
export const PLAN_POLICY_ENDPOINT_PATH = '/v1/plan-policy';

/** Joins `baseUrl` and the frozen `/v1/plan-policy` path without producing a doubled or missing slash — mirrors `rank-weights-provider.ts`'s `buildRankWeightsUrl`. */
export function buildPlanPolicyUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${PLAN_POLICY_ENDPOINT_PATH}`;
}

/** The HTTP primitive this module needs — a POST carrying a JSON body, unlike `rank-weights-provider.ts`'s GET. */
export type PlanPolicyHttpPost = (params: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}) => Promise<HttpResponseLike>;

/**
 * One running course's numeric facts — mirrors `olea-service`'s
 * `CourseAllocationInput` (`src/plan/allocation.ts`) field-for-field.
 * **Never her content**: an opaque course id plus numeric facts a caller
 * already resolved from her vault or her own settings.
 */
export interface PlanPolicyCourseInput {
  readonly courseId: string;
  readonly daysToNextAssessment: number | null;
  readonly assessmentWorth: number;
  readonly readiness: number;
  readonly evidenceVolume: number;
  readonly tempoWeight?: number;
  readonly steeringWeight?: number;
  readonly sittingsSinceFloorMet?: number;
}

export interface PlanPolicyRequest {
  readonly asOf: string;
  readonly courses: readonly PlanPolicyCourseInput[];
  readonly maintenanceBucket?: { readonly nonEmpty: boolean };
}

/** One allocation entry, mirroring `olea-contracts`' `StudyPlanAllocationEntry` shape — kept as a local structural type for the same reason `PLAN_POLICY_ENDPOINT_PATH` is a hand-kept literal above. */
export interface PlanPolicyAllocationEntry {
  readonly courseId: string;
  readonly share: number;
  readonly minBlockSeconds: number;
  readonly contributions: readonly { readonly name: string; readonly value: number }[];
  readonly reason: string;
}

/** Mirrors `olea-contracts`' `RankWeightsBody` field-for-field. */
export interface PlanPolicyRankWeights {
  readonly proximityHalfLifeDays: number;
  readonly assessmentWeightDivisor: number;
  readonly masteryNeedWeight: {
    readonly seed: number;
    readonly sprout: number;
    readonly sapling: number;
    readonly tree: number;
    readonly unknown: number;
  };
}

export interface PlanPolicyResult {
  readonly asOf: string;
  readonly rankWeights: PlanPolicyRankWeights;
  readonly allocation: readonly PlanPolicyAllocationEntry[];
  readonly floorsFundable: boolean;
}

function isAllocationEntry(value: unknown): value is PlanPolicyAllocationEntry {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.courseId === 'string' &&
    typeof c.share === 'number' &&
    typeof c.minBlockSeconds === 'number' &&
    Array.isArray(c.contributions) &&
    typeof c.reason === 'string'
  );
}

function isRankWeights(value: unknown): value is PlanPolicyRankWeights {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.proximityHalfLifeDays === 'number' &&
    typeof r.assessmentWeightDivisor === 'number' &&
    typeof r.masteryNeedWeight === 'object' &&
    r.masteryNeedWeight !== null
  );
}

/**
 * Hand-rolled shape check on the decoded JSON body — the module doc explains
 * why there is no zod schema for this wire shape. Anything short of every
 * field present and correctly typed is treated the same as a transport
 * failure: `undefined`, never a partially-trusted object.
 */
function isPlanPolicyResult(value: unknown): value is PlanPolicyResult {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.asOf === 'string' &&
    isRankWeights(body.rankWeights) &&
    Array.isArray(body.allocation) &&
    body.allocation.every(isAllocationEntry) &&
    typeof body.floorsFundable === 'boolean'
  );
}

/**
 * Fetch and decode `POST /v1/plan-policy`. Returns `undefined` on every
 * failure path — see the module doc for why that is correct here rather
 * than a caller-visible error.
 */
export async function fetchPlanPolicy(
  httpPost: PlanPolicyHttpPost,
  config: WorkerConfig,
  request: PlanPolicyRequest,
): Promise<PlanPolicyResult | undefined> {
  let response: HttpResponseLike;
  try {
    response = await httpPost({
      url: buildPlanPolicyUrl(config.baseUrl),
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  } catch {
    // Transport-level failure (offline, DNS, connection refused) — same
    // catch-and-collapse `fetchRankWeightsOptions` uses. Nothing here could
    // leak content or a credential even if a caller (against the rule)
    // logged the caught value.
    return undefined;
  }

  if (response.status < 200 || response.status >= 300) return undefined;

  let blob: unknown;
  try {
    blob = JSON.parse(response.text);
  } catch {
    return undefined;
  }

  return isPlanPolicyResult(blob) ? blob : undefined;
}
