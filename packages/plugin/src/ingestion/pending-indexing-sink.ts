/**
 * `PendingIndexingSink` — the plugin's current `ExtractedUnitSink`
 * (`olea-core`'s `ingestion/extraction-runner.ts`) implementation
 * (C3, P3-T03a / DF-21a).
 *
 * `ExtractedUnitSink`'s own module doc names its real destination in one
 * line: "the plugin's real implementation forwards to indexing (C2/C3, out
 * of this bead's scope)". That real destination — embeddings + hybrid
 * retrieval, content-hash keyed (C2.3/C2.5, cost model §5) — is P3-T05, and
 * P3-T05 has not landed. Building that consumer here would mean this bead
 * inventing C2.3/C2.5's storage shape unilaterally, in the plugin package,
 * ahead of the task the plan actually assigns it to — exactly the kind of
 * silent feature invention CLAUDE.md's authority-order section warns
 * against.
 *
 * So this is deliberately the narrowest honest thing that satisfies DF-21a's
 * "a real sink" (not a test-only stub that just gets thrown away): every
 * unit a drained job produces is captured, addressable by source path, so
 * `createExtractionJobRunner` composes with a real, running plugin end to
 * end and a drained job's output is inspectable. It is **not** persisted to
 * `data.json` — an ever-growing, unconsumed archive of full lecture text is
 * not a cache worth surviving a restart (unlike the keyword index or the
 * ingestion queue, there is no rebuild story for this data yet, so keeping
 * it only in memory costs nothing beyond what content-hash idempotent
 * re-extraction, D-002, can already recover: nothing here is the only copy
 * of anything — the vault is). Whichever task builds C2.3/C2.5's real
 * consumer supplies its own `ExtractedUnitSink` and this class simply stops
 * being constructed in `wiring.ts` — no interface changes required, exactly
 * what a structural port is for.
 */

import type { ExtractedUnit, ExtractedUnitSink } from 'olea-core';

export class PendingIndexingSink implements ExtractedUnitSink {
  private readonly bySource = new Map<string, ExtractedUnit[]>();

  async receive(units: readonly ExtractedUnit[]): Promise<void> {
    for (const unit of units) {
      const key = unit.provenance.sourcePath;
      const existing = this.bySource.get(key);
      if (existing) existing.push(unit);
      else this.bySource.set(key, [unit]);
    }
  }

  /** Every unit received so far, across every source, in receive order. */
  all(): readonly ExtractedUnit[] {
    return [...this.bySource.values()].flat();
  }

  /** Units received for one source path, in receive order; empty if that source has produced nothing (yet). */
  forSource(sourcePath: string): readonly ExtractedUnit[] {
    return this.bySource.get(sourcePath) ?? [];
  }
}
