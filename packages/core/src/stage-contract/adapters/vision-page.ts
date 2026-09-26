/**
 * Writing adapter for the perception chain's page-reading seam
 * (`[ILB-PER-4]`, this bead `ol-egov.141.89.8.4`; `ol-egov.141.89.20`'s own
 * acceptance names `ingestion/vision-page-runner.ts:168` as one of the two
 * plugin seams to adapt, tagged "(writing)"). Pure; `vision-page-runner.ts`
 * itself is not touched, and this file does not import it — `packages/core`
 * never imports `packages/plugin` (INV-1) — so `VisionPageExtractResultShape`
 * below mirrors that file's own `VisionPageExtractResult` structurally,
 * exactly the reasoning `../../concept/revision/` adapters already give for
 * reading the plugin's `MaterialityJudge` result the same way
 * (`revision-judge.ts`'s own module doc: "the plugin's file-level ... returns
 * the same shape field for field ... so this adapter reads its results too,
 * structurally, without core importing the plugin").
 *
 * **No production caller yet** — same posture `ol-egov.141.89.20`'s own close
 * notes record for every adapter it shipped ("production caller: none yet;
 * each chain's wire bead adopts its adapter"). Wiring `vision-page-runner.ts`
 * to actually call this adapter (for example, widening `deps.onManifestEntry`
 * into a `deps.onWritingOutcome`-shaped hook) is a further, separate step —
 * a new consumer surface, not something this adapter's own existence
 * decides — left as a named follow-up (see this bead's report) rather than
 * built unilaterally.
 *
 * **The mapping — a reading, not a check, so most readings are `unverified`,
 * never `checks-passed`.** `vision-page-runner.ts` runs no code checks over
 * an accepted reading today (its own module doc: the INV-5 empty-context
 * guard lives server-side); `writingFromChecks` is still the right call
 * (`writing.ts`'s own doc: "there were no checks at all" is exactly what
 * `unverified` means), so a clean read of a page is `written` with an empty
 * check list, never dressed up as `checks-passed`.
 *
 * - `'unreadable'`, or `'complete'`/`'partial'` with empty `extractedText`
 *   (D-325's figure-only page, or an honestly empty reading): `declined`,
 *   basis `nothing-to-write-from` — nothing textual to write, matching
 *   `readAndLandPage`'s own "no unit invented from nothing" posture. A
 *   figure's own description is never folded into the draft's `text` here
 *   either (D-325: it is Olea's wording, never citable as hers) — carried
 *   on `VisionPageDraft.figureDescription` as its own field instead.
 * - `'complete'`/`'partial'` with non-empty `extractedText`: `written`, an
 *   empty-checks receipt (`unverified`, per the note above).
 * - A failed call (`writingFromVisionPageCallFailure`, below) —
 *   `WorkerVisionPageExtractor.extract` throwing, or the transport itself
 *   failing before any response arrives — is the operational-failure arm,
 *   read through `./worker-failure.js#readWorkerErrorCode` exactly the way
 *   `knowledge-kind.ts`/other Worker-error adapters already do, with the
 *   same `grounding-refused` exception that module's doc states: a task
 *   refusing rather than inventing from empty context (INV-5) is "a success
 *   of the system, not a fault", so a writing step reads it `declined`,
 *   basis `nothing-to-write-from`, never `unavailable`.
 *
 * **Never content (D-005).** `VisionPageDraft.text`/`.figureDescription` are
 * the only content-bearing fields anywhere in this module's output, and
 * both are the draft itself, not the receipt: `writingFromChecks` builds an
 * empty-checks receipt from an empty list, so no draft text ever reaches a
 * check's `note`.
 */

import type { StageUnavailableCause } from '../provenance.js';
import {
  failedCallProvenance,
  type ModelStamp,
  modelProvenance,
  type StageSeamContext,
} from '../provenance.js';
import type { WritingDeclined, WritingOutcome, WritingUnavailable } from '../writing.js';
import { writingFromChecks } from '../writing.js';
import { readWorkerErrorCode } from './worker-failure.js';

/**
 * Mirrors `packages/plugin/src/ingestion/vision-page-runner.ts`'s
 * `VisionPageExtractResult` structurally — see this module's own doc for why
 * mirrored rather than imported (INV-1: core never imports the plugin).
 * `modelId`/`promptVersion` optional for the same reason that file's own
 * doc gives: a test double may answer without a wire stamp to read.
 */
export interface VisionPageExtractResultShape {
  readonly outcome: 'complete' | 'partial' | 'unreadable';
  readonly extractedText: string;
  readonly figureDescription: string | null;
  readonly coverage: string | null;
  readonly unreadableReason: string | null;
  readonly modelId?: string;
  readonly promptVersion?: string;
}

/**
 * What a `'complete'`/`'partial'` reading writes. `figureDescription` is
 * carried apart from `text` on purpose (D-325) — never merged, so a
 * consumer cannot cite it as her material's own words by construction of
 * the type, not just by convention.
 */
export interface VisionPageDraft {
  readonly text: string;
  readonly figureDescription: string | null;
}

/** The context this adapter needs beyond the result itself — no `stamp`: it is read off `result.modelId`/`.promptVersion` directly, since the wire stamp travels on the result, not resolved ahead by the caller. */
export type VisionPageSeamContext = Pick<StageSeamContext, 'seat' | 'taskId' | 'evidenceDigests'>;

function stampOf(result: VisionPageExtractResultShape): ModelStamp | null {
  return result.modelId !== undefined && result.promptVersion !== undefined
    ? { modelId: result.modelId, promptVersion: result.promptVersion }
    : null;
}

/**
 * One settled `vision.extract.v2` reading, as a writing outcome. Never
 * called for a failed call — see `writingFromVisionPageCallFailure` for
 * that arm.
 */
export function writingFromVisionPageExtract(
  result: VisionPageExtractResultShape,
  context: VisionPageSeamContext,
): WritingOutcome<VisionPageDraft> {
  const provenance = modelProvenance({ ...context, stamp: stampOf(result) });

  if (result.outcome === 'unreadable' || result.extractedText.length === 0) {
    // Unreadable, or a `'complete'`/`'partial'` reading with nothing textual
    // (D-325's figure-only page, or an honestly empty one): nothing to
    // write from, not a run failure — see this module's own doc.
    return { kind: 'declined', basis: 'nothing-to-write-from', provenance };
  }

  const draft: VisionPageDraft = {
    text: result.extractedText,
    figureDescription: result.figureDescription,
  };
  // No code checks exist for this reading today — an empty list is honestly
  // `unverified`, never `checks-passed` (writing.ts's own dispositionOf rule).
  return writingFromChecks(draft, [], provenance);
}

/**
 * A call that never reached a settled `VisionPageExtractResult`:
 * `reachedWorker: false` for the transport itself failing before any
 * response arrived (mirrors `vision-page-runner.ts#isUnavailableVisionFailure`'s
 * first arm); `reachedWorker: true` with the Worker's own error `code` for
 * a well-formed refusal or an unusable response (its second arm and every
 * other `WorkerVisionPageExtractorError`).
 */
export interface VisionPageCallFailure {
  readonly reachedWorker: boolean;
  readonly code?: string;
}

/**
 * A failed call to `vision.extract.v2`, as a writing outcome. Reads the
 * Worker's own error code through `readWorkerErrorCode` — the same shared
 * reading every other Worker-error adapter in this directory uses — so
 * `grounding-refused` reaches `declined`/`nothing-to-write-from` rather than
 * `unavailable`, per that function's own doc.
 */
export function writingFromVisionPageCallFailure(
  failure: VisionPageCallFailure,
  context: VisionPageSeamContext,
): WritingDeclined | WritingUnavailable {
  const provenance = failedCallProvenance({ ...context, stamp: null });

  if (!failure.reachedWorker) {
    return { kind: 'unavailable', cause: 'call-failed', provenance };
  }

  const reading = readWorkerErrorCode(failure.code);
  if (reading.kind === 'nothing-to-work-from') {
    return { kind: 'declined', basis: 'nothing-to-write-from', provenance };
  }
  const cause: StageUnavailableCause =
    reading.kind === 'service-refused' ? 'service-refused' : 'malformed';
  return {
    kind: 'unavailable',
    cause,
    ...(reading.kind === 'service-refused' ? { serviceCode: reading.serviceCode } : {}),
    provenance,
  };
}
