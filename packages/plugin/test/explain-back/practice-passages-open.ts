/**
 * Opens the real `ExplainBackModal` for the passage specs (`ol-egov.141.89.6.146`, `[D-633]`) with
 * the retrieval, the causes partner and the transcript host chosen by the spec, and reads back the
 * passages as she sees them. The calling spec mocks `obsidian` and `render-sprig` itself. Synthetic data.
 */

import { expect, vi } from 'vitest';
import { EXPLAIN_BACK_SUBMIT_LABEL } from '../../src/explain-back/copy.js';
import type { ExplainBackModalDeps } from '../../src/explain-back/modal.js';
import type { ViewPracticeExplanationInput } from '../../src/explain-back/practice-record.js';
import type { ExplainBackSourceBlock } from '../../src/explain-back/request.js';
import {
  type FakeEl,
  INSTRUMENT,
  introducingPassageFor,
  NOW,
  relationPartner,
  SUBJECT_KEY,
  submit,
  type ViewInternals,
} from './practice-view-harness.js';

export interface PassageView {
  readonly modal: ViewInternals;
  readonly root: FakeEl;
  readonly retrieve: ReturnType<typeof vi.fn>;
}

export async function openPassages(options: {
  readonly retrieve: (
    query: string,
    courseCode?: string | null,
  ) => Promise<readonly ExplainBackSourceBlock[]>;
  readonly seed?: 'concept' | 'relation' | 'freeform';
  readonly extraDeps?: Partial<ExplainBackModalDeps>;
}): Promise<PassageView> {
  const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
  const seed = options.seed ?? 'concept';
  const ids = ['attempt-1', 'attempt-2'];
  let clock = NOW.getTime();
  const retrieve = vi.fn(options.retrieve);
  const modal = new ExplainBackModal(
    {} as never,
    {
      retrieveSourceBlocks: retrieve,
      generateInstrumentId: () => ids.shift() ?? 'extra',
      now: () => {
        clock += 1000;
        return new Date(clock);
      },
      recordFeedbackShown: vi.fn(async () => {}),
      recordPracticeExplanation: vi.fn(async (input: ViewPracticeExplanationInput) => ({
        written: true as const,
        record: { attemptId: input.attemptId } as never,
        path: '.olea/reviews/x.jsonl' as never,
        contentId: 'content-1',
      })),
      recordNonAttempt: vi.fn(async () => {}),
      openHistory: vi.fn(async () => {}),
      ...(seed === 'relation'
        ? {
            resolveCausesPartner: (subject: string) =>
              subject === SUBJECT_KEY ? relationPartner() : undefined,
            resolveIntroducingPassage: introducingPassageFor,
          }
        : {}),
      ...(seed === 'freeform'
        ? {
            matchFreeformTopicConcept: () => ({ kind: 'unique' as const, conceptId: SUBJECT_KEY }),
          }
        : {}),
      ...options.extraDeps,
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
  return { modal, root: modal.contentEl, retrieve };
}

/** Types an answer, chooses "Show the passages" and waits for the passages phase. */
export async function answerPassages(view: PassageView, text: string): Promise<void> {
  submit(view.root, text, EXPLAIN_BACK_SUBMIT_LABEL);
  await vi.waitFor(() => expect(view.modal.state.phase).toBe('passages'));
}

/** The passages on screen: each one's text and its label (`null` when it has none), in order. */
export function shownPassages(root: FakeEl): { text: string; label: string | null }[] {
  return root.withClass('olea-explain-back-item').map((row) => ({
    text: row.children.find((c) => c.classes.includes('olea-explain-back-item-text'))?.text ?? '',
    label: row.children.find((c) => c.classes.includes('olea-explain-back-cite'))?.text ?? null,
  }));
}
