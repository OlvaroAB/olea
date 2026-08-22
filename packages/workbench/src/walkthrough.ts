/**
 * Walkthrough mode (`ol-c48c`) — a seventh, linear entry point over the
 * existing six surfaces, plus two steps of its own (`'note'`, `'oracle-
 * fixture'`) and three that are genuinely missing product screens.
 *
 * This file is data and derivation only — it names WHICH `{surface,
 * stateId}` each step points at and computes each step's status; it renders
 * nothing. `main.ts` is the one place that mounts a screen, same as it
 * already is for the six flat surfaces (see this package's README on why
 * that stays a single render path).
 *
 * ## Two pseudo-surfaces, and why they exist
 *
 * `'note'` (step 1) and `'oracle-fixture'` (steps 7-8) are not one of the six
 * addressable surfaces `main.ts`'s `RouteSurface` already had. Neither invents
 * a new PRODUCT screen (rule 1's actual constraint):
 *
 *   - `'note'` renders her fixture note's own markdown, literally — the same
 *     thing Obsidian's stock reading view does with no plugin code involved
 *     at all. There is no "Olea screen" to reuse because none is needed.
 *   - `'oracle-fixture'` mounts the SAME real `GapView` the flat oracle
 *     surface already mounts (`oracle-scenarios.ts`) — the product screen is
 *     unchanged. What differs is the DATA under it: the fixture vault's own
 *     material instead of `packages/synthetic`'s coined corpus, per D-041
 *     (`ol-st9i`) — ranked concepts, gap rows and citations computed by the
 *     product's own `composeOracleRanking`/`buildGapView` (`olea-core`) over
 *     real fixture-vault text, never a hand-built `GapViewModel`. See
 *     `oracle/fixture-oracle.ts` for the whole argument, including why this
 *     needs no cassette. The flat `oracle` surface (`oracle-scenarios.ts`,
 *     `ORACLE_STATES`) is completely untouched by this — same synthetic
 *     corpus, same existing disclaimers, N-015 scoped rather than repealed.
 *
 * ## Status is derived, never typed by hand
 *
 * `deriveStatus` below is the one place a step's `status` is decided.
 * `'gap'` when `stateId` is `null` (rule 3: no screen exists at all).
 * `'partial'` only when the step's own definition SAYS so (`partial` is
 * present) — screen real, path to it in Obsidian not. Otherwise `'live'`:
 * either one of the two pseudo-surfaces (implemented directly, see above) or
 * an existing `{surface, stateId}` pair that genuinely resolves against the
 * surface's own state list — resolution is CHECKED, not assumed, so a state
 * id that drifts out from under this file turns the step into a gap rather
 * than a silent 404.
 */

import { findExplainState } from './explain-scenarios.js';
import { findGenerateState } from './generate-scenarios.js';
import { findOracleState } from './oracle-scenarios.js';
import { findRetrieveState } from './retrieve-scenarios.js';
import { findState } from './scenarios.js';
import { findSessionState } from './session-scenarios.js';
import { findTimelineState } from './timeline-scenarios.js';
import { findTodayState } from './today-scenarios.js';
import { findTrendsState } from './trends-scenarios.js';

/** The nine surfaces `main.ts` already addresses, reused verbatim by a walkthrough step. */
export type WalkContentSurface =
  | 'review'
  | 'today'
  | 'oracle'
  | 'retrieve'
  | 'generate'
  | 'timeline'
  | 'explain'
  | 'session'
  | 'trends';

/** Everything a step's `surface` field may hold — the six above, or one of the two pseudo-surfaces this file's module doc explains, or `null` for a full gap. */
export type WalkSurface = WalkContentSurface | 'note' | 'oracle-fixture' | null;

export type WalkStatus = 'live' | 'partial' | 'gap';

/** What a gap card, or a partial step's caption, names — product language plus the bead that tracks it. */
export interface WalkGap {
  readonly what: string;
  readonly bead: string;
}

export interface WalkStepDefinition {
  readonly n: number;
  readonly title: string;
  readonly copy: string;
  readonly surface: WalkSurface;
  readonly stateId: string | null;
  /** Present only when the screen is real but unreachable in Obsidian (rule 3). */
  readonly partial?: WalkGap;
  /** Present only when `stateId` is `null` — what's missing, in product language, and its bead. */
  readonly gap?: WalkGap;
}

export interface WalkStep extends WalkStepDefinition {
  readonly status: WalkStatus;
}

function resolvesInContentSurface(surface: WalkContentSurface, stateId: string): boolean {
  switch (surface) {
    case 'review':
      return findState(stateId) !== undefined;
    case 'today':
      return findTodayState(stateId) !== undefined;
    case 'oracle':
      return findOracleState(stateId) !== undefined;
    case 'retrieve':
      return findRetrieveState(stateId) !== undefined;
    case 'generate':
      return findGenerateState(stateId) !== undefined;
    case 'timeline':
      return findTimelineState(stateId) !== undefined;
    case 'explain':
      return findExplainState(stateId) !== undefined;
    case 'session':
      return findSessionState(stateId) !== undefined;
    case 'trends':
      return findTrendsState(stateId) !== undefined;
  }
}

function deriveStatus(def: WalkStepDefinition): WalkStatus {
  if (def.stateId === null || def.surface === null) return 'gap';
  if (def.partial !== undefined) return 'partial';
  if (def.surface === 'note' || def.surface === 'oracle-fixture') return 'live';
  return resolvesInContentSurface(def.surface, def.stateId) ? 'live' : 'gap';
}

const WALKTHROUGH_STEP_DEFINITIONS: readonly WalkStepDefinition[] = [
  {
    n: 1,
    title: 'A normal Monday note',
    copy:
      'Week six, and she takes lecture notes the way she always has. Olea reads what she ' +
      'already writes — no second app, no separate deck, no import step.',
    surface: 'note',
    stateId: '00 Daily notes/2026-08-10.md',
  },
  {
    n: 2,
    title: 'Olea offers cards, and asks',
    copy:
      'It notices question-shaped headings and highlighted terms and drafts cards from them. ' +
      'Then it stops and asks. Nothing it writes enters her deck or her vault without her ' +
      'seeing it first.',
    surface: 'generate',
    stateId: 'generation-pending-accept',
    partial: {
      what:
        "The accept step you can click below is real (INV-6's own gate), but nothing in " +
        'Obsidian opens this screen yet — P3-T07b, quiz generation into persistent instruments, ' +
        'is still open.',
      bead: 'ol-p3t07b',
    },
  },
  {
    n: 3,
    title: "Tuesday: what's due",
    copy:
      'Twelve items, across two courses, with the next exam eighteen days out. The count is ' +
      'not a target and the streak never nags.',
    surface: 'today',
    stateId: 'today-due',
  },
  {
    n: 4,
    title: 'The question',
    copy:
      'Front, reveal, and four ways to say how that went. The scheduling underneath decides ' +
      'when she sees it again; the screen itself is deliberately boring.',
    surface: 'review',
    stateId: 'qa-front',
  },
  {
    n: 5,
    title: 'Other shapes: cloze and MCQ',
    copy:
      'The same loop carries fill-in-the-blank and multiple choice. Her material decides which ' +
      'shape fits, not a setting.',
    surface: 'review',
    stateId: 'cloze-front',
  },
  {
    n: 6,
    title: 'Why did I get that wrong?',
    copy:
      'She asks, and the answer quotes her own notes back with a link to the paragraph it came ' +
      'from. This is the difference between a study tool and a chatbot: the answer is grounded ' +
      'in her material or it does not get made.',
    surface: 'explain',
    stateId: 'explanation-grounded',
    partial: {
      what:
        'The grounding half is real — these are the actual passages from her own notes that an ' +
        'explanation would be built on. The explanation itself is not written yet: the Worker ' +
        'does not serve the explain task.',
      bead: 'ol-rem6',
    },
  },
  {
    n: 7,
    title: "What's likely to come up",
    copy:
      'The oracle ranks concepts by how likely they are to be examined, and shows its reasoning ' +
      'and its sources for each. It says likelihood, never prophecy, and it always tells her to ' +
      'cover the syllabus.',
    // Was `partial` for one afternoon, on the grounds that nothing opened this screen in
    // Obsidian. That stopped being true while this file was being written: ol-2tyj landed the
    // provider and the registerView call, so the command `olea-gap-open` now reaches it. Live.
    surface: 'oracle-fixture',
    stateId: 'oracle-ranked',
  },
  {
    n: 8,
    title: 'Where the holes are',
    copy:
      'Every concept below is the same kind of hole: she has notes on it and nothing to ' +
      'practise with. Olea separates that from being shaky on something, and from a topic ' +
      "that isn't in her materials at all — and it will not offer to generate what it cannot " +
      'ground.',
    // Live for the same reason as step 7 — see the note there.
    surface: 'oracle-fixture',
    stateId: 'gap-coverage',
    partial: {
      what:
        'The gap classes are real and the screen computes them, but this invented vault only ' +
        'produces one of the three: every concept its past papers cite has notes and no cards. ' +
        'So the other two are described above rather than shown. The copy used to promise all ' +
        'three, which the screen could never have delivered.',
      bead: 'ol-m3ty',
    },
  },
  {
    n: 9,
    title: "When Olea doesn't know",
    copy:
      'She asks about something outside her material, and it declines. This is a feature, and ' +
      'it is measured: the refusal behaviour is tested adversarially on every generative path.',
    surface: 'retrieve',
    stateId: 'grounding-refused-no-hits',
  },
  {
    n: 10,
    title: 'A fortnight on',
    copy: 'What moved and what did not. Scrub the day to watch it change.',
    surface: 'timeline',
    stateId: 'timeline-steady',
  },
  {
    n: 11,
    title: 'Exam eve: build me a session',
    copy: 'Ninety minutes, weighted to the exam, drawn from her gaps.',
    surface: 'session',
    stateId: 'session-exam-eve-90',
  },
  {
    n: 12,
    title: "How she's trending",
    copy:
      'Per-course mastery, and one or two observed patterns — how her spaced material held up ' +
      'against what she crammed, and where her time went against where her exams are.',
    surface: 'trends',
    stateId: 'trends-cramming',
  },
];

export const WALKTHROUGH_STEPS: readonly WalkStep[] = WALKTHROUGH_STEP_DEFINITIONS.map((def) => ({
  ...def,
  status: deriveStatus(def),
}));

export function findWalkStep(id: string): WalkStep | undefined {
  const n = Number(id);
  if (!Number.isInteger(n)) return undefined;
  return WALKTHROUGH_STEPS.find((step) => step.n === n);
}

export const DEFAULT_WALK_STEP = '1';

export function walkStepStateId(n: number): string {
  return String(n);
}
