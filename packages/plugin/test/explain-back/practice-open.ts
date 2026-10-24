/**
 * Opens the real `ExplainBackModal` over `./practice-view-harness.ts`'s DOM stand-in with spies on
 * every write and on the history opener, for the exit and no-passages specs
 * (`practice-exit.spec.ts`, `practice-no-passages.spec.ts`; `ol-egov.141.89.6.143`). The calling
 * spec mocks `obsidian` and `render-sprig` itself (`vi.mock` is per file). Synthetic data only.
 */

import { expect, vi } from 'vitest';
import { EXPLAIN_BACK_SUBMIT_LABEL } from '../../src/explain-back/copy.js';
import type { ViewPracticeExplanationInput } from '../../src/explain-back/practice-record.js';
import type { ExplainBackSourceBlock } from '../../src/explain-back/request.js';
import {
  type FakeEl,
  INSTRUMENT,
  NOW,
  retrieveFor,
  SUBJECT_KEY,
  submit,
  type ViewInternals,
} from './practice-view-harness.js';

export interface OpenedView {
  readonly modal: ViewInternals;
  readonly root: FakeEl;
  readonly practice: ReturnType<typeof vi.fn>;
  readonly marker: ReturnType<typeof vi.fn>;
  readonly nonAttempt: ReturnType<typeof vi.fn>;
  readonly retrieve: ReturnType<typeof vi.fn>;
  readonly openHistory: ReturnType<typeof vi.fn>;
  /** Every `inputs` the practice writer was called with, in order. */
  readonly saved: () => ViewPracticeExplanationInput[];
}

export async function openView(
  options: {
    readonly seed?: 'concept' | 'freeform';
    readonly topicMatch?: 'unique' | 'none';
    readonly marker?: (input: unknown) => Promise<void>;
    readonly passages?: readonly ExplainBackSourceBlock[];
    readonly searchAvailable?: boolean;
    readonly withPractice?: boolean;
  } = {},
): Promise<OpenedView> {
  const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
  const seed = options.seed ?? 'concept';
  const ids = ['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4'];
  let clock = NOW.getTime();
  const practice = vi.fn(async (input: ViewPracticeExplanationInput) => ({
    written: true as const,
    record: { attemptId: input.attemptId } as never,
    path: '.olea/reviews/x.jsonl' as never,
    contentId: 'content-1',
  }));
  const marker = vi.fn(options.marker ?? (async () => {}));
  const nonAttempt = vi.fn(async () => {});
  const openHistory = vi.fn(async () => {});
  const retrieve = vi.fn(async (query: string) => options.passages ?? (await retrieveFor(query)));
  const modal = new ExplainBackModal(
    {} as never,
    {
      retrieveSourceBlocks: retrieve,
      generateInstrumentId: () => ids.shift() ?? 'extra',
      now: () => {
        clock += 1000;
        return new Date(clock);
      },
      recordFeedbackShown: marker,
      recordPracticeExplanation: practice,
      recordNonAttempt: nonAttempt,
      openHistory,
      ...(options.searchAvailable === false ? { searchAvailable: () => false } : {}),
      ...(seed === 'freeform' && options.topicMatch === 'unique'
        ? {
            matchFreeformTopicConcept: () => ({ kind: 'unique' as const, conceptId: SUBJECT_KEY }),
          }
        : {}),
    },
    seed === 'freeform' ? { kind: 'freeform' } : { kind: 'instrument', instrument: INSTRUMENT },
  ) as unknown as ViewInternals;
  modal.onOpen();
  if (seed === 'freeform') {
    const topic = modal.contentEl.fields()[0];
    if (topic === undefined) throw new Error('no topic field');
    topic.value = 'the coined process';
    modal.contentEl.button('Continue').click();
  }
  await vi.waitFor(() => expect(modal.state.phase).toBe('answering'));
  return {
    modal,
    root: modal.contentEl,
    practice,
    marker,
    nonAttempt,
    retrieve,
    openHistory,
    saved: () => practice.mock.calls.map(([input]) => input as ViewPracticeExplanationInput),
  };
}

/** Types an answer, chooses "Show the passages" and waits for the passages phase. */
export async function answer(opened: OpenedView, text: string): Promise<void> {
  submit(opened.root, text, EXPLAIN_BACK_SUBMIT_LABEL);
  await vi.waitFor(() => expect(opened.modal.state.phase).toBe('passages'));
}

/** Lets pending microtasks and timers settle, so "exactly once" is read after any late second call. */
export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
