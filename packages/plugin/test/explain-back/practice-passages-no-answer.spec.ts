/**
 * `[D-633]` (`ol-egov.141.89.6.146`): the lookup reads the prompt, the concept and the course,
 * never her answer, and the passages are fixed before she answers, so the ungraded route's
 * no-model-reading rule holds. A spy on the lookup's every input.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), tagged
 * `plugin/explain-back/practice-passages-no-answer.spec`. Synthetic data only.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { answerPassages, openPassages, shownPassages } from './practice-passages-open.js';
import { INSTRUMENT, NEIGHBOUR_NAME, retrieveFor } from './practice-view-harness.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

const MARKER = 'zzq-her-own-wording-marker';

describe('retrieval never reads her answer ([D-633])', () => {
  it.each([
    ['a concept prompt', 'concept' as const],
    ['a relation prompt', 'relation' as const],
  ])(
    '%s: every lookup input is the prompt, the neighbour wording or the course',
    async (_l, seed) => {
      const view = await openPassages({ retrieve: retrieveFor, seed });
      const before = view.retrieve.mock.calls.map((call) => [...call]);
      for (const call of before) {
        const [query, course] = call as [string, string | null];
        expect(['What does Alpha drive?', NEIGHBOUR_NAME]).toContain(query);
        expect(course).toBe(INSTRUMENT.courseCode);
      }
      const passagesBefore = shownPassages(view.root);
      expect(passagesBefore).toEqual([]); // nothing is shown before she answers

      await answerPassages(view, `My answer, with ${MARKER} in it.`);
      // No lookup ran after she answered, and none of the inputs ever held her words.
      expect(view.retrieve.mock.calls.map((call) => [...call])).toEqual(before);
      expect(JSON.stringify(view.retrieve.mock.calls)).not.toContain(MARKER);
      const shown = shownPassages(view.root);
      expect(shown.length).toBeGreaterThan(0);
      expect(JSON.stringify(shown)).not.toContain(MARKER);
    },
  );

  it('the passages shown are the ones fixed when the prompt opened, a second answer included', async () => {
    const view = await openPassages({ retrieve: retrieveFor });
    const { state } = view.modal as unknown as {
      state: { prompt: { passages: readonly unknown[] } };
    };
    const fixed = state.prompt.passages;
    await answerPassages(view, `First ${MARKER}.`);
    expect(
      (view.modal as unknown as { state: { prompt: { passages: unknown } } }).state.prompt.passages,
    ).toBe(fixed);
    expect(view.retrieve).toHaveBeenCalledTimes(1);
  });
});
