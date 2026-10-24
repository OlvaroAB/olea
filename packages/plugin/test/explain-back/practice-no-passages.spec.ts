/**
 * `[D-629]` (sheet v87 row 7, `ol-egov.141.89.6.143`): after a completed search that finds nothing
 * the view says so in registry section 39's words, for an instrument prompt and a free-form topic
 * alike; a free-form topic is no longer refused with grading wording; with no Worker (no search
 * ran) it says it is unavailable instead; and the history link, Done and Try again stay.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), tagged
 * `plugin/explain-back/practice-no-passages.spec`. Behavioural, over the real view in
 * `./practice-view-harness.ts`'s DOM stand-in. Coined data only.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_NO_PASSAGES_FOUND,
  EXPLAIN_BACK_PASSAGES_HEADING,
  EXPLAIN_BACK_PRACTICE_NOTICE,
  EXPLAIN_BACK_REFLECTION_ADD_OR_REPHRASE,
  EXPLAIN_BACK_REFLECTION_READ_ALONGSIDE,
  EXPLAIN_BACK_REGISTRY_ENTRY_ACTION,
} from '../../src/explain-back/copy.js';
import { EXPLAIN_WHY_UNAVAILABLE } from '../../src/review/copy.js';
import { answer, openView, settle } from './practice-open.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

const NO_PASSAGES = "Olea hasn't found passages to show alongside your explanation.";
const PASSAGE_LIST_CLASS = 'olea-explain-back-region-items';

describe('a completed search that finds nothing says so, in registry section 39’s words', () => {
  it('the constant is the registry’s line, straight apostrophe', () => {
    expect(EXPLAIN_BACK_NO_PASSAGES_FOUND).toBe(NO_PASSAGES);
  });

  it.each([
    ['an instrument prompt', { seed: 'concept' as const }],
    [
      'a free-form topic that matched a concept',
      { seed: 'freeform' as const, topicMatch: 'unique' as const },
    ],
    [
      'a free-form topic that matched none',
      { seed: 'freeform' as const, topicMatch: 'none' as const },
    ],
  ])(
    '%s: her explanation, then exactly the line, with none of the passage furniture',
    async (_l, options) => {
      const opened = await openView({ ...options, passages: [] });
      expect(opened.retrieve).toHaveBeenCalled();
      await answer(opened, 'My explanation.');
      const texts = opened.root.texts();
      expect(texts).toContain('My explanation.');
      expect(texts.filter((t) => t === NO_PASSAGES)).toHaveLength(1);
      expect(texts).not.toContain(EXPLAIN_BACK_PASSAGES_HEADING);
      expect(texts).not.toContain(EXPLAIN_BACK_REFLECTION_READ_ALONGSIDE);
      expect(texts).not.toContain(EXPLAIN_BACK_REFLECTION_ADD_OR_REPHRASE);
      expect(opened.root.withClass(PASSAGE_LIST_CLASS)).toEqual([]);
      expect(texts).not.toContain(EXPLAIN_WHY_UNAVAILABLE);
      expect(opened.root.buttonLabels()).toEqual([
        EXPLAIN_BACK_DONE_LABEL,
        EXPLAIN_BACK_DISCARD_LABEL,
        EXPLAIN_BACK_REGISTRY_ENTRY_ACTION,
      ]);
    },
  );

  it('a free-form topic is not refused with the grading wording: it reaches the answer box with the notice', async () => {
    const opened = await openView({ seed: 'freeform', topicMatch: 'none', passages: [] });
    expect(opened.modal.state.phase).toBe('answering');
    const everything = opened.root.texts().join(' ');
    expect(everything).toContain(EXPLAIN_BACK_PRACTICE_NOTICE);
    expect(everything).not.toMatch(/to grade|Nothing matched|what your notes returned/i);
  });

  it('the line promises no check and claims nothing about her notes', () => {
    expect(NO_PASSAGES).not.toMatch(/grade|check|your notes|enough|nothing/i);
  });

  it('with passages found, the line is not shown', async () => {
    const opened = await openView();
    await answer(opened, 'An explanation.');
    expect(opened.root.texts()).not.toContain(NO_PASSAGES);
    expect(opened.root.texts()).toContain(EXPLAIN_BACK_PASSAGES_HEADING);
  });

  it('"Try again" from the no-passages state returns to the answer box with her text', async () => {
    const opened = await openView({ passages: [] });
    await answer(opened, 'My first words.');
    opened.root.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    expect(opened.modal.state.phase).toBe('answering');
    expect(opened.root.fields()[0]?.value).toBe('My first words.');
  });

  it('the link to her history leads on from the no-passages state, saving once', async () => {
    const opened = await openView({ passages: [] });
    await answer(opened, 'An explanation.');
    opened.root.button(EXPLAIN_BACK_REGISTRY_ENTRY_ACTION).click();
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
    expect(opened.openHistory).toHaveBeenCalledTimes(1);
  });
});

describe('with no Worker, no search ran, so the view says it is unavailable, never the no-passages line', () => {
  it.each([
    ['an instrument prompt', { seed: 'concept' as const }],
    ['a free-form topic', { seed: 'freeform' as const, topicMatch: 'unique' as const }],
  ])(
    '%s: no search is made, and her explanation is followed by the existing unavailable wording',
    async (_l, options) => {
      const opened = await openView({ ...options, searchAvailable: false });
      expect(opened.retrieve).not.toHaveBeenCalled();
      await answer(opened, 'My explanation.');
      const texts = opened.root.texts();
      expect(texts.filter((t) => t === EXPLAIN_WHY_UNAVAILABLE)).toHaveLength(1);
      expect(texts).not.toContain(NO_PASSAGES);
      expect(texts).not.toContain(EXPLAIN_BACK_PASSAGES_HEADING);
      expect(texts).not.toContain(EXPLAIN_BACK_REFLECTION_READ_ALONGSIDE);
      expect(opened.root.buttonLabels()).toEqual([
        EXPLAIN_BACK_DONE_LABEL,
        EXPLAIN_BACK_DISCARD_LABEL,
        EXPLAIN_BACK_REGISTRY_ENTRY_ACTION,
      ]);
      expect(opened.retrieve).not.toHaveBeenCalled();
    },
  );

  it('her explanation is still saved on exit', async () => {
    const opened = await openView({ searchAvailable: false });
    await answer(opened, 'Offline words.');
    opened.modal.onClose();
    await settle();
    expect(opened.practice).toHaveBeenCalledTimes(1);
  });
});
