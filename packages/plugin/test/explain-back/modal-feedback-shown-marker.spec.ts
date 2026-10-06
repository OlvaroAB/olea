/**
 * `[D-460]` (`ol-egov.141.89.6.86`): the explain-back view writes the feedback exposure marker
 * BEFORE the graded result renders, and a failed write still shows her the result while this
 * session holds the exposure as shown. Behavioural, through the view's own `submitAnswer`,
 * `discardGrading` and `onClose`.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.4 (continued) / [D-460]".
 *
 * `modal.ts` extends Obsidian's `Modal`, which cannot load under Vitest, so this file supplies a
 * bare `Modal` base and stands in for the two modules that need a real Obsidian, exactly as
 * `modal-idempotency.spec.ts` does. `render` is replaced by a recorder, so the order of what
 * was written and what was drawn is observable. Structural placeholders throughout (INV-3).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_ATTEMPT_SEQUENCE,
  type SealedAttemptSupport,
  sealAttemptSupport,
} from '../../src/explain-back/attempt-sequence.js';
import {
  createFeedbackExposureLedger,
  type FeedbackExposureLedger,
  type RecordFeedbackShown,
  resolvePriorAttemptState,
} from '../../src/explain-back/feedback-exposure.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';

vi.mock('obsidian', () => ({
  Modal: class {
    contentEl = { empty: () => {} };
    titleEl = {};
    constructor(readonly app: unknown) {}
  },
}));
vi.mock('../../src/registry/obsidian-ports.js', () => ({ openRegistryEntryFor: () => {} }));
vi.mock('../../src/sprig/render-sprig.js', () => ({ renderSprig: () => {} }));

const NOW = new Date('2026-10-05T14:15:00Z');
const INSTRUMENT = 'instrument-1';
const UNAIDED = { hintOffered: false, sourceShownWhileAnswering: false } as const;
const GRADED = { grading: { outcome: 'graded', verdict: 'partial' } } as never;
const UNABLE = { grading: { outcome: 'unable-to-assess' } } as never;

const PROMPT = {
  context: {
    question: 'Why does X happen?',
    referenceAnswer: 'Because Y drives Z.',
    sourceBlocks: [],
    misconceptionDigest: [],
  },
  subjectConceptId: null,
  originInstrumentId: INSTRUMENT,
  conceptIds: [],
  sourceBlocks: [],
};

interface Internals {
  state: {
    phase: string;
    attemptId?: string;
    support?: SealedAttemptSupport;
    prompt?: unknown;
    answer?: string;
    pending?: unknown;
    durationMs?: number | null;
  };
  render: () => void;
  submitAnswer: (prompt: unknown, answer: string) => Promise<void>;
  discardGrading: (
    prompt: unknown,
    answer: string,
    pending: unknown,
    durationMs: number | null,
    attemptId: string,
    support: SealedAttemptSupport,
  ) => void;
  onClose: () => void;
}

type GradeResult = 'graded' | 'unable-to-assess' | 'unavailable' | 'check-failed';

async function openView(params: {
  readonly grade?: () => Promise<unknown>;
  readonly result?: GradeResult;
  readonly recordFeedbackShown?: RecordFeedbackShown;
  readonly ledger?: FeedbackExposureLedger;
  readonly events?: string[];
}) {
  const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
  const events = params.events ?? [];
  const ids = ['attempt-1', 'attempt-2', 'attempt-3'];
  const result = params.result ?? 'graded';
  const grade =
    params.grade ??
    (() => {
      if (result === 'unavailable') return Promise.resolve(null);
      if (result === 'check-failed') return Promise.reject(new Error('socket closed'));
      return Promise.resolve(result === 'graded' ? GRADED : UNABLE);
    });
  const ledger = params.ledger ?? createFeedbackExposureLedger();
  const modal = new ExplainBackModal(
    {} as never,
    {
      grade,
      acceptWithObservation: vi.fn(),
      retrieveSourceBlocks: vi.fn(),
      buildObservationContext: vi.fn(),
      generateInstrumentId: () => ids.shift() ?? 'extra',
      feedbackExposureLedger: ledger,
      now: () => NOW,
      ...(params.recordFeedbackShown ? { recordFeedbackShown: params.recordFeedbackShown } : {}),
    } as never,
    { kind: 'freeform' },
  );
  const internals = modal as unknown as Internals;
  internals.render = () => {
    events.push(`render:${internals.state.phase}`);
  };
  return { internals, ledger, events };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('the marker is written before the graded result appears ([D-460])', () => {
  it('the result renders only once the marker write has settled', async () => {
    const events: string[] = [];
    let releaseWrite: () => void = () => {};
    const recordFeedbackShown = vi.fn(() => {
      events.push('write:start');
      return new Promise<void>((resolve) => {
        releaseWrite = () => {
          events.push('write:settled');
          resolve();
        };
      });
    });
    const { internals } = await openView({ recordFeedbackShown, events });

    const submitted = internals.submitAnswer(PROMPT, 'an answer');
    await vi.waitFor(() => expect(recordFeedbackShown).toHaveBeenCalledTimes(1));
    // The grading has returned and the write is in flight: nothing graded is on screen yet.
    expect(internals.state.phase).toBe('grading');
    expect(events).not.toContain('render:graded');

    releaseWrite();
    await submitted;
    expect(events).toEqual(['render:grading', 'write:start', 'write:settled', 'render:graded']);
    expect(internals.state).toMatchObject({ phase: 'graded', attemptId: 'attempt-1' });
  });

  it('holds only the question, the attempt and the time', async () => {
    const recordFeedbackShown = vi.fn(async () => {});
    const { internals } = await openView({ recordFeedbackShown });

    await internals.submitAnswer(PROMPT, 'an answer');

    expect(recordFeedbackShown).toHaveBeenCalledTimes(1);
    expect(recordFeedbackShown).toHaveBeenCalledWith({
      timestamp: isoWithLocalOffset(NOW),
      instrumentId: INSTRUMENT,
      attemptId: 'attempt-1',
    });
    const [input] = recordFeedbackShown.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(Object.keys(input).sort()).toEqual(['attemptId', 'instrumentId', 'timestamp']);
    expect(JSON.stringify(input)).not.toContain('an answer');
  });

  it('a successful write is not repeated when she leaves the result', async () => {
    const recordFeedbackShown = vi.fn(async () => {});
    const { internals } = await openView({ recordFeedbackShown });

    await internals.submitAnswer(PROMPT, 'an answer');
    internals.onClose();

    expect(recordFeedbackShown).toHaveBeenCalledTimes(1);
  });

  it('unwired, the result renders exactly as before, and the session still notes it', async () => {
    const { internals, ledger, events } = await openView({});

    await internals.submitAnswer(PROMPT, 'an answer');

    expect(events).toEqual(['render:grading', 'render:graded']);
    expect(ledger.shown(INSTRUMENT)).toEqual({ attemptId: 'attempt-1' });
  });
});

describe('a failed marker write still shows her the result, and never reads as not shown in this session ([D-460])', () => {
  const failing = () => vi.fn(() => Promise.reject(new Error('write failed')));

  it('she still sees the graded result, and the failure is never thrown at her', async () => {
    const recordFeedbackShown = failing();
    const { internals, events } = await openView({ recordFeedbackShown });

    await expect(internals.submitAnswer(PROMPT, 'an answer')).resolves.toBeUndefined();

    expect(internals.state).toMatchObject({ phase: 'graded', attemptId: 'attempt-1' });
    expect(events).toEqual(['render:grading', 'render:graded']);
  });

  it('the failure is logged without content: no ids, no answer', async () => {
    const { internals } = await openView({ recordFeedbackShown: failing() });

    await internals.submitAnswer(PROMPT, 'an answer');

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls[0]?.[0]);
    expect(logged).not.toContain(INSTRUMENT);
    expect(logged).not.toContain('attempt-1');
    expect(logged).not.toContain('an answer');
  });

  it('a view opened again in this session reads shown, so its revision is guided, even though her log holds nothing', async () => {
    const { internals, ledger } = await openView({ recordFeedbackShown: failing() });
    await internals.submitAnswer(PROMPT, 'an answer');

    const prior = await resolvePriorAttemptState({
      instrumentId: INSTRUMENT,
      ledger,
      // Her log, where the marker never landed.
      readLogged: async () => ({ exposure: 'not-shown', lastAttemptId: null }),
    });

    expect(prior).toEqual({ exposure: 'shown', lastAttemptId: 'attempt-1' });
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED, prior).supportLevelShown).toBe(
      'guided',
    );
  });

  it('a revision in the same view after Try again is guided, never independent', async () => {
    const { internals } = await openView({ recordFeedbackShown: failing() });
    await internals.submitAnswer(PROMPT, 'an answer');
    const { prompt, answer, pending, durationMs, attemptId, support } = internals.state;
    internals.discardGrading(
      prompt,
      answer ?? '',
      pending,
      durationMs ?? null,
      attemptId ?? '',
      support as SealedAttemptSupport,
    );

    await internals.submitAnswer(PROMPT, 'a revised answer');

    expect(internals.state.support).toEqual({
      supportLevelShown: 'guided',
      followsAttemptId: 'attempt-1',
      feedbackExposure: 'shown',
    });
  });

  it('leaving the result without Try again or accepting writes the same marker once more', async () => {
    const recordFeedbackShown = failing();
    const { internals } = await openView({ recordFeedbackShown });
    await internals.submitAnswer(PROMPT, 'an answer');

    internals.onClose();
    await vi.waitFor(() => expect(recordFeedbackShown).toHaveBeenCalledTimes(2));

    expect(recordFeedbackShown.mock.calls[1]).toEqual(recordFeedbackShown.mock.calls[0]);
    // A second failure is absorbed too: closing never throws at her.
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2));
  });

  it('after Try again the set-aside record speaks for it, so closing writes no second marker', async () => {
    const recordFeedbackShown = failing();
    const { internals } = await openView({ recordFeedbackShown });
    await internals.submitAnswer(PROMPT, 'an answer');
    const { prompt, answer, pending, durationMs, attemptId, support } = internals.state;
    internals.discardGrading(
      prompt,
      answer ?? '',
      pending,
      durationMs ?? null,
      attemptId ?? '',
      support as SealedAttemptSupport,
    );

    internals.onClose();

    expect(recordFeedbackShown).toHaveBeenCalledTimes(1);
  });
});

describe('no marker where no feedback was shown ([D-460])', () => {
  for (const result of ['unable-to-assess', 'unavailable', 'check-failed'] as const) {
    it(`${result}: no marker is written and the session holds nothing as shown`, async () => {
      const recordFeedbackShown = vi.fn(async () => {});
      const { internals, ledger } = await openView({ result, recordFeedbackShown });

      await internals.submitAnswer(PROMPT, 'an answer');

      expect(recordFeedbackShown).not.toHaveBeenCalled();
      expect(ledger.shown(INSTRUMENT)).toBeUndefined();
    });
  }

  it('closed before the result arrived: no marker, no note, nothing drawn', async () => {
    let releaseGrade: (value: unknown) => void = () => {};
    const recordFeedbackShown = vi.fn(async () => {});
    const { internals, ledger, events } = await openView({
      grade: () =>
        new Promise((resolve) => {
          releaseGrade = resolve;
        }),
      recordFeedbackShown,
    });

    const submitted = internals.submitAnswer(PROMPT, 'an answer');
    internals.onClose();
    releaseGrade(GRADED);
    await submitted;

    expect(recordFeedbackShown).not.toHaveBeenCalled();
    expect(ledger.shown(INSTRUMENT)).toBeUndefined();
    expect(events).not.toContain('render:graded');
  });

  it('closed while the marker write was in flight: the result is never drawn, and the marker stands', async () => {
    let releaseWrite: () => void = () => {};
    const recordFeedbackShown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );
    const { internals, events } = await openView({ recordFeedbackShown });

    const submitted = internals.submitAnswer(PROMPT, 'an answer');
    await vi.waitFor(() => expect(recordFeedbackShown).toHaveBeenCalledTimes(1));
    internals.onClose();
    releaseWrite();
    await submitted;

    expect(events).not.toContain('render:graded');
    // Conservative: the marker may claim a result she did not see; it withholds credit, never grants it.
    expect(recordFeedbackShown).toHaveBeenCalledTimes(1);
  });
});
