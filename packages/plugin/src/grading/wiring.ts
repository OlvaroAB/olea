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
 * - The candidate next caller was `ol-p4t05`/`ol-h2bx` (confusion routing,
 *   F2.12) — routing a repeated card failure *into* this pipeline once she
 *   has written something to grade. **That did not happen, and the section
 *   below this one records why**: `ol-h2bx` routes the accepted offer into
 *   F2.7's on-demand explain-why channel instead, precisely because the two
 *   Class C questions in the bullet above are still open. This module's
 *   "no caller yet" therefore remains true even though confusion routing
 *   itself is now fully wired.
 *
 * ===========================================================================
 * `ol-p4t05` UPDATE: THE ROUTING DECISION EXISTS. `ol-h2bx` UPDATE: THE
 * REVIEW-SIDE CALLER NOW EXISTS TOO — AND ROUTES SOMEWHERE DIFFERENT FROM
 * WHAT THIS DOC ORIGINALLY EXPECTED
 * ===========================================================================
 * `evaluateConfusionRouting` below composes `olea-core`'s pure F2.12 decision
 * (`../misconception/confusion-routing.js`, in that package) into this
 * plugin's wiring layer, mirroring `gradeExplainBackAttempt` immediately
 * below it. It needs no `GradingWiring`/Worker dependency — the decision is
 * local and synchronous — but it lives here rather than as a bare re-export
 * because this file is the one this bead's own module doc already commits to
 * being "the destination."
 *
 * `ol-h2bx` (`review/session.ts`'s `logAndAdvance`, composed at
 * `OleaPlugin.evaluateConfusionRouting` → `main.ts`'s `composeReviewSession`)
 * is that caller now. **It does NOT wire the two together the way this doc's
 * first version expected** — "an offer, then a grade once she writes one."
 * There is still no explain-back destination in the review UI where she
 * writes anything (see this doc's own "WHY THE MODEL/UI QUESTION IS
 * DELIBERATELY OUT OF SCOPE HERE" section above, unchanged), and
 * `ol-tka5`/`ol-548w` are still open Class C questions. So accepting F2.12's
 * offer routes into F2.7's on-demand explain-why channel instead
 * (`ExplainWhyPort`/`requestExplainWhy`, `review/explainWhy.ts` /
 * `review/session.ts`) — the same grounded explanation the on-demand tap
 * shows, not a Feynman-mode input. `gradeExplainBackAttempt` immediately
 * below still has no caller anywhere in this package, and that gap is not
 * closed by this update.
 *
 * ===========================================================================
 * `ol-g3a0.1` UPDATE: A SECOND, INDEPENDENT REASON THIS RETURNS `null`
 * ===========================================================================
 * F7.8 as amended by `[D-127]` adds a kill-switch: sustained failure of
 * E2b's live calibration audit (`ol-g3a0`, private repo, not yet built)
 * greys explain-back honestly, the same shape as the
 * `judgeCaller === null` grey-out above but carrying a different message.
 * `GradingWiring.killedBySustainedAuditFailure` and
 * `../settings/explain-back-audit-gate.ts` are that switch — see that
 * file's module doc for the full story, including why a KV flag and not a
 * new endpoint, and why the write side is a tested setter rather than a
 * real producer today. `gradeExplainBackAttempt`'s "no caller anywhere in
 * this package" gap, above, is UNCHANGED by this update: this wiring makes
 * the kill-switch itself provably effective (`ol-g3a0.1`'s acceptance
 * criterion), and inherits, rather than closes, the pre-existing reachability
 * gap on the function it greys — closing that is `ol-tka5`/`ol-548w`'s job,
 * not this bead's.
 *
 * ===========================================================================
 * `ol-4053` UPDATE: THE ACCEPT STEP NOW COMPOSES THE MISCONCEPTION EMBEDDER
 * ===========================================================================
 * `ol-tka5` (the verdict-seam Class C question) and `ol-548w` (the INV-6
 * accept-step recording question) are now BOTH CLOSED — `[D-117]`'s review-log
 * v5 landed the schema. **That does not mean an explain-back destination
 * exists in the review UI yet — it still does not**, and building one is a
 * Class C user-visible-surface change with no citing clause, out of this
 * bead's `owns` (`packages/plugin/src/grading/`,
 * `packages/core/src/misconception/`) regardless. What `ol-4053` actually
 * closes is narrower and one level down: `ol-nagi` built
 * `WorkerMisconceptionEmbedder`/`buildObservationEventWithEmbedding` with no
 * caller "by construction" — the honest caller is the accepted-grading path,
 * which needed `ol-tka5` to exist at all. `GradingWiring` below now also
 * composes a `MisconceptionEmbedder`/`MisconceptionEmbeddingCacheEngine` pair
 * (`buildMisconceptionEmbedderWiring`, `../misconception-embedder.js` — same
 * F7.8 grey-out terms, same `SLOT_E_MODEL_ID` pin, same Worker config), and
 * `acceptExplainBackGradingWithObservation` below is the real, callable
 * accept-and-observe path: `acceptExplainBackGrading` (INV-6) followed by
 * `buildObservationEventsFromAcceptedGrading`
 * (`../../core/src/misconception/accepted-grading-observation.js`) against
 * that composed embedder/cache, with the observation half wrapped in the same
 * best-effort boundary `../ingestion/wiring.ts`'s `withUnitsLandedHook`
 * establishes: an embedding failure never fails the grade acceptance it rode
 * on.
 *
 * **Still no production caller of `acceptExplainBackGradingWithObservation`
 * itself**, for the same reason `gradeExplainBackAttempt` above has none: there
 * is nowhere in the product yet that produces a `PendingExplainBackGrading` to
 * accept in the first place. Per `[D-072]` clause 5's escape hatch, the next
 * caller is named rather than guessed at or built past this bead's `owns`: the
 * explain-back UI destination (e.g. `ol-qbbb` [F5a], or an equivalent
 * contract-cited surface) plus whatever reads the misconception store
 * (`packages/plugin/src/misconception/store.ts`) to supply
 * `AcceptExplainBackGradingWithObservationContext`'s `resolveCitation` /
 * `resolveConceptId` / `candidateRecordsForConcept` for real — none of which
 * this bead's `owns` reaches.
 *
 * ===========================================================================
 * `ol-12gs` UPDATE (2026-08-31): THE ABOVE GAP IS CLOSED — `ol-cqz8` UPDATE
 * BELOW ADDS THE SOLO PIPELINE'S OWN COMPOSITION
 * ===========================================================================
 * `ol-12gs` built `ExplainBackModal` (`packages/plugin/src/explain-back/
 * modal.ts`), the `[D-163]` destination surface the paragraph above was
 * still waiting on — `gradeExplainBackAttempt` and
 * `acceptExplainBackGradingWithObservation` both have real production callers
 * now (`main.ts`'s `openExplainBackModal`), closing the reachability gap this
 * doc named through several update sections.
 *
 * That closed the CORRECTNESS pipeline's reachability, not the SOLO one:
 * `createWorkerSoloJudgeCaller` (`explain-back.solo.v1`, `ol-95vv.2`) had no
 * plugin-side composition anywhere, unlike its correctness sibling above.
 * `gradeSoloAttempt` below is that composition — mirroring
 * `gradeExplainBackAttempt`'s shape (same `GradingWiring`, same F7.8 grey-out
 * reasons) with one addition the SOLO pipeline's write side requires: a real
 * `SoloArtifactProvenance` (D7.3's promptVersion/modelId stamp), which a bare
 * `SoloJudgeCaller` has nowhere to carry back to a caller — see that
 * function's own doc.
 *
 * `ExplainBackModal`'s accept flow (`modal.ts`'s `acceptGrading`) calls
 * `gradeSoloAttempt` through `../explain-back/solo-review.js`'s
 * `recordSoloGradeAndReview`, which also composes `acceptSoloGrading` and
 * `recordGradedExplainBackReview` (`olea-core`) into the one review-log write
 * `[D-117]`'s "rides the same review event" ruling calls for — see that
 * module's own doc for the full chain and for why `ExplainBackModalDeps
 * .recordSoloGradeAndReview` is optional: `main.ts`'s `openExplainBackModal`
 * construction site (the ONE place a real `RecordSoloGradeAndReviewDeps`
 * instance — `GradingWiring` plus a `VaultSource`/device id — could be built)
 * is outside `ol-cqz8`'s `owns`, so wiring that one call site is named as a
 * follow-on rather than reached into.
 *
 * ===========================================================================
 * `ol-0r92.11` UPDATE: F5.3a / R7's THIRD TRIGGER FOR THE SAME F2.21 OFFER
 * ===========================================================================
 * `evaluateSchedulingObservationRouting` below composes `olea-core`'s pure
 * F5.3a decision (`../misconception/scheduling-observation-routing.js`),
 * mirroring `evaluateConfusionRouting` immediately above it exactly: no
 * `GradingWiring`/Worker dependency, pure and synchronous, living here
 * because this file is the one composition root. The ONE difference from
 * `evaluateConfusionRouting`'s shape: this decision needs the log's live
 * scheduling-observation map (`replayUnconsumedSchedulingObservations`), a
 * per-vault value this wiring layer has no access to (no `VaultSource`
 * here) — so, unlike `evaluateConfusionRouting`, this is NOT threaded onto
 * `ReviewSessionDeps` by `main.ts` at plugin-construction time. The map is
 * computed once per opened session by `../review/open-session.js`, which
 * already reads the whole log to build `composed.entries` for
 * `buildSupportLevelHistoryLookup` — that is the actual composition site
 * for the closure over `liveObservations`; this function is the thin, pure,
 * independently-testable delegate that call site closes over. See
 * `open-session.ts`'s own doc for that seam.
 */

import {
  type AcceptedExplainBackGrading,
  type AcceptedGradingObservationOutcome,
  acceptExplainBackGrading,
  buildObservationEventsFromAcceptedGrading,
  type ConfusionRoutingDecision,
  type ConfusionRoutingInput,
  createWorkerJudgeCaller,
  createWorkerSoloJudgeCaller,
  EXPLAIN_BACK_SOLO_TASK_ID,
  evaluateConfusionRouting as evaluateConfusionRoutingCore,
  evaluateSchedulingObservationRouting as evaluateSchedulingObservationRoutingCore,
  type GradeExplainBackInput,
  type GradeSoloInput,
  gradeExplainBack,
  gradeSolo,
  type JudgeCaller,
  type MisconceptionEmbedder,
  type MisconceptionEmbeddingCacheEngine,
  type MisconceptionRecord,
  type MisconceptionSourceCitation,
  type PendingExplainBackGrading,
  type PendingSoloGrading,
  type SchedulingObservationDecision,
  type SchedulingObservationRoutingInput,
  type SoloArtifactProvenance,
  type WorkerTaskTransport,
} from 'olea-core';
import { buildMisconceptionEmbedderWiring } from '../misconception-embedder.js';
import {
  isExplainBackKilled,
  ObsidianExplainBackAuditGateStore,
} from '../settings/explain-back-audit-gate.js';
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
  /**
   * `true` when E2b's live calibration audit (`ol-g3a0`) has observed
   * sustained grading failure — F7.8's kill-switch, `[D-127]`. A SECOND,
   * independent reason `gradeExplainBackAttempt` returns `null`, distinct
   * from `judgeCaller === null`: see `../settings/explain-back-audit-gate.ts`
   * and this file's `ol-g3a0.1` module-doc update.
   */
  readonly killedBySustainedAuditFailure: boolean;
  /**
   * `null` under the same F7.8 grey-out condition as `judgeCaller` (no Worker
   * configured yet) — see the `ol-4053` module-doc update above.
   * `misconceptionEmbedder`/`misconceptionEmbeddingCache` are always
   * both-or-neither, mirroring `MisconceptionEmbedderWiring`'s own pair.
   */
  readonly misconceptionEmbedder: MisconceptionEmbedder | null;
  readonly misconceptionEmbeddingCache: MisconceptionEmbeddingCacheEngine | null;
  /**
   * `ol-cqz8`: the SAME `WorkerTaskTransport` `judgeCaller` was built over
   * (one Worker config, one transport per `buildGradingWiring` call — same
   * posture `judgeCaller`/`misconceptionEmbedder` already share), kept raw
   * rather than wrapped into a `SoloJudgeCaller` here. `gradeSoloAttempt`
   * below is what wraps it, per call, in a stamp-capturing decorator — see
   * that function's own doc for why a bare `SoloJudgeCaller` (a plain
   * function returning only `ExplainBackSoloWireResponse`) cannot carry
   * `[D-117]`'s required `artifactProvenance` (D7.3's promptVersion/modelId
   * stamp) back to a caller on its own. `null` under the identical F7.8
   * grey-out condition as `judgeCaller`.
   */
  readonly soloTransport: WorkerTaskTransport | null;
}

export async function buildGradingWiring(deps: GradingWiringDeps): Promise<GradingWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  const auditGateStore = new ObsidianExplainBackAuditGateStore(deps.dataHost);
  const killedBySustainedAuditFailure = isExplainBackKilled(await auditGateStore.load());
  // `ol-4053`: the same Worker config this wiring already loads also gates
  // the misconception embedder — `buildMisconceptionEmbedderWiring` re-checks
  // it independently (mirroring how `this.retrieval`/`this.grading` each
  // build their own transport in `main.ts` rather than sharing one), so this
  // never depends on `judgeCaller`'s own null-check below.
  const misconception = await buildMisconceptionEmbedderWiring({
    dataHost: deps.dataHost,
    createTransport: deps.createTransport,
  });

  if (!isWorkerConfigured(config)) {
    return {
      judgeCaller: null,
      killedBySustainedAuditFailure,
      misconceptionEmbedder: misconception.embedder,
      misconceptionEmbeddingCache: misconception.cache,
      soloTransport: null,
    };
  }

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  return {
    judgeCaller: createWorkerJudgeCaller({ transport }),
    killedBySustainedAuditFailure,
    misconceptionEmbedder: misconception.embedder,
    misconceptionEmbeddingCache: misconception.cache,
    // `ol-cqz8`: the correctness judge and the SOLO depth judge are
    // independent Worker tasks (`explainBackSolo.ts`'s own module doc, "WHY
    // THIS IS A SEPARATE PIPELINE") but share one Worker config/transport —
    // same posture `misconception`'s embedder pair already takes above.
    soloTransport: transport,
  };
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
 *
 * Returns `null` for either of TWO independent reasons — the Worker isn't
 * configured, or `[D-127]`'s kill-switch has tripped — and deliberately does
 * not distinguish them in its own return type: the caller-facing contract
 * ("no grading available right now") is identical either way, and the two
 * reasons carry different STUDENT-FACING wording only in the settings pane
 * (`../settings/settings-tab.ts`), never here.
 */
export async function gradeExplainBackAttempt(
  wiring: GradingWiring,
  input: GradeExplainBackInput,
): Promise<PendingExplainBackGrading | null> {
  if (wiring.judgeCaller === null || wiring.killedBySustainedAuditFailure) return null;
  return gradeExplainBack(input, wiring.judgeCaller);
}

/**
 * Everything a caller must supply beyond `wiring` to turn an accepted
 * grading's `misconceptionCandidates` into observation events — see
 * `olea-core`'s `AcceptedGradingObservationContext`
 * (`packages/core/src/misconception/accepted-grading-observation.ts`) for the
 * full contract these fields satisfy. Named separately here rather than
 * re-exported so this module stays the one place that documents what a real
 * caller (still unbuilt — see the `ol-4053` module-doc update) needs to
 * resolve: which `sourceBlocks` id maps to which `{path, blockIndex}`, which
 * label maps to which concept id, and which existing records are eligible to
 * reabsorb a new occurrence on that concept.
 */
export interface AcceptExplainBackGradingWithObservationContext {
  readonly originInstrumentId: string;
  readonly originReviewEventId: string | null;
  readonly timestamp: string;
  readonly resolveCitation: (blockId: string) => MisconceptionSourceCitation | null;
  readonly resolveConceptId: (concept: string) => string | null;
  readonly candidateRecordsForConcept: (conceptId: string) => readonly MisconceptionRecord[];
}

export interface AcceptExplainBackGradingWithObservationResult {
  readonly accepted: AcceptedExplainBackGrading;
  /** Empty when there were no misconceptionCandidates to observe, or when the observation step failed — see this function's doc. */
  readonly observations: readonly AcceptedGradingObservationOutcome[];
}

/**
 * `ol-4053`: the accepted-grading path `buildObservationEventWithEmbedding`
 * was built for, one composition root up from
 * `buildObservationEventsFromAcceptedGrading` (`olea-core`). Runs INV-6's
 * accept step first — `acceptExplainBackGrading` throwing means `pending`
 * carried an ungrounded citation, a caller bug per that function's own doc,
 * so this does NOT catch that — then maps every surviving
 * `misconceptionCandidates` entry into an observation event against
 * `wiring`'s composed embedder/cache.
 *
 * **Failure isolation, mirroring `../ingestion/wiring.ts`'s
 * `withUnitsLandedHook`:** the observation step is wrapped in its own
 * try/catch. An embedding or observation failure never fails the grade
 * acceptance it rode on — the caller still gets back a valid `accepted`
 * grading, with `observations: []` and a content-free `console.error` line
 * (D-005: a count only, never the candidate's statement or correction).
 */
export async function acceptExplainBackGradingWithObservation(
  wiring: GradingWiring,
  pending: PendingExplainBackGrading,
  context: AcceptExplainBackGradingWithObservationContext,
): Promise<AcceptExplainBackGradingWithObservationResult> {
  const accepted = acceptExplainBackGrading(pending);
  if (accepted.misconceptionCandidates.length === 0) {
    return { accepted, observations: [] };
  }

  try {
    const observations = await buildObservationEventsFromAcceptedGrading(
      accepted.misconceptionCandidates,
      context,
      {
        embedder: wiring.misconceptionEmbedder,
        ...(wiring.misconceptionEmbeddingCache
          ? { cache: wiring.misconceptionEmbeddingCache }
          : {}),
      },
    );
    return { accepted, observations };
  } catch (error) {
    console.error('Olea: misconception observation failed (grade acceptance unaffected)', {
      misconceptionCandidateCount: accepted.misconceptionCandidates.length,
      error,
    });
    return { accepted, observations: [] };
  }
}

/** What `gradeSoloAttempt` hands back — the pending SOLO grading plus the D7.3 provenance triple the write side ([D-117]'s `explainBackGrade.artifactProvenance`) requires and cannot derive on its own. */
export interface SoloGradingOutcome {
  readonly pending: PendingSoloGrading;
  readonly artifactProvenance: SoloArtifactProvenance;
}

/**
 * `ol-cqz8`: the plugin-side composition `createWorkerSoloJudgeCaller`
 * (`olea-core`) had no caller anywhere in the plugin before this — mirrors
 * `gradeExplainBackAttempt` above (same `null` grey-out reasons: no Worker
 * configured, or `[D-127]`'s kill-switch has tripped) with one addition this
 * pipeline needs that the correctness one does not: **the caller must also
 * come away with a real `SoloArtifactProvenance`**, because
 * `buildExplainBackGradeReviewFields` (`explainBackSolo.ts`) takes it as a
 * required input rather than deriving it, and nothing upstream of the Worker
 * response can supply a real `promptVersion`/`modelId` pair.
 *
 * A `SoloJudgeCaller` (`createWorkerSoloJudgeCaller`'s return type) is a
 * plain `(input) => Promise<ExplainBackSoloWireResponse>` — deliberately
 * faithful to the wire response only (that class's own module doc), so it
 * has nowhere to carry the envelope's `stamp`. This function closes that gap
 * itself, the same way `generation/response.ts`'s `extractDraftedProvenance`
 * and `worker/transport.ts`'s `WorkerHttpTransport.onCallRecorded` already
 * read `stamp.promptVersion`/`stamp.modelId` off the public envelope for
 * D7.3 elsewhere in this plugin: it wraps `wiring.soloTransport` in a
 * one-shot capturing decorator, builds a fresh `SoloJudgeCaller` over that
 * decorator, and reads the captured stamp back out after `gradeSolo`
 * resolves.
 *
 * Returns `null` — never throws — for any of three reasons, deliberately not
 * distinguished in the return type (same posture `gradeExplainBackAttempt`
 * already takes for its own two): the Worker isn't configured, the
 * kill-switch has tripped, or (new to this function) the response carried no
 * usable `stamp`. The third case is D-005's "never guess" posture applied to
 * provenance specifically — `extractDraftedProvenance`'s own doc states the
 * identical rule: "a caller that cannot prove provenance does not cache the
 * draft." Here that becomes "does not treat the grading as usable," logged
 * with a task id only (D-005: never the rationale or her answer).
 */
export async function gradeSoloAttempt(
  wiring: GradingWiring,
  input: GradeSoloInput,
): Promise<SoloGradingOutcome | null> {
  if (wiring.soloTransport === null || wiring.killedBySustainedAuditFailure) return null;
  const soloTransport = wiring.soloTransport;

  let stamp: SoloArtifactProvenance | null = null;
  const capturingTransport: WorkerTaskTransport = {
    send: async (request) => {
      const body = await soloTransport.send(request);
      stamp = extractSoloArtifactProvenance(body, request.taskId);
      return body;
    },
  };

  const pending = await gradeSolo(
    input,
    createWorkerSoloJudgeCaller({ transport: capturingTransport }),
  );
  if (stamp === null) {
    console.error(
      'Olea: SOLO grading response carried no D7.3 stamp (promptVersion/modelId) — grading discarded, not guessed',
      { taskId: EXPLAIN_BACK_SOLO_TASK_ID },
    );
    return null;
  }
  return { pending, artifactProvenance: stamp };
}

/**
 * Reads `{promptVersion, modelId}` off a Worker response's public `stamp`
 * envelope — the same shape `generation/response.ts#extractDraftedProvenance`
 * and `worker/transport.ts#WorkerHttpTransport`'s `onCallRecorded` callback
 * already read for D7.3, duplicated here (rather than imported) because
 * neither of those lives in this file's `owns` and both read a DIFFERENT
 * `taskId` local constant than this pipeline's own. `null` on any malformed
 * or missing piece — never a fabricated placeholder (D-005).
 */
function extractSoloArtifactProvenance(
  body: unknown,
  taskId: string,
): SoloArtifactProvenance | null {
  if (typeof body !== 'object' || body === null) return null;
  const envelope = body as Record<string, unknown>;
  if (envelope.ok !== true) return null;
  const stamp = envelope.stamp;
  if (typeof stamp !== 'object' || stamp === null) return null;
  const s = stamp as Record<string, unknown>;
  if (typeof s.promptVersion !== 'string' || s.promptVersion.length === 0) return null;
  if (typeof s.modelId !== 'string' || s.modelId.length === 0) return null;
  return { taskId, promptVersion: s.promptVersion, modelId: s.modelId };
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

/**
 * `ol-0r92.11`'s F5.3a / R7 third-trigger decision, composed at this
 * plugin's wiring layer. Delegates entirely to `olea-core`'s
 * `evaluateSchedulingObservationRouting`
 * (`../misconception/scheduling-observation-routing.js`) — pure and
 * synchronous, no `GradingWiring`/Worker dependency, exactly like
 * `evaluateConfusionRouting` immediately above. See this file's
 * `ol-0r92.11 UPDATE` module-doc section for why `../review/open-session.js`,
 * not `main.ts`, is the call site that closes over the per-vault
 * `liveObservations` map this function's input needs.
 */
export function evaluateSchedulingObservationRouting(
  input: SchedulingObservationRoutingInput,
): SchedulingObservationDecision {
  return evaluateSchedulingObservationRoutingCore(input);
}
