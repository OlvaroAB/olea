/**
 * `[D-564]` (c) condition 2 (`ol-egov.141.89.6.113`): no decline is evidence, whichever kind. As
 * v0.9 has it (`[D-603]`, `ol-egov.141.89.6.129`) no answer goes to grading, so no decline can
 * reach the view at all: a judge standing ready to decline every kind is never asked, the view
 * shows none of the decline messages, and her answer is the practice it is — no verdict, no
 * attainment, no review, no misconception, no depth pass and no set-aside record. The message
 * each kind would get stays `./decline-kind.ts`'s, checked here as the function it is, for when
 * grading returns (the F5 heading note).
 *
 * Scenario: `features/F5-explain-it-back.md` (olea-service), "no decline is evidence, whichever
 * kind it is" (dormant in v0.9). The view renders for real into `./practice-view-harness.ts`'s
 * stand-in (`obsidian` mocked). Structural placeholders throughout (INV-3).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EXPLAIN_BACK_DECLINED_DEFECTIVE_QUESTION_MESSAGE,
  EXPLAIN_BACK_DECLINED_INSUFFICIENT_MATERIAL_MESSAGE,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_SUBMIT_LABEL,
  EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE,
} from '../../src/explain-back/copy.js';
import {
  declineKindOf,
  declineMessageFor,
  type ExplainBackDeclineKind,
} from '../../src/explain-back/decline-kind.js';
import {
  INSTRUMENT,
  NOW,
  retrieveFor,
  submit,
  type ViewInternals,
} from './practice-view-harness.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

// The first import of the view (and `olea-core` behind it) can outlast a test's own timeout on a
// loaded machine; it is made once, here, so each test times only its own work.
beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

const CASES: readonly {
  readonly kind: ExplainBackDeclineKind;
  readonly reason: string | undefined;
  readonly message: string;
}[] = [
  { kind: 'non-attempt', reason: 'blank answer', message: EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE },
  { kind: 'non-attempt', reason: undefined, message: EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE },
  {
    kind: 'insufficient-material',
    reason: 'insufficient-material: the notes do not cover it',
    message: EXPLAIN_BACK_DECLINED_INSUFFICIENT_MATERIAL_MESSAGE,
  },
  {
    kind: 'defective-question',
    reason: 'defective-question: it contradicts itself',
    message: EXPLAIN_BACK_DECLINED_DEFECTIVE_QUESTION_MESSAGE,
  },
];

const ALL_DECLINE_MESSAGES = [...new Set(CASES.map((c) => c.message))];

describe.each(CASES)('a $kind decline ($reason) is never evidence', ({ kind, reason, message }) => {
  it('the dormant message for it is unchanged, for when grading returns', () => {
    expect(declineKindOf(reason)).toBe(kind);
    expect(declineMessageFor(kind)).toBe(message);
  });

  it('v0.9: the judge that would decline is never asked, nothing is recorded as a verdict, and no decline is shown', async () => {
    const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
    const declining = {
      grading: { outcome: 'unable-to-assess', ...(reason !== undefined ? { reason } : {}) },
    };
    const writes = {
      grade: vi.fn(async () => declining as never),
      acceptWithObservation: vi.fn(),
      recordSoloGradeAndReview: vi.fn(),
      recordSetAsideAttempt: vi.fn(async () => {}),
      buildObservationContext: vi.fn(),
      recordNonAttempt: vi.fn(async () => {}),
    };
    const practice = vi.fn(async () => ({ written: false as const, record: {} as never }));
    const shown: string[] = [];
    const view = new ExplainBackModal(
      {} as never,
      {
        retrieveSourceBlocks: retrieveFor,
        generateInstrumentId: () => 'attempt-1',
        now: () => NOW,
        recordPracticeExplanation: practice,
        ...writes,
      },
      { kind: 'instrument', instrument: INSTRUMENT },
    ) as unknown as ViewInternals;
    const render = view.render.bind(view);
    view.render = () => {
      render();
      shown.push(...view.contentEl.texts());
    };
    view.onOpen();
    await vi.waitFor(() => expect(view.state.phase).toBe('answering'));
    submit(view.contentEl, 'an answer', EXPLAIN_BACK_SUBMIT_LABEL);
    await vi.waitFor(() => expect(view.state.phase).toBe('passages'));
    view.contentEl.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(practice).toHaveBeenCalledTimes(1));

    for (const declineMessage of ALL_DECLINE_MESSAGES) expect(shown).not.toContain(declineMessage);
    expect(writes.grade).not.toHaveBeenCalled();
    expect(writes.acceptWithObservation).not.toHaveBeenCalled();
    expect(writes.recordSoloGradeAndReview).not.toHaveBeenCalled();
    expect(writes.buildObservationContext).not.toHaveBeenCalled();
    expect(writes.recordSetAsideAttempt).not.toHaveBeenCalled();
    expect(writes.recordNonAttempt).not.toHaveBeenCalled();
    // Her answer's one record is the practice explanation, which carries no verdict.
    expect(JSON.stringify(practice.mock.calls[0])).not.toMatch(
      /verdict|incorrect|correct|misconception|unable-to-assess/i,
    );
  });
});
