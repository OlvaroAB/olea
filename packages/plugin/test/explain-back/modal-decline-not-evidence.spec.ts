/**
 * `[D-564]` (c) condition 2 (`ol-egov.141.89.6.113`): no decline is evidence, whichever kind. For
 * each of the three kinds, through the view's own `submitAnswer`, the unable-to-assess render and
 * `discardGrading`: no verdict, attainment or review is recorded, no misconception is observed,
 * the depth pass never runs, and the only write is the set-aside record, which carries no verdict.
 * Scenario: `features/F5-explain-it-back.md` (olea-service), "no decline is evidence".
 *
 * `modal.ts` cannot load real Obsidian under Vitest, so this stands in for it exactly as
 * `modal-feedback-shown-marker.spec.ts` does. Structural placeholders throughout (INV-3).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SealedAttemptSupport } from '../../src/explain-back/attempt-sequence.js';
import {
  EXPLAIN_BACK_DECLINED_DEFECTIVE_QUESTION_MESSAGE,
  EXPLAIN_BACK_DECLINED_INSUFFICIENT_MATERIAL_MESSAGE,
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE,
} from '../../src/explain-back/copy.js';
import type { ExplainBackDeclineKind } from '../../src/explain-back/decline-kind.js';

vi.mock('obsidian', () => ({
  Modal: class {
    contentEl = { empty: () => {} };
    titleEl = {};
    constructor(readonly app: unknown) {}
  },
}));
vi.mock('../../src/registry/obsidian-ports.js', () => ({ openRegistryEntryFor: () => {} }));
vi.mock('../../src/sprig/render-sprig.js', () => ({ renderSprig: () => {} }));

const NOW = new Date('2026-10-21T10:00:00Z');
const INSTRUMENT = 'instrument-1';

const PROMPT = {
  context: {
    question: 'Why does X happen?',
    referenceAnswer: 'Because Y drives Z.',
    sourceBlocks: [],
    misconceptionDigest: [],
  },
  subjectConceptId: 'concept-1',
  originInstrumentId: INSTRUMENT,
  conceptIds: ['concept-1'],
  sourceBlocks: [],
};

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

interface Internals {
  state: { phase: string; pending?: unknown; attemptId?: string; support?: SealedAttemptSupport };
  render: () => void;
  submitAnswer: (prompt: unknown, answer: string) => Promise<void>;
  renderUnableToAssessPhase: (
    root: unknown,
    prompt: unknown,
    answer: string,
    pending: unknown,
    durationMs: number | null,
    attemptId: string,
    support: SealedAttemptSupport,
  ) => void;
}

interface FakeEl {
  readonly kind: string;
  readonly text: string;
  readonly children: FakeEl[];
  readonly handlers: Record<string, () => void>;
  createEl: (tag: string, opts?: { text?: string }) => FakeEl;
  createDiv: (opts?: { text?: string }) => FakeEl;
  addEventListener: (name: string, handler: () => void) => void;
}

function fakeEl(kind: string, text = ''): FakeEl {
  const el: FakeEl = {
    kind,
    text,
    children: [],
    handlers: {},
    createEl(tag, opts) {
      const child = fakeEl(tag, opts?.text ?? '');
      el.children.push(child);
      return child;
    },
    createDiv(opts) {
      const child = fakeEl('div', opts?.text ?? '');
      el.children.push(child);
      return child;
    },
    addEventListener(name, handler) {
      el.handlers[name] = handler;
    },
  };
  return el;
}

function flatten(el: FakeEl): FakeEl[] {
  return [el, ...el.children.flatMap(flatten)];
}

async function openDecliningView(reason: string | undefined) {
  const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
  const pending = {
    grading: { outcome: 'unable-to-assess', ...(reason !== undefined ? { reason } : {}) },
  };
  const writes = {
    acceptWithObservation: vi.fn(),
    recordSoloGradeAndReview: vi.fn(),
    recordSetAsideAttempt: vi.fn(async () => {}),
    recordFeedbackShown: vi.fn(async () => {}),
    recordNonAttempt: vi.fn(async () => {}),
    buildObservationContext: vi.fn(),
    retrieveSourceBlocks: vi.fn(),
  };
  const ids = ['attempt-1', 'attempt-2'];
  const modal = new ExplainBackModal(
    {} as never,
    {
      grade: () => Promise.resolve(pending),
      generateInstrumentId: () => ids.shift() ?? 'extra',
      now: () => NOW,
      ...writes,
    } as never,
    { kind: 'freeform' },
  );
  const internals = modal as unknown as Internals;
  internals.render = () => {};
  return { internals, writes, pending };
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe.each(CASES)('a $kind decline ($reason) is never evidence', ({ reason, message }) => {
  it('shows its message and the one Try again action, nothing graded', async () => {
    const { internals, pending } = await openDecliningView(reason);
    await internals.submitAnswer(PROMPT, 'an answer');
    expect(internals.state.phase).toBe('graded');

    const root = fakeEl('root');
    internals.renderUnableToAssessPhase(
      root,
      PROMPT,
      'an answer',
      pending,
      null,
      'attempt-1',
      internals.state.support as SealedAttemptSupport,
    );
    const all = flatten(root).slice(1);
    expect(all.find((e) => e.kind === 'p')?.text).toBe(message);
    const buttons = all.filter((e) => e.kind === 'button');
    expect(buttons.map((b) => b.text)).toEqual([EXPLAIN_BACK_DISCARD_LABEL]);
  });

  it('records no verdict, no attainment, no misconception and runs no depth pass, on show or on Try again', async () => {
    const { internals, writes } = await openDecliningView(reason);
    await internals.submitAnswer(PROMPT, 'an answer');
    const state = internals.state as unknown as Record<string, unknown>;
    const discard = (internals as unknown as { discardGrading: (...a: unknown[]) => void })
      .discardGrading;
    discard.call(
      internals,
      PROMPT,
      'an answer',
      state.pending,
      null,
      state.attemptId,
      state.support,
    );
    await vi.waitFor(() => expect(writes.recordSetAsideAttempt).toHaveBeenCalledTimes(1));

    // Nothing that records a verdict, attainment, a review or a misconception, and no depth pass.
    expect(writes.acceptWithObservation).not.toHaveBeenCalled();
    expect(writes.recordSoloGradeAndReview).not.toHaveBeenCalled();
    expect(writes.buildObservationContext).not.toHaveBeenCalled();
    expect(writes.retrieveSourceBlocks).not.toHaveBeenCalled();
    expect(writes.recordNonAttempt).not.toHaveBeenCalled();
    // No feedback was shown, so no exposure marker either.
    expect(writes.recordFeedbackShown).not.toHaveBeenCalled();

    // The one write is the set-aside record, which carries no verdict.
    const calls = writes.recordSetAsideAttempt.mock.calls as unknown as [
      { outcome: Record<string, unknown>; acceptance?: string },
    ][];
    const input = calls[0]?.[0];
    expect(input?.outcome).toEqual({ kind: 'unable-to-assess' });
    expect(JSON.stringify(input)).not.toMatch(/verdict|incorrect|correct|misconception/i);
  });
});
