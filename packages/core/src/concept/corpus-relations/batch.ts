/**
 * The corpus-level relation stage's production-shaped entry point — ties
 * nomination (`./nominate.js`), the combined-passage verdict
 * (`./verdict.js`) and the batch trigger (`./trigger.js`) into one call, the
 * same composition shape `../read.js`'s `readConcepts` uses for the
 * per-document stage.
 *
 * **The server-side-storage tripwire, discharged in this function's own
 * shape.** `runCorpusRelationBatch` takes a batch as plain arguments and
 * returns a plain result. It holds no state between calls, constructs
 * nothing that outlives the call, and the port it calls is handed exactly
 * one transient request per batch (`./verdict.js`'s
 * `CorpusVerdictRequest`). No concept set, index or embedding is retained
 * here or implied by anything this function does — the architecture
 * boundary's C6 proviso (`docs/Olea_architecture_boundary.md` §1) is met by
 * construction, not by a comment promising it.
 *
 * **Reachability (`[D-072]`), corrected `ol-2zfj.108` [NEW-24].** This module doc previously said
 * "there is deliberately no production caller yet" — stale since `[EXT-11]`/`ol-kw4a` (2026-08-25)
 * wired `WorkerCorpusRelationVerdict` and `packages/plugin/src/concept/wiring.ts`'s
 * `runCorpusRelationBatchIfDue` started calling this function on the plugin's own ingestion-tick
 * interval (`OleaPlugin.tickIngestionAndMaybeRunCorpusRelations`, `packages/plugin/src/main.ts`).
 * The gap this paragraph used to name — a verdict port with a task id — is closed; see
 * `docs/dev/wiring-register.md`'s `CorpusRelationVerdictPort` row (olea-service) for the
 * production caller's own reachability record.
 */

import { nominateCorpusRelationCandidates } from './nominate.js';
import type { CorpusConcept, NominationSignal } from './types.js';
import {
  CORPUS_RELATIONS_CANDIDATE_CAP_PER_CALL_DECLARED_PENDING,
  type CorpusRelationBatchResult,
  emptyCorpusDropCounts,
  totalCorpusDropped,
} from './types.js';
import {
  type CorpusRelationVerdictPort,
  type CorpusVerdictRequestCandidate,
  reconcileCorpusVerdicts,
} from './verdict.js';

/**
 * Resolves the introducing-passage TEXT for one concept — kept as an
 * injected function, not a `VaultSource` read directly, so this module
 * never grows a vault dependency of its own: the caller (client-side,
 * per the boundary column) already has the text in hand from the same
 * read that produced `CorpusConcept.anchor`.
 */
export type PassageTextLookup = (concept: CorpusConcept) => string;

export interface RunCorpusRelationBatchInput {
  /** Concepts introduced since the corpus stage last ran for this course. */
  readonly newConcepts: readonly CorpusConcept[];
  /** The course's full, current concept set. */
  readonly allConcepts: readonly CorpusConcept[];
  /** Cheap nomination signals — see `./types.js`'s `NominationSignal`. */
  readonly signals: readonly NominationSignal[];
  readonly passageText: PassageTextLookup;
}

/**
 * Run one corpus-stage batch: nominate, verdict, reconcile. Never call this
 * without first checking `./trigger.js`'s `shouldRunCorpusRelationBatch` —
 * this function does not gate itself, because the trigger decision and the
 * scope of a single run are separate concerns with separate tests (this
 * bead's own acceptance criteria draws that line).
 */
export async function runCorpusRelationBatch(
  port: CorpusRelationVerdictPort,
  input: RunCorpusRelationBatchInput,
): Promise<CorpusRelationBatchResult> {
  const nominated = nominateCorpusRelationCandidates(
    input.newConcepts,
    input.allConcepts,
    input.signals,
  );

  if (nominated.length === 0) {
    // INV-5's refusal shape, one level up from `../read.js`: nothing
    // nominated means nothing to verdict, so the port is never reached —
    // the same reasoning that keeps a reader from being asked to invent
    // an edge over an empty context.
    return {
      relations: [],
      dropped: emptyCorpusDropCounts(),
      candidatesNominated: 0,
      candidatesCappedOut: 0,
    };
  }

  // ONT-R2 (`ol-2zfj.89`, C7.10, `./types.js`'s own doc): the declared cap, enforced by simple
  // truncation over nomination's own (deterministic) output order — never mandatory splitting,
  // which the ruling rejects as the primary mechanism. A capped-out candidate is not lost: it is
  // simply reconsidered on the next batch boundary, since this stage's scope is new-concept x
  // all-concepts rather than a one-shot queue.
  const candidates = nominated.slice(0, CORPUS_RELATIONS_CANDIDATE_CAP_PER_CALL_DECLARED_PENDING);
  const candidatesCappedOut = nominated.length - candidates.length;

  const requestCandidates: readonly CorpusVerdictRequestCandidate[] = candidates.map((c) => ({
    a: { ...c.a, passageText: input.passageText(c.a) },
    b: { ...c.b, passageText: input.passageText(c.b) },
  }));

  const response = await port.verdict({ candidates: requestCandidates });
  const { relations, dropped } = reconcileCorpusVerdicts(response.verdicts, candidates);

  const fullDropped = emptyCorpusDropCounts();
  for (const [reason, count] of Object.entries(dropped)) {
    fullDropped[reason as keyof typeof fullDropped] = count ?? 0;
  }

  return {
    relations,
    dropped: fullDropped,
    candidatesNominated: nominated.length,
    candidatesCappedOut,
  };
}

export { totalCorpusDropped };
