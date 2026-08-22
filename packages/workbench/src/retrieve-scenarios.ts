/**
 * The four addressable retrieval states (`ol-opmb.2` [TB-2]), mounted the
 * same way `oracle-scenarios.ts` mounts TB-1's nine: a state list, a finder,
 * a builder. Every state runs `oracle/retrieve.ts`'s `retrieveScenario`
 * against the SAME real, pre-computed `EmbeddingCassette` — no product view
 * exists for raw retrieval results (unlike the oracle surface's real
 * `GapView`), so `main.ts` reports these through the inspector only; see its
 * own note there for why that is honest rather than a shortcut.
 *
 * ## Which query demonstrates which state, and why it is not tuning
 *
 * Each state below cites a SPECIFIC query id from `queries.ts` and, for two
 * of the four, a specific non-default option (`requireComposite: false`,
 * `minCosineScore: 0.5`). Both choices were made by RUNNING the real,
 * once-embedded cassette against every labelled query and reading off which
 * `GroundingRefusalReason` (or `'grounded'`) each one actually produces —
 * never by picking a query and asserting what it "should" do. That is the
 * parent bead's hard limit in practice: nothing here claims a query is
 * "the" answerable/near-miss/unanswerable case in any quality sense, only
 * that THIS query, against THIS corpus, empirically exercises THIS
 * mechanism. A later regeneration of the corpus or a re-embed could change
 * which specific query lands where; `retrieve.spec.ts` asserts the
 * MECHANISM (a `GroundingResult.reason`), never a specific score.
 *
 * ## `grounding-refused-below-threshold`'s honest caveat
 *
 * `retrieve.ts`'s module doc explains why `below-relevance-threshold` is
 * structurally unreachable downstream of a PASSING composite check — so this
 * state necessarily runs with `requireComposite: false`. On real embeddings,
 * even that was not enough on its own: every labelled query's best cosine
 * hit cleared the shipped default `minCosineScore` of 0.25 (the SAME
 * "gibberish clears the bare 0.25 floor" finding `ol-cmpl` already made on
 * the real vault — corroborating evidence, not a new discovery). Isolating
 * the mechanism therefore also needed `minCosineScore: 0.5`, an artificially
 * strict per-hit bar chosen ONLY to make the refusal reachable at all — not
 * a claim about calibration, and not a value used anywhere else in this
 * codebase. It is what genuinely separates `unans-gib-01` (pure nonsense,
 * refused) from every other labelled query (all still grounded even at that
 * stricter bar).
 */

import {
  emptyRetrievalIndex,
  type RetrieveScenarioResult,
  retrieveScenario,
} from './oracle/retrieve.js';
import type { EmbeddingCassette, SyntheticQuery } from './synthetic-bridge.js';
import { findQuery } from './synthetic-bridge.js';

export interface RetrieveWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'retrieve';
  readonly note: string;
}

export const RETRIEVE_STATES: readonly RetrieveWorkbenchState[] = [
  {
    id: 'grounding-refused-no-hits',
    label: 'Refused — no hits',
    group: 'retrieve',
    note:
      'The keyword index is genuinely empty (no documents at all) — an answerable-shaped query ' +
      '(ans-01, melspar) against nothing indexed. hits.length === 0 short-circuits before the ' +
      "composite gate or the per-hit filter ever run — the 'no-hits' reason names exactly that.",
  },
  {
    id: 'grounding-refused-below-threshold',
    label: 'Refused — below relevance threshold',
    group: 'retrieve',
    note:
      'The pure-gibberish query (unans-gib-01), requireComposite:false with an artificially ' +
      "strict minCosineScore:0.5 — see retrieve-scenarios.ts's own module doc for why both " +
      'overrides are necessary to reach this reason at all on real embeddings, and why neither ' +
      'is a claim about calibration.',
  },
  {
    id: 'grounding-refused-composite',
    label: 'Refused — below composite threshold (ratified)',
    group: 'retrieve',
    note:
      'The ratified operating point (D-042/ol-xf6x): requireComposite:true, ' +
      'RECOMMENDED_COMPOSITE_THRESHOLDS, no overrides. ans-01 (melspar, richly covered) still ' +
      'fails the composite gate on this corpus — empirically measured, not asserted; see the ' +
      "parent bead's hard limit on why that number is not evidence about retrieval quality.",
  },
  {
    id: 'grounded-with-citations',
    label: 'Grounded — with citations (ratified)',
    group: 'retrieve',
    note:
      'The SAME ratified operating point as the composite-refusal state above, no overrides — ' +
      'ans-03 (ilmenor) clears every composite signal on this corpus and returns cited chunks. ' +
      'Proof the ratified gate does not refuse everything, not a claim about which queries ' +
      'generally should ground.',
  },
];

export function findRetrieveState(id: string): RetrieveWorkbenchState | undefined {
  return RETRIEVE_STATES.find((state) => state.id === id);
}

export interface RetrieveScenario {
  readonly note: string;
  readonly result: RetrieveScenarioResult;
}

function requireQuery(id: string): SyntheticQuery {
  const query = findQuery(id);
  if (query === undefined)
    throw new Error(`workbench: unknown synthetic query ${JSON.stringify(id)}`);
  return query;
}

/** Builds one retrieval-surface state against an already-loaded, already-validated cassette. */
export async function buildRetrieveScenario(
  stateId: string,
  cassette: EmbeddingCassette,
): Promise<RetrieveScenario> {
  const state = findRetrieveState(stateId);
  if (state === undefined) {
    throw new Error(`workbench: unknown retrieve state ${JSON.stringify(stateId)}`);
  }

  switch (stateId) {
    case 'grounding-refused-no-hits': {
      const result = await retrieveScenario({
        cassette,
        query: requireQuery('ans-01'),
        index: emptyRetrievalIndex(),
      });
      return { note: state.note, result };
    }
    case 'grounding-refused-below-threshold': {
      const result = await retrieveScenario({
        cassette,
        query: requireQuery('unans-gib-01'),
        requireComposite: false,
        minCosineScore: 0.5,
      });
      return { note: state.note, result };
    }
    case 'grounding-refused-composite': {
      const result = await retrieveScenario({ cassette, query: requireQuery('ans-01') });
      return { note: state.note, result };
    }
    case 'grounded-with-citations': {
      const result = await retrieveScenario({ cassette, query: requireQuery('ans-03') });
      return { note: state.note, result };
    }
    default:
      throw new Error(`workbench: retrieve state ${JSON.stringify(stateId)} has no builder`);
  }
}
