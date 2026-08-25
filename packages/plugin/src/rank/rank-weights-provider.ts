/**
 * `fetchRankWeightsOptions` — the production reader for component 3.3's
 * delivered ranking weights (`[D-110]`, `ol-egov.28`; promoted into the
 * shared envelope by `ol-v7r5.3`).
 *
 * `packages/core/src/oracle/rank.ts`'s `resolveOptions` already accepts a
 * `RankOracleOptions` object and falls back per-field to its own
 * `DECLARED_FALLBACK_*` constants when a field (or the whole object) is
 * absent — that seam existed before this bead (`ol-v7r5.2`). This module is
 * what puts a real, delivered value into that seam in production: it GETs
 * the `rank-weights` artifact from the Worker, decodes it through the
 * shared envelope (`packages/contracts/src/artifact-envelope.ts`), and maps
 * the body onto `RankOracleOptions` field-for-field.
 *
 * **Every failure mode returns `undefined`, never a throw.** Offline, an
 * unconfigured Worker, an expired or unreadable envelope, a non-2xx
 * response, a transport error below HTTP — all of them collapse to the same
 * outcome, because `resolveOptions` already treats `undefined` as "use the
 * declared fallback". That is F7.8's posture (AI/network features degrade,
 * never half-work, and nothing surfaces an error for a feature that keeps
 * working) applied to this seam without inventing a second one: the
 * ranking still runs, just against the client's own argued-defensible
 * numbers instead of a tuned server-side set. See `rank/wiring.ts` for how
 * this composes with the persisted Worker config, and `plan/provider.ts`
 * for the one production caller today.
 *
 * **Deliberately obsidian-free**, same split `worker/transport.ts` and
 * `worker/obsidian-transport.ts` already establish: the HTTP primitive is
 * injected as `RankWeightsHttpGet` so this file loads and is tested under
 * plain Vitest, and `obsidian-rank-weights-transport.ts` supplies the real
 * one over Obsidian's `requestUrl` (C1.6, INV-1).
 *
 * **Why a GET, not `POST /v1/task`.** `rank-weights` names no
 * request-specific variable — nothing about the request varies per call —
 * so it does not fit the generative-envelope shape `WorkerHttpTransport`
 * speaks (`olea-service`'s `/v1/task` always ends in a model call). See
 * `packages/contracts/src/artifact-envelope.ts`'s `RANK_WEIGHTS_ENDPOINT_PATH`
 * doc for the fuller argument, and `olea-service/src/index.ts`'s
 * `GET /v1/rank-weights` for the route this reads.
 */

import {
  envelopeFreshness,
  RANK_WEIGHTS_ENDPOINT_PATH,
  RANK_WEIGHTS_KIND,
  type RankWeightsBody,
  rankWeightsEnvelope,
  readArtifactEnvelope,
} from 'olea-contracts';
import type { RankOracleOptions } from 'olea-core';
import type { HttpResponseLike, WorkerConfig } from '../worker/transport.js';

/**
 * The HTTP primitive this module needs, injected on the same terms
 * `HttpRequestFn` is in `worker/transport.ts` — a GET carries no body, so
 * this is that shape narrowed rather than reused, to avoid widening the
 * POST-only contract `WorkerHttpTransport` exists to honour.
 */
export type RankWeightsHttpGet = (params: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}) => Promise<HttpResponseLike>;

/** Joins `baseUrl` and the frozen `/v1/rank-weights` path without producing a doubled or missing slash — mirrors `worker/transport.ts`'s `buildTaskUrl`. */
export function buildRankWeightsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${RANK_WEIGHTS_ENDPOINT_PATH}`;
}

/** `RankWeightsBody` mirrors `RankOracleOptions` field-for-field (see `artifact-envelope.ts`'s doc) — this is that mapping, made total by both sides being fully required. */
function toRankOracleOptions(body: RankWeightsBody): RankOracleOptions {
  return {
    proximityHalfLifeDays: body.proximityHalfLifeDays,
    assessmentWeightDivisor: body.assessmentWeightDivisor,
    masteryNeedWeight: body.masteryNeedWeight,
  };
}

/**
 * Fetch and decode the delivered ranking-weights artifact. Returns
 * `undefined` on every failure path — see the module doc for why that is
 * the correct behaviour here rather than a caller-visible error.
 */
export async function fetchRankWeightsOptions(
  httpGet: RankWeightsHttpGet,
  config: WorkerConfig,
  now: Date = new Date(),
): Promise<RankOracleOptions | undefined> {
  let response: HttpResponseLike;
  try {
    response = await httpGet({
      url: buildRankWeightsUrl(config.baseUrl),
      headers: { authorization: `Bearer ${config.token}` },
    });
  } catch {
    // Transport-level failure (offline, DNS, connection refused) — the same
    // case `WorkerTransportError` names in `worker/transport.ts`. No
    // content or credential is in this catch, so nothing here could leak
    // even if a caller (against the rule) logged the caught value.
    return undefined;
  }

  if (response.status < 200 || response.status >= 300) return undefined;

  let blob: unknown;
  try {
    blob = JSON.parse(response.text);
  } catch {
    return undefined;
  }

  const read = readArtifactEnvelope(rankWeightsEnvelope, RANK_WEIGHTS_KIND, blob);
  if (read.status !== 'ok') return undefined;

  // `envelopeFreshness`'s three-state answer distinguishes fresh from
  // stale-but-governing from expired. `rank-weights` is an OPERATING
  // artifact (packages/contracts/src/artifact-envelope.ts): a stale set
  // still governs (see that file's "Declared constants" section), so only
  // `expired` degrades to the declared fallback here — `stale` still
  // applies the delivered numbers. Neither state is shown on screen: unlike
  // the study plan, a ranking-weight set is never itself a claim rendered
  // to her, so there is nothing for a surface to label old.
  const freshness = envelopeFreshness(read.artifact, now);
  if (freshness.state === 'expired') return undefined;

  return toRankOracleOptions(read.artifact.body);
}
