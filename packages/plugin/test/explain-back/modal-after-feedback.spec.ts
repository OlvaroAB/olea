/**
 * `[D-512]` (`ol-egov.141.89.6.93`), as v0.9 has it (`[D-603]`, `ol-egov.141.89.6.129`): the
 * accept call that carried `afterFeedback` is dormant with the rest of grading (its rule stays in
 * `../grading/wiring.ts`, proven in `test/grading/wiring.spec.ts`). In v0.9 what she was shown
 * before an answer rides that answer's practice explanation instead (D7.1, `[D-614]`): the view
 * names the passages shown after each earlier attempt it holds, and the writer reads earlier
 * sessions from her log. `modal.ts` cannot be imported unmocked, so this checks the source text,
 * comments stripped; `practice-view.spec.ts` checks the behaviour.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const raw = readFileSync(
  fileURLToPath(new URL('../../src/explain-back/modal.ts', import.meta.url)),
  'utf8',
);
const modal = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the after-feedback fact, as the practice view carries it', () => {
  it('no accept call, so no afterFeedback on an accept context', () => {
    expect(modal).not.toMatch(/acceptWithObservation\(/);
    expect(modal).not.toMatch(/afterFeedback/);
  });

  it('each answer’s practice explanation names the attempts left by "Try again" before it', () => {
    const body = modal.slice(
      modal.indexOf('private async recordPracticeExplanationIfPossible('),
      modal.indexOf('private skipPrompt('),
    );
    expect(body).toMatch(/const earlierAttemptIds = this\.attemptsLeftByTryAgain\.filter\(/);
    expect(body).toMatch(/earlierAttemptIds,/);
    expect(body).toMatch(/passageTexts: prompt\.passages\.map\(/);
  });
});
