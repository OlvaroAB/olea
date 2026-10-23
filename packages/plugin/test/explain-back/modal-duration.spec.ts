/**
 * `ExplainBackModal`'s timing (`ol-yj0k`) and what the v0.9 view says after an answer
 * (`[D-603]`, F5.3 as amended; `ol-egov.141.89.6.129`).
 *
 * - `durationMs` is the view's own measurement, from the prompt's presentation to her submit,
 *   carried onto the practice explanation she leaves by "Done" or "Try again" (D7.1, `[D-614]`);
 *   "Try again" restarts the clock for the next answer.
 * - After an answer, and after "Done", nothing reads how far she reached: no depth heading, no
 *   outcome line, no first-full-depth sentence, and no depth reading asked for or recorded.
 * - The misconception digest, which the view loaded only to send to the judge (`ol-2zfj.75`), is
 *   no longer loaded: nothing is sent.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service): "F5.3 / [D-603] — the view states
 * no depth line" (the two `modal-duration.spec` scenarios), "F5 — the explain-back review-log
 * write carries a real durationMs" and its "Try again restarts the clock", the dormant
 * "F5.6 (continued) — the judge digest has a real production caller", and the dormant
 * "a transient check-failed retry does not restart the clock".
 *
 * Behavioural through the real view (`./practice-view-harness.ts`, `obsidian` mocked), with
 * source-level checks (comments stripped) where the claim is about what the file can reach.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_SUBMIT_LABEL,
} from '../../src/explain-back/copy.js';
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

/** A view on a clock the test moves by hand. */
async function openView() {
  const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
  let at = NOW.getTime();
  const ids = ['attempt-1', 'attempt-2'];
  const practice = vi.fn(async (_input: ViewPracticeExplanationInput) => ({
    written: false as const,
    record: {} as never,
  }));
  const loadMisconceptionDigest = vi.fn(async () => []);
  const recordSoloGradeAndReview = vi.fn(async () => undefined);
  const view = new ExplainBackModal(
    {} as never,
    {
      retrieveSourceBlocks: retrieveFor,
      generateInstrumentId: () => ids.shift() ?? 'extra',
      now: () => new Date(at),
      recordPracticeExplanation: practice,
      loadMisconceptionDigest,
      recordSoloGradeAndReview,
      getMasteryState: () => 'sprout',
    },
    { kind: 'instrument', instrument: INSTRUMENT },
  ) as unknown as ViewInternals;
  const drawn: string[] = [];
  const classes: string[] = [];
  const render = view.render.bind(view);
  view.render = () => {
    render();
    drawn.push(...view.contentEl.texts());
    classes.push(...view.contentEl.allClasses());
  };
  view.onOpen();
  await vi.waitFor(() => expect(view.state.phase).toBe('answering'));
  return {
    view,
    practice,
    loadMisconceptionDigest,
    recordSoloGradeAndReview,
    drawn,
    classes,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

async function answer(view: ViewInternals, text: string): Promise<void> {
  submit(view.contentEl, text, EXPLAIN_BACK_SUBMIT_LABEL);
  await vi.waitFor(() => expect(view.state.phase).toBe('passages'));
}

const DEPTH_LINES = /You explained this|first time this concept has been explained|full depth/;

describe('ExplainBackModal times an attempt through its own injected clock, never Date.now() at a measurement site', () => {
  it('reads the current time only via this.now(), and falls back to `new Date` in exactly one place — the constructor default for an unwired deps.now', () => {
    const dateConstructions = modal.match(/new Date\(\)/g) ?? [];
    expect(dateConstructions).toHaveLength(1);
    expect(modal).toMatch(/this\.now = deps\.now \?\? \(\(\) => new Date\(\)\);/);
    expect(modal).not.toMatch(/Date\.now\(\)/);
  });

  it('computes durationMs at submission from presentedAtMs, guarded against a clock running backwards', () => {
    expect(modal).toMatch(
      /this\.presentedAtMs !== null \? Math\.max\(0, this\.now\(\)\.getTime\(\) - this\.presentedAtMs\) : null/,
    );
  });
});

describe('a submitted answer’s timing is captured and persisted on its practice explanation', () => {
  it('durationMs is the milliseconds from the prompt’s presentation to that submit, never null', async () => {
    const { view, practice, advance } = await openView();
    advance(42_000);
    await answer(view, 'An answer.');
    advance(90_000); // reading the passages is not part of the answer's time
    view.contentEl.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(practice).toHaveBeenCalledTimes(1));
    expect(practice.mock.calls[0]?.[0].durationMs).toBe(42_000);
  });
});

describe('"Try again" restarts the clock for the next answer', () => {
  it('the second answer is timed from the answering view reappearing, not the original presentation', async () => {
    const { view, practice, advance } = await openView();
    advance(30_000);
    await answer(view, 'A first answer.');
    advance(20_000);
    view.contentEl.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    advance(15_000);
    await answer(view, 'A revised answer.');
    view.contentEl.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(practice).toHaveBeenCalledTimes(2));
    expect(practice.mock.calls.map(([input]) => input.durationMs)).toEqual([30_000, 15_000]);
  });
});

describe('after an answer, the view shows no heading that reads how far she reached (F5.3, [D-603])', () => {
  it('no depth heading and no outcome line renders, and nothing stands in place of one', async () => {
    const { view, drawn, classes } = await openView();
    await answer(view, 'An answer.');
    expect(drawn.join('\n')).not.toMatch(DEPTH_LINES);
    expect(classes).not.toContain('olea-explain-back-outcome');
    expect(classes).not.toContain('olea-explain-back-encouragement');
    expect(modal).not.toMatch(/explainBackDepthHeading|olea-explain-back-outcome/);
  });
});

describe('"Done" ends the practice with nothing said about depth', () => {
  it('no depth heading, no first-full-depth sentence and no line about how she did, at any point', async () => {
    const { view, drawn, classes, recordSoloGradeAndReview } = await openView();
    await answer(view, 'An answer.');
    const linesBeforeDone = drawn.length;
    view.contentEl.button(EXPLAIN_BACK_DONE_LABEL).click();
    expect(drawn.length).toBe(linesBeforeDone); // "Done" closes; nothing further is drawn
    expect(drawn.join('\n')).not.toMatch(DEPTH_LINES);
    expect(classes).not.toContain('olea-explain-back-encouragement');
    // No depth reading is asked for or recorded.
    expect(recordSoloGradeAndReview).not.toHaveBeenCalled();
    expect(modal).not.toMatch(/recordSoloGradeAndReview\(/);
    expect(modal).not.toMatch(/explainBackFullDepthEncouragement|isConfirmedFirstFullDepth/);
  });
});

describe('the judge digest is no longer loaded: nothing is sent to a judge in v0.9 ([D-603])', () => {
  it('resolving an instrument-seeded prompt does not ask for a misconception digest', async () => {
    const { view, loadMisconceptionDigest } = await openView();
    await answer(view, 'An answer.');
    expect(loadMisconceptionDigest).not.toHaveBeenCalled();
    expect(modal).not.toMatch(/this\.deps\.loadMisconceptionDigest/);
  });

  it('the dependency stays declared, optional and dormant, so the composition root is unchanged', () => {
    expect(modal).toMatch(/readonly loadMisconceptionDigest\?: \(/);
  });
});

describe('no check runs, so no check-failed retry exists to restart or keep a clock', () => {
  it('the view has no could-not-check refusal and no retry control', () => {
    expect(modal).not.toMatch(/check-failed|EXPLAIN_BACK_CHECK_FAILED_REFUSAL|refusal-retry/);
  });
});
