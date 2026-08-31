/**
 * F2.7's two addressable states ("explain why I got this wrong",
 * `features/F2-review.md:267`), mounted the same way `retrieve-scenarios.ts`
 * mounts TB-2's four: a state list, a finder, a builder. Both halves now run
 * for real (`ol-4k45` [XWY-2] closed the prose half `ol-rem6` used to block):
 * every state runs `explain/ground.ts`'s `groundExplanation` against the REAL
 * fixture vault (`packages/core/fixtures/vault/`), and `explanation-grounded`
 * additionally runs `explain/generate.ts`'s `generateExplainProse` — a
 * cassette-replayed `explain-why.generate.v1` call — over that grounding's
 * cited chunks. No product view exists for a bare grounding-plus-prose
 * result (the walkthrough's own screen is this inspector; see `main.ts`'s
 * `mountExplain`), so this stays inspector-only, exactly like
 * `retrieve-scenarios.ts`'s own note explains for itself.
 *
 * ## Which query demonstrates which state, and why it is not tuning
 *
 * Both queries below were chosen the same way `retrieve-scenarios.ts` chose
 * its four: by RUNNING `groundExplanation` against the real fixture-vault
 * index and reading off what it actually produced, never by asserting what a
 * query "should" do. `explanation-grounded`'s query
 * ("What causes clast imbrication in a rolling bedload?") deliberately
 * echoes the fixture vault's own lecture-note title (`01 Courses/GEOL204/
 * WEEK 1/Lecture - Clast Provenance and Imbrication.md`) because F2.7
 * is about a MISSED answer on material she has — a query with no relationship
 * to anything in the vault would not demonstrate that. `explanation-refused`'s
 * query is deliberately invented nonsense (no natural-language relationship
 * to anything, so it cannot keyword-match anything by accident) — see
 * `explain/ground.ts`'s module doc for why this is the reason INV-5 exists:
 * the refusal branch has to fire from having nothing to ground on, not from
 * a query that merely reads badly.
 *
 * ## Why only `explanation-grounded` calls the generative task
 *
 * `explanation-refused-no-grounding` stays local and zero-spend, deliberately
 * — production never calls `explain-why.generate.v1` with an empty context
 * either way (the client-side `ExplainWhyPort` composition in
 * `packages/plugin/src/review/explainWhy.ts` still calls it, since the
 * Worker's own `groundExplanation` enforces the empty-context refusal
 * server-side — but `precompute-generation.mjs` only ever recorded the ONE
 * grounded call this bead's spend budget covered). Calling `generate` for
 * the refused state here would hit `CassetteGenerationProvider`'s
 * `GenerationReplayError` (no recording exists for that payload) rather than
 * demonstrate anything, so this file does not attempt it — see that state's
 * own `note` below, unchanged: "Computed locally, zero model spend."
 *
 * ## The one honest caveat this file inherits from its driver
 *
 * Both states ground with NO embedding provider (`explain/ground.ts`) — real
 * fixture-vault text, real keyword search, real refusal logic, but the
 * semantic half of hybrid retrieval never runs and the ratified
 * `requireComposite: true` operating point (D-042/`ol-xf6x`) is not
 * reachable here at all. See that file's module doc for the measured finding
 * behind that. Nothing in this file's `note` strings claims otherwise —
 * intentionally left placeholder-plain; the integration lane writes the
 * user-facing wording.
 */

import type { VaultSource } from '../../core/src/vault/types.js';
import { type ExplainProseResult, generateExplainProse } from './explain/generate.js';
import { type GroundExplanationResult, groundExplanation } from './explain/ground.js';
import type { GenerationCassette } from './synthetic-bridge.js';

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
      'path, the paragraph position and the quotable passage — everything an explanation is ' +
      'grounded in. `explain-why.generate.v1` then writes the explanation from those exact ' +
      'quotes (a recorded call, replayed here — see `explain/generate.ts`), citing one of them ' +
      "by index; the citation is checked against `sourceChunks` server-side (`explainWhyGenerate.ts`'s " +
      '`groundExplanation`), never re-verified here. Two things are switched off here and neither ' +
      'is a detail: this vault has no embeddings, so only keyword overlap decided what came back, ' +
      'and the composite grounding gate cannot run at all without them. This shows the plumbing ' +
      'working over real material. It shows nothing about how well retrieval ranks.',
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
  /** `null` for `explanation-refused-no-grounding` — see this file's module doc for why that state never calls the generative task. */
  readonly prose: ExplainProseResult | null;
}

/**
 * `explanation-grounded`'s query — echoes the title of a real fixture-vault
 * lecture note; see this file's module doc. Also the `question` sent to
 * `explain-why.generate.v1` (matching production wiring — see
 * `explain/generate.ts`'s module doc) and MUST match
 * `precompute-generation.mjs`'s `EXPLAIN_WHY_QUESTION` byte-for-byte, or the
 * recorded cassette entry's payload hash will not be found.
 */
const GROUNDED_QUERY = 'What causes clast imbrication in a rolling bedload?';
/** `explanation-refused-no-grounding`'s query — invented nonsense, zero keyword overlap with the fixture vault by construction. */
const REFUSED_QUERY = 'zorblatt quixnorf plibbertyglop wobsnaggle';

/**
 * The rest of `explanation-grounded`'s `explain-why.generate.v1` payload —
 * GEOL204's own `05 Zettelkasten/Imbrication.md` note, real and public
 * (INV-3: fixture-vault content, never a real course or a real student's
 * words). MUST match `precompute-generation.mjs`'s constants of the same
 * name byte-for-byte — see this file's module doc and that script's own for
 * why: the cassette is keyed by an exact payload hash, not a fuzzy match.
 */
const EXPLAIN_WHY_COURSE_CODE = 'GEOL204';
const EXPLAIN_WHY_CONCEPT_NAME = 'Imbrication';
const EXPLAIN_WHY_STUDENT_ANSWER =
  'The current pushes the flat side of each clast so it settles facing downstream.';
const EXPLAIN_WHY_CORRECT_ANSWER =
  'Clasts tip so their long axis dips upstream as the bed rolls, recording the last flow strong ' +
  'enough to move the whole grain skeleton.';

/** Builds one explain-surface state against the real, already-loaded fixture vault and the pre-recorded generation cassette. */
export async function buildExplainScenario(
  stateId: string,
  vault: VaultSource,
  generationCassette: GenerationCassette,
): Promise<ExplainScenario> {
  const state = findExplainState(stateId);
  if (state === undefined) {
    throw new Error(`workbench: unknown explain state ${JSON.stringify(stateId)}`);
  }

  switch (stateId) {
    case 'explanation-grounded': {
      const result = await groundExplanation({ vault, query: GROUNDED_QUERY });
      const prose = await generateExplainProse({
        cassette: generationCassette,
        grounding: result,
        courseCode: EXPLAIN_WHY_COURSE_CODE,
        conceptName: EXPLAIN_WHY_CONCEPT_NAME,
        question: GROUNDED_QUERY,
        studentAnswer: EXPLAIN_WHY_STUDENT_ANSWER,
        correctAnswer: EXPLAIN_WHY_CORRECT_ANSWER,
      });
      return { note: state.note, result, prose };
    }
    case 'explanation-refused-no-grounding': {
      const result = await groundExplanation({ vault, query: REFUSED_QUERY });
      return { note: state.note, result, prose: null };
    }
    default:
      throw new Error(`workbench: explain state ${JSON.stringify(stateId)} has no builder`);
  }
}
