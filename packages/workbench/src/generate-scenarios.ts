/**
 * The three addressable generation states (`ol-opmb.3` [TB-3]), mounted the
 * same way `retrieve-scenarios.ts` mounts TB-2's four: a state list, a
 * finder, a builder. Every state chains `oracle/retrieve.ts`'s
 * `retrieveScenario` (TB-2, replaying the SAME real, once-embedded
 * `EmbeddingCassette`) into `oracle/generate.ts`'s `generateScenario` (TB-3,
 * replaying a `GenerationCassette`) — never a hand-built `GroundingResult`,
 * for the same "self-consistency" reason `oracle-scenarios.ts` never
 * hand-builds a `GapViewModel`.
 *
 * ## Which query/course/concept, and why it is not tuning
 *
 * Same discipline as `retrieve-scenarios.ts`'s own module doc: each state
 * below names a SPECIFIC query id already labelled in `queries.ts` — reusing
 * the exact ones TB-2's `grounding-refused-composite`
 * (`ans-01`/melspar/vantrel) and `grounded-with-citations`
 * (`ans-03`/ilmenor/quorbin) states already demonstrate, so this file adds
 * no new claim about which query "should" refuse or ground. `courseCode`/
 * `conceptName` passed to `quiz.generate.v1` are the SAME coined vocabulary
 * tokens (`syn:course:…`, `syn:concept:…`) — never a real course code, never
 * `olea-service`'s own E3 scaffolding strings, which live in the private
 * repo and stay there (see `generate.ts`'s module doc).
 *
 * ## The accept gate: two states share one call, only one clicks it
 *
 * `generation-pending-accept` and `generation-accepted` run the IDENTICAL
 * retrieve+generate chain and differ in exactly one thing: whether
 * `oracle/generate.ts`'s `acceptCandidates` was called before this module
 * handed its result to `main.ts`. That mirrors `main.ts`'s live "Accept"
 * button exactly — clicking it calls the same function this file calls to
 * pre-reach `generation-accepted` — so the addressable URL and the real
 * click are proven to go through the same code path, not two.
 */

import {
  acceptCandidates,
  type GenerateScenarioResult,
  generateScenario,
} from './oracle/generate.js';
import type { RetrieveScenarioResult } from './oracle/retrieve.js';
import { retrieveScenario } from './oracle/retrieve.js';
import type { PipelineTrace } from './oracle/trace.js';
import type { GeneratedMcqCandidate, McqFields } from './oracle-bridge.js';
import type { EmbeddingCassette, GenerationCassette, SyntheticQuery } from './synthetic-bridge.js';
import { findQuery } from './synthetic-bridge.js';

export interface GenerateWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'generate';
  readonly note: string;
  /** Whether this state's build script clicks "Accept" for you before you ever see it. */
  readonly opensAccepted: boolean;
}

export const GENERATE_STATES: readonly GenerateWorkbenchState[] = [
  {
    id: 'generation-refused-upstream',
    label: 'Refused — inherited from retrieval (INV-5)',
    group: 'generate',
    opensAccepted: false,
    note:
      "The SAME query and corpus as the retrieve surface's 'Refused — below composite threshold' " +
      'state (ans-01, melspar) — retrieval refuses first, so generation runs with an EMPTY ' +
      'source context. That is exactly INV-5\'s adversarial case ("write me questions from ' +
      'nothing"), and this is a REAL recorded call: quiz.generate.v1 genuinely returns ' +
      'questions: [] rather than inventing. couldHaveSucceeded: false on BOTH the generate and ' +
      'accept stages, attributedTo: retrieve — neither stage did anything wrong.',
  },
  {
    id: 'generation-pending-accept',
    label: 'Grounded — generated, NOT yet accepted (INV-6)',
    group: 'generate',
    opensAccepted: false,
    note:
      "The SAME query and corpus as the retrieve surface's 'Grounded — with citations' state " +
      '(ans-03, ilmenor) — retrieval grounds, quiz.generate.v1 genuinely returns real questions ' +
      "from real cited chunks. The trace has NO 'accept' stage at all: nobody has clicked Accept " +
      'yet, so nothing here is vault-ready. Click the button in the host pane to reach the same ' +
      'place generation-accepted opens in.',
  },
  {
    id: 'generation-accepted',
    label: 'Grounded — accepted (INV-6, the gate passed)',
    group: 'generate',
    opensAccepted: true,
    note:
      "The IDENTICAL scenario as generation-pending-accept, with this state's build script " +
      'calling the exact same acceptCandidates() the live "Accept" button calls — proving the ' +
      'addressable URL and the real click share one code path. The trace now carries an ' +
      "'accept' stage, and the candidates are McqFields — the shape a vault write would use.",
  },
];

export function findGenerateState(id: string): GenerateWorkbenchState | undefined {
  return GENERATE_STATES.find((state) => state.id === id);
}

export interface GenerateScenario {
  readonly note: string;
  readonly retrieval: RetrieveScenarioResult;
  readonly generation: GenerateScenarioResult;
  readonly accepted: {
    readonly accepted: readonly McqFields[];
    readonly rejected: number;
    /** The 'accept' `StageRecord`, from `oracle/generate.ts`'s `acceptCandidates` — surfaced here so the inspector can render it, same as `retrieval.trace`/`generation.trace`. */
    readonly trace: PipelineTrace;
  } | null;
}

function requireQuery(id: string): SyntheticQuery {
  const query = findQuery(id);
  if (query === undefined)
    throw new Error(`workbench: unknown synthetic query ${JSON.stringify(id)}`);
  return query;
}

/** `syn:course:vantrel` — melspar's course. Same coined token `retrieve-scenarios.ts`'s ans-01 case already exercises. */
const MELSPAR_COURSE = 'syn:course:vantrel';
const MELSPAR_CONCEPT = 'syn:concept:melspar';
/** `syn:course:quorbin` — ilmenor's course. Same coined token `retrieve-scenarios.ts`'s ans-03 case already exercises. */
const ILMENOR_COURSE = 'syn:course:quorbin';
const ILMENOR_CONCEPT = 'syn:concept:ilmenor';

/** Builds one generation-surface state against already-loaded, already-validated cassettes. */
export async function buildGenerateScenario(
  stateId: string,
  embeddingCassette: EmbeddingCassette,
  generationCassette: GenerationCassette,
): Promise<GenerateScenario> {
  const state = findGenerateState(stateId);
  if (state === undefined) {
    throw new Error(`workbench: unknown generate state ${JSON.stringify(stateId)}`);
  }

  switch (stateId) {
    case 'generation-refused-upstream': {
      const retrieval = await retrieveScenario({
        cassette: embeddingCassette,
        query: requireQuery('ans-01'),
      });
      const generation = await generateScenario({
        cassette: generationCassette,
        courseCode: MELSPAR_COURSE,
        conceptName: MELSPAR_CONCEPT,
        retrieval: retrieval.result,
      });
      return { note: state.note, retrieval, generation, accepted: null };
    }
    case 'generation-pending-accept': {
      const retrieval = await retrieveScenario({
        cassette: embeddingCassette,
        query: requireQuery('ans-03'),
      });
      const generation = await generateScenario({
        cassette: generationCassette,
        courseCode: ILMENOR_COURSE,
        conceptName: ILMENOR_CONCEPT,
        retrieval: retrieval.result,
      });
      return { note: state.note, retrieval, generation, accepted: null };
    }
    case 'generation-accepted': {
      const retrieval = await retrieveScenario({
        cassette: embeddingCassette,
        query: requireQuery('ans-03'),
      });
      const generation = await generateScenario({
        cassette: generationCassette,
        courseCode: ILMENOR_COURSE,
        conceptName: ILMENOR_CONCEPT,
        retrieval: retrieval.result,
      });
      const gate = acceptCandidates(generation.candidates as readonly GeneratedMcqCandidate[]);
      return {
        note: state.note,
        retrieval,
        generation,
        accepted: { accepted: gate.accepted, rejected: gate.rejected.length, trace: gate.trace },
      };
    }
    default:
      throw new Error(`workbench: generate state ${JSON.stringify(stateId)} has no builder`);
  }
}
