/**
 * F5.1's "Explain it back" surface (`ol-z6x2` [WB-2] F5 tranche, `[D-163]`),
 * built against the REAL `ExplainBackModal` (`packages/plugin`) — same
 * "workbench mounts the real product view against real deps" discipline
 * `registry-scenarios.ts`'s own module doc states for its surface.
 *
 * Unlike every other surface in this package, `ExplainBackModal` is a
 * `Modal`, not an `ItemView`: it never runs `gradeExplainBackAttempt` /
 * `acceptExplainBackGradingWithObservation` (`grading/wiring.ts`) over a real
 * Worker call or a real misconception store — that pipeline's OWN behaviour
 * (grounding, citation dropping, the restatement gate) is already covered by
 * `packages/core`'s and `olea-service`'s own spec files
 * (`gradingPipeline.spec`, `explainBackJudge.spec`). This bridge exists for a
 * DIFFERENT risk: the modal's own phase-rendering state machine (topic →
 * answering → grading → graded/refused → accepted) and its copy selection —
 * risk that lives in this package's DOM/state logic, never in the Obsidian
 * runtime, which is exactly the class of scenario `ol-z6x2`'s own acceptance
 * criteria asks an `@auto-web` tranche to argue for. So every fixture state
 * below injects a CANNED `grade`/`acceptWithObservation` result directly —
 * never the real pipeline — the same "feed the real view fixture records
 * instead of walking a fixture vault" posture `registry-scenarios.ts` states
 * for its own surface.
 *
 * Course codes, concept names and note paths below are coined vocabulary
 * (`syn:course:…`, `syn:concept:…`), never real course or concept names —
 * same fixture-vocabulary discipline `registry-scenarios.ts`/
 * `bulk-review-scenarios.ts` state for their own corpora.
 */

import type {
  AcceptExplainBackGradingWithObservationContext,
  AcceptExplainBackGradingWithObservationResult,
  AcceptedExplainBackGrading,
  ExplainBackModalDeps,
  ExplainBackSeed,
  ExplainBackSourceBlock,
  GradeExplainBackInput,
  PendingExplainBackGrading,
  ReviewInstrument,
} from './explain-back-bridge.js';
import { App, ExplainBackModal } from './explain-back-bridge.js';

export interface ExplainBackWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'explain-back';
  readonly note: string;
}

export const EXPLAIN_BACK_STATES: readonly ExplainBackWorkbenchState[] = [
  {
    id: 'explain-back-fresh-prompt',
    label: 'A fresh, free-form prompt',
    group: 'explain-back',
    note:
      "F5.1's on-demand entry point (`[D-163]`): she names the topic herself. Typing a topic " +
      'and continuing resolves a real retrieval (canned, non-empty here) and lands on the ' +
      'answering phase — the same `resolveTopicPrompt` transition the real modal runs.',
  },
  {
    id: 'explain-back-graded-feedback',
    label: 'Graded, with feedback, missed points and cited issues',
    group: 'explain-back',
    note:
      'A confusion-routing seed (F2.12) whose canned `grade` resolves to a partial verdict ' +
      'carrying missed points, cited issues and a misconception candidate — exercises "From ' +
      'your notes", "Worth a closer look" and the `[D-171]` "See in registry" one-step ' +
      'affordance (F8.4), wired to the real `openRegistryEntryFor`.',
  },
  {
    id: 'explain-back-graded-clean',
    label: 'Graded correct, nothing flagged',
    group: 'explain-back',
    note:
      'The one shape `explainBackFullDepthEncouragement` (F6.8/V5) can honestly praise: ' +
      'verdict correct, nothing missed, cited or flagged. Accepting this grading is the only ' +
      'path in this surface that shows the encouragement line.',
  },
  {
    id: 'explain-back-refused-check-failed',
    label: 'A transient check failure',
    group: 'explain-back',
    note:
      "C4.7/`[D-089]`'s two-reason posture: the canned `grade` call rejects with a plain " +
      'error (not `UnusableGradingInputError`), so the modal shows the transient ' +
      '`EXPLAIN_BACK_CHECK_FAILED_REFUSAL` copy — never the insufficient-notes wording — and ' +
      'offers a retry.',
  },
];

export function findExplainBackState(
  id: string,
): { readonly id: string; readonly note: string } | undefined {
  const found = EXPLAIN_BACK_STATES.find((s) => s.id === id);
  return found === undefined ? undefined : { id: found.id, note: found.note };
}

const COURSE = 'syn:course:vantrel';

function sourceBlock(id: string, text: string): ExplainBackSourceBlock {
  return { block: { blockId: id, text }, path: `01 Courses/${COURSE}/Week 2.md`, blockIndex: 0 };
}

const FIXTURE_SOURCE_BLOCKS: readonly ExplainBackSourceBlock[] = [
  sourceBlock('syn-block-1', 'The alpha mechanism regulates the synthetic rate constant.'),
  sourceBlock('syn-block-2', 'A higher synthetic rate constant shortens the reaction half-life.'),
];

const FIXTURE_INSTRUMENT: ReviewInstrument = {
  instrumentId: 'qa:syn:concept-key:alpha:1',
  conceptIds: ['syn:concept-key:alpha'],
  courseCode: COURSE,
  noteTitle: 'Week 2',
  sourcePath: `01 Courses/${COURSE}/Week 2.md`,
  blockId: 'syn-block-1',
  draftId: null,
  type: 'qa',
  question: 'What does the alpha mechanism regulate?',
  answer: 'The synthetic rate constant.',
};

/** Record-only per `[D-138]` — never gates the canned model call below; zeroed since nothing here re-derives a real containment measurement. */
const ZERO_OVERLAP = {
  containment: 0,
  lcsRatio: 0,
  jaccard: 0,
  ngramSize: 8,
  answerTokenCount: 0,
  sourceTokenCount: 0,
} as const;

function cleanGrading(): PendingExplainBackGrading {
  return {
    status: 'pending-review',
    overlap: ZERO_OVERLAP,
    grading: {
      verdict: 'correct',
      feedback: 'This names the mechanism and its target correctly.',
      missedPoints: [],
      citedIssues: [],
      misconceptionCandidates: [],
      citationsAvailable: true,
      droppedCitationCount: 0,
      droppedMisconceptionCount: 0,
    },
  };
}

function flaggedGrading(): PendingExplainBackGrading {
  return {
    status: 'pending-review',
    overlap: ZERO_OVERLAP,
    grading: {
      verdict: 'partial',
      feedback: 'The mechanism is right, but the effect on half-life is missing.',
      missedPoints: ['How the synthetic rate constant changes the reaction half-life'],
      citedIssues: [
        {
          kind: 'omission',
          description: 'Nothing said about the effect on reaction half-life',
          sourceBlockIds: ['syn-block-2'],
        },
      ],
      misconceptionCandidates: [
        {
          concept: 'syn:concept-key:alpha',
          statement: 'The alpha mechanism only affects the synthetic rate constant',
          correction: 'It also shortens the reaction half-life, via that same constant',
          correctionSourceBlockIds: ['syn-block-2'],
        },
      ],
      citationsAvailable: true,
      droppedCitationCount: 0,
      droppedMisconceptionCount: 0,
    },
  };
}

function acceptedFrom(pending: PendingExplainBackGrading): AcceptedExplainBackGrading {
  return { status: 'accepted', ...pending.grading };
}

export interface ExplainBackScenario {
  readonly stateId: string;
  readonly app: App;
  readonly modal: ExplainBackModal;
  /** `VIEW_TYPE_OLEA_REGISTRY` reveals recorded through this scenario's own `app.workspace` — the `[D-171]` hand-off's observable trace (`obsidian-shim`'s own module doc: no second screen actually paints). */
  readonly registryHandoffCount: () => number;
}

/**
 * Builds one fresh `ExplainBackModal` per open, over a fresh `App` (so each
 * scenario's `[D-171]` hand-off recording starts at zero) and canned deps —
 * never the real `gradeExplainBackAttempt`/`acceptExplainBackGradingWithObservation`
 * pipeline, per this file's own module doc.
 */
export function buildExplainBackScenario(stateId: string): ExplainBackScenario {
  const app = new App();

  const seed: ExplainBackSeed =
    stateId === 'explain-back-fresh-prompt'
      ? { kind: 'freeform' }
      : { kind: 'instrument', instrument: FIXTURE_INSTRUMENT };

  const deps: ExplainBackModalDeps = {
    async grade(_input: GradeExplainBackInput): Promise<PendingExplainBackGrading | null> {
      if (stateId === 'explain-back-refused-check-failed') {
        throw new Error('workbench fixture: the canned grading check failed');
      }
      if (stateId === 'explain-back-graded-clean') return cleanGrading();
      return flaggedGrading();
    },
    async acceptWithObservation(
      pending: PendingExplainBackGrading,
      _context: AcceptExplainBackGradingWithObservationContext,
    ): Promise<AcceptExplainBackGradingWithObservationResult | null> {
      return { accepted: acceptedFrom(pending), observations: [] };
    },
    async retrieveSourceBlocks(_query: string): Promise<readonly ExplainBackSourceBlock[]> {
      return FIXTURE_SOURCE_BLOCKS;
    },
    async buildObservationContext(): Promise<AcceptExplainBackGradingWithObservationContext> {
      return {
        originInstrumentId: 'qa:syn:concept-key:alpha:1',
        originReviewEventId: null,
        timestamp: '2027-01-15T09:00:00-08:00',
        resolveCitation: () => null,
        resolveConceptId: () => null,
        candidateRecordsForConcept: () => [],
      };
    },
    generateInstrumentId: () => 'explain-back:workbench-fixture:1',
  };

  const modal = new ExplainBackModal(app, deps, seed);

  return {
    stateId,
    app,
    modal,
    registryHandoffCount: () => app.workspace.revealedCount,
  };
}
