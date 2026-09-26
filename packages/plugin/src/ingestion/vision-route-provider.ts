/**
 * `fetchVisionRouteOptions` — the production reader for component 1.6's
 * delivered vision-routing threshold (`docs/dev/intelligence-build/per.md`
 * §8 item 2, `[ILB-PER-4]`; the promoted `vision-route` envelope shape is
 * `packages/contracts/src/artifact-envelope.ts`'s own "register's first
 * delivered threshold" — the schema pre-dates this reader).
 *
 * This is `rank/rank-weights-provider.ts`'s pattern, mirrored one level
 * down, per this bead's own brief ("the served threshold is a delivered
 * parameter, so mirror the rank-weights envelope pattern"): GET the
 * delivered artifact, decode it through the shared envelope, map its body
 * onto `ExtractOptions` field-for-field, and degrade to `undefined` on
 * every failure so `routePage`'s own `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD`
 * (D-022, `../extract/threshold.js`) keeps applying exactly as it does
 * today — that seam (`ExtractOptions.textLayerCharThreshold`, resolved by
 * `routePage`'s own default parameter) already existed before this bead;
 * this module is what puts a real, server-delivered value into it in
 * production, the same relationship `rank-weights-provider.ts` has to
 * `packages/core/src/oracle/rank.ts`'s `resolveOptions`.
 *
 * **`VISION_ROUTE_ENDPOINT_PATH` is defined LOCALLY below, not imported
 * from `olea-contracts`.** `packages/contracts/src/artifact-envelope.ts`
 * already exports `RANK_WEIGHTS_ENDPOINT_PATH` and `DEPTH_GATE_ENDPOINT_PATH`
 * beside their own envelope shapes, but no equivalent constant for
 * `vision-route` — and that file is outside this bead's file ownership (see
 * the lane brief: only `packages/core/src/extract/`,
 * `packages/core/src/ingestion/extraction-runner.ts`, this file, and specs).
 * Filed as a follow-up to move this string into `artifact-envelope.ts`
 * alongside its two siblings once that file's ownership allows it; until
 * then this local constant is the correct value for the route the
 * orchestrator still owes `src/index.ts` (see that report) — `GET
 * /v1/vision-route`, mirroring `GET /v1/rank-weights`
 * (`olea-service/src/index.ts` around line 135) and `GET /v1/depth-gate`.
 *
 * **Every failure mode returns `undefined`, never a throw** — same posture,
 * same reasoning (F7.8: AI/network features degrade, never half-work) as
 * `rank-weights-provider.ts`'s own module doc, which see for the fuller
 * argument. `routePage`'s existing default-parameter fallback is what makes
 * `undefined` the correct degrade here rather than a second fallback
 * mechanism invented by this module.
 */

import {
  envelopeFreshness,
  readArtifactEnvelope,
  VISION_ROUTE_KIND,
  type VisionRouteBody,
  visionRouteEnvelope,
} from 'olea-contracts';
import type { ExtractOptions } from 'olea-core';
import type { HttpResponseLike, WorkerConfig } from '../worker/transport.js';

/**
 * The frozen `GET /v1/vision-route` path — see the module doc's note on why
 * this is declared here rather than imported from `olea-contracts`.
 */
export const VISION_ROUTE_ENDPOINT_PATH = '/v1/vision-route';

/**
 * The HTTP primitive this module needs, injected on the same terms
 * `RankWeightsHttpGet` is in `rank/rank-weights-provider.ts` — a GET carries
 * no body, so this is that shape narrowed rather than reused, to avoid
 * widening the POST-only contract `WorkerHttpTransport` exists to honour.
 */
export type VisionRouteHttpGet = (params: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}) => Promise<HttpResponseLike>;

/** Joins `baseUrl` and the frozen `/v1/vision-route` path without producing a doubled or missing slash — mirrors `rank/rank-weights-provider.ts`'s `buildRankWeightsUrl`. */
export function buildVisionRouteUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${VISION_ROUTE_ENDPOINT_PATH}`;
}

/**
 * `VisionRouteBody` names its one field `minTextLayerChars`
 * (`artifact-envelope.ts`'s own doc: "text-layer characters at or above
 * which the page is routed to the text layer"); `ExtractOptions` names the
 * same number `textLayerCharThreshold` (`../extract/types.js`, threaded to
 * `routePage` via `../extract/threshold.js`) — this is that one-field
 * mapping, made total by both sides being fully required.
 */
function toExtractOptions(body: VisionRouteBody): ExtractOptions {
  return { textLayerCharThreshold: body.minTextLayerChars };
}

/**
 * Fetch and decode the delivered vision-route artifact. Returns `undefined`
 * on every failure path — see the module doc for why that is the correct
 * behaviour here rather than a caller-visible error.
 */
export async function fetchVisionRouteOptions(
  httpGet: VisionRouteHttpGet,
  config: WorkerConfig,
  now: Date = new Date(),
): Promise<ExtractOptions | undefined> {
  let response: HttpResponseLike;
  try {
    response = await httpGet({
      url: buildVisionRouteUrl(config.baseUrl),
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

  const read = readArtifactEnvelope(visionRouteEnvelope, VISION_ROUTE_KIND, blob);
  if (read.status !== 'ok') return undefined;

  // `envelopeFreshness`'s three-state answer distinguishes fresh from
  // stale-but-governing from expired. `vision-route` is an OPERATING
  // artifact (`artifact-envelope.ts`'s "1.6 — decide if a PDF needs
  // vision" is grouped with 2.5/3.3 under the operating class): a stale
  // set still governs, so only `expired` degrades to the declared
  // fallback (`DEFAULT_TEXT_LAYER_CHAR_THRESHOLD`) here — `stale` still
  // applies the delivered number. Neither state is shown on screen: a
  // routing threshold is never itself a claim rendered to her.
  const freshness = envelopeFreshness(read.artifact, now);
  if (freshness.state === 'expired') return undefined;

  return toExtractOptions(read.artifact.body);
}
