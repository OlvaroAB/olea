/**
 * The client-side plan cache (A2.5's "the client caches the plan", D-006).
 *
 * Two functions over a `StudyPlanStore`, and the interesting one is `load`.
 *
 * ## Every way of not having a plan reads the same way, and that is deliberate
 *
 * `loadCachedStudyPlan` returns `null` for all of: nothing persisted yet, a
 * blob at an unknown `formatVersion`, and a blob the contract schema rejects.
 * It never throws and never migrates.
 *
 * That is D-006 doing the work a migration would otherwise have to. The plan is
 * a **derivation**, not a source of truth — the same class as the embedding
 * cache, whose engine treats an unrecognised version exactly as it treats a
 * model swap, by starting from zero. The alternative, a migration path per
 * format version, buys nothing here: the inputs that produced the plan are all
 * still local, so rebuilding is cheap and always correct, while a migration is
 * code that must stay right about a shape nobody has looked at in six months.
 *
 * The contrast with the review log is the whole reason both choices are right.
 * That record **cannot be backfilled**, so it migrates and never discards. This
 * one can be rebuilt from scratch on demand, so it discards and never migrates.
 * The distinction to check when adding any new persisted shape is not "is it
 * important" — it is "can it be recomputed".
 *
 * ## Why `load` takes `unknown`
 *
 * `StudyPlanStore.load` is typed `Promise<unknown>` rather than
 * `Promise<StudyPlanArtifact | null>`. What comes off disk is a blob a previous
 * build wrote, and typing the port as though it were already a valid current
 * plan would put the version check in the implementor's honour system — which
 * is precisely the check this module exists to perform.
 */

import { type StudyPlanArtifact, studyPlanArtifact } from 'olea-contracts';
import type { StudyPlanStore } from './types.js';

/** Why a persisted blob was not usable — reported, never silently absorbed. */
export type StudyPlanCacheRejection =
  /** Nothing persisted yet: `load` returned `null` or `undefined`. */
  | 'absent'
  /** Present but not a current-format plan (unknown `formatVersion`, or schema mismatch). */
  | 'unreadable';

export interface LoadCachedStudyPlanResult {
  readonly plan: StudyPlanArtifact | null;
  /** Present exactly when `plan` is `null`. Distinguishes "never had one" from "had one we cannot read". */
  readonly rejection?: StudyPlanCacheRejection;
}

/**
 * Read the cached plan, or report why there isn't one.
 *
 * The two-arm result exists so a caller can log the difference without the
 * function having to choose between throwing and lying. "Never cached" is the
 * ordinary first-run state; "cached but unreadable" is worth a line in the log,
 * because it is the shape a botched format bump takes.
 */
export async function loadCachedStudyPlan(
  store: StudyPlanStore,
): Promise<LoadCachedStudyPlanResult> {
  const raw = await store.load();
  if (raw === null || raw === undefined) return { plan: null, rejection: 'absent' };
  const parsed = studyPlanArtifact.safeParse(raw);
  if (!parsed.success) return { plan: null, rejection: 'unreadable' };
  return { plan: parsed.data };
}

/**
 * Write a plan to the cache, validating first.
 *
 * The validation is not ceremony. `save` is the only door into a store the
 * plugin implements over `saveData`, and a plan that fails the schema on the
 * way in becomes a blob that fails it on the way out — at which point the
 * failure is discovered on her next session rather than at the moment something
 * built a bad plan. Throwing here is right precisely because it is *not* the
 * offline path: a caller that cannot build a valid plan has a bug, whereas a
 * caller that cannot reach the network has weather (see `refresh.ts`).
 */
export async function saveCachedStudyPlan(
  store: StudyPlanStore,
  plan: StudyPlanArtifact,
): Promise<void> {
  await store.save(studyPlanArtifact.parse(plan));
}
