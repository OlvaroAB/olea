/**
 * `[JEV-6]` (`ol-3ux7.89`) — the other half of the pointer capture: turning
 * captured pointers back into the assembled context strings Stage J1 scores.
 *
 * **Where this runs.** Not on her machine and not in production. It runs
 * inside the private service repo, against the vault snapshot already
 * tracked and consented there (`olea-service/docs/Obsidian-vault-copy/`,
 * home three on `CLAUDE.md`'s sanctioned-homes list, and already the oracle
 * several privacy guards read from). It lives in this package rather than
 * there because it is client logic — it has to reproduce the client's own
 * context assembly exactly — and because keeping it here makes it testable
 * with no snapshot and no real material at all. **It has no storage, no
 * host, no network and no clock**, and the thing that actually opens notes
 * arrives as `BlockResolver`, which the service-side harness wires. That
 * lane owns the wiring; this module owns the reconstruction.
 *
 * ## The one line that must not drift
 *
 * `resolveGroundedContext` builds the judge's context as
 * `decision.chunks.map((chunk) => chunk.text).join('\n\n')`
 * (`olea-core`, `retrieval/groundedContext.ts`). `joinBlocks` below is that
 * expression and nothing else, so the reconstructed string is byte-identical
 * to what the judge actually received — which is the entire point of §2's
 * "byte-identical assembled context per case". If that join ever changes,
 * this changes with it, and `judge-case-reconstruction.spec.ts` asserts the
 * separator so the drift is a red test rather than a quietly different
 * corpus.
 *
 * ## The snapshot is older than her vault, and that biases the sample
 *
 * The snapshot is a copy taken at a point in time; her vault has moved on.
 * A case whose notes were written or edited after the copy cannot be
 * reconstructed from it, and a case whose note was edited may reconstruct to
 * something that is not what the judge saw.
 *
 * **Unreconstructable cases are dropped and COUNTED, never silently
 * skipped.** `ReconstructionReport` carries the drop count and the reason
 * per dropped case, because the drops are not random with respect to the
 * thing being measured: newer material is exactly what fails to resolve, so
 * the surviving sample is biased toward older notes. That is a limit of the
 * study, it is reported with the result, and it is the reason this function
 * returns a report rather than an array.
 *
 * **What this module cannot detect**, stated because a reader will assume it
 * can: a note that still exists at the same path with the same number of
 * blocks, but whose block text has been edited since capture, resolves
 * cleanly and silently yields a context the judge never saw. Nothing in the
 * captured record could catch that — a content hash would catch it and would
 * also be a derivation of her passage text written on her machine, which the
 * ruling this capture exists under does not permit. So the honest position
 * is: reconstruction detects a missing note and a missing block, and does
 * not detect an edited one. A shorter capture window is the only control
 * available for it, and choosing that window is the study's call.
 */

import type { GroundedChunkRef } from 'olea-core';
import type { CapturedJudgeCase } from './judge-case-capture.js';

/** Exactly `resolveGroundedContext`'s own separator — see the module doc. */
const CONTEXT_SEPARATOR = '\n\n';

export type BlockLookup =
  | { readonly status: 'ok'; readonly text: string }
  /** No note at that path in the snapshot — the typical postdates-the-snapshot case. */
  | { readonly status: 'note-missing' }
  /** The note is there but has no block at that index — an edit that changed the block structure. */
  | { readonly status: 'block-missing' };

/**
 * The injected way to read one block out of the snapshot. Async because the
 * service-side wiring reads files; a port rather than a path so this module
 * never learns where the snapshot is, and so every test below runs on
 * invented fixture text.
 */
export interface BlockResolver {
  lookup(ref: GroundedChunkRef): Promise<BlockLookup>;
}

export type DropReason = 'note-missing' | 'block-missing' | 'no-refs' | 'resolver-failed';

export interface ReconstructedCase {
  readonly caseId: string;
  readonly query: string;
  /** Byte-identical to what the judge received, if and only if the notes are unchanged since capture. */
  readonly context: string;
  readonly intendedOperation?: CapturedJudgeCase['intendedOperation'];
}

export interface DroppedCase {
  readonly caseId: string;
  readonly reason: DropReason;
}

export interface ReconstructionReport {
  readonly reconstructed: readonly ReconstructedCase[];
  readonly dropped: readonly DroppedCase[];
  /** Cases handed in. `reconstructed.length + dropped.length` always equals this — asserted in the spec, because a case that vanished from both would be the silent skip this design forbids. */
  readonly attempted: number;
  /** Breakdown of `dropped` by reason, so the report can say what kind of staleness cost what. */
  readonly droppedByReason: Readonly<Record<DropReason, number>>;
}

function joinBlocks(texts: readonly string[]): string {
  return texts.join(CONTEXT_SEPARATOR);
}

function emptyDropCounts(): Record<DropReason, number> {
  return { 'note-missing': 0, 'block-missing': 0, 'no-refs': 0, 'resolver-failed': 0 };
}

/**
 * Reconstructs every case it can and reports every case it cannot.
 *
 * **A case is all-or-nothing.** One unresolvable ref drops the whole case
 * rather than yielding a short context: a context missing one of its
 * passages is a different case from the one the judge decided, and scoring
 * it would be scoring something that never happened while looking like a
 * successful reconstruction.
 */
export async function reconstructJudgeCases(
  cases: readonly CapturedJudgeCase[],
  resolver: BlockResolver,
): Promise<ReconstructionReport> {
  const reconstructed: ReconstructedCase[] = [];
  const dropped: DroppedCase[] = [];
  const droppedByReason = emptyDropCounts();

  const drop = (caseId: string, reason: DropReason): void => {
    dropped.push({ caseId, reason });
    droppedByReason[reason] += 1;
  };

  for (const captured of cases) {
    if (captured.refs.length === 0) {
      drop(captured.caseId, 'no-refs');
      continue;
    }
    const texts: string[] = [];
    let failure: DropReason | null = null;
    for (const ref of captured.refs) {
      let lookup: BlockLookup;
      try {
        lookup = await resolver.lookup(ref);
      } catch {
        // A resolver that throws is a fact about the reconstruction run, not
        // about her vault, so it gets its own reason rather than being
        // counted as staleness.
        failure = 'resolver-failed';
        break;
      }
      if (lookup.status !== 'ok') {
        failure = lookup.status;
        break;
      }
      texts.push(lookup.text);
    }
    if (failure !== null) {
      drop(captured.caseId, failure);
      continue;
    }
    reconstructed.push({
      caseId: captured.caseId,
      query: captured.query,
      context: joinBlocks(texts),
      ...(captured.intendedOperation !== undefined
        ? { intendedOperation: captured.intendedOperation }
        : {}),
    });
  }

  return { reconstructed, dropped, attempted: cases.length, droppedByReason };
}

/**
 * The freeze-time draw: `n` cases from the held set, uniformly at random and
 * reproducibly from `seed`.
 *
 * The capture's reservoir has already made the held set a uniform sample of
 * the window, so this is a uniform sub-sample of a uniform sample, which is
 * itself uniform over the window. It exists separately because the held set
 * is normally larger than the 100 §3.3 asks for, and because the draw has to
 * be re-runnable from the record alone once the window is closed.
 *
 * Seeded Fisher-Yates on a copy, keyed off `seed` with an offset so the draw
 * never consumes the same values the reservoir did — reusing them would
 * correlate which cases were kept with which are then drawn, and the whole
 * reason both are seeded is to be able to say they are independent.
 */
export function drawJudgeCaseSample(
  cases: readonly CapturedJudgeCase[],
  n: number,
  seed: number,
): readonly CapturedJudgeCase[] {
  const pool = [...cases];
  const take = Math.max(0, Math.min(n, pool.length));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(drawRandom(seed, i) * (i + 1));
    const a = pool[i] as CapturedJudgeCase;
    const b = pool[j] as CapturedJudgeCase;
    pool[i] = b;
    pool[j] = a;
  }
  return pool.slice(0, take);
}

const DRAW_OFFSET = 0x5f37_1d1b;

function drawRandom(seed: number, index: number): number {
  let t = (Math.imul((seed ^ DRAW_OFFSET) | 0, 0x9e3779b1) + Math.imul(index | 0, 0x85ebca6b)) | 0;
  t = (t + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}
