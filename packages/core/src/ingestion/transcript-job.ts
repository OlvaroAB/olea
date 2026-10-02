/**
 * The `'transcript'` ingestion job kind (`ol-egov.141.89.8.49`; PERSISTENCE
 * 2.7; D-465).
 *
 * A fifth kind beside `source`, `note`, `vision-page` and `instrument-revision`.
 * Payload `{ kind: 'transcript', sourcePath, transcriptFormat }`, the format
 * one of the closed set in `../extract/transcript.ts`. It is a kind, not a fifth
 * value of `SourceFormat`: that field means a paged document, and a fifth value
 * would also offer a transcript for registration as a past paper. The queue
 * envelope stays `version: 1`; `KNOWN_FORMATS` and `SourceFormat` are unchanged.
 *
 * `contentHash` is the bytes hash, `sourceUnitId` is the path, and
 * `workflowVersion` is `TRANSCRIPT_WORKFLOW_VERSION`, kept apart from
 * `EXTRACTION_WORKFLOW_VERSION`.
 *
 * **Unknown values are rejected visibly.** At enqueue (`buildTranscriptEnqueueInput`)
 * an unknown format throws. At drain, a persisted payload of this kind with an
 * unknown or unread format fails, not to be retried, with a reason naming the
 * value. An older build that has no transcript kind passes the payload to
 * `createExtractionJobRunner`, which already fails it as "unrecognised ingestion
 * job payload" without rewriting it; nothing here changes that.
 *
 * Composition mirrors `instrument-revision`: `createTranscriptAwareJobRunner`
 * recognises its own kind and hands everything else to `fallback`.
 */

import {
  describeTranscriptFailure,
  isTranscriptFormat,
  readTranscriptFromVault,
  TRANSCRIPT_READER_VERSION,
  type TranscriptFormat,
  transcriptPartsToUnits,
} from '../extract/transcript.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { VersionedEnqueueInput } from './engine.js';
import type { ExtractedUnitSink } from './extraction-runner.js';
import type { JobRunner, JobRunnerView, JobRunOutcome } from './types.js';

/** Names the reader version a transcript job was queued under. Not `EXTRACTION_WORKFLOW_VERSION`. */
export const TRANSCRIPT_WORKFLOW_VERSION = TRANSCRIPT_READER_VERSION;

export interface TranscriptJobPayload {
  readonly kind: 'transcript';
  readonly sourcePath: VaultPath;
  readonly transcriptFormat: TranscriptFormat;
}

/** Whether a payload is of the transcript kind at all, whatever its format value. */
export function isTranscriptKind(value: unknown): value is {
  readonly kind: 'transcript';
  readonly sourcePath: unknown;
  readonly transcriptFormat?: unknown;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'transcript'
  );
}

/** A well-formed transcript payload: a path and a format from the closed set. */
export function isTranscriptJobPayload(value: unknown): value is TranscriptJobPayload {
  if (!isTranscriptKind(value)) return false;
  return (
    typeof value.sourcePath === 'string' &&
    value.sourcePath.length > 0 &&
    isTranscriptFormat(value.transcriptFormat)
  );
}

/** Builds the enqueue input for a transcript. Throws on a format outside the closed set. */
export function buildTranscriptEnqueueInput(args: {
  readonly sourcePath: VaultPath;
  readonly transcriptFormat: TranscriptFormat;
  readonly contentHash: string;
}): VersionedEnqueueInput {
  if (!isTranscriptFormat(args.transcriptFormat)) {
    throw new Error(`unknown transcript format "${String(args.transcriptFormat)}"`);
  }
  const payload: TranscriptJobPayload = {
    kind: 'transcript',
    sourcePath: args.sourcePath,
    transcriptFormat: args.transcriptFormat,
  };
  return {
    contentHash: args.contentHash,
    label: args.sourcePath,
    payload,
    sourceUnitId: args.sourcePath,
    workflowVersion: TRANSCRIPT_WORKFLOW_VERSION,
  };
}

export interface TranscriptRunnerDeps {
  readonly vault: VaultSource;
  readonly sink: ExtractedUnitSink;
  /** Everything that is not a transcript job (in production, the revision-aware or extraction runner). */
  readonly fallback: JobRunner;
}

/**
 * The queue path's units: `transcriptPartsToUnits` plus the `transcriptPart` provenance marker
 * (D-465, D-466), so a part read through the queue cites by part ("part 3"), never as a page.
 * The part ordinal stays in `page` (the registry reads it as the part number); this reader
 * knows no cue times, so the marker carries no `startSeconds`.
 */
export function transcriptUnitsForQueue(
  sourcePath: VaultPath,
  parts: Parameters<typeof transcriptPartsToUnits>[1],
): ReturnType<typeof transcriptPartsToUnits> {
  return transcriptPartsToUnits(sourcePath, parts).map((unit) => ({
    ...unit,
    provenance: {
      ...unit.provenance,
      location: {
        ...unit.provenance.location,
        transcriptPart: {},
      },
    },
  }));
}

async function runTranscriptJob(
  deps: TranscriptRunnerDeps,
  job: JobRunnerView,
): Promise<JobRunOutcome> {
  const payload = job.payload as { sourcePath?: unknown; transcriptFormat?: unknown };
  if (typeof payload.sourcePath !== 'string' || payload.sourcePath.length === 0) {
    return {
      ok: false,
      retryable: false,
      reason: `transcript job has no source path for ${job.contentHash}`,
    };
  }
  try {
    const result = await readTranscriptFromVault(
      deps.vault,
      payload.sourcePath as VaultPath,
      payload.transcriptFormat,
    );
    if (!result.ok) {
      return { ok: false, retryable: false, reason: describeTranscriptFailure(result) };
    }
    if (result.outcome === 'empty-document') {
      return {
        ok: false,
        retryable: false,
        reason: 'transcript has no readable text (empty-document)',
      };
    }
    await deps.sink.receive(transcriptUnitsForQueue(payload.sourcePath as VaultPath, result.parts));
    return { ok: true };
  } catch {
    // A file removed between enqueue and drain, or a transient read error.
    return { ok: false, retryable: true };
  }
}

/** The composed runner: serves `'transcript'` jobs, defers all else to `deps.fallback`. */
export function createTranscriptAwareJobRunner(deps: TranscriptRunnerDeps): JobRunner {
  return async (job: JobRunnerView): Promise<JobRunOutcome> => {
    if (!isTranscriptKind(job.payload)) return deps.fallback(job);
    return runTranscriptJob(deps, job);
  };
}
