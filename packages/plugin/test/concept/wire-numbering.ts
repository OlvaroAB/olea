/**
 * The `result.numbering` a Worker returns with `concepts.extract.v1` (`ol-egov.141.89.3.32`), for
 * the fake transports that stand in for it.
 *
 * The real Worker numbers only the passages it shows the model and reports which sent position each
 * shown number stands for; `WorkerConceptReader` resolves every cited number through that report and
 * refuses a response without it. A fake transport that scripts concepts therefore has to say how its
 * imagined Worker numbered the batch. These fixtures' passages are all prose, so their Worker shows
 * every one of them and number k is position k, which is what this returns. A test about a Worker
 * that drops furniture-only chunks scripts its own numbering (`workerConceptReader.spec.ts`).
 */
import type { WorkerTaskRequest } from 'olea-core';

export function numberingShownInFull(request: WorkerTaskRequest): {
  readonly chunks: readonly { readonly sentIndex: number; readonly length: number }[];
} {
  const sourceChunks = (request.payload as { sourceChunks: readonly string[] }).sourceChunks;
  return { chunks: sourceChunks.map((chunk, i) => ({ sentIndex: i + 1, length: chunk.length })) };
}
