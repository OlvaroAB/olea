/**
 * Trigger and scope — the third of the corpus stage's three ruled things
 * (`[D-082]`).
 *
 * **Batch boundaries only, never per document arrival.** A corpus stage
 * triggered on every save re-reads the world on every save, which is
 * precisely the unbounded loop the operational ceiling exists to stop
 * (`[D-052]`: this is a bound on FREQUENCY, legitimately imposed by the
 * ceiling — it is not a cheaper design, and cost did not choose this
 * shape). So this module's input type is deliberately incapable of
 * expressing "a document just arrived": there is no per-document
 * parameter anywhere below, on purpose, so a caller cannot wire this to
 * the per-document ingestion event even by mistake — see
 * `features/F1-sources.md`'s "do not confuse this trigger with the
 * per-document re-extraction trigger" scenario, which this shape makes
 * true by construction rather than by review.
 *
 * **Two boundaries, either fires the batch:** an ingestion session closing,
 * or `N` new concepts having accumulated since the corpus stage last ran.
 *
 * **`N` is a required, undefaulted, DERIVED constant.** Component register
 * row 1.2a: "there is no principled value to state in plain English; it
 * needs a tuning pass." Exactly `../read.js`'s `ConceptReadBudget.maxPassages`
 * pattern — this module declines to have an opinion, so `N` has no default
 * and a caller that omits it is a type error, not a silently-chosen number.
 */

export interface CorpusRelationBatchTriggerInput {
  /** True the moment an ingestion session closes — the first of the two boundaries. */
  readonly ingestionSessionClosed: boolean;
  /**
   * How many concepts have been added to the course's set since the corpus
   * stage last ran for it — never a running lifetime total, and never
   * reset by anything other than this stage actually running.
   */
  readonly newConceptsSinceLastRun: number;
  /**
   * The derived threshold — see this module's doc. Required, no default:
   * a caller that has not derived a value cannot silently fall back to one
   * this module invented.
   */
  readonly n: number;
}

export type CorpusRelationBatchTriggerReason =
  | 'ingestion-session-closed'
  | 'concept-threshold-reached';

export interface CorpusRelationBatchTriggerResult {
  readonly shouldRun: boolean;
  /** Present only when `shouldRun` is true — which boundary fired, for the health check row 1.2a names. */
  readonly reason?: CorpusRelationBatchTriggerReason;
}

/**
 * Decide whether the corpus stage should run NOW, against exactly the two
 * ruled boundaries and nothing else. This function is pure and stateless —
 * the caller owns "since last run" bookkeeping; this module never counts
 * documents, never watches a clock and is never handed anything shaped
 * like a single document event.
 */
export function shouldRunCorpusRelationBatch(
  input: CorpusRelationBatchTriggerInput,
): CorpusRelationBatchTriggerResult {
  if (input.ingestionSessionClosed) {
    return { shouldRun: true, reason: 'ingestion-session-closed' };
  }
  if (input.newConceptsSinceLastRun >= input.n) {
    return { shouldRun: true, reason: 'concept-threshold-reached' };
  }
  return { shouldRun: false };
}
