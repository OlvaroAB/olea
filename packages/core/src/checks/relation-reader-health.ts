/**
 * `ol-mdvy` — component register rows 1.2 ("Work out how they relate — same
 * document") and 1.2a ("...across documents") share one named health check,
 * stated in the register in the row's own words: **"the ruling's own test —
 * for each type, does a real downstream reader fire non-trivially on real
 * material."** `[D-070 / REL-2]` is what names a reader for each of the six
 * ruled types (`../concept/relation.js`'s module doc restates the per-type
 * argument); this module is that test made checkable, in the same
 * "check compares, a harness runs" split every file in this directory
 * follows (`./mastery-stage-health.ts`, `./misconception-merge-boundary.ts`).
 *
 * **What "fires" means here, precisely.** A relation edge of some type was
 * produced (by the per-document stage, `../concept/read.js`, for `is-a`/
 * `part-of`; by the corpus stage, `../concept/corpus-relations/batch.js`, for
 * `prerequisite`/`contrasts-with`) and a *named, already-wired* production
 * consumer visibly changed its output because of it. Producing an edge that
 * is folded (`../concept/relation.js`'s `deriveRelationSet`) and then held —
 * never read again by anything — is exactly the silent failure this check
 * exists to catch: the pipeline always looks like it worked, because folding
 * an edge is not itself a proof anyone downstream consumes it.
 *
 * **This module is pure and does no I/O**, per `./types.ts`'s own rule: it
 * takes already-computed observations — did an edge of this type get
 * produced, and did the reader's output change — and returns a verdict.
 * Producing the observations (running the real per-document stage against a
 * fixture vault and fixture port; running the real corpus batch against
 * fixture concepts and a fixture verdict port; checking whether anything
 * production-reachable reads the result) is the harness script's job:
 * `olea-service`'s `scripts/harness/relation-reader-check.mjs`.
 *
 * ## The audited answer this check currently reports (2026-08-26)
 *
 * Both stages are built and reachable in production
 * (`packages/plugin/src/main.ts`'s `tickIngestionAndMaybeRunCorpusRelations`,
 * via `readConceptsAndRelations`). That is not what this check measures —
 * reachability alone was already the subject of `[D-072]`'s clause 5. What
 * this check adds is the layer above reachability: of the four relation
 * types either row can emit today —
 *
 * - **`is-a`, `part-of`** — the per-document stage's `applyContainmentEvidence`
 *   (`../concept/read.js`, unexported, exercised through `readConcepts`)
 *   folds a produced edge into its target concept's `size.extent.
 *   containmentEvidence` in the very same pass, which component size (row
 *   1.3) reads. **A real downstream reader fires.**
 * - **`contrasts-with`, `prerequisite`** — the corpus stage produces these
 *   for real once its trigger fires, and `deriveRelationSet` folds them into
 *   `OleaPlugin.relations`. **Nothing production-reachable reads that field
 *   afterwards**: the misconception store's confusion pairing and 3.3's
 *   ordering are named in this register and in code comments
 *   (`../mastery/rollup.ts`) but neither imports `ConceptRelation` or reads
 *   a `RelationSet` anywhere. **No real downstream reader fires** — the
 *   edges are produced and discarded, the exact silent-failure shape this
 *   check exists to name.
 *
 * A check that reported only "the stage ran" would call all four types
 * healthy. This one does not, and is not expected to go green on
 * `contrasts-with`/`prerequisite` until a consumer bead lands — see
 * `./mastery-stage-health.ts`'s own doc for the precedent: a check naming a
 * real, already-known gap rather than hiding it is the point, not a bug in
 * the check.
 */
import type { CheckVerdict } from './types.js';

/**
 * One relation type's observation for one run: how many edges of this type
 * a real producer emitted, and whether a real, already-wired consumer's
 * output changed because of at least one of them. `readerName` is a plain
 * label (never a concept name, never her wording — INV-3) identifying which
 * named reader was checked, for the detail string only.
 */
export interface RelationReaderObservation {
  readonly type: string;
  readonly readerName: string;
  readonly edgesProduced: number;
  readonly readerFired: boolean;
}

export interface RelationReaderHealthMeasured {
  readonly n: number;
  /** Types with `edgesProduced > 0` where `readerFired` was also true. */
  readonly firing: readonly string[];
  /** Types with `edgesProduced > 0` but `readerFired` false — edges produced, nothing downstream reads them. */
  readonly silent: readonly string[];
  /** Types with `edgesProduced === 0` — nothing was produced to test a reader against, reported rather than silently dropped. */
  readonly untested: readonly string[];
}

/**
 * One observation per relation type in, a verdict out. Fails on ANY type
 * that produced at least one edge but whose named reader did not fire, or
 * if zero observations were supplied (N-013: a check that ran nothing
 * cannot pass). A type with zero edges produced never fails the check on
 * its own — there is nothing yet to ask a reader to read — but is reported
 * in `untested` rather than silently folded into `firing`.
 */
export function checkRelationReaderFires(
  observations: readonly RelationReaderObservation[],
): CheckVerdict<RelationReaderHealthMeasured> {
  const firing: string[] = [];
  const silent: string[] = [];
  const untested: string[] = [];

  for (const observation of observations) {
    if (observation.edgesProduced === 0) {
      untested.push(observation.type);
    } else if (observation.readerFired) {
      firing.push(observation.type);
    } else {
      silent.push(observation.type);
    }
  }

  const measured: RelationReaderHealthMeasured = {
    n: observations.length,
    firing,
    silent,
    untested,
  };

  if (observations.length === 0) {
    return { ok: false, measured, detail: 'zero observations supplied — nothing was checked' };
  }
  if (silent.length > 0) {
    const named = observations
      .filter((o) => silent.includes(o.type))
      .map((o) => `${o.type} (reader: ${o.readerName})`)
      .join(', ');
    return {
      ok: false,
      measured,
      detail: `${silent.length} of ${observations.length} type(s) produced edges no wired reader consumed: ${named}`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `every type that produced an edge (${firing.length}) had a real downstream reader fire (${untested.length} type(s) produced nothing to test)`,
  };
}
