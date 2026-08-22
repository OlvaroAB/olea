/**
 * Per-stage attribution for the oracle driver (`ol-opmb.1` [TB-1], satisfying
 * `ol-v0w4`'s worked example 1 for the zero-spend chain).
 *
 * `StageRecord` is emitted by `./derive.ts`, the driver — never by the pure
 * functions it calls (`rankOracle`, `buildStudyPlan`, `buildGapView`,
 * `computeAllConceptMastery` stay exactly as pure as they already are; see
 * their own module docs). A trace is an observation ABOUT a pipeline run, not
 * a part of the pipeline.
 *
 * ## `couldHaveSucceeded` — the load-bearing field
 *
 * `false` when an upstream stage already lacked what THIS stage would have
 * needed, so this stage's own output — however it looks — could not have
 * been otherwise. The concrete instance this driver computes: `COURSE_QUORBIN`
 * has a registered assessment and zero evidence edges (`curriculum.ts`), so
 * `rankOracle` abstains for it. Every queue item whose only concepts belong to
 * that course therefore cannot receive a plan rank — not because `plan` or
 * `queue` did anything wrong, but because `rank` had nothing to give them.
 * The `queue` stage's record reports that honestly (`couldHaveSucceeded:
 * false, attributedTo: 'rank'`) instead of looking like an unexplained queue
 * defect.
 */

/**
 * `'retrieve'` added `ol-opmb.2` [TB-2]: the query -> hybrid-retrieve ->
 * ground/refuse chain (`./retrieve.ts`), a separate pipeline from the
 * `mastery -> rank -> plan -> gap -> queue` chain above rather than an
 * extra stage appended to it — a query's retrieval has no `asOf` and is not
 * part of a closed loop over one world, so it gets its own single-stage
 * `PipelineTrace` per call. `StageId`/`StageStatus`/`StageRecord`/
 * `recordStage(Async)` are the SAME shapes both chains share (this file's
 * whole point), which is deliberate: a later generative stage can extend
 * this union the same way, on the same `StageRecord` contract, rather than
 * inventing a parallel trace shape (per David's directive that this stage
 * should be something the generative stage can extend, not replace).
 *
 * `'generate'` and `'accept'` added `ol-opmb.3` [TB-3] — exactly the
 * extension the paragraph above anticipated, on the identical
 * `StageRecord` contract. `'generate'` is `./generate.ts`'s cassette-backed
 * call to a generative chat task (`quiz.generate.v1`); when the upstream
 * `'retrieve'` stage refused, `'generate'` still runs — with an empty
 * `sourceChunks` — because that is exactly INV-5's adversarial case, not a
 * skip, and its record carries `couldHaveSucceeded: false, attributedTo:
 * 'retrieve'` rather than being blamed for a refusal it inherited. `'accept'`
 * is INV-6's gate made visible: it never runs automatically after
 * `'generate'` produces candidates — a workbench state only reaches it by
 * dispatching the same click a real user would make (see `main.ts`), and its
 * record is what proves nothing reached an "accepted" shape without that
 * click happening.
 */
export type StageId =
  | 'mastery'
  | 'rank'
  | 'plan'
  | 'gap'
  | 'queue'
  | 'retrieve'
  | 'generate'
  | 'accept'
  // Walkthrough mode only (D-041, `ol-c48c`, `ol-st9i`): the fixture-vault
  // oracle (`oracle/fixture-oracle.ts`) walks the real vault — concept
  // extraction, the Bases assignments read, evidence-edge building and
  // mastery-and-rank composition — in one call (`composeOracleRanking`,
  // `olea-core`) that has no equivalent single stage in the synthetic chain
  // above, which builds a curriculum/corpus as literal data instead of
  // extracting one. `'gap'` and `'plan'` below are shared with that chain
  // unchanged; only the vault walk needed a name of its own.
  | 'compose';
export type StageStatus = 'ok' | 'abstained' | 'empty' | 'threw';

export interface StageRecord {
  readonly stage: StageId;
  readonly status: StageStatus;
  readonly inputSummary: Readonly<Record<string, number | string | boolean | null>>;
  readonly outputSummary: Readonly<Record<string, number | string | boolean | null>>;
  /** See the module doc. `true` unless a specific upstream shortfall is named below. */
  readonly couldHaveSucceeded: boolean;
  /** Set exactly when `couldHaveSucceeded` is `false`. */
  readonly attributedTo: StageId | null;
  readonly durationMs: number;
}

export interface PipelineTrace {
  readonly stages: readonly StageRecord[];
}

/**
 * Times `fn` and wraps its result in a `StageRecord`, so every stage in
 * `./derive.ts` is measured the same way and none can forget to record
 * `durationMs`.
 */
export function recordStage<T>(
  stage: StageId,
  fn: () => T,
  summarise: (result: T) => {
    readonly status: StageStatus;
    readonly inputSummary: Readonly<Record<string, number | string | boolean | null>>;
    readonly outputSummary: Readonly<Record<string, number | string | boolean | null>>;
    readonly couldHaveSucceeded?: boolean;
    readonly attributedTo?: StageId | null;
  },
): { readonly result: T; readonly record: StageRecord } {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  const summary = summarise(result);
  return {
    result,
    record: {
      stage,
      status: summary.status,
      inputSummary: summary.inputSummary,
      outputSummary: summary.outputSummary,
      couldHaveSucceeded: summary.couldHaveSucceeded ?? true,
      attributedTo: summary.attributedTo ?? null,
      durationMs,
    },
  };
}

/** `recordStage`'s async twin — `buildStudyPlan` hashes (`SubtleCrypto`), so it alone is async. */
export async function recordStageAsync<T>(
  stage: StageId,
  fn: () => Promise<T>,
  summarise: (result: T) => {
    readonly status: StageStatus;
    readonly inputSummary: Readonly<Record<string, number | string | boolean | null>>;
    readonly outputSummary: Readonly<Record<string, number | string | boolean | null>>;
    readonly couldHaveSucceeded?: boolean;
    readonly attributedTo?: StageId | null;
  },
): Promise<{ readonly result: T; readonly record: StageRecord }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  const summary = summarise(result);
  return {
    result,
    record: {
      stage,
      status: summary.status,
      inputSummary: summary.inputSummary,
      outputSummary: summary.outputSummary,
      couldHaveSucceeded: summary.couldHaveSucceeded ?? true,
      attributedTo: summary.attributedTo ?? null,
      durationMs,
    },
  };
}
