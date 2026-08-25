/**
 * CHK-1 — component register row 1.5's health check, built.
 *
 * Row 1.5 ("Classify what kind of knowledge it is") names its own check in
 * plain terms: **"the label distribution — the strongest check in the
 * machinery paper. One label on the overwhelming majority is presumed
 * silent failure; zero unclassified is equally suspicious. Written down as
 * an obligation and never implemented."** This is that implementation.
 *
 * `concepts.classify.v1` returns one of three real labels — `fact`,
 * `category`, `principle` — or `unclassified` when its own confidence floor
 * says committing a label would be worse than abstaining (row 1.5,
 * `confidenceFloor`). A classifier that always says the same thing and a
 * classifier that is actually broken and always says the same thing are
 * indistinguishable from a single call; only a batch's *distribution* can
 * tell them apart, which is why this check takes an array of labels rather
 * than one.
 *
 * ## What is checked, and why these two shapes specifically
 *
 * - **A dominant kind at or above {@link DOMINANT_KIND_SHARE_CEILING}.**
 *   Three real, roughly-plausible knowledge kinds covering a real course's
 *   material collapsing onto one label the overwhelming majority of the
 *   time is the classic "always ranks / always labels" failure this whole
 *   bead exists to catch.
 * - **Zero `unclassified` in a batch large enough to expect some.** The
 *   label exists because `confidenceFloor` is meant to fire sometimes; a
 *   batch that never produces it is more likely evidence the floor never
 *   fires (e.g. it is stuck at `0`, or the field is silently dropped
 *   somewhere) than evidence the batch was unusually easy.
 *
 * Both mirror `scripts/modeling/kct/curve.mjs`'s `healthCheck` in
 * `olea-service` **by design, not by coincidence** — that function was
 * written for `KCT-3`'s one-off derivation report ("re-implemented here
 * ONLY so this derivation can report what it would have said — never as a
 * second source of truth") and was never wired up as a check anything could
 * run again. This is the standing version: the shape moves into the shipped
 * client package so it can be pointed at any future batch, not just the one
 * KCT-3 measured once.
 *
 * ## Below the sample floor, this declines rather than guesses
 *
 * Same "not-enough-history" discipline `insights/types.ts` states for the
 * tell-her surfaces, applied here to a classifier batch instead of a review
 * log: fewer than {@link MIN_SAMPLE_FOR_DISTRIBUTION_CHECK} classifications
 * and neither shape is asserted — `ok` is `true`, `measured` still reports
 * what there was.
 */
import type { CheckVerdict } from './types.js';

/**
 * How much of a batch a single real label may cover before the check calls
 * it a collapsed distribution. `0.9` — one label covering nine concepts in
 * ten is comfortably past "one kind happens to be common in this course"
 * and into "this classifier is not discriminating." Copied from
 * `scripts/modeling/kct/curve.mjs`'s `DECLARED.DOMINANT_KIND_SHARE_CEILING`
 * in `olea-service` (`kct-floor.mjs`'s own module doc names it a declared
 * constant this derivation is "also asked to check") — kept in sync by
 * `algorithm-checks.mjs`'s self-test rather than re-derived here, so a
 * change in one place is caught rather than silently diverging.
 */
export const DOMINANT_KIND_SHARE_CEILING = 0.9;

/**
 * Below this many classifications, a distribution is not a distribution —
 * it is a handful of points. Copied from the same source as
 * {@link DOMINANT_KIND_SHARE_CEILING}, for the same reason.
 */
export const MIN_SAMPLE_FOR_DISTRIBUTION_CHECK = 20;

const REAL_LABELS = ['fact', 'category', 'principle'] as const;
export type RealKnowledgeKind = (typeof REAL_LABELS)[number];
export type KnowledgeKindLabel = RealKnowledgeKind | 'unclassified';

export interface KnowledgeKindDistributionMeasured {
  readonly total: number;
  readonly counts: Readonly<Record<RealKnowledgeKind, number>>;
  readonly unclassified: number;
  readonly dominantKind: RealKnowledgeKind | undefined;
  readonly dominantShare: number;
  readonly sampleTooSmall: boolean;
  readonly dominantKindTooHigh: boolean;
  readonly zeroUnclassifiedSuspicious: boolean;
}

/**
 * One batch of `concepts.classify.v1` outputs in, a verdict out. Order is
 * irrelevant — this reads only the multiset of labels.
 */
export function checkKnowledgeKindDistribution(
  labels: readonly KnowledgeKindLabel[],
): CheckVerdict<KnowledgeKindDistributionMeasured> {
  const counts: Record<RealKnowledgeKind, number> = { fact: 0, category: 0, principle: 0 };
  let unclassified = 0;
  for (const label of labels) {
    if (label === 'unclassified') unclassified += 1;
    else counts[label] += 1;
  }

  const total = labels.length;
  let dominantKind: RealKnowledgeKind | undefined;
  let dominantCount = 0;
  for (const kind of REAL_LABELS) {
    if (counts[kind] > dominantCount) {
      dominantCount = counts[kind];
      dominantKind = kind;
    }
  }
  const dominantShare = total === 0 ? 0 : dominantCount / total;
  const sampleTooSmall = total < MIN_SAMPLE_FOR_DISTRIBUTION_CHECK;
  const dominantKindTooHigh = !sampleTooSmall && dominantShare >= DOMINANT_KIND_SHARE_CEILING;
  const zeroUnclassifiedSuspicious = !sampleTooSmall && total > 0 && unclassified === 0;

  const measured: KnowledgeKindDistributionMeasured = {
    total,
    counts,
    unclassified,
    dominantKind,
    dominantShare,
    sampleTooSmall,
    dominantKindTooHigh,
    zeroUnclassifiedSuspicious,
  };

  if (sampleTooSmall) {
    return {
      ok: true,
      measured,
      detail: `fewer than ${MIN_SAMPLE_FOR_DISTRIBUTION_CHECK} classifications (${total}) — declining rather than guessing`,
    };
  }
  if (dominantKindTooHigh) {
    return {
      ok: false,
      measured,
      detail:
        `dominant kind covers ${(dominantShare * 100).toFixed(1)}% of ${total} classifications — ` +
        `at or above the ${(DOMINANT_KIND_SHARE_CEILING * 100).toFixed(0)}% ceiling`,
    };
  }
  if (zeroUnclassifiedSuspicious) {
    return {
      ok: false,
      measured,
      detail: `zero of ${total} classifications came back unclassified — the confidence floor may never fire`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `dominant kind at ${(dominantShare * 100).toFixed(1)}% of ${total}, ${unclassified} unclassified`,
  };
}
