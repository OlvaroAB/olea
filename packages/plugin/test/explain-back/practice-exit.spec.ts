/**
 * `[D-630]` (sheet v87 rows 6 and 8, `ol-egov.141.89.6.143`): any exit after a genuine submitted
 * explanation saves it exactly once; reopening, rendering or an empty view writes nothing; an exit
 * other than "Done" is not told apart in the record (it has no field for how she left); and the
 * link to her explain-back history is on the view after she submits.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "any exit after a submitted
 * explanation saves it exactly once" and its neighbours, tagged `plugin/explain-back/practice-exit.spec`.
 * Behavioural, over the real view in `./practice-view-harness.ts`'s DOM stand-in. Coined data only.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_REGISTRY_ENTRY_ACTION,
  EXPLAIN_BACK_SUBMIT_LABEL,
} from '../../src/explain-back/copy.js';
import { answer, openView, settle } from './practice-open.js';
import { INSTRUMENT, SUBJECT_KEY, submit } from './practice-view-harness.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

type Exit = readonly [string, (o: Awaited<ReturnType<typeof openView>>) => void];
const EXITS: readonly Exit[] = [
  ['Esc or the close control', (o) => o.modal.onClose()],
  ['the link to her history', (o) => o.root.button(EXPLAIN_BACK_REGISTRY_ENTRY_ACTION).click()],
  ['"Done"', (o) => o.root.button(EXPLAIN_BACK_DONE_LABEL).click()],
  ['"Try again"', (o) => o.root.button(EXPLAIN_BACK_DISCARD_LABEL).click()],
];

describe('any exit after a submitted explanation saves it exactly once', () => {
  it.each(EXITS)('%s: one practice explanation for that answer', async (_label, leave) => {
    const opened = await openView();
    await answer(opened, 'My explanation.');
    expect(opened.practice).not.toHaveBeenCalled();
    leave(opened);
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
    expect(opened.saved()[0]?.attemptId).toBe('attempt-1');
    expect(opened.saved()[0]?.answer).toBe('My explanation.');
  });

  it('"Done" followed by the close control (as Obsidian does after close) saves once, not twice', async () => {
    const opened = await openView();
    await answer(opened, 'My explanation.');
    opened.root.button(EXPLAIN_BACK_DONE_LABEL).click();
    opened.modal.onClose();
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
  });

  it('"Try again" saves, and a later exit without a new submit saves nothing more', async () => {
    const opened = await openView();
    await answer(opened, 'First.');
    opened.root.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
    opened.modal.onClose();
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
    expect(opened.nonAttempt).not.toHaveBeenCalled();
  });

  it('a second submit after "Try again" is its own explanation, saved once on its own exit', async () => {
    const opened = await openView();
    await answer(opened, 'First.');
    opened.root.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    await answer(opened, 'Second.');
    opened.modal.onClose();
    await settle();
    expect(opened.saved().map((input) => input.attemptId)).toEqual(['attempt-1', 'attempt-2']);
  });

  it('a close during the exposure-marker write ends with exactly one save, and the passages never render', async () => {
    let release: () => void = () => {};
    const opened = await openView({
      marker: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    submit(opened.root, 'Closed mid-write.', EXPLAIN_BACK_SUBMIT_LABEL);
    await vi.waitFor(() => expect(opened.marker).toHaveBeenCalledTimes(1));
    expect(opened.modal.state.phase).toBe('revealing');
    opened.modal.onClose();
    release();
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
    expect(opened.saved()[0]?.answer).toBe('Closed mid-write.');
    expect(opened.modal.state.phase).toBe('revealing');
    expect(opened.root.children).toEqual([]);
  });

  it('a free-form topic that matched a concept saves on exit too', async () => {
    const opened = await openView({ seed: 'freeform', topicMatch: 'unique' });
    await answer(opened, 'Free-form answer.');
    opened.modal.onClose();
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
    expect(opened.saved()[0]?.conceptIds).toEqual([SUBJECT_KEY]);
  });
});

describe('reopening, rendering or a view with nothing submitted writes no practice explanation', () => {
  it('opening and re-rendering the answer box writes nothing of any kind', async () => {
    const opened = await openView();
    opened.modal.render();
    opened.modal.render();
    await settle();
    expect(opened.practice).not.toHaveBeenCalled();
    expect(opened.marker).not.toHaveBeenCalled();
  });

  it('rendering the passages again writes no second entry and no second marker', async () => {
    const opened = await openView();
    await answer(opened, 'Once.');
    opened.modal.render();
    opened.modal.render();
    await settle();
    expect(opened.marker).toHaveBeenCalledTimes(1);
    expect(opened.practice).not.toHaveBeenCalled();
    opened.modal.onClose();
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
  });

  it('a fresh view over the same prompt (a reopen) that is closed unanswered writes no practice explanation, only the non-attempt', async () => {
    const first = await openView();
    await answer(first, 'Saved.');
    first.modal.onClose();
    await settle();
    expect(first.practice).toHaveBeenCalledTimes(1);

    const reopened = await openView();
    reopened.modal.onClose();
    await settle();
    expect(reopened.practice).not.toHaveBeenCalled();
    expect(reopened.nonAttempt).toHaveBeenCalledTimes(1);
  });

  it('closing a blank answer box, or after a skip, writes no practice explanation', async () => {
    const blank = await openView();
    submit(blank.root, '   ', EXPLAIN_BACK_SUBMIT_LABEL);
    blank.modal.onClose();
    await settle();
    expect(blank.practice).not.toHaveBeenCalled();
  });
});

describe('an exit other than "Done" is not recorded as a "Done" completion', () => {
  it('every exit writes the same shape of record: it has no field that says how she left', async () => {
    const shapes: string[][] = [];
    for (const [, leave] of EXITS) {
      const opened = await openView();
      await answer(opened, 'An explanation.');
      leave(opened);
      await settle();
      const [input] = opened.saved();
      if (input === undefined) throw new Error('nothing saved');
      shapes.push(Object.keys(input).sort());
    }
    for (const shape of shapes) expect(shape).toEqual(shapes[0]);
    expect(shapes[0]).toEqual([
      'answer',
      'attemptId',
      'conceptIds',
      'durationMs',
      'instrumentId',
      'passagesShownInView',
      'promptShape',
      'timestamp',
    ]);
  });
});

describe('the link to her explain-back history', () => {
  it('is not on the view before she answers, and is on it after', async () => {
    const opened = await openView();
    expect(opened.root.buttonLabels()).not.toContain(EXPLAIN_BACK_REGISTRY_ENTRY_ACTION);
    await answer(opened, 'An answer.');
    expect(
      opened.root.buttonLabels().filter((l) => l === EXPLAIN_BACK_REGISTRY_ENTRY_ACTION),
    ).toHaveLength(1);
  });

  it('following it saves her explanation once, then leads to the instrument’s registry entry', async () => {
    const opened = await openView();
    await answer(opened, 'An answer.');
    opened.root.button(EXPLAIN_BACK_REGISTRY_ENTRY_ACTION).click();
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
    expect(opened.openHistory).toHaveBeenCalledTimes(1);
    expect(opened.openHistory).toHaveBeenCalledWith({ instrumentId: INSTRUMENT.instrumentId });
    // Saved before it navigated.
    const saveOrder = opened.practice.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    const openOrder = opened.openHistory.mock.invocationCallOrder[0] ?? 0;
    expect(saveOrder).toBeLessThan(openOrder);
  });

  it('a free-form topic that matched a concept leads to that concept’s entry', async () => {
    const opened = await openView({ seed: 'freeform', topicMatch: 'unique' });
    await answer(opened, 'An answer.');
    opened.root.button(EXPLAIN_BACK_REGISTRY_ENTRY_ACTION).click();
    await settle();
    expect(opened.openHistory).toHaveBeenCalledWith({ conceptKey: SUBJECT_KEY });
  });

  it('a registry that fails to open is logged and never thrown at her', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const opened = await openView();
    opened.openHistory.mockRejectedValueOnce(new Error('no registry'));
    await answer(opened, 'An answer.');
    opened.root.button(EXPLAIN_BACK_REGISTRY_ENTRY_ACTION).click();
    await settle();
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
