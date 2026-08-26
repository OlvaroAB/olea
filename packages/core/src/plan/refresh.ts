/**
 * `refreshStudyPlan` — plan §7.1.4's third clause, and nothing more.
 *
 * Reconnection does exactly four things, and one of them is *"the study plan
 * may refresh (pull: mastery out transiently, new versioned plan back,
 * cached)"*. **May.** This function is the whole of that clause: ask the
 * provider, validate what comes back, cache it, and — in every case where any
 * of that does not happen — hand back the plan already on disk.
 *
 * ## It does not throw, and the failure is reported rather than swallowed
 *
 * F7.8 requires cards, review, scheduling and the Today panel to keep working
 * with no AI at all. A refresh that threw would make every caller wrap it, and
 * the first caller that forgot would have a review session that died because the
 * network did. So a provider that throws, hangs up, or returns nonsense yields
 * `source: 'cache'`, `offline: true`, and a `reason` string — reported, so
 * F7.5's honest degradation has something to say, and never silence.
 *
 * The reason string names the failure, never her material: nothing from the
 * provider's payload is copied into it, only the error's own message.
 *
 * ## A bad answer never costs her the plan she already had
 *
 * The validation happens **before** the cache is written, so a provider
 * returning a malformed plan leaves the cached one exactly where it was. That
 * ordering is the one real risk in this file: the obvious implementation —
 * write what came back, then read it — turns one bad response into a lost plan
 * and a Phase A queue on the morning of an exam.
 *
 * ## What it deliberately does not decide
 *
 * *When* to refresh. A2.5 says "periodically (daily, or on material change)";
 * that is a scheduling policy belonging to whatever owns the reconnection event,
 * and core has no clock. This function refreshes when it is called.
 *
 * ## The envelope migration (`[D-122]`, `[BND-3b]`)
 *
 * The plan the provider returns and the plan the cache holds are now both
 * `StudyPlanEnvelope`, read through `readArtifactEnvelope` — the same
 * discard-and-rebuild discipline `cache.ts` uses for the persisted blob, and
 * for the same reason: an envelope this build cannot read (an unknown
 * version, or a blob in the retired pre-envelope `studyPlanArtifact` shape) is
 * never migrated, only rejected. `now` is required, not defaulted, so this
 * module never reads a clock on its own — the caller supplies it, same as
 * every other clock-touching seam in this package.
 */

import { readArtifactEnvelope, STUDY_PLAN_KIND, studyPlanEnvelope } from 'olea-contracts';
import { loadCachedStudyPlan, saveCachedStudyPlan } from './cache.js';
import type { StudyPlanProvider, StudyPlanRefreshResult, StudyPlanStore } from './types.js';

export interface RefreshStudyPlanDeps {
  readonly store: StudyPlanStore;
  /**
   * Omitted when there is no way to reach the Worker — offline, AI features
   * switched off (F7.8), or simply not configured. Omission is a configuration,
   * not a failure, so it produces no `reason`.
   */
  readonly provider?: StudyPlanProvider;
  /**
   * When this refresh runs — explicit, never read from a clock in here (see
   * the module doc). Used only to evaluate the cached envelope's freshness
   * through `loadCachedStudyPlan`; never applied to whatever the provider
   * returns.
   */
  readonly now: () => Date;
}

/** The error's own message, or a description of a thrown non-error. Never carries a payload. */
function describeFailure(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return `provider threw a non-Error value of type ${typeof cause}`;
}

export async function refreshStudyPlan(
  deps: RefreshStudyPlanDeps,
): Promise<StudyPlanRefreshResult> {
  const cached = await loadCachedStudyPlan(deps.store, deps.now());

  if (deps.provider === undefined) {
    return cached.plan === null
      ? { plan: null, source: 'none', offline: true }
      : { plan: cached.plan, source: 'cache', offline: true };
  }

  let reason: string;
  try {
    const raw = await deps.provider.fetchPlan();
    const read = readArtifactEnvelope(studyPlanEnvelope, STUDY_PLAN_KIND, raw);
    if (read.status === 'ok') {
      // Only now, with a valid plan in hand, is the cache touched.
      await saveCachedStudyPlan(deps.store, read.artifact);
      return { plan: read.artifact, source: 'provider', offline: false };
    }
    reason = `provider returned a plan the envelope could not read (${read.reason})`;
  } catch (cause) {
    reason = describeFailure(cause);
  }

  return cached.plan === null
    ? { plan: null, source: 'none', offline: true, reason }
    : { plan: cached.plan, source: 'cache', offline: true, reason };
}
