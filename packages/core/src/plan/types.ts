/**
 * The study plan's ports and result shapes (A2.5, C5.5, C7.6, D-006, P5-T05).
 *
 * A2.5 splits the plan in two: *"The Worker computes priority weights and topic
 * rankings per course periodically … The client caches the plan and runs review
 * against it."* This directory is the client half of that sentence, and it is
 * three separate things kept separate on purpose:
 *
 * - `build.ts` turns a `RankOracleResult` (P5-T04) into the shared envelope.
 * - `cache.ts` persists it through `StudyPlanStore`, in the plugin data folder.
 * - `execute.ts` runs a composed queue against a cached plan — **pure, no
 *   network, no clock, no provider.** That is C5.5's *"works offline from the
 *   cached plan"*, and it is why the port lives on the refresh path only.
 *
 * ## The two ports, and why neither of them is in `execute.ts`
 *
 * `StudyPlanStore` mirrors `KeywordIndexStore` and `EmbeddingCacheStore` field
 * for field: a narrow load/save over a plain-JSON persisted value, implemented
 * in `packages/plugin` over Obsidian's `loadData`/`saveData` under its own
 * top-level key (INV-1 — nothing here may import `obsidian`), living in the
 * plugin data folder and never the vault (D-006, and INV-2 by construction:
 * the plan is never written into a note, so there is no round-trip to break).
 *
 * `StudyPlanProvider` is the one seam onto "compute a fresh plan", the same
 * shape and the same reasoning as `EmbeddingProvider`: it says nothing about
 * HTTP, task ids or the Worker envelope, a production implementation lives in
 * `packages/plugin`, and every test here injects a fake. It is **optional
 * everywhere it appears**, because F7.8 requires review to work with no AI at
 * all and plan §7.1.4 lists a plan refresh as something reconnection *may* do —
 * never something the daily loop waits on.
 */

import type { StudyPlanEnvelope } from 'olea-contracts';

/**
 * The persistence port (A2.5, D-006). Core depends only on this.
 *
 * `load` returning `null` means "nothing persisted yet", which is a different
 * statement from "a plan with no courses" — a vault with no assessments
 * legitimately produces the latter, and a caller that conflated them would
 * refresh forever or never. `cache.ts` keeps them distinct.
 *
 * There is deliberately no `clear`. Deleting the cache is the plugin's business
 * (and D-006's rebuildable property is what makes it safe); core's job is to
 * survive its absence, which it does by treating absent, unparseable,
 * unknown-version and expired blobs identically.
 *
 * `save` takes the shared `StudyPlanEnvelope` (`[D-122]`, `[BND-3b]`) rather
 * than the retired `StudyPlanArtifact` — the study plan is now one instance of
 * the versioned-artifact envelope (`packages/contracts/src/artifact-envelope.ts`),
 * not a parallel persisted shape.
 */
export interface StudyPlanStore {
  load(): Promise<unknown>;
  save(plan: StudyPlanEnvelope): Promise<void>;
}

/**
 * The seam onto "compute a fresh plan" (A2.5's Worker half).
 *
 * Nothing in this package calls the network. A production implementation lives
 * in `packages/plugin` and speaks the Worker envelope; every test here injects
 * a fake, including fakes that throw, that hang up, and that return nonsense —
 * which is the point, since those are the states F7.8 has to survive.
 *
 * It returns `unknown` rather than `StudyPlanEnvelope` on purpose. What comes
 * back off a wire is not a plan until the contract schema says it is, and a port
 * typed as though it were would move that check into the implementor's honour
 * system. `refresh.ts` validates before anything reaches the cache.
 */
export interface StudyPlanProvider {
  fetchPlan(): Promise<unknown>;
}

/** Where the plan a caller is holding actually came from. */
export type StudyPlanSource =
  /** Freshly computed by the provider and written to the cache. */
  | 'provider'
  /** Read from the local cache — either because there was no provider, or because it failed. */
  | 'cache'
  /** There is no plan: nothing cached, and no provider produced one. */
  | 'none';

/**
 * The outcome of a refresh attempt.
 *
 * **This never throws for a provider failure**, and that is the whole design.
 * A refresh is an optimisation on top of a cached plan; a caller forced into a
 * `try`/`catch` to keep her queue working is one `await` away from a session
 * that dies because the network did. Failures are reported in `reason` instead,
 * so they can be logged and surfaced (F7.5's honest degradation) rather than
 * swallowed — the alternative to throwing is *reporting*, never silence.
 */
export interface StudyPlanRefreshResult {
  /** The plan now in force, or `null` when there is none to be had. */
  readonly plan: StudyPlanEnvelope | null;
  readonly source: StudyPlanSource;
  /**
   * True when the plan in force is not the provider's latest — no provider was
   * supplied, or the one supplied did not produce a usable plan. Distinct from
   * `plan === null`: a stale plan is still a plan, and plan §7.1.6 is explicit
   * that its weights go stale in days, not minutes.
   */
  readonly offline: boolean;
  /**
   * Why the provider did not supply the plan, when it did not. Present exactly
   * when a provider was supplied and failed; absent on success and absent when
   * no provider was supplied at all (that is not a failure, it is a
   * configuration).
   *
   * A message, never her content: it names the failure, never the material.
   */
  readonly reason?: string;
}
