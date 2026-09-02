/**
 * The addressable states: one workbench URL per screen the review view can be in.
 *
 * Every state is reached by **driving the real view with real keystrokes**
 * through the real keymap (`packages/plugin/src/review/keymap.ts`) — never by
 * poking `ReviewSession`'s internals or hand-building a view model. Two
 * consequences worth stating:
 *
 *  - What renders is what a keyboard user would actually see, so Q6.5's "every
 *    hint shown is a real binding" is exercised by construction: a state that
 *    can only be reached by a key the resolver rejects cannot be reached here
 *    either.
 *  - WB-2 (`ol-z6x2`) can reproduce any state from its id alone, and the
 *    stable `data-wb-*` attributes below are its selectors. That is the whole
 *    of what this file does for WB-2; no Playwright, no screenshots, no
 *    `@auto-web` tags live here.
 *
 * Determinism is deliberate: a fixed clock, deterministic prior scheduling
 * states, deterministic event ids, and index-based instrument picks (never a
 * fixture string). A screenshot taken twice is the same screenshot.
 */

import type { Rating } from 'olea-contracts';
import type { Scheduler, VaultSource } from 'olea-core';
import { appendReviewLogRecord, appendSuspendRecord } from 'olea-core';
import { WORKBENCH_NOW } from './clock.js';
import { Notice } from './obsidian-shim/index.js';
import type { PersonaHistory } from './persona/history.js';
import { NO_PERSONA_HISTORY } from './persona/history.js';
import type { ReviewInstrument, ReviewQueueItem, ReviewSessionDeps } from './plugin-bridge.js';
import type { WorkbenchQueue } from './queue/derive.js';

/** Fixed instant every scenario runs at, so FSRS previews never move. Defined in `./clock.ts`. */
export { WORKBENCH_NOW };

export const WORKBENCH_DEVICE_ID = 'workbench';

export type StateGroup = 'session' | 'card' | 'mcq' | 'edge' | 'today';

export interface WorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: StateGroup;
  /** What this state is here to show. Rendered in the inspector. */
  readonly note: string;
}

export const REVIEW_STATES: readonly WorkbenchState[] = [
  {
    id: 'loading',
    label: 'Loading',
    group: 'session',
    note: 'The pre-start screen. Held open by a note-existence check that never settles.',
  },
  {
    id: 'empty',
    label: 'Nothing due',
    group: 'session',
    note: 'F2.2 — an empty queue, with the next-due label the session was given.',
  },
  {
    id: 'qa-front',
    label: 'Q&A · front',
    group: 'card',
    note: 'A real `::` card from the fixture vault, offered by the composer.',
  },
  {
    id: 'heading-offer-banner',
    label: 'Q&A · front, with the heading-offer banner',
    group: 'card',
    note:
      "F2.10's `[D-170]` heading-offer banner, mounted over the same Q&A front screen as " +
      '`qa-front` — its own accept ("Create a card") and dismiss ("Not now") are bound to a ' +
      "canned tracker (`main.ts`'s `buildHeadingOfferFixture`), never the real note-detection " +
      'walk. Dismiss hides the banner for the rest of this mounted session — it is never re-' +
      'offered without a fresh mount.',
  },
  {
    id: 'qa-reveal',
    label: 'Q&A · reveal',
    group: 'card',
    note: 'Space to reveal. The four intervals are real FSRS output for this item, not sample text.',
  },
  {
    id: 'cloze-front',
    label: 'Cloze · front',
    group: 'card',
    note: 'A real `==…==` deletion in the fixture vault. The blank is what she wrote between the delimiters.',
  },
  {
    id: 'cloze-reveal',
    label: 'Cloze · reveal',
    group: 'card',
    note: 'Space to reveal. The blanked span and the note-context line under it.',
  },
  {
    id: 'mcq-open',
    label: 'MCQ · unanswered',
    group: 'mcq',
    note: 'F2.15 — three distractors sampled from a pool of at least four, plus the answer, all four shuffled. Resampled every showing.',
  },
  {
    id: 'mcq-answered-correct',
    label: 'MCQ · correct',
    group: 'mcq',
    note: 'F2.16 — a confident correct answer maps to Good, never Easy.',
  },
  {
    id: 'mcq-answered-wrong',
    label: 'MCQ · wrong',
    group: 'mcq',
    note: 'The chosen option and the correct one are both marked; the rest dim.',
  },
  {
    id: 'mcq-answered-guessed',
    label: "MCQ · correct, wasn't sure",
    group: 'mcq',
    note: 'F2.16 — G toggles "guessed"; a guessed-correct answer drops to Hard and the interval moves with it.',
  },
  {
    id: 'note-missing',
    label: 'Source note gone',
    group: 'edge',
    note: 'F2.6 — the item was due but its note has been deleted since it was scheduled.',
  },
  {
    id: 'session-complete',
    label: 'Session complete',
    group: 'session',
    note: 'Three items rated straight through. The summary counts and course list are computed, not written.',
  },
];

export function findState(id: string): WorkbenchState | undefined {
  return REVIEW_STATES.find((state) => state.id === id);
}

/** One review-log line the session actually wrote, for the inspector. */
export interface LoggedEvent {
  readonly path: string;
  readonly json: string;
}

export interface Scenario {
  readonly deps: ReviewSessionDeps;
  /** Keys to send to the mounted view, in order, to reach this state. */
  readonly keys: readonly string[];
  /** Populated as the scenario runs. */
  readonly logged: LoggedEvent[];
}

/**
 * ISO-8601 with the local offset, matching what the real port writes.
 *
 * Exported so `today-scenarios.ts` can stamp the review-log records it writes
 * to demonstrate `ol-h3wy` with the same timestamp shape a real session
 * produces, rather than a second, slightly-different formatter.
 */
export function isoWithLocalOffset(date: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return `${local.toISOString().slice(0, -1)}${sign}${pad(Math.trunc(offsetMin / 60))}:${pad(offsetMin % 60)}`;
}

function mcqLetter(instrument: ReviewInstrument, correct: boolean): string {
  if (instrument.type !== 'mcq') return 'a';
  const index = instrument.options.findIndex((option) => option.correct === correct);
  return 'abcdefghij'[index === -1 ? 0 : index] ?? 'a';
}

const RATE_GOOD: Rating = 'good';

export interface BuildScenarioOptions {
  readonly vault: VaultSource;
  readonly scheduler: Scheduler;
  /**
   * The composed session, bucketed by instrument type
   * (`queue/derive.ts`). Whole `ReviewQueueItem`s: `priorState` and
   * `selectionContext` arrive decided by the composer, and nothing in this file
   * may construct either.
   */
  readonly queue: WorkbenchQueue;
  readonly stateId: string;
  /**
   * The loaded persona's history, or `NO_PERSONA_HISTORY`. Optional so every
   * existing caller keeps WB-1's behaviour without a change.
   */
  readonly history?: PersonaHistory;
}

export function buildScenario(options: BuildScenarioOptions): Scenario {
  const { vault, scheduler, queue, stateId } = options;
  const history = options.history ?? NO_PERSONA_HISTORY;
  const logged: LoggedEvent[] = [];

  const qa = queue.qa[0];
  const cloze = queue.cloze[0];
  const mcq = queue.mcq[0];
  if (qa === undefined || cloze === undefined || mcq === undefined) {
    throw new Error(
      'workbench: the composed session offers no Q&A, cloze or MCQ item — see src/queue/derive.ts',
    );
  }

  let eventCounter = 0;

  const reviewLog: ReviewSessionDeps['reviewLog'] = {
    async recordReview(input) {
      const result = await appendReviewLogRecord(
        vault,
        {
          timestamp: isoWithLocalOffset(WORKBENCH_NOW),
          instrumentId: input.instrument.instrumentId,
          instrumentType: input.instrument.type,
          conceptIds: [...input.instrument.conceptIds],
          rating: input.rating,
          wasUnsure: input.wasUnsure,
          // Real elapsed time would make every screenshot differ; the review-log
          // schema allows null and means it ("unknown"), so the workbench says so.
          durationMs: null,
          selectionContext: input.selectionContext,
        },
        {
          deviceId: WORKBENCH_DEVICE_ID,
          generateEventId: () => {
            eventCounter += 1;
            return `wb-event-${String(eventCounter).padStart(4, '0')}`;
          },
        },
      );
      logged.push({ path: result.path, json: JSON.stringify(result.record) });
    },
  };

  /**
   * Writes the same durable suspend event the plugin's own
   * `createVaultSuspendPort` does (`ol-xvmx`) — `SuspendPort.suspend` now
   * carries `conceptIds`, so this no longer has to stop at a `Notice` the way
   * it did while the port's signature couldn't produce a conforming record.
   * Shares `reviewLog`'s event-id counter above so every event this scenario
   * writes, suspend or review, gets a distinct deterministic id.
   */
  const suspendPort: ReviewSessionDeps['suspendPort'] = {
    async suspend(instrumentId, conceptIds): Promise<void> {
      await appendSuspendRecord(
        vault,
        {
          kind: 'suspend',
          timestamp: isoWithLocalOffset(WORKBENCH_NOW),
          instrumentId,
          conceptIds: [...conceptIds],
        },
        {
          deviceId: WORKBENCH_DEVICE_ID,
          generateEventId: () => {
            eventCounter += 1;
            return `wb-event-${String(eventCounter).padStart(4, '0')}`;
          },
        },
      );
    },
  };

  /**
   * `EditPort` opens the source note beside the session (F2.6). That is host
   * window management with no core-ward equivalent, so the workbench reports it
   * instead of faking an editor.
   */
  const editPort: ReviewSessionDeps['editPort'] = {
    edit(instrument): Promise<void> {
      new Notice(
        `Workbench: the product would open ${instrument.sourcePath} in a split. There is no editor here.`,
      );
      return Promise.resolve();
    },
  };

  const alwaysExists: ReviewSessionDeps['noteExists'] = {
    exists: () => Promise.resolve(true),
  };
  const neverSettles: ReviewSessionDeps['noteExists'] = {
    exists: () => new Promise<boolean>(() => undefined),
  };
  const neverExists: ReviewSessionDeps['noteExists'] = {
    exists: () => Promise.resolve(false),
  };

  const clock: ReviewSessionDeps['clock'] = { now: () => WORKBENCH_NOW };

  /**
   * `ol-p3t07a`: `WorkbenchQueue`'s items are always ordinary, already-
   * enumerated instruments (`draftId: null` — `queue-adapter.ts`'s `common()`
   * sets it and this file constructs no instrument literals of its own, see
   * this file's module doc), so nothing here should ever reach a still-
   * pending draft. Present because `ReviewSessionDeps` requires it.
   */
  const draftAcceptPort: ReviewSessionDeps['draftAcceptPort'] = {
    accept(): Promise<never> {
      return Promise.reject(
        new Error('workbench: no scenario composes a queue with a pending draft item'),
      );
    },
    reject(): Promise<never> {
      return Promise.reject(
        new Error('workbench: no scenario composes a queue with a pending draft item'),
      );
    },
  };

  const base = {
    scheduler,
    reviewLog,
    suspendPort,
    editPort,
    noteExists: alwaysExists,
    clock,
    draftAcceptPort,
  };

  const single = (item: ReviewQueueItem): readonly ReviewQueueItem[] => [item];

  switch (stateId) {
    case 'loading':
      return {
        deps: { ...base, noteExists: neverSettles, queue: single(qa) },
        keys: [],
        logged,
      };

    case 'empty':
      return {
        deps: {
          ...base,
          queue: [],
          // With a persona loaded this is the soonest FSRS due date across her
          // whole deck, derived from replaying her own stream — including the
          // `null` the empty-history edge case correctly produces, which is the
          // "Nothing is due right now" branch of F2.2. Without one it is WB-1's
          // written-down word.
          nextDueLabel: history.id === 'none' ? 'tomorrow' : history.nextDueLabel,
        },
        keys: [],
        logged,
      };

    case 'qa-front':
      return { deps: { ...base, queue: single(qa) }, keys: [], logged };

    case 'heading-offer-banner':
      // The banner itself is `main.ts`'s concern (`buildHeadingOfferFixture`,
      // passed straight to `ReviewView`'s own constructor argument) — this
      // state reuses `qa-front`'s exact deps and keys because the banner
      // mounts over whatever screen has a current item, and Q&A front is the
      // plainest one.
      return { deps: { ...base, queue: single(qa) }, keys: [], logged };

    case 'qa-reveal':
      return { deps: { ...base, queue: single(qa) }, keys: [' '], logged };

    case 'cloze-front':
      return { deps: { ...base, queue: single(cloze) }, keys: [], logged };

    case 'cloze-reveal':
      return { deps: { ...base, queue: single(cloze) }, keys: [' '], logged };

    case 'mcq-open':
      return { deps: { ...base, queue: single(mcq) }, keys: [], logged };

    case 'mcq-answered-correct':
      return {
        deps: { ...base, queue: single(mcq) },
        keys: [mcqLetter(mcq.instrument, true)],
        logged,
      };

    case 'mcq-answered-wrong':
      return {
        deps: { ...base, queue: single(mcq) },
        keys: [mcqLetter(mcq.instrument, false)],
        logged,
      };

    case 'mcq-answered-guessed':
      return {
        deps: { ...base, queue: single(mcq) },
        keys: [mcqLetter(mcq.instrument, true), 'g'],
        logged,
      };

    case 'note-missing':
      return {
        deps: { ...base, noteExists: neverExists, queue: single(qa) },
        keys: [],
        logged,
      };

    case 'session-complete': {
      // Three items straight through, drawn from what the composer actually
      // offered: two cards and a cloze, deduplicated by instrument id so a
      // corpus offering the same item twice cannot inflate the summary.
      const candidates = [queue.qa[0], queue.cloze[0], queue.qa[1]];
      const chosen: ReviewQueueItem[] = [];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (candidate === undefined) continue;
        if (seen.has(candidate.instrument.instrumentId)) continue;
        seen.add(candidate.instrument.instrumentId);
        chosen.push(candidate);
      }
      const ratingKey = ['again', 'hard', 'good', 'easy'].indexOf(RATE_GOOD) + 1;
      const keys = chosen.flatMap(() => [' ', String(ratingKey)]);
      return { deps: { ...base, queue: chosen }, keys, logged };
    }

    default:
      throw new Error(`workbench: unknown state ${JSON.stringify(stateId)}`);
  }
}
