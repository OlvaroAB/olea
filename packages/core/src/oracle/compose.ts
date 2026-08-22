/**
 * `composeOracleRanking` — the one join that turns a vault and a review log
 * into a `RankOracleResult` (P5-T07).
 *
 * `rank.ts`'s own module doc says `rankOracle` is "the whole of F4.2's
 * inspectable ranking… computed with no model call and no network", and its
 * `RankOracleInput` is "typed against the exact result shapes P5-T03 and
 * P4-T06 already produce". Both of those shapes existed, both were tested,
 * and nothing in production called either one to build the third — the gap
 * this bead measured (`ol-p5t07`'s notes, `ol-2tyj`'s discovery): `rankOracle`
 * had no non-test caller anywhere in either repo.
 *
 * This module is that caller, and nothing more. It does not tune a weight, it
 * does not decide a folder default beyond what `evidence-edge/build.ts` and
 * `concept/evidence.ts` already default, and the one thing it cannot default
 * — `basePath`, the Bases assignments table F1.1 reads — it takes as a
 * required argument, exactly as `buildConceptAssessmentEdges` already
 * requires it. No new judgment is exercised here; it composes.
 *
 * ## Which concepts get a mastery lookup, and why not "every concept in the
 * log"
 *
 * Mastery is computed for exactly the concepts `buildConceptAssessmentEdges`
 * found evidence for — the ranking's own universe — rather than for every
 * concept `conceptIdsInLog` finds. A concept she has reviewed but that no
 * assessment cites never appears in a `ConceptPriority` at all (P5-T03's join
 * is course-and-evidence only), so computing its mastery would be work with
 * no reader. A concept with an edge but no review history still gets a real
 * `computeConceptMastery` call and reads `'new'` — which is the correct,
 * *not* `'unknown'`, answer: mastery data was supplied for it, it simply
 * shows no scored evidence yet (see `rank.ts`'s `resolveMasteryState` doc for
 * why those two absences are deliberately different values).
 *
 * ## Cost, and why this is not called on every render
 *
 * `extractTier3Evidence` walks and re-segments her past papers and
 * objectives — real vault I/O, not a cache read. Nothing in this module
 * caches its own result; that is `plan/cache.ts`'s job, one layer up, and is
 * exactly why `StudyPlanStore` exists at all. A caller composing this on
 * every review-session open would re-pay the tier-3 walk every time she
 * opens a card; the intended caller is a `StudyPlanProvider.fetchPlan`
 * implementation invoked through `refreshStudyPlan`'s "may refresh"
 * discipline, not the review session path.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { buildConceptAssessmentEdges } from '../evidence-edge/build.js';
import type {
  BuildConceptAssessmentEdgesOptions,
  BuildConceptAssessmentEdgesResult,
} from '../evidence-edge/types.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import { computeAllConceptMastery } from '../mastery/rollup.js';
import type { VaultSource } from '../vault/types.js';
import { rankOracle } from './rank.js';
import type { RankOracleOptions, RankOracleResult } from './types.js';

export interface ComposeOracleRankingInput extends BuildConceptAssessmentEdgesOptions {
  readonly vault: VaultSource;
  /**
   * The whole review log, already read. This module does no vault I/O for
   * it — the callers that have one differ on how they got there (a full
   * history read for a background refresh, a session's own read for a
   * harness), and re-reading it here would be a second, possibly
   * inconsistent, read of the same files.
   */
  readonly reviewLog: readonly ReviewLogEntry[];
  /** The calendar day exam proximity is measured from — passed straight to `rankOracle`. */
  readonly asOf: string;
  readonly options?: RankOracleOptions;
}

export interface ComposeOracleRankingResult {
  readonly ranking: RankOracleResult;
  /**
   * `buildConceptAssessmentEdges`'s full result, passed through — `ol-2tyj`'s
   * gap and coverage views need `tier3.sourcesReport` for `ol-cvsc`'s
   * coverage scope, and re-running the tier-3 walk a second time to get it
   * would defeat the point of composing it once here.
   */
  readonly edges: BuildConceptAssessmentEdgesResult;
  /**
   * The mastery map this composition already builds for `rankOracle`,
   * passed through — `buildGapView`'s `mastery` input is keyed exactly the
   * same way (by `ConceptAssessmentEdge.conceptName`), and re-deriving it a
   * second time from the same review log would be a second, possibly
   * inconsistent, computation of the same thing. Additive: existing callers
   * that only read `ranking`/`edges` are unaffected.
   */
  readonly mastery: ReadonlyMap<string, ConceptMasteryResult>;
}

/**
 * Build a fresh `RankOracleResult` from a vault and a review log.
 *
 * No cache, no clock read here (`asOf` is the caller's, same discipline as
 * `rankOracle` itself) — this is the vault-and-log-in, ranking-out
 * composition and nothing about *when* to call it or *where to keep* what it
 * returns.
 */
export async function composeOracleRanking(
  input: ComposeOracleRankingInput,
): Promise<ComposeOracleRankingResult> {
  const { vault, reviewLog, asOf, options, ...edgeOptions } = input;
  const edges = await buildConceptAssessmentEdges(vault, edgeOptions);

  const conceptNames = [...new Set(edges.edges.map((edge) => edge.conceptName))].sort();
  const mastery = computeAllConceptMastery(reviewLog, conceptNames);

  const ranking = rankOracle({
    evidence: {
      edges: edges.edges,
      assessmentsRead: edges.assessmentsRead,
      assessmentsWithNoEvidence: edges.assessmentsWithNoEvidence,
    },
    mastery,
    asOf,
    ...(options !== undefined ? { options } : {}),
  });

  return { ranking, edges, mastery };
}
