/**
 * `[D-460]` (`ol-egov.141.89.6.86`), as the v0.9 view has it (`[D-603]`, F5.4 as amended;
 * `ol-egov.141.89.6.129`): what she is shown after an answer is the supporting passages, and the
 * exposure marker is written BEFORE they render. A failed write still shows her the passages, and
 * the view and this session hold the exposure as shown; leaving the passages writes the marker
 * once more. Behavioural, through the real view's own controls.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.4 (continued) / [D-460]": the
 * three scenarios tagged `modal-feedback-shown-marker.spec` (rewritten in place for `[D-603]`).
 *
 * `obsidian` is mocked with `./practice-view-harness.ts`'s `Modal`; the view renders into its DOM
 * stand-in. Structural placeholders throughout (INV-3).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_PASSAGES_HEADING,
  EXPLAIN_BACK_SUBMIT_LABEL,
} from '../../src/explain-back/copy.js';
import {
  createFeedbackExposureLedger,
  type FeedbackExposureLedger,
  type RecordFeedbackShown,
  resolvePriorAttemptState,
} from '../../src/explain-back/feedback-exposure.js';
import type { ViewPracticeExplanationInput } from '../../src/explain-back/practice-record.js';
import { EXPLAIN_BACK_SKIP_LABEL } from '../../src/explain-back/skip.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';
import {
  INSTRUMENT,
  NOW,
  retrieveFor,
  SUBJECT_PASSAGES,
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

const QUESTION = INSTRUMENT.instrumentId;

async function openView(params: {
  readonly recordFeedbackShown?: RecordFeedbackShown;
  readonly ledger?: FeedbackExposureLedger;
  readonly events?: string[];
}) {
  const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
  const events = params.events ?? [];
  const ids = ['attempt-1', 'attempt-2', 'attempt-3'];
  const ledger = params.ledger ?? createFeedbackExposureLedger();
  const practice = vi.fn(async (_input: ViewPracticeExplanationInput) => ({
    written: false as const,
    record: {} as never,
  }));
  const view = new ExplainBackModal(
    {} as never,
    {
      retrieveSourceBlocks: retrieveFor,
      generateInstrumentId: () => ids.shift() ?? 'extra',
      feedbackExposureLedger: ledger,
      now: () => NOW,
      recordPracticeExplanation: practice,
      ...(params.recordFeedbackShown ? { recordFeedbackShown: params.recordFeedbackShown } : {}),
    },
    { kind: 'instrument', instrument: INSTRUMENT },
  ) as unknown as ViewInternals;
  view.onOpen();
  await vi.waitFor(() => expect(view.state.phase).toBe('answering'));
  const render = view.render.bind(view);
  view.render = () => {
    events.push(`render:${view.state.phase}`);
    render();
  };
  return { view, ledger, events, practice };
}

function submitAnswer(view: ViewInternals, text: string): void {
  submit(view.contentEl, text, EXPLAIN_BACK_SUBMIT_LABEL);
}

async function answer(view: ViewInternals, text: string): Promise<void> {
  submitAnswer(view, text);
  await vi.waitFor(() => expect(view.state.phase).toBe('passages'));
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('the marker is written before the supporting passages appear, and holds only the attempt’s identity and the time', () => {
  it('the passages render only once the marker write has settled', async () => {
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
    const { view } = await openView({ recordFeedbackShown, events });

    submitAnswer(view, 'an answer');
    await vi.waitFor(() => expect(recordFeedbackShown).toHaveBeenCalledTimes(1));
    // The write is in flight: no passage is on screen yet.
    expect(view.state.phase).toBe('revealing');
    expect(view.contentEl.texts()).not.toContain(EXPLAIN_BACK_PASSAGES_HEADING);

    releaseWrite();
    await vi.waitFor(() => expect(view.state.phase).toBe('passages'));
    expect(events).toEqual(['render:revealing', 'write:start', 'write:settled', 'render:passages']);
    expect(view.state).toMatchObject({ phase: 'passages', attemptId: 'attempt-1' });
  });

  it('holds only the question, the attempt and the time: no answer, passage or other text', async () => {
    const recordFeedbackShown = vi.fn(async () => {});
    const { view } = await openView({ recordFeedbackShown });

    await answer(view, 'an answer');

    expect(recordFeedbackShown).toHaveBeenCalledTimes(1);
    expect(recordFeedbackShown).toHaveBeenCalledWith({
      timestamp: isoWithLocalOffset(NOW),
      instrumentId: QUESTION,
      attemptId: 'attempt-1',
    });
    const [input] = recordFeedbackShown.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(Object.keys(input).sort()).toEqual(['attemptId', 'instrumentId', 'timestamp']);
    const serialised = JSON.stringify(input);
    expect(serialised).not.toContain('an answer');
    for (const p of SUBJECT_PASSAGES) expect(serialised).not.toContain(p.block.text);
  });

  it('a successful write is not repeated when she leaves the passages', async () => {
    const recordFeedbackShown = vi.fn(async () => {});
    const { view } = await openView({ recordFeedbackShown });

    await answer(view, 'an answer');
    view.contentEl.button(EXPLAIN_BACK_DONE_LABEL).click();

    expect(recordFeedbackShown).toHaveBeenCalledTimes(1);
  });

  it('unwired, the passages render as soon as she submits, and the session still notes the exposure', async () => {
    const { view, ledger, events } = await openView({});

    await answer(view, 'an answer');

    expect(events).toEqual(['render:revealing', 'render:passages']);
    expect(ledger.shown(QUESTION)).toEqual({ attemptId: 'attempt-1' });
  });
});

describe('a failed marker write still shows her the passages, and never reads as not shown in this session', () => {
  const failing = () => vi.fn(() => Promise.reject(new Error('write failed')));

  it('she still sees the passages, and the failure is never thrown at her', async () => {
    const recordFeedbackShown = failing();
    const { view, events } = await openView({ recordFeedbackShown });

    await answer(view, 'an answer');

    expect(view.state).toMatchObject({ phase: 'passages', attemptId: 'attempt-1' });
    expect(view.contentEl.texts()).toContain(EXPLAIN_BACK_PASSAGES_HEADING);
    expect(events).toEqual(['render:revealing', 'render:passages']);
  });

  it('the failure is logged without content: no ids, no answer', async () => {
    const { view } = await openView({ recordFeedbackShown: failing() });

    await answer(view, 'an answer');

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls[0]?.[0]);
    expect(logged).not.toContain(QUESTION);
    expect(logged).not.toContain('attempt-1');
    expect(logged).not.toContain('an answer');
  });

  it('this session holds the exposure as shown, even though her log holds nothing', async () => {
    const { view, ledger } = await openView({ recordFeedbackShown: failing() });
    await answer(view, 'an answer');

    const prior = await resolvePriorAttemptState({
      instrumentId: QUESTION,
      ledger,
      // Her log, where the marker never landed.
      readLogged: async () => ({ exposure: 'not-shown', lastAttemptId: null }),
    });

    expect(prior).toEqual({ exposure: 'shown', lastAttemptId: 'attempt-1' });
  });

  it('an answer she writes again here, after "Try again", carries the exposure', async () => {
    const { view, practice } = await openView({ recordFeedbackShown: failing() });
    await answer(view, 'an answer');
    view.contentEl.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    await answer(view, 'a revised answer');
    view.contentEl.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(practice).toHaveBeenCalledTimes(2));

    const revised = practice.mock.calls[1]?.[0];
    expect(revised?.attemptId).toBe('attempt-2');
    expect(revised?.passagesShownInView.map((shown) => shown.attemptId)).toEqual(['attempt-1']);
    expect(revised?.passagesShownInView[0]?.passageFingerprints).toHaveLength(
      SUBJECT_PASSAGES.length,
    );
  });

  it('leaving the passages by "Done" writes the same marker once more', async () => {
    const recordFeedbackShown = failing();
    const { view } = await openView({ recordFeedbackShown });
    await answer(view, 'an answer');

    view.contentEl.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(recordFeedbackShown).toHaveBeenCalledTimes(2));

    expect(recordFeedbackShown.mock.calls[1]).toEqual(recordFeedbackShown.mock.calls[0]);
    // A second failure is absorbed too: leaving never throws at her.
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2));
  });

  it('closing the view on the passages writes the same marker once more, and only once', async () => {
    const recordFeedbackShown = failing();
    const { view } = await openView({ recordFeedbackShown });
    await answer(view, 'an answer');

    view.onClose();
    await vi.waitFor(() => expect(recordFeedbackShown).toHaveBeenCalledTimes(2));
    expect(recordFeedbackShown.mock.calls[1]).toEqual(recordFeedbackShown.mock.calls[0]);
  });

  it('"Try again" writes it once more too: in v0.9 no set-aside record speaks for the exposure', async () => {
    const recordFeedbackShown = failing();
    const { view } = await openView({ recordFeedbackShown });
    await answer(view, 'an answer');

    view.contentEl.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    await vi.waitFor(() => expect(recordFeedbackShown).toHaveBeenCalledTimes(2));
    // Closing the answering phase afterwards writes no third marker.
    view.onClose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recordFeedbackShown).toHaveBeenCalledTimes(2);
  });
});

describe('no marker where no passages were shown', () => {
  it('a skip: no marker is written and the session holds nothing as shown', async () => {
    const recordFeedbackShown = vi.fn(async () => {});
    const { view, ledger } = await openView({ recordFeedbackShown });

    view.contentEl.button(EXPLAIN_BACK_SKIP_LABEL).click();

    expect(recordFeedbackShown).not.toHaveBeenCalled();
    expect(ledger.shown(QUESTION)).toBeUndefined();
  });

  it('a prompt closed without an answer: no marker, no note', async () => {
    const recordFeedbackShown = vi.fn(async () => {});
    const { view, ledger } = await openView({ recordFeedbackShown });

    view.onClose();

    expect(recordFeedbackShown).not.toHaveBeenCalled();
    expect(ledger.shown(QUESTION)).toBeUndefined();
  });

  it('closed while the marker write was in flight: the passages are never drawn, and the marker stands', async () => {
    let releaseWrite: () => void = () => {};
    const recordFeedbackShown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );
    const { view, events } = await openView({ recordFeedbackShown });

    submitAnswer(view, 'an answer');
    await vi.waitFor(() => expect(recordFeedbackShown).toHaveBeenCalledTimes(1));
    view.onClose();
    releaseWrite();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).not.toContain('render:passages');
    // Conservative: the marker may claim passages she did not see; it withholds, never grants.
    expect(recordFeedbackShown).toHaveBeenCalledTimes(1);
  });
});
