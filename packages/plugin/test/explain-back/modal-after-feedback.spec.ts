/**
 * `[D-512]` (`ol-egov.141.89.6.93`): the modal's accept call carries the sealed
 * feedback exposure as `afterFeedback`, so a correct answer written after she
 * read feedback records no resolution evidence (behaviour proven in
 * `test/grading/wiring.spec.ts`). `modal.ts` cannot be imported under Vitest,
 * so this checks the source text, comments stripped.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const raw = readFileSync(
  fileURLToPath(new URL('../../src/explain-back/modal.ts', import.meta.url)),
  'utf8',
);
const modal = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('computeAcceptGrading carries the after-feedback fact on the accept context', () => {
  it("sets afterFeedback from the sealed support's feedbackExposure, before the accept call", () => {
    const body = modal.slice(
      modal.indexOf('private async computeAcceptGrading('),
      modal.indexOf('private renderMasteryTag('),
    );
    const setIndex = body.indexOf("afterFeedback: support.feedbackExposure === 'shown'");
    const callIndex = body.indexOf('this.deps.acceptWithObservation(');
    expect(setIndex).toBeGreaterThan(-1);
    expect(setIndex).toBeLessThan(callIndex);
  });
});
