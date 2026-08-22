/**
 * The two addressable states of F2.7's grounding half ("explain why I got
 * this wrong", `features/F2-review.md:267`), mounted the same way
 * `retrieve-scenarios.ts` mounts TB-2's four: a state list, a finder, a
 * builder. Every state runs `explain/ground.ts`'s `groundExplanation`
 * against the REAL fixture vault (`packages/core/fixtures/vault/`) — no
 * product view exists for a bare grounding result (the prose half that would
 * consume it is BLOCKED on `ol-rem6`), so this is inspector-only, exactly
 * like `retrieve-scenarios.ts`'s own note explains for itself.
 *
 * ## Which query demonstrates which state, and why it is not tuning
 *
 * Both queries below were chosen the same way `retrieve-scenarios.ts` chose
 * its four: by RUNNING `groundExplanation` against the real fixture-vault
 * index and reading off what it actually produced, never by asserting what a
 * query "should" do. `explanation-grounded`'s query
 * ("What causes clast imbrication in a rolling bedload?") deliberately
 * echoes the fixture vault's own lecture-note title (`01 Courses/GEOL204/
 * WEEK 1/Lecture - Grain Provenance and Clast Imbrication.md`) because F2.7
 * is about a MISSED answer on material she has — a query with no relationship
 * to anything in the vault would not demonstrate that. `explanation-refused`'s
 * query is deliberately invented nonsense (no natural-language relationship
 * to anything, so it cannot keyword-match anything by accident) — see
 * `explain/ground.ts`'s module doc for why this is the reason INV-5 exists:
 * the refusal branch has to fire from having nothing to ground on, not from
 * a query that merely reads badly.
 *
 * ## The one honest caveat this file inherits from its driver
 *
 * Both states run with NO embedding provider (`explain/ground.ts`) — real
 * fixture-vault text, real keyword search, real refusal logic, but the
 * semantic half of hybrid retrieval never runs and the ratified
 * `requireComposite: true` operating point (D-042/`ol-xf6x`) is not
 * reachable here at all. See that file's module doc for the measured finding
 * behind that. Nothing in this file's `note` strings claims otherwise —
 * intentionally left placeholder-plain; the integration lane writes the
 * user-facing wording.
 */

import type { VaultSource } from '../../core/src/vault/types.js';
import { type GroundExplanationResult, groundExplanation } from './explain/ground.js';

export interface ExplainWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'explain';
  readonly note: string;
}

export const EXPLAIN_STATES: readonly ExplainWorkbenchState[] = [
  {
    id: 'explanation-grounded',
    label: 'Grounded — quotes the real note',
    group: 'explain',
    note:
      "Real fixture-vault text, searched by the product's own retrieval, returning the note " +
      'path, the paragraph position and the quotable passage — everything an explanation would ' +
      'be grounded in. Two things are switched off here and neither is a detail: this vault has ' +
      'no embeddings, so only keyword overlap decided what came back, and the composite ' +
      'grounding gate cannot run at all without them. This shows the plumbing working over real ' +
      'material. It shows nothing about how well retrieval ranks.',
  },
  {
    id: 'explanation-refused-no-grounding',
    label: 'Refused — nothing to ground on',
    group: 'explain',
    note:
      'The query matches nothing in her material, so retrieval refuses rather than handing a ' +
      'model weak passages to write around. This is the branch INV-5 exists for, and nothing in ' +
      "the project exercised it until this screen was built — all three of F2.7's scenarios are " +
      'tagged manual. Computed locally, zero model spend.',
  },
];

export function findExplainState(id: string): ExplainWorkbenchState | undefined {
  return EXPLAIN_STATES.find((state) => state.id === id);
}

export interface ExplainScenario {
  readonly note: string;
  readonly result: GroundExplanationResult;
}

/** `explanation-grounded`'s query — echoes the title of a real fixture-vault lecture note; see this file's module doc. */
const GROUNDED_QUERY = 'What causes clast imbrication in a rolling bedload?';
/** `explanation-refused-no-grounding`'s query — invented nonsense, zero keyword overlap with the fixture vault by construction. */
const REFUSED_QUERY = 'zorblatt quixnorf plibbertyglop wobsnaggle';

/** Builds one explain-surface state against the real, already-loaded fixture vault. */
export async function buildExplainScenario(
  stateId: string,
  vault: VaultSource,
): Promise<ExplainScenario> {
  const state = findExplainState(stateId);
  if (state === undefined) {
    throw new Error(`workbench: unknown explain state ${JSON.stringify(stateId)}`);
  }

  switch (stateId) {
    case 'explanation-grounded': {
      const result = await groundExplanation({ vault, query: GROUNDED_QUERY });
      return { note: state.note, result };
    }
    case 'explanation-refused-no-grounding': {
      const result = await groundExplanation({ vault, query: REFUSED_QUERY });
      return { note: state.note, result };
    }
    default:
      throw new Error(`workbench: explain state ${JSON.stringify(stateId)} has no builder`);
  }
}
