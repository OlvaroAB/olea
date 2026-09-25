/**
 * `studyPlanRefreshDue` — the "the clock schedules the check" half of
 * `[D-167]`'s fingerprint-gated recompute (`ol-egov.141.89.10.17`).
 *
 * `refreshCachedStudyPlan` (`main.ts`) had exactly one call site — `onload`
 * — so a plan built once, cached, and never touched again for the rest of a
 * session: leave Obsidian open across a day boundary and the plan she reads
 * keeps reporting yesterday's due-ness and assessment proximity forever,
 * never reaching A2.5's "recomputes about daily" without a full restart.
 *
 * `[D-167]`'s own text: "the clock schedules a free, local input-delta
 * check ... only a changed fingerprint triggers the remote recompute," and
 * "In practice this recomputes about daily, because due-ness and assessment
 * proximity are functions of the date." This module is that clock, made a
 * pure, testable predicate rather than inline state in `main.ts` — which
 * cannot itself be loaded under Vitest (`obsidian`'s own `package.json`
 * `main` is `""`; see `test/main-wiring.spec.ts`'s module doc for the same
 * constraint on the wiring test this bead adds to).
 *
 * **Deliberately day-boundary only — not a second copy of the deep
 * fingerprint.** The full fingerprint (event log advanced, an item crossed
 * a due boundary, an assessment moved a proximity band, new material
 * landed — every input `plan-policy-fingerprint.ts`'s `planPolicyFingerprint`
 * actually hashes) is already computed, and already gates the one
 * spend-bearing call this chain makes (`plan-policy-wiring.ts`'s
 * `readPlanPolicy`), on every single run of `refreshCachedStudyPlan` —
 * unchanged, not touched by this bead (`plan-policy-wiring.ts` and
 * `plan/provider.ts` are outside this bead's owned paths). What was
 * genuinely missing was a caller for that whole chain anywhere BETWEEN
 * sessions. This module supplies exactly that, at the granularity `[D-167]`
 * itself names as the practical case ("about daily") — never a second,
 * shallower fingerprint of its own. A same-day material change (new
 * material landing mid-session, independent of the date) is not separately
 * scheduled here; see this bead's report for why, and the follow-up it
 * files for a caller-supplied "material landed" signal.
 *
 * **Why the clock alone is cheap enough to poll on every tick.** Comparing
 * two `YYYY-MM-DD` strings is in-memory and instant — no vault read, no
 * network call — which is what makes it honest to evaluate this on
 * `main.ts`'s existing `INGESTION_TICK_INTERVAL_MS` poll (already running
 * "while Obsidian is open" for the ingestion queue) rather than inventing a
 * second timer and a second declared number. The (comparatively) expensive
 * part — `refreshCachedStudyPlan`'s own local vault/review-log walk, plus
 * the gated remote calls it may make — only runs when this predicate
 * actually returns `true`, i.e. about once per calendar day of continuous
 * use, matching the ruling's own framing.
 */

import { localToday } from '../today/data-source.js';

/**
 * `true` when today's local calendar day differs from `lastCheckedDay` — a
 * day boundary has passed since the caller last checked (and, per the
 * contract below, recorded that it checked). `lastCheckedDay === null`
 * means "never checked this session" and always returns `true`.
 *
 * The caller (`main.ts`) is expected to update its own stored
 * `lastCheckedDay` to `localToday(now)` every time this returns `true` — see
 * that call site's own comment — so the very next tick reads `false` again
 * until the day genuinely turns over, rather than firing on every tick for
 * the rest of the day.
 */
export function studyPlanRefreshDue(lastCheckedDay: string | null, now: Date): boolean {
  if (lastCheckedDay === null) return true;
  return localToday(now) !== lastCheckedDay;
}
