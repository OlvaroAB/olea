/**
 * `answerEdits` (`ol-0r92.56`, `[D-228 / SIG-3]`, F2.16), as v0.9 has it (`[D-603]`,
 * `ol-egov.141.89.6.129`). The two counts — when she first typed and how many times she came back
 * to a fresh answer box — ride on the explain-back REVIEW record, and a practice attempt writes no
 * review record: its one record is the practice explanation (D7.1, `[D-614]`), which has no field
 * for them. So the v0.9 view captures neither (no input listener, no counter), adds them nowhere,
 * and — scenario 7, still binding — shows nothing about how she composed her answer.
 *
 * The schema half of F2.16 (scenarios 1–4) stays in `contracts/review-log-v5.spec.ts`, unchanged;
 * scenarios 5 and 6 (one burst; the counter surviving a re-render) describe a capture that rides
 * a review record, and return with grading (the F5 heading note).
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F2.16 / [D-228]": the three
 * tagged `modal-answer-edits.spec`. Source-level (comments stripped) and behavioural through the
 * real view (`./practice-view-harness.ts`, `obsidian` mocked).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EXPLAIN_BACK_DONE_LABEL, EXPLAIN_BACK_SUBMIT_LABEL } from '../../src/explain-back/copy.js';
import type { ViewPracticeExplanationInput } from '../../src/explain-back/practice-record.js';
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

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed — a doc paragraph must not satisfy an assertion about the code doing the thing. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

describe('v0.9: the view captures no answer-edit counts, because no review record carries them', () => {
  it('no input listener, no first-edit time and no burst counter anywhere in the view', () => {
    // The class body: the dormant review write's parameter type still declares the field.
    const view = modal.slice(modal.indexOf('export class ExplainBackModal'));
    expect(view).not.toMatch(/addEventListener\('input'/);
    expect(view).not.toMatch(/firstEditAtMs|editBursts|firstEditMs|answerEdits/);
  });

  it('the practice explanation she leaves carries no answerEdits', async () => {
    const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
    const practice = vi.fn(async (_input: ViewPracticeExplanationInput) => ({
      written: false as const,
      record: {} as never,
    }));
    const view = new ExplainBackModal(
      {} as never,
      {
        retrieveSourceBlocks: retrieveFor,
        generateInstrumentId: () => 'attempt-1',
        now: () => NOW,
        recordPracticeExplanation: practice,
      },
      { kind: 'instrument', instrument: INSTRUMENT },
    ) as unknown as ViewInternals;
    view.onOpen();
    await vi.waitFor(() => expect(view.state.phase).toBe('answering'));
    submit(view.contentEl, 'An answer typed straight through.', EXPLAIN_BACK_SUBMIT_LABEL);
    await vi.waitFor(() => expect(view.state.phase).toBe('passages'));
    view.contentEl.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(practice).toHaveBeenCalledTimes(1));
    expect(Object.keys(practice.mock.calls[0]?.[0] ?? {})).not.toContain('answerEdits');
  });
});

describe('nothing about the count is shown to her while she writes', () => {
  it('the answering phase shows the question, the notice, the answer box and two controls, and no count, timer or composition feedback', async () => {
    const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
    const view = new ExplainBackModal(
      {} as never,
      {
        retrieveSourceBlocks: retrieveFor,
        generateInstrumentId: () => 'attempt-1',
        now: () => NOW,
      },
      { kind: 'instrument', instrument: INSTRUMENT },
    ) as unknown as ViewInternals;
    view.onOpen();
    await vi.waitFor(() => expect(view.state.phase).toBe('answering'));
    const [textarea] = view.contentEl.fields();
    if (textarea === undefined) throw new Error('no answer box');
    textarea.value = 'Partly typed';
    view.render();
    const texts = view.contentEl
      .texts()
      .filter((text) => text !== INSTRUMENT.courseCode && text !== INSTRUMENT.noteTitle);
    expect(texts.join(' ')).not.toMatch(/\d/);
    expect(texts.join(' ')).not.toMatch(/burst|edit|typed|seconds|timer/i);
    expect(view.contentEl.buttons()).toHaveLength(2);
  });
});
