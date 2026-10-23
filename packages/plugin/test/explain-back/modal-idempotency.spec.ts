/**
 * `ol-0r92.94` [DOS-C1] and `[D-482]`, as the v0.9 view has them (`[D-603]`,
 * `ol-egov.141.89.6.129`):
 * - `submitAnswer` mints a fresh `attemptId` via `this.deps.generateInstrumentId()` on every
 *   genuine submit, and every state it moves to carries it; "Done" and "Try again" never mint one.
 * - A second click on "Done" or "Try again" for the same answer is not a second practice write:
 *   the view remembers the attempts it has asked the writer for (the writer is idempotent on the
 *   attempt id as well, which covers a reopen or a reload).
 * - A late settle never overwrites a newer attempt: `runGradingAttempt`'s guard (dormant with
 *   grading, tested below as the function it is) and, in v0.9, the view's own guard on the marker
 *   write before the passages appear.
 *
 * Source-level checks run on the comment-stripped text; the behavioural ones render the real view
 * into `./practice-view-harness.ts`'s stand-in (`obsidian` mocked).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runGradingAttempt } from '../../src/explain-back/grading-attempt.js';
import { NOW, retrieveFor } from './practice-view-harness.js';

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

/** Source with comments removed — see this file's module doc. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

function bodyBetween(startMarker: string, endMarker: string): string {
  const start = modal.indexOf(startMarker);
  const end = modal.indexOf(endMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return modal.slice(start, end);
}

describe('ExplainBackModal — ol-0r92.94 [DOS-C1]: attemptId minted at submit, never when she leaves the answer', () => {
  it('submitAnswer mints attemptId via deps.generateInstrumentId() and carries it into every ModalState transition it makes', () => {
    const submitAnswerBody = bodyBetween(
      'private async submitAnswer(',
      'private async recordFeedbackShownBeforeDisplay(',
    );
    expect(submitAnswerBody).toMatch(/const attemptId = this\.deps\.generateInstrumentId\(\);/);
    expect(submitAnswerBody).toMatch(
      /phase: 'revealing',\s*prompt,\s*answer,\s*attemptId,\s*durationMs/,
    );
    expect(submitAnswerBody).toMatch(
      /phase: 'passages',\s*prompt,\s*answer,\s*attemptId,\s*durationMs/,
    );
  });

  it('"Done" and "Try again" never mint their own id — attemptId only ever arrives as a parameter', () => {
    const leaving = bodyBetween('private finishPractice(', 'private skipPrompt(');
    expect(leaving).not.toMatch(/generateInstrumentId/);
  });
});

describe('ExplainBackModal — one practice write per answer, however often she clicks', () => {
  it('declares one Set of the attempts already asked for', () => {
    expect(modal).toMatch(/private readonly practiceRecorded = new Set<string>\(\);/);
  });

  it('checks and marks the attempt before the first await, so a second click finds it', () => {
    const body = bodyBetween(
      'private async recordPracticeExplanationIfPossible(',
      'private skipPrompt(',
    );
    const check = body.indexOf('if (this.practiceRecorded.has(attemptId)) return;');
    const mark = body.indexOf('this.practiceRecorded.add(attemptId);');
    const firstAwait = body.indexOf('await ');
    expect(check).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(check);
    expect(firstAwait).toBeGreaterThan(mark);
  });
});

// ---------------------------------------------------------------------------
// `[D-482]` (F5.5): a late answer never overwrites a newer attempt
// ---------------------------------------------------------------------------

const GRADE_INPUT = {
  question: 'Why does X happen?',
  studentAnswer: 'Because Y causes Z.',
  referenceAnswer: 'Because Y drives Z.',
  sourceBlocks: [],
  misconceptionDigest: [],
};

describe('runGradingAttempt: the attempt guard', () => {
  const pending = { status: 'pending-review' } as never;

  // @auto:plugin/explain-back/modal-idempotency.spec
  it('a first call that returns after Try again started a second attempt is ignored', async () => {
    // The modal's own notion of "current", reduced to what the guard reads.
    let currentAttempt = 'attempt-1';
    let releaseFirst: (value: never) => void = () => {};
    const first = runGradingAttempt({
      grade: () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
      input: GRADE_INPUT,
      isCurrent: () => currentAttempt === 'attempt-1',
    });
    currentAttempt = 'attempt-2'; // Try again: a newer attempt began
    releaseFirst(pending);
    expect(await first).toEqual({ kind: 'superseded' });

    const second = await runGradingAttempt({
      grade: () => Promise.resolve(pending),
      input: GRADE_INPUT,
      isCurrent: () => currentAttempt === 'attempt-2',
    });
    expect(second).toEqual({ kind: 'graded', pending });
  });

  it('a late refusal from the superseded attempt is ignored too', async () => {
    let current = false;
    const result = await runGradingAttempt({
      grade: () => Promise.reject(new Error('socket closed')),
      input: GRADE_INPUT,
      isCurrent: () => current,
    });
    expect(result).toEqual({ kind: 'superseded' });
    current = true;
  });

  // @auto:plugin/explain-back/modal-idempotency.spec
  it('removing the guard turns the late-response check red: submitAnswer reads the live attempt id after its await', () => {
    // The behavioural test below fails for a submitAnswer that ignores which attempt is live; this
    // half pins the v0.9 guard: after the marker write settles, the passages are drawn only if
    // this attempt is still the one on screen and the view is still open.
    const submitAnswerBody = bodyBetween(
      'private async submitAnswer(',
      'private async recordFeedbackShownBeforeDisplay(',
    );
    expect(submitAnswerBody).toMatch(
      /if \(this\.closed \|\| this\.state\.phase !== 'revealing' \|\| this\.state\.attemptId !== attemptId\) \{\s*return;\s*\}/,
    );
    expect(modal).not.toMatch(/runGradingAttempt/);
  });
});

describe("ExplainBackModal: the modal's own late-response guard", () => {
  // @auto:plugin/explain-back/modal-idempotency.spec
  it("through the modal's own submit path, a first marker write that settles after a second attempt began draws nothing", async () => {
    const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
    const released: Array<() => void> = [];
    const recordFeedbackShown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          released.push(resolve);
        }),
    );
    const grade = vi.fn();
    const ids = ['attempt-1', 'attempt-2'];
    const view = new ExplainBackModal(
      {} as never,
      {
        grade,
        retrieveSourceBlocks: retrieveFor,
        recordFeedbackShown,
        generateInstrumentId: () => ids.shift() ?? 'extra',
        now: () => NOW,
      },
      { kind: 'freeform' },
    );
    const internals = view as unknown as {
      state: { phase: string; attemptId?: string };
      render: () => void;
      submitAnswer: (prompt: unknown, answer: string) => Promise<void>;
    };
    const render = vi.fn();
    internals.render = render;
    const prompt = {
      question: 'Why does X happen?',
      subjectConceptId: null,
      originInstrumentId: 'instrument-1',
      passages: [],
      shape: { kind: 'concept' },
      conceptIds: [],
      courseCode: null,
      noteTitle: null,
    };

    const first = internals.submitAnswer(prompt, 'first answer');
    expect(internals.state).toMatchObject({ phase: 'revealing', attemptId: 'attempt-1' });
    const second = internals.submitAnswer(prompt, 'second answer'); // a newer attempt began
    expect(internals.state).toMatchObject({ phase: 'revealing', attemptId: 'attempt-2' });
    await vi.waitFor(() => expect(recordFeedbackShown).toHaveBeenCalledTimes(2));
    const rendersBeforeLate = render.mock.calls.length;

    // The first marker write settles late.
    released[0]?.();
    await first;

    // Ignored: the live attempt's state is untouched and nothing was drawn for the first.
    expect(internals.state).toMatchObject({ phase: 'revealing', attemptId: 'attempt-2' });
    expect(render).toHaveBeenCalledTimes(rendersBeforeLate);

    // The live attempt still settles normally, and nothing was ever sent to a grader.
    released[1]?.();
    await second;
    expect(internals.state).toMatchObject({ phase: 'passages', attemptId: 'attempt-2' });
    expect(grade).not.toHaveBeenCalled();
  });
});
