/**
 * `ol-0r92.94` [DOS-C1]: `ExplainBackModal`'s in-flight-memo guard against a
 * double-click accept — source-level assertions, not a behavioural test, for
 * the same reason `modal-duration.spec.ts` and `modal-refusal.spec.ts` give:
 * `modal.ts` extends Obsidian's `Modal`, and `obsidian`'s `package.json`
 * `main` is `""`, so it cannot be instantiated under Vitest at all. Comments
 * are stripped before matching so a doc paragraph describing the guard can't
 * satisfy an assertion that the guard actually exists in the code.
 *
 * What this locks in:
 * - `submitAnswer` mints a fresh `attemptId` via `this.deps.generateInstrumentId()`
 *   on every call (every genuine submit), never once per modal instance and
 *   never derived from `prompt.originInstrumentId`.
 * - `acceptGrading` checks an in-flight `Map` keyed on `attemptId` before
 *   doing any real work, and stores the in-flight `Promise` before
 *   returning it — the same "store the Promise itself, not just its
 *   resolved value" shape `grading/wiring.ts`'s own
 *   `acceptedObservationsByAttempt` uses, so a second concurrent call for
 *   the SAME attempt shares one execution rather than starting a second
 *   `recordSoloGradeAndReview`/`acceptWithObservation` run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runGradingAttempt } from '../../src/explain-back/grading-attempt.js';

// The modal extends Obsidian's `Modal` (unresolvable under Vitest), so the behavioural test below
// supplies a bare `Modal` base and stands in for the two modules that need a real Obsidian.
vi.mock('obsidian', () => ({
  Modal: class {
    contentEl = {};
    titleEl = {};
    constructor(readonly app: unknown) {}
  },
}));
vi.mock('../../src/registry/obsidian-ports.js', () => ({ openRegistryEntryFor: () => {} }));
vi.mock('../../src/sprig/render-sprig.js', () => ({ renderSprig: () => {} }));

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

describe('ExplainBackModal — ol-0r92.94 [DOS-C1]: attemptId minted at submit, never at accept', () => {
  it('submitAnswer mints attemptId via deps.generateInstrumentId() and carries it into every ModalState transition it makes', () => {
    const submitAnswerBody = bodyBetween('private async submitAnswer(', 'private acceptGrading(');
    expect(submitAnswerBody).toMatch(/const attemptId = this\.deps\.generateInstrumentId\(\);/);
    // Every state transition submitAnswer makes after minting carries it.
    expect(submitAnswerBody).toMatch(
      /phase: 'grading',\s*prompt,\s*answer,\s*durationMs,\s*attemptId/,
    );
    expect(submitAnswerBody).toMatch(
      /phase: 'refused',\s*prompt,\s*answer,\s*reason: outcome\.kind === 'unavailable' \? 'unavailable' : outcome\.reason,\s*durationMs,\s*attemptId/,
    );
    expect(submitAnswerBody).toMatch(
      /phase: 'graded',\s*prompt,\s*answer,\s*pending,\s*durationMs,\s*attemptId/,
    );
  });

  it('acceptGrading never mints its own id — attemptId only ever arrives as a parameter', () => {
    const acceptGradingBody = bodyBetween('private acceptGrading(', 'private discardGrading(');
    expect(acceptGradingBody).not.toMatch(/generateInstrumentId/);
  });
});

describe('ExplainBackModal — ol-0r92.94 [DOS-C1]: in-flight memo keyed on attemptId', () => {
  it('declares one Map instance field for the in-flight guard', () => {
    expect(modal).toMatch(
      /private readonly acceptInFlightByAttempt = new Map<string, Promise<void>>\(\);/,
    );
  });

  it('acceptGrading checks the map before doing any work, and stores the in-flight Promise (not a resolved value) before returning it', () => {
    const acceptGradingBody = bodyBetween(
      'private acceptGrading(',
      'private async computeAcceptGrading(',
    );
    expect(acceptGradingBody).toMatch(
      /const inFlight = this\.acceptInFlightByAttempt\.get\(attemptId\);/,
    );
    expect(acceptGradingBody).toMatch(/if \(inFlight\) return inFlight;/);
    expect(acceptGradingBody).toMatch(/const promise = this\.computeAcceptGrading\([^)]*\);/);
    expect(acceptGradingBody).toMatch(
      /this\.acceptInFlightByAttempt\.set\(attemptId,\s*promise\);/,
    );
  });

  it('the real work (acceptWithObservation, recordSoloGradeAndReview) lives in computeAcceptGrading, not in the memoizing wrapper', () => {
    const acceptGradingBody = bodyBetween(
      'private acceptGrading(',
      'private async computeAcceptGrading(',
    );
    expect(acceptGradingBody).not.toMatch(/acceptWithObservation/);
    expect(acceptGradingBody).not.toMatch(/recordSoloGradeAndReview/);
    const computeBody = bodyBetween(
      'private async computeAcceptGrading(',
      'private discardGrading(',
    );
    expect(computeBody).toMatch(/this\.deps\.acceptWithObservation\(/);
    expect(computeBody).toMatch(/this\.deps\.recordSoloGradeAndReview\(/);
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
  it('removing the guard turns the late-response check red: submitAnswer returns on superseded and reads the live attempt id', () => {
    // The behavioural test above fails for any runGradingAttempt that ignores isCurrent();
    // this half pins that the modal supplies the guard and honours its answer.
    const submitAnswerBody = bodyBetween('private async submitAnswer(', 'private acceptGrading(');
    expect(submitAnswerBody).toMatch(
      /isCurrent:\s*\(\)\s*=>\s*this\.state\.phase === 'grading' && this\.state\.attemptId === attemptId/,
    );
    expect(submitAnswerBody).toMatch(/if \(outcome\.kind === 'superseded'\) return;/);
  });
});

describe("ExplainBackModal: the modal's own late-response guard", () => {
  // @auto:plugin/explain-back/modal-idempotency.spec
  it("through the modal's own submit path, a first grading call that settles after a second attempt began is ignored", async () => {
    const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
    const released: Array<(value: never) => void> = [];
    const grade = vi.fn(
      () =>
        new Promise<never>((resolve) => {
          released.push(resolve);
        }),
    );
    const noteShown = vi.fn();
    const acceptWithObservation = vi.fn();
    const recordSoloGradeAndReview = vi.fn();
    const ids = ['attempt-1', 'attempt-2'];
    const modal = new ExplainBackModal(
      {} as never,
      {
        grade,
        acceptWithObservation,
        recordSoloGradeAndReview,
        generateInstrumentId: () => ids.shift() ?? 'extra',
        feedbackExposureLedger: { noteShown },
      } as never,
      { kind: 'freeform' },
    );
    // The modal's observable surface here is its phase state and its render calls.
    const internals = modal as unknown as {
      state: { phase: string; attemptId?: string };
      render: () => void;
      submitAnswer: (prompt: unknown, answer: string) => Promise<void>;
    };
    const render = vi.fn();
    internals.render = render;
    const prompt = {
      context: { ...GRADE_INPUT },
      subjectConceptId: null,
      originInstrumentId: 'instrument-1',
      conceptIds: [],
      sourceBlocks: [],
    };

    const first = internals.submitAnswer(prompt, 'first answer');
    expect(internals.state).toMatchObject({ phase: 'grading', attemptId: 'attempt-1' });
    const second = internals.submitAnswer(prompt, 'second answer'); // a newer attempt began
    expect(internals.state).toMatchObject({ phase: 'grading', attemptId: 'attempt-2' });
    expect(grade).toHaveBeenCalledTimes(2);
    const rendersBeforeLate = render.mock.calls.length;

    // The first call settles late, with a gradable verdict.
    const graded = { grading: { outcome: 'graded', verdict: 'correct' } } as never;
    released[0]?.(graded);
    await first;

    // Ignored: the live attempt's state is untouched, nothing was drawn, shown or written for it.
    expect(internals.state).toMatchObject({ phase: 'grading', attemptId: 'attempt-2' });
    expect(render).toHaveBeenCalledTimes(rendersBeforeLate);
    expect(noteShown).not.toHaveBeenCalled();
    expect(acceptWithObservation).not.toHaveBeenCalled();
    expect(recordSoloGradeAndReview).not.toHaveBeenCalled();

    // The live attempt still settles normally.
    released[1]?.(graded);
    await second;
    expect(internals.state).toMatchObject({ phase: 'graded', attemptId: 'attempt-2' });
    expect(noteShown).toHaveBeenCalledTimes(1);
    expect(noteShown).toHaveBeenCalledWith('instrument-1', 'attempt-2');
  });
});
