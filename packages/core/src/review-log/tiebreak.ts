/**
 * The comparable-observation-disagreement half of C5.10 ruling 1's narrow
 * tiebreak (`[D-265]`, `ol-egov.141.62`, the producer bead for
 * `ol-egov.141.52`'s mechanism in `../oracle/rank.ts`).
 *
 * `../oracle/rank.ts`'s own module doc is explicit that
 * `RankOracleTiebreakInput.tiebreakEligible` is a fact "a caller has already
 * determined," and that telling a genuine unexplained disagreement apart
 * from an ordinary probabilistic pattern needs data `oracle/` is never
 * handed — review-log history. This module is that reading, over ONE half
 * of the clause's own words (`docs/Olea_alpha_functional_scope.md` C5.10):
 * "a concept whose recent recall observations disagree — comparable in
 * tier, support level shown, source version and recency, with nothing in
 * the record explaining the split." The other half — "a different eligible
 * ordinary instrument on the concept exists" — is
 * `../routing/instrument-eligibility.ts`; `../oracle/compose.ts` folds both
 * into the one flag `rankOracle` reads.
 *
 * ## What "disagree" means here, narrowly
 *
 * The clause's own worked examples rule out the easy false positives: "a
 * recall success followed by a failure on a harder instrument is not a
 * conflict" (different tier — never even compared here, see below), and
 * "two successes and a failure are consistent with any probabilistic recall
 * model" (a lone outlier deep in an otherwise-tidy run is not a split).
 * This module reads "recent recall observations disagree" as narrowly as
 * `rank.ts`'s own tiebreak mechanism reads "may be served first": only the
 * TWO MOST RECENT observations that are actually comparable to each other
 * (same tier, same shown support level, same source version, both recent)
 * are ever compared — never a whole history, never a lone outlier several
 * reviews back paired against today's review just because both happen to
 * exist. Explain-back is excluded outright: it produces no rating
 * (`olea-contracts`' `instrumentType` doc) and is never FSRS-scheduled, so
 * it is not a "recall observation" in this clause's sense at all.
 *
 * ## Source version: a known, explicit gap, not a silent assumption
 *
 * Comparability needs four things to hold at once, and `ReviewLogRecordV5`
 * (`olea-contracts`) carries data for three of them today: `instrumentType`
 * (tier), `supportLevelShown` (support level shown — optional; absent means
 * "not recorded," never defaulted to `'independent'`), and `timestamp`
 * (recency). It carries NOTHING for the fourth: no field anywhere in the
 * review-log schema records which revision of an instrument's source
 * material a review was read against (confirmed against every kind in the
 * v5 union, including `sourceRegisteredLogRecordV5`, which names a
 * document's role and course, never a revision marker).
 *
 * `resolveSourceVersion` below is therefore an OPTIONAL caller input,
 * following the exact shape `../oracle/compose.ts`'s
 * `ComposeRetrievabilityInput` already uses for an analogous gap
 * (`RankOracleInput.retrievability`'s own doc: "Known gap (reachability...):
 * nothing supplies this today"). Omitted — as every caller does today,
 * since nothing in `review-log/`, `routing/` or `ingestion/materiality/`
 * produces a per-review source-version stamp yet — every comparison reads
 * source version as UNKNOWN for both observations. This module's rule for
 * a dimension it cannot establish is the same one this bead's own text
 * states for a different missing field (hint use, proposed by `[D-350]`,
 * not yet a review-log field either): **unknown is never comparable, and
 * this is said here rather than worked around.** So until a real producer
 * is wired for this one field, `findComparableObservationDisagreements` can
 * never report a disagreement for ANY concept — not because the mechanism
 * is broken, but because one of the clause's own four required facts does
 * not exist in the log yet. This is a reachability gap, exactly the shape
 * `retrievability`'s own field carried before `ol-95vv.1` wired it, stated
 * here rather than quietly treated as "same version" by default (which
 * would risk firing a narrow tiebreak — never a re-weighting, but still not
 * nothing — on a split a source revision might fully explain).
 */

import type { InstrumentType, Rating, ReviewLogEntry, SupportLevel } from 'olea-contracts';
import { daysBetween } from '../dates.js';

/**
 * DECLARED (not derived — n=1 cannot fit this, the same register test
 * `../oracle/rank.ts`'s own declared fallbacks apply, e.g.
 * `DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS`). **Plain-English defence:**
 * a recall observation is still live evidence about what her memory shows
 * right now for about two weeks; further back, whatever she has done in
 * between is itself already the kind of explanation the clause's "nothing
 * in the record explaining the split" rules out, so an old observation is
 * never held against a fresh one. No corpus behind this number, and none is
 * needed to defend it — see `docs/design/component-baseline.md`'s
 * declared/derived line (service repo).
 */
export const DECLARED_RECENT_OBSERVATION_WINDOW_DAYS = 14;

/** The ordinary, FSRS-scheduled instrument types — excludes `explain-back` (see module doc). */
const ORDINARY_TIER_TYPES: ReadonlySet<InstrumentType> = new Set(['qa', 'cloze', 'mcq']);

type OrdinaryInstrumentType = Exclude<InstrumentType, 'explain-back'>;

interface RecallObservation {
  readonly conceptKey: string;
  readonly instrumentId: string;
  readonly instrumentType: OrdinaryInstrumentType;
  readonly supportLevelShown: SupportLevel | undefined;
  readonly success: boolean;
  readonly instant: number;
  readonly eventId: string;
}

/** `'again'` is the FSRS log's only failure rating (`olea-contracts`' `rating` doc); every other value is a success. Restated here rather than imported from `../mastery/rollup.ts`, which is outside this bead's owned files. */
function isSuccessRating(rating: Rating): boolean {
  return rating !== 'again';
}

function collectObservations(entries: readonly ReviewLogEntry[]): readonly RecallObservation[] {
  const observations: RecallObservation[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (entry.rating === null) continue; // explain-back, or an unrated review — not a recall observation
    if (!ORDINARY_TIER_TYPES.has(entry.instrumentType)) continue;
    const instant = Date.parse(entry.timestamp);
    if (Number.isNaN(instant)) continue;
    for (const conceptKey of entry.conceptIds) {
      observations.push({
        conceptKey,
        instrumentId: entry.instrumentId,
        instrumentType: entry.instrumentType as OrdinaryInstrumentType,
        supportLevelShown: entry.supportLevelShown,
        success: isSuccessRating(entry.rating),
        instant,
        eventId: entry.eventId,
      });
    }
  }
  return observations;
}

/** An observation with every comparability field resolved to a concrete, known value — see module doc for why `supportLevelShown`/source version being unknown drops an observation out of comparison entirely rather than matching it loosely. */
interface QualifyingObservation extends RecallObservation {
  readonly supportLevelShown: SupportLevel;
  readonly sourceVersion: string;
}

function qualify(
  observation: RecallObservation,
  resolveSourceVersion: ((instrumentId: string) => string | undefined) | undefined,
): QualifyingObservation | undefined {
  if (observation.supportLevelShown === undefined) return undefined;
  if (resolveSourceVersion === undefined) return undefined;
  const sourceVersion = resolveSourceVersion(observation.instrumentId);
  if (sourceVersion === undefined) return undefined;
  return { ...observation, supportLevelShown: observation.supportLevelShown, sourceVersion };
}

/** Groups only on the dimensions the clause requires equal for comparability: tier, support level shown, source version. Recency is checked afterwards, pairwise, against `asOf`. */
function clusterKey(observation: QualifyingObservation): string {
  return `${observation.instrumentType}\u0000${observation.supportLevelShown}\u0000${observation.sourceVersion}`;
}

function compareByRecencyDesc(a: QualifyingObservation, b: QualifyingObservation): number {
  if (a.instant !== b.instant) return b.instant - a.instant;
  // Same ordering discipline as `./suspension.ts`'s `(instant, eventId)` fold,
  // so two callers reading the same merged log always agree on "most recent."
  return b.eventId.localeCompare(a.eventId);
}

export interface ComparableObservationDisagreementInput {
  readonly entries: readonly ReviewLogEntry[];
  /** The calendar day recency is measured from, `YYYY-MM-DD` — same discipline as `RankOracleInput.asOf`: explicit, never read from a clock in this module. */
  readonly asOf: string;
  /**
   * Optional producer for a review's source-version marker, keyed by
   * `instrumentId`. **Omit — as every caller does today** — to read source
   * version as unknown for every observation, which this module's rule
   * (see module doc) means no disagreement is ever reported. Supplying one
   * is future work for whichever bead wires `ingestion/materiality/`'s
   * citation-revision state through to a per-review stamp; nothing in
   * `review-log/` or `routing/` produces one yet.
   */
  readonly resolveSourceVersion?: (instrumentId: string) => string | undefined;
}

/** One concept whose two most recent comparable recall observations disagree, with nothing in the record (as read by this module) explaining the split. */
export interface ComparableObservationDisagreement {
  readonly conceptKey: string;
  /** The instrument id(s) whose disagreeing observations triggered this — `../routing/instrument-eligibility.ts` excludes exactly these when asking whether a DIFFERENT eligible ordinary instrument exists. */
  readonly disagreeingInstrumentIds: ReadonlySet<string>;
}

const CALENDAR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads the review log for concepts whose two most recent comparable recall
 * observations disagree, per C5.10 ruling 1's own words. Pure: the same
 * `entries`/`asOf`/`resolveSourceVersion` always produce the same result,
 * no clock read, no I/O.
 *
 * **This is one half of the tiebreak's eligibility test.** A concept
 * appearing here is not yet tiebreak-eligible — `../oracle/compose.ts`
 * additionally requires `../routing/instrument-eligibility.ts`'s
 * `hasDifferentEligibleOrdinaryInstrument` to hold, per the clause's own
 * "only where a different eligible ordinary instrument on the concept
 * exists to resolve it."
 */
export function findComparableObservationDisagreements(
  input: ComparableObservationDisagreementInput,
): ReadonlyMap<string, ComparableObservationDisagreement> {
  const result = new Map<string, ComparableObservationDisagreement>();
  if (!CALENDAR_DAY_RE.test(input.asOf)) return result;
  const asOfInstant = Date.parse(`${input.asOf}T00:00:00.000Z`);
  if (Number.isNaN(asOfInstant)) return result;
  const asOfDate = new Date(asOfInstant);

  const byConcept = new Map<string, RecallObservation[]>();
  for (const observation of collectObservations(input.entries)) {
    const list = byConcept.get(observation.conceptKey);
    if (list === undefined) byConcept.set(observation.conceptKey, [observation]);
    else list.push(observation);
  }

  for (const [conceptKey, observations] of byConcept) {
    const qualifying = observations
      .map((observation) => qualify(observation, input.resolveSourceVersion))
      .filter((observation): observation is QualifyingObservation => observation !== undefined);

    const byCluster = new Map<string, QualifyingObservation[]>();
    for (const observation of qualifying) {
      const key = clusterKey(observation);
      const list = byCluster.get(key);
      if (list === undefined) byCluster.set(key, [observation]);
      else list.push(observation);
    }

    const disagreeingInstrumentIds = new Set<string>();
    for (const cluster of byCluster.values()) {
      const sorted = cluster.slice().sort(compareByRecencyDesc);
      const latest = sorted[0];
      const second = sorted[1];
      if (latest === undefined || second === undefined) continue; // need two to disagree
      if (latest.success === second.success) continue; // tidy — no split to explain
      const latestDays = daysBetween(new Date(latest.instant), asOfDate);
      const secondDays = daysBetween(new Date(second.instant), asOfDate);
      const bothRecent =
        latestDays >= 0 &&
        latestDays <= DECLARED_RECENT_OBSERVATION_WINDOW_DAYS &&
        secondDays >= 0 &&
        secondDays <= DECLARED_RECENT_OBSERVATION_WINDOW_DAYS;
      if (!bothRecent) continue;
      disagreeingInstrumentIds.add(latest.instrumentId);
      disagreeingInstrumentIds.add(second.instrumentId);
    }

    if (disagreeingInstrumentIds.size > 0) {
      result.set(conceptKey, { conceptKey, disagreeingInstrumentIds });
    }
  }

  return result;
}
