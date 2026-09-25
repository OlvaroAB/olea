/**
 * `fetchDepthGateOptions` — the production reader for component 3.1's
 * delivered growth-stage depth gate (`[D-352]`, `ol-egov.141.89.9.54`;
 * follow-up filed as `ol-egov.141.89.9.55`).
 *
 * `packages/core/src/mastery/rollup.ts`'s `computeConceptMastery`/
 * `computeAllConceptMastery` already accept a `MasteryRollupOptions.depthGate`
 * field and fall back to that module's own `DEPTH_GATE_SOLO_LEVEL` (declared,
 * `'relational'`, `rollup.ts:224`) when it is absent — that seam existed
 * before this bead. This module is what puts a real, delivered value into
 * that seam in production, mirroring `../rank/rank-weights-provider.ts`
 * field-for-field: it GETs the `depth-gate` artifact from the Worker, decodes
 * it through the shared envelope (`packages/contracts/src/artifact-envelope.ts`),
 * and maps the body onto the one `SoloLevel` field the fold's option needs.
 *
 * **Every failure mode returns `undefined`, never a throw.** Offline, an
 * unconfigured Worker, an expired or unreadable envelope, a non-2xx
 * response, a transport error below HTTP, an unknown envelope or body
 * version — all of them collapse to the same outcome, because
 * `computeConceptMastery` already treats an absent `depthGate` option as
 * "use the declared fallback" (D-352: an unknown version is discarded and
 * the declared fallback used, never an improvised value). That is F7.8's
 * posture (AI/network features degrade, never half-work) applied to this
 * seam without inventing a second one: mastery still rolls up, just against
 * the client's own declared depth gate instead of a delivered one.
 *
 * **Deliberately obsidian-free**, same split `worker/transport.ts` and
 * `worker/obsidian-transport.ts` (and `rank/rank-weights-provider.ts` and
 * `rank/obsidian-rank-weights-transport.ts`) already establish: the HTTP
 * primitive is injected as `DepthGateHttpGet` so this file loads and is
 * tested under plain Vitest, and `obsidian-depth-gate-transport.ts` supplies
 * the real one over Obsidian's `requestUrl` (C1.6, INV-1).
 *
 * **Why a GET, not `POST /v1/task`.** Same argument as `rank-weights`:
 * `depth-gate` names no request-specific variable — nothing about the
 * request varies per call — so it does not fit the generative-envelope
 * shape `WorkerHttpTransport` speaks. See
 * `packages/contracts/src/artifact-envelope.ts`'s `DEPTH_GATE_ENDPOINT_PATH`
 * doc for the fuller argument, and `olea-service/src/index.ts`'s
 * `GET /v1/depth-gate` for the route this reads.
 */

import {
  DEPTH_GATE_ENDPOINT_PATH,
  DEPTH_GATE_KIND,
  type DepthGateBody,
  depthGateEnvelope,
  envelopeFreshness,
  readArtifactEnvelope,
} from 'olea-contracts';
import type { SoloLevel } from 'olea-contracts';
import type { HttpResponseLike, WorkerConfig } from '../worker/transport.js';

/**
 * The HTTP primitive this module needs, injected on the same terms
 * `RankWeightsHttpGet` is in `rank/rank-weights-provider.ts` — a GET carries
 * no body, so this is that shape narrowed rather than reused, to avoid
 * widening the POST-only contract `WorkerHttpTransport` exists to honour.
 */
export type DepthGateHttpGet = (params: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}) => Promise<HttpResponseLike>;

/** Joins `baseUrl` and the frozen `/v1/depth-gate` path without producing a doubled or missing slash — mirrors `rank/rank-weights-provider.ts`'s `buildRankWeightsUrl`. */
export function buildDepthGateUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${DEPTH_GATE_ENDPOINT_PATH}`;
}

/** `DepthGateBody` carries the one field `MasteryRollupOptions.depthGate` needs — this is that mapping, made total by the body field being required. */
function toDepthGateOption(body: DepthGateBody): SoloLevel {
  return body.depthGate;
}

/**
 * Fetch and decode the delivered depth-gate artifact. Returns `undefined`
 * on every failure path — see the module doc for why that is the correct
 * behaviour here rather than a caller-visible error, and why it is exactly
 * what makes `computeConceptMastery` apply `DEPTH_GATE_SOLO_LEVEL`.
 */
export async function fetchDepthGateOptions(
  httpGet: DepthGateHttpGet,
  config: WorkerConfig,
  now: Date = new Date(),
): Promise<SoloLevel | undefined> {
  let response: HttpResponseLike;
  try {
    response = await httpGet({
      url: buildDepthGateUrl(config.baseUrl),
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

  // `readArtifactEnvelope` is the one place an unknown envelope version (or
  // kind, or a body that fails `depthGateBody`'s schema) is discarded —
  // D-352's "an unknown version is discarded and the declared fallback
  // used" is this call returning a non-`'ok'` status, which this function
  // then collapses to `undefined` exactly like every other failure mode.
  const read = readArtifactEnvelope(depthGateEnvelope, DEPTH_GATE_KIND, blob);
  if (read.status !== 'ok') return undefined;

  // `envelopeFreshness`'s three-state answer distinguishes fresh from
  // stale-but-governing from expired. `depth-gate` is an OPERATING artifact
  // (packages/contracts/src/artifact-envelope.ts's doc on `depthGateBody`):
  // a stale gate still governs — it only shifts which stage a concept
  // displays as, never a false claim fabricated from nothing — so only
  // `expired` degrades to the declared fallback here, mirroring
  // `rank-weights-provider.ts`'s identical `expired`-only check.
  const freshness = envelopeFreshness(read.artifact, now);
  if (freshness.state === 'expired') return undefined;

  return toDepthGateOption(read.artifact.body);
}
