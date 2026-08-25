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
 * **Reachability (`[D-072]`).** There is deliberately no production caller
 * yet. This function needs (a) real nomination signals computed from the
 * local vector cache, assessment co-occurrence and her wikilinks, and (b) a
 * `CorpusRelationVerdictPort` implementation, which needs a task id — and
 * the task-id catalogue is frozen (C4.1–C4.3), so adding one is Class C,
 * exactly the procedure `[D-111]`/`[D-112]` used to wire `ConceptReaderPort`
 * (`ol-5nle`, `[EXT-7]`). This build declines to invent that decision and
 * instead files the follow-on bead as `[EXT-8]`, discovered-from this one —
 * see the bead's own notes for its id. Until it lands, this module is
 * exercised only by its own spec suite, the same honest gap
 * `ConceptReaderPort` sat in between `[EXT-3]` and `[EXT-7]`.
 */

import { nominateCorpusRelationCandidates } from './nominate.js';
import type { CorpusConcept, NominationSignal } from './types.js';
import {
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
  const candidates = nominateCorpusRelationCandidates(
    input.newConcepts,
    input.allConcepts,
    input.signals,
  );

  if (candidates.length === 0) {
    // INV-5's refusal shape, one level up from `../read.js`: nothing
    // nominated means nothing to verdict, so the port is never reached —
    // the same reasoning that keeps a reader from being asked to invent
    // an edge over an empty context.
    return { relations: [], dropped: emptyCorpusDropCounts(), candidatesNominated: 0 };
  }

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

  return { relations, dropped: fullDropped, candidatesNominated: candidates.length };
}

export { totalCorpusDropped };
