/**
 * Barrel for `[CORP-3]` (`ol-2zfj.2`) — see `types.ts`'s module doc for the
 * scope this directory covers and does not cover.
 *
 * **Not yet re-exported from `packages/core/src/index.ts`.** That file is a
 * shared surface many lanes append to concurrently; this bead's OWNS is
 * scoped to `ingestion/` and this new directory only, so the one export
 * line this needs is left as a diff in the bead's close notes rather than
 * applied here. Until that line lands, this module has an import path
 * (`olea-core/concept/revision/index.js`-shaped, once built) but no
 * production caller — the named D-072 reachability gap.
 */

export type { InstrumentRevisionJobPayload } from './enqueue.js';
export { buildSuccessorRevisionEnqueueInput } from './enqueue.js';
export { evaluateCitedPassageRevision } from './material-change.js';
export type { RelocationMatch } from './relocate.js';
export {
  classifyRelocation,
  normalizeWhitespace,
  RELOCATION_NEAR_MATCH_FLOOR,
} from './relocate.js';
export type {
  CitedPassageInput,
  CitedPassageRevisionOutcome,
  CurrentPassageState,
  RelocationCandidate,
  RevisionEvent,
  RevisionJudgeInput,
  RevisionJudgePort,
  RevisionJudgeVerdict,
} from './types.js';
