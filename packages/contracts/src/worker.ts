/**
 * The Worker API envelope.
 *
 * "FROZEN before Lane B forks (P3-T01, P3-T02)" used to stand here. That was a
 * lane-coordination device — an orchestrator holding two parallel lanes off
 * this file for the duration of one run — and those lanes forked and finished
 * long ago; it read as a standing constraint on this file long after it
 * stopped being one (ol-jnt0).
 *
 * What is real and current is D-011's versioning discipline: every request
 * carries the version it was built against, the Worker serves two versions at
 * once (current and current−1), and dropping the older one means deleting its
 * golden fixtures in the same commit. Changing this envelope's shape costs a
 * `CONTRACT_VERSION` bump with N/N−1 serving — a real, payable cost, not a
 * prohibition on touching the file.
 *
 * This file fixes the *envelope*, not the task payloads — task-specific
 * request/response shapes land per task id in `tasks.ts` and after. What the
 * envelope covers is how every request is versioned, authenticated, stamped,
 * and refused. Those are the seams.
 *
 * Three contract requirements are encoded here rather than left to convention:
 *
 * - **D-011 versioning.** Every request carries the version it was built
 *   against; two are served, the current one and the one before it; anything
 *   older is refused with a distinct `update-required` code the plugin can act
 *   on. D-011's point is what happens next on the client: review still works,
 *   the AI features say why they cannot, and nothing is left half-working.
 * - **D7.3 stamping.** Prompt and model version travel on every response, so a
 *   quality regression months later is traceable to a specific change. The
 *   client persists these onto generated artifacts.
 * - **D-005 boundary.** The Worker is a calculator, not a database (plan §7.1).
 *   Requests carry context *transiently*; responses carry artifacts and
 *   metadata. Nothing here gives the Worker a way to reference her content
 *   across calls — no note ids, no concept ids, no session handles. If a future
 *   task id seems to need one, that is the C6 tripwire firing, not a gap.
 */

import { z } from 'zod';

/**
 * The current contract version, stamped by the client on every request.
 *
 * Bumping this is a deliberate act: the Worker must support N and N−1, so the
 * bump commit adds golden fixtures for the new version and the *drop* commit
 * deletes N−2's fixtures in the same change (D-011). Version skew is normal —
 * she updates the plugin whenever BRAT gets round to it — so the floor is a
 * real runtime condition, not a theoretical one.
 */
export const CONTRACT_VERSION = 1 as const;

/** Versions this build accepts: N and N−1. Below `min`, `update-required`. */
export const SUPPORTED_CONTRACT_VERSIONS = { min: 1, current: CONTRACT_VERSION } as const;

/**
 * Task identifier. The client sends an id plus context; the Worker holds the
 * versioned prompt templates (C4.3) — prompts are the substantive IP and the
 * plugin repo is publicly readable, so they never ship in the bundle.
 *
 * Permissive **on purpose**, even though `tasks.ts` freezes the catalogue: the
 * envelope's job is to say whether the request is well-formed, and the routing
 * table's job is to say whether this build serves that id. Narrowing here would
 * merge the two answers and tell a client with a newer plugin that its JSON was
 * malformed, when in fact its Worker is simply older — the exact confusion
 * D-011's version floor exists to prevent. Validate against `knownTaskId` at
 * the routing layer instead.
 */
export const taskId = z.string().min(1);
export type TaskId = z.infer<typeof taskId>;

/** Every request carries the version and the task; payload is per-task. */
export const requestEnvelope = z.object({
  contractVersion: z.number().int().positive(),
  taskId,
  /** Transient context. Never persisted server-side (D-005, plan §7.1). */
  payload: z.unknown(),
});
export type RequestEnvelope = z.infer<typeof requestEnvelope>;

/**
 * Provenance stamped on every successful response (D7.3).
 *
 * `promptVersion` and `modelId` are what make "which change caused this
 * regression?" answerable at semester scale. The client persists them onto the
 * artifact the response produced, so the artifact carries its own provenance
 * even after the server has forgotten the call — which it does immediately.
 */
export const responseStamp = z.object({
  contractVersion: z.number().int().positive(),
  /** VERSION file of the prompt template that served this task (C4.3, D7.3). */
  promptVersion: z.string().min(1),
  /** The model that produced it, e.g. a Workers AI or gateway model id (C4.6). */
  modelId: z.string().min(1),
});
export type ResponseStamp = z.infer<typeof responseStamp>;

/**
 * Error codes the plugin must handle distinctly, because each has a different
 * honest thing to say to her (F7.5, F7.8):
 *
 * - `update-required` — her plugin is below the floor. Review keeps working;
 *   AI features explain why. Never a half-working session (D-011).
 * - `unauthenticated` — the token is missing or invalid; actionable, and the
 *   plugin surfaces it honestly rather than silently degrading (P3-T01).
 * - `grounding-refused` — retrieval was empty and the task refused rather than
 *   inventing (C4.7, INV-5). **This is a success of the system, not a fault.**
 *   An invented card she trusts does more damage than a missing one, because
 *   she revises from it and then sits an exam on it.
 * - `quota-exceeded` — hooks are wired and enforcement-capable, unlimited for
 *   alpha (C4.5).
 * - `invalid-request` / `upstream-error` / `internal-error` — the rest.
 */
export const errorCode = z.enum([
  'update-required',
  'unauthenticated',
  'invalid-request',
  'grounding-refused',
  'quota-exceeded',
  'upstream-error',
  'internal-error',
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const errorResponse = z.object({
  ok: z.literal(false),
  code: errorCode,
  /** Human-readable and safe to show her. Never contains her content. */
  message: z.string().min(1),
  /** Present on `update-required`: what the Worker still supports. */
  supported: z
    .object({ min: z.number().int().positive(), current: z.number().int().positive() })
    .optional(),
});
export type ErrorResponse = z.infer<typeof errorResponse>;

export const successResponse = z.object({
  ok: z.literal(true),
  stamp: responseStamp,
  /** The computed artifact. Per-task shape; validated per task id in P3-T02. */
  result: z.unknown(),
  /**
   * Budget headroom signal (D-002). The Worker keeps no queue state; it reports
   * headroom and nothing more — the plugin owns the ingestion queue and paces it against
   * the daily neuron budget. Queueing server-side instead would mean holding
   * her material for hours at a time, long enough that D-005's transient-only
   * posture would stop describing what the Worker actually does.
   */
  budgetHeadroom: z.number().min(0).max(1).optional(),
});
export type SuccessResponse = z.infer<typeof successResponse>;

export const workerResponse = z.discriminatedUnion('ok', [successResponse, errorResponse]);
export type WorkerResponse = z.infer<typeof workerResponse>;

/**
 * Per-request telemetry — the ONLY thing the Worker may persist about a call,
 * and the schema that makes D-005 auditable rather than aspirational.
 *
 * Legitimately here (C4.4, D7.3): the task id, token counts, cost, latency, and
 * the model and prompt-template versions. **Forbidden:** her content, any
 * concept or note identifier, and anything her material could be rebuilt from.
 * `userId` is an opaque account handle, not her name or vault.
 *
 * P3-T02 carries a test asserting content never reaches this record. That test
 * is the enforcement; this comment is only the reason.
 */
export const requestTelemetry = z.object({
  userId: z.string().min(1),
  taskId,
  modelId: z.string().min(1),
  promptVersion: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  timestamp: z.string().datetime({ offset: true }),
  outcome: z.enum(['ok', 'refused', 'error']),
});
export type RequestTelemetry = z.infer<typeof requestTelemetry>;

/** Is this client version still served? Below `min` → `update-required`. */
export function isSupportedContractVersion(version: number): boolean {
  return (
    version >= SUPPORTED_CONTRACT_VERSIONS.min && version <= SUPPORTED_CONTRACT_VERSIONS.current
  );
}
