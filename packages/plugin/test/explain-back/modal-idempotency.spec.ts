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
import { describe, expect, it } from 'vitest';

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
      /phase: 'refused',\s*prompt,\s*answer,\s*reason: 'unavailable',\s*durationMs,\s*attemptId/,
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
