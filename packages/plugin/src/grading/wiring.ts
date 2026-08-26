/**
 * `buildGradingWiring` / `gradeExplainBackAttempt` — the plugin-side
 * composition root for the explain-back grading pipeline (`ol-drfy`).
 *
 * ===========================================================================
 * WHAT WAS MISSING BEFORE THIS FILE EXISTED
 * ===========================================================================
 * `ol-p4t02` (grading pipeline) shipped `gradeExplainBack` and the
 * `JudgeCaller` port, both closed, with no implementation of the port and no
 * caller of the pipeline anywhere outside their own module and specs — the
 * wiring register's `JudgeCaller` finding
 * (`olea/docs/dev/wiring-register.md`). `olea-core`'s new
 * `createWorkerJudgeCaller` (`ol-drfy`) is the missing implementation; this
 * module is the missing plugin-side composition, following exactly the
 * pattern `retrieval/wiring.ts` established for `WorkerEmbeddingProvider`:
 * load the persisted Worker config, build a real transport when (and only
 * when) it is usable, and hand back `null` otherwise rather than a caller
 * doomed to fail on its first real request.
 *
 * ===========================================================================
 * WHY THE MODEL/UI QUESTION IS DELIBERATELY OUT OF SCOPE HERE
 * ===========================================================================
 * `gradeExplainBackAttempt` below is a genuine, non-test call to
 * `gradeExplainBack` — real infrastructure, not a fake — and `main.ts`
 * exposes it as `OleaPlugin.gradeExplainBackAttempt`, a real method on the
 * plugin instance. But nothing calls *that method* yet. That is
 * intentional, not an oversight left for a later pass to notice:
 *
 * - There is no explain-back destination in the review UI at all.
 *   `review/types.ts` says so explicitly ("`explain-back` is never
 *   queued/rated here — F2.12/F5 territory, not this bead"), and
 *   `commands/register-commands.ts`'s module doc records David's own ruling
 *   that a command with no real destination is more misleading than an
 *   absent one — it "waits for the bead that builds it."
 * - Building that destination now would be a Class C move twice over: it
 *   would change what the alpha user experiences (a new command or view)
 *   without the decision that authorises it, and the two verdict-shaped
 *   Class C questions immediately downstream — where a grading verdict
 *   lives (`ol-tka5`) and what the accept step records (`ol-548w`) — are
 *   both still open. Producing a real grading with nowhere honest to send it
 *   would be worse than not producing one yet.
 * - The intended next caller is `ol-p4t05` (confusion routing, F2.12):
 *   its whole premise is routing a repeated card failure *into* this
 *   pipeline. This module — and `OleaPlugin.gradeExplainBackAttempt` — is
 *   what makes that routing land somewhere real instead of a dead end.
 *
 * ===========================================================================
 * `ol-p4t05` UPDATE: THE ROUTING DECISION EXISTS NOW; THE REVIEW-SIDE CALLER
 * STILL DOES NOT, AND FOR THE SAME REASON AS ABOVE
 * ===========================================================================
 * `evaluateConfusionRouting` below composes `olea-core`'s pure F2.12 decision
 * (`../misconception/confusion-routing.js`, in that package) into this
 * plugin's wiring layer, mirroring `gradeExplainBackAttempt` immediately
 * below it. It needs no `GradingWiring`/Worker dependency — the decision is
 * local and synchronous — but it lives here rather than as a bare re-export
 * because this file is the one this bead's own module doc already commits to
 * being "the destination," and because a caller wiring the two together (an
 * offer, then a grade once she writes one) has one composition root to import
 * from instead of two.
 *
 * Its own caller is still missing, on purpose, for the same reason
 * `gradeExplainBackAttempt` had none until now: the review rating flow that
 * would call this after each graded review lives in `packages/plugin/src/
 * review/**`, a concurrently-owned lane's files this bead does not touch.
 * `OleaPlugin.evaluateConfusionRouting` (main.ts) exists so that lane has
 * something real to call into.
 *
 * So "genuinely reachable" here means what it means for
 * `WorkerTaskTransport` in the register today ("wired, but its only
 * production caller today is the settings connection test... genuinely
 * wired, not yet exercised for real work") — composed against real
 * infrastructure, not a fake, and callable by production code, with the
 * actual trigger left to the bead whose job it is.
 */

import {
  type ConfusionRoutingDecision,
  type ConfusionRoutingInput,
  createWorkerJudgeCaller,
  evaluateConfusionRouting as evaluateConfusionRoutingCore,
  type GradeExplainBackInput,
  gradeExplainBack,
  type JudgeCaller,
  type PendingExplainBackGrading,
  type WorkerTaskTransport,
} from 'olea-core';
import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern `retrieval/wiring.ts` and every other store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface GradingWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
}

export interface GradingWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — see the module doc.
   * A caller checks this exactly once, the same shape `main.ts` already uses
   * for `this.retrieval`/`this.ingestion`.
   */
  readonly judgeCaller: JudgeCaller | null;
}

export async function buildGradingWiring(deps: GradingWiringDeps): Promise<GradingWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { judgeCaller: null };

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  return { judgeCaller: createWorkerJudgeCaller({ transport }) };
}

/**
 * The production caller `ol-drfy` exists to build: reaches `gradeExplainBack`
 * through whatever `JudgeCaller` `buildGradingWiring` composed, over the real
 * Worker transport when one is configured. `null` when it is not (F7.8) —
 * the same "grey out, never half-work" contract every other AI-gated surface
 * in this plugin follows, propagated one level up rather than left for a
 * caller to rediscover.
 *
 * Returns a `PendingExplainBackGrading` — never accepted. INV-6's accept
 * step (`acceptExplainBackGrading`, `olea-core`) is a separate, deliberate
 * call a caller makes only after she has seen and agreed with the grading;
 * nothing here calls it on her behalf, and nothing here persists the result
 * — `ol-tka5` (where a verdict lives) and `ol-548w` (what the accept step
 * records) are both open Class C questions this function does not answer.
 */
export async function gradeExplainBackAttempt(
  wiring: GradingWiring,
  input: GradeExplainBackInput,
): Promise<PendingExplainBackGrading | null> {
  if (wiring.judgeCaller === null) return null;
  return gradeExplainBack(input, wiring.judgeCaller);
}

/**
 * `ol-p4t05`'s F2.12 decision, composed at this plugin's wiring layer.
 * Delegates entirely to `olea-core`'s `evaluateConfusionRouting`
 * (`../misconception/confusion-routing.js` in that package) — pure and
 * synchronous, with no `GradingWiring`/Worker dependency, unlike
 * `gradeExplainBackAttempt` above. It lives here, rather than as a bare
 * re-export from `main.ts`, so this file stays the one composition root the
 * bead that built `gradeExplainBackAttempt` already named as this bead's
 * destination — see the module doc above.
 */
export function evaluateConfusionRouting(input: ConfusionRoutingInput): ConfusionRoutingDecision {
  return evaluateConfusionRoutingCore(input);
}
