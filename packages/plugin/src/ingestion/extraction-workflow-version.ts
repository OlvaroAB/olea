/**
 * D-381 (`ol-egov.141.89.5.18`; chg.md §11's cache-key audit, row 1) —
 * the `workflowVersion` `process-now.ts` and `arrival-watch.ts` both pass
 * into `IngestionQueueEngine.enqueue` for a raw embedded-source ('source'
 * kind) job.
 *
 * **What the audit found.** A `PersistedJob` for a PDF/PPTX/DOCX/image is
 * keyed on `contentHash` alone (`packages/core/src/ingestion/types.ts`'s
 * doc). A hash already on record — including `'done'` — is never re-added,
 * so once `vision.extract`/`outcomes.extract` bumps its contract version, a
 * page that would now route differently (or a document that would now
 * extract outcomes it didn't before) still reads `already-processed` for
 * unchanged bytes: the version bump never reaches an already-`done` job.
 *
 * **Why one composite string, not a per-format value.** Neither of these
 * two files knows, at enqueue time, whether a given PDF/PPTX/DOCX will
 * later route any of its pages to Slot V (`vision.extract`) or feed
 * `outcomes.extract` — that dispatch happens downstream, inside
 * `extraction-runner.ts` (outside this bead's owned paths), per page, after
 * local text-layer extraction runs. Composing BOTH contract versions into
 * one string, changed whenever EITHER moves, is the safe, honest choice
 * available at THIS layer: a version bump that turns out irrelevant to one
 * particular file costs at most one harmless, non-paid re-extraction of
 * that file's local text layer, the next time (never eagerly — see the
 * module doc on both call sites) a real vault event or a manual "process
 * now" touches that exact path; a version bump that WAS relevant to that
 * file is no longer silently masked by an already-`done` record, which is
 * the actual gap this bead closes.
 *
 * Every current production caller of `IngestionQueueEngine.enqueue` for a
 * raw source omitted `workflowVersion` before this bead — starting to
 * supply it changes the identity of every FUTURE enqueue call for
 * previously-`done` content whenever either constant below changes, but
 * never touches an already-recorded job (INV-2; D-381's clarification): the
 * older, version-mismatched job is left exactly as `IngestionQueueEngine`
 * already leaves it — see `engine.ts`'s "Version-aware dedup" doc.
 */

import { OUTCOMES_EXTRACT_CONTRACT_VERSION } from './outcomes-extract-adapter.js';
import { VISION_EXTRACT_CONTRACT_VERSION } from './vision-page-runner.js';

/**
 * The `workflowVersion` for a raw embedded-source enqueue. Changes if
 * EITHER downstream contract version changes — see this module's doc for
 * why a single composite is the correct, if coarse, choice at this layer.
 */
export const EXTRACTION_WORKFLOW_VERSION = `vision:${VISION_EXTRACT_CONTRACT_VERSION}:outcomes:${OUTCOMES_EXTRACT_CONTRACT_VERSION}`;
