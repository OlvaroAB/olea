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
 * `computeConceptMastery` call and reads `'seed'` — which is the correct,
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
import type { ConceptRecord } from '../concept/types.js';
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
   * same way (by `ConceptAssessmentEdge.conceptKey`, the opaque join key —
   * `ol-63e1`), and re-deriving it a second time from the same review log
   * would be a second, possibly inconsistent, computation of the same thing.
   * Additive: existing callers that only read `ranking`/`edges` are
   * unaffected.
   */
  readonly mastery: ReadonlyMap<string, ConceptMasteryResult>;
}

/**
 * Case-insensitive, course-scoped fallback for the exact-match name→key
 * lookup `buildConceptAssessmentEdges` performs internally
 * (`evidence-edge/build.ts`'s `conceptKeyByName`, `ol-63e1`).
 *
 * **The bug this closes (`ol-5y40`).** A `topic:` value that does not
 * byte-match its note's exact Zettelkasten title is the ORDINARY case, not
 * an exotic one — tier-2 extraction mints the `ConceptRecord` under the
 * topic's own casing (R1/R2 forbid folding it there), while
 * `extractTier3Evidence`'s vocabulary match returns the edge's `conceptName`
 * in the *Zettelkasten note title's* casing (R2 — matched case-insensitively,
 * returned verbatim in the vocabulary's own casing). The exact-match lookup
 * then misses and the edge falls back to its own `conceptName` as the key
 * (see `ConceptAssessmentEdge.conceptKey`'s doc) — a value that never
 * matches `buildMaterialPresence`'s map (`gap/build.ts`, keyed by the real
 * `ConceptRecord.key`), so a concept she genuinely has notes on
 * misclassifies as `'material-gap'` (F4.10): the single most
 * trust-damaging thing that screen can say, said silently.
 *
 * **Scoped narrowly to this composition seam, per the bead's acceptance
 * criteria — this is not a case-folding of concept identity.** `extract.ts`
 * is untouched: two topic strings differing only by case still mint two
 * distinct `ConceptRecord`s (R1/R2), and this function never merges their
 * evidence. It only ever fires for an edge whose exact-match lookup already
 * failed (`edge.conceptKey === edge.conceptName` is the *only* way that can
 * happen — a real key always carries `concept-prov1:`, never a bare display
 * name), and it resolves on `(course, lowercased name)`, never name alone —
 * so a same-named concept in a *different* course is never pulled in, and a
 * genuine collision (two records, same course, same name, differing only by
 * case) picks the extraction-order-first one deterministically rather than
 * silently merging two identities. A term absent from `concepts`, in every
 * casing, for this course, is left exactly as `buildConceptAssessmentEdges`
 * resolved it — that is a true material-gap, not a residue of this join.
 */
function resolveCaseInsensitiveConceptKeys(
  edges: BuildConceptAssessmentEdgesResult,
  concepts: readonly ConceptRecord[],
): BuildConceptAssessmentEdgesResult {
  const keyByCourseAndLowerName = new Map<string, string>();
  for (const concept of concepts) {
    for (const course of concept.courses) {
      const fallbackKey = `${course}::${concept.name.toLowerCase()}`;
      // First concept wins on a same-course/same-casefold collision
      // (extraction order) — deterministic, and this seam's job is ordinary
      // topic-casing slips, not adjudicating a genuine name collision.
      if (!keyByCourseAndLowerName.has(fallbackKey)) {
        keyByCourseAndLowerName.set(fallbackKey, concept.key);
      }
    }
  }

  return {
    ...edges,
    edges: edges.edges.map((edge) => {
      if (edge.conceptKey !== edge.conceptName) return edge; // already a real key
      const resolvedKey = keyByCourseAndLowerName.get(
        `${edge.course}::${edge.conceptName.toLowerCase()}`,
      );
      return resolvedKey === undefined ? edge : { ...edge, conceptKey: resolvedKey };
    }),
  };
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
  const rawEdges = await buildConceptAssessmentEdges(vault, edgeOptions);
  // `ol-5y40`: repairs the case-mismatched fallback `buildConceptAssessmentEdges`
  // leaves behind before anything downstream (the mastery join below,
  // `rankOracle`'s grouping, `buildMaterialPresence`'s lookup) ever sees it.
  const edges = resolveCaseInsensitiveConceptKeys(rawEdges, edgeOptions.concepts);

  // Keyed by the opaque join key, not the display name (`ol-63e1`) — this is
  // exactly the value `session/enumerate.ts` now mints into a review-log
  // record's `conceptIds`, so this is the join that used to silently miss
  // every entry before the coordinated flip.
  const conceptKeys = [...new Set(edges.edges.map((edge) => edge.conceptKey))].sort();
  const mastery = computeAllConceptMastery(reviewLog, conceptKeys);

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
