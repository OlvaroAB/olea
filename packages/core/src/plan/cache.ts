/**
 * The client-side plan cache (A2.5's "the client caches the plan", D-006).
 *
 * Two functions over a `StudyPlanStore`, and the interesting one is `load`.
 *
 * ## Every way of not having a plan reads the same way, and that is deliberate
 *
 * `loadCachedStudyPlan` returns `plan: null` for all of: nothing persisted
 * yet, a blob of an unknown envelope/body version (or the pre-envelope
 * `studyPlanArtifact` shape — see below), a blob the contract schema rejects,
 * and a blob that has expired. It never throws and never migrates.
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
 * ## The envelope migration (`[D-122]`, `[BND-3b]`) — discard and rebuild, not migrate
 *
 * The study plan used to be its own persisted shape (`studyPlanArtifact`,
 * discriminated on `formatVersion`). It is now one instance of the shared
 * versioned-artifact envelope (`packages/contracts/src/artifact-envelope.ts`),
 * read through `readArtifactEnvelope`. **A blob in the old, pre-envelope shape
 * has no `envelopeVersion` field at all, so it fails the very first check
 * `readArtifactEnvelope` makes and is treated exactly like any other unreadable
 * blob** — discarded and rebuilt, never migrated onto the new shape. `[D-122]`
 * rules this explicitly: the mapping from the old shape to the new one is
 * total and mechanical (pinned by `artifact-envelope.spec.ts`'s compile-time
 * test), but that mapping is never *run* here — there is no data migration to
 * write, because the cost of a discarded plan is one recompute, not a lost
 * history (the plan is not append-only; nothing about her is only knowable
 * through an old plan artifact).
 *
 * ## Freshness is also `readArtifactEnvelope`'s neighbour, `envelopeFreshness`
 *
 * The study plan is a **governing** artifact (`artifact-envelope.ts`'s
 * "Declared constants" section): it tells her what to do, so a stale one is
 * still worth having and an expired one is not — `[D-044]`'s "degrade rather
 * than stop", but only up to the governing horizon, past which continuing to
 * apply the plan would be pretending to know something no longer evidenced.
 * `loadCachedStudyPlan` therefore treats an **expired** envelope the same as
 * an absent one for the purpose of "is there a plan to execute against" — see
 * `rejection: 'expired'` below — while still handing back `freshness` for a
 * plan that is merely `stale`, so a caller can say so (F7.5's honest
 * degradation) rather than silently reusing yesterday's plan without a word.
 *
 * ## Why `load` takes `unknown`
 *
 * `StudyPlanStore.load` is typed `Promise<unknown>` rather than
 * `Promise<StudyPlanEnvelope | null>`. What comes off disk is a blob a previous
 * build wrote, and typing the port as though it were already a valid current
 * plan would put the version check in the implementor's honour system — which
 * is precisely the check this module exists to perform.
 */

import {
  type EnvelopeState,
  envelopeFreshness,
  readArtifactEnvelope,
  STUDY_PLAN_KIND,
  type StudyPlanEnvelope,
  studyPlanEnvelope,
} from 'olea-contracts';
import type { StudyPlanStore } from './types.js';

/** Why a persisted blob was not usable — reported, never silently absorbed. */
export type StudyPlanCacheRejection =
  /** Nothing persisted yet: `load` returned `null` or `undefined`. */
  | 'absent'
  /**
   * Present but not a readable current envelope — unknown `envelopeVersion` or
   * `bodyVersion`, the wrong `kind`, a schema mismatch, or a blob in the
   * retired pre-envelope `studyPlanArtifact` shape (which has no
   * `envelopeVersion` field and so fails the same check). See the module doc:
   * every one of these is discarded and rebuilt, never migrated.
   */
  | 'unreadable'
  /**
   * A readable envelope whose `governsForSeconds` horizon has passed
   * (`envelopeFreshness`'s `expired` state). Treated as absent rather than
   * stale-but-usable: the plan is a *governing* artifact, and past this point
   * it is no longer evidence about her current work.
   */
  | 'expired';

export interface LoadCachedStudyPlanResult {
  readonly plan: StudyPlanEnvelope | null;
  /** Present exactly when `plan` is `null`. Distinguishes "never had one" from "had one we cannot read/use". */
  readonly rejection?: StudyPlanCacheRejection;
  /**
   * Present exactly when `plan` is non-null — `envelopeFreshness` evaluated
   * against the `now` this call was given. `state` is `fresh` or `stale`
   * (never `expired`: an expired envelope is reported through `rejection`
   * instead, with `plan: null`, per the module doc).
   */
  readonly freshness?: {
    readonly state: EnvelopeState;
    readonly freshUntil: Date;
    readonly governsUntil: Date;
  };
}

/**
 * Read the cached plan, or report why there isn't one.
 *
 * The two-arm result exists so a caller can log the difference without the
 * function having to choose between throwing and lying. "Never cached" is the
 * ordinary first-run state; "cached but unreadable" is worth a line in the log,
 * because it is the shape a botched format bump takes; "expired" is worth a
 * different line again, because unlike the other two it means a plan *was*
 * being applied and has now aged out.
 *
 * `now` is explicit, never read from a clock in here — same discipline as
 * `build.ts`'s `computedAt` and every other clock-touching seam in this
 * package.
 */
export async function loadCachedStudyPlan(
  store: StudyPlanStore,
  now: Date,
): Promise<LoadCachedStudyPlanResult> {
  const raw = await store.load();
  if (raw === null || raw === undefined) return { plan: null, rejection: 'absent' };

  const read = readArtifactEnvelope(studyPlanEnvelope, STUDY_PLAN_KIND, raw);
  if (read.status !== 'ok') return { plan: null, rejection: 'unreadable' };

  const freshness = envelopeFreshness(read.artifact, now);
  if (freshness.state === 'expired') return { plan: null, rejection: 'expired' };

  return { plan: read.artifact, freshness };
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
  plan: StudyPlanEnvelope,
): Promise<void> {
  await store.save(studyPlanEnvelope.parse(plan));
}
