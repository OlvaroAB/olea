/**
 * `ol-0r92.98`, as the v0.9 view has it (`[D-603]`, `ol-egov.141.89.6.129`): an empty or
 * whitespace-only "Show the passages" is a no-op. The passages are not shown, and no exposure
 * marker and no practice explanation is written, so an empty submit is never a way to read the
 * passages without explaining first (F5.2). It mirrors the topic phase's own emptiness guard and
 * is deliberately NOT the named skip (`[DOS-I9]`, SKIP-2/3/4): it writes no event of any kind.
 *
 * Scenario: `features/F5-explain-it-back.md` (olea-service), "an empty or whitespace-only submit
 * is a no-op: no passages and no practice entry" (`submit-guard.spec`).
 *
 * The predicate is extracted from `modal.ts`'s own source and run for real; the wiring is then
 * checked behaviourally through the real view (`./practice-view-harness.ts`, `obsidian` mocked)
 * and structurally against the comment-stripped source.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EXPLAIN_BACK_PASSAGES_HEADING,
  EXPLAIN_BACK_SUBMIT_LABEL,
} from '../../src/explain-back/copy.js';
import { INSTRUMENT, NOW, retrieveFor, type ViewInternals } from './practice-view-harness.js';

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

/** `isBlankExplainBackAnswer`'s own source, evaluated as a standalone function. */
function extractIsBlankExplainBackAnswer(): (answer: string) => boolean {
  const start = modal.indexOf('export function isBlankExplainBackAnswer');
  expect(start).toBeGreaterThan(-1);
  const end = modal.indexOf('\n}', start) + 2;
  const source = modal
    .slice(start, end)
    .replace('export function', 'return function')
    .replace('(answer: string)', '(answer)')
    .replace('): boolean {', ') {');
  // eslint-disable-next-line no-new-func
  return new Function(source)();
}

describe('isBlankExplainBackAnswer — the submit guard predicate, run for real from its own source', () => {
  const isBlank = extractIsBlankExplainBackAnswer();

  it.each(['', '   ', '\n', '\t\t', ' \n \t '])('treats %j as blank', (blank) => {
    expect(isBlank(blank)).toBe(true);
  });

  it.each(['x', ' a real answer ', 'a\nmulti-line answer'])('treats %j as not blank', (answer) => {
    expect(isBlank(answer)).toBe(false);
  });
});

describe('an empty or whitespace-only "Show the passages" is a no-op: no passages and no practice entry', () => {
  it.each(['', '   ', '\n', '\t'])(
    'choosing it with %j shows nothing and writes nothing',
    async (blank) => {
      const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
      const marker = vi.fn(async () => {});
      const practice = vi.fn();
      const nonAttempt = vi.fn(async () => {});
      const view = new ExplainBackModal(
        {} as never,
        {
          retrieveSourceBlocks: retrieveFor,
          generateInstrumentId: () => 'attempt-1',
          now: () => NOW,
          recordFeedbackShown: marker,
          recordPracticeExplanation: practice,
          recordNonAttempt: nonAttempt,
        },
        { kind: 'instrument', instrument: INSTRUMENT },
      ) as unknown as ViewInternals;
      view.onOpen();
      await vi.waitFor(() => expect(view.state.phase).toBe('answering'));

      const [textarea] = view.contentEl.fields();
      if (textarea === undefined) throw new Error('no answer box');
      textarea.value = blank;
      view.contentEl.button(EXPLAIN_BACK_SUBMIT_LABEL).click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(view.state.phase).toBe('answering');
      expect(view.contentEl.texts()).not.toContain(EXPLAIN_BACK_PASSAGES_HEADING);
      expect(marker).not.toHaveBeenCalled();
      expect(practice).not.toHaveBeenCalled();
      // Not a skip: no non-attempt event either.
      expect(nonAttempt).not.toHaveBeenCalled();
    },
  );
});

describe('ExplainBackModal — the submit button guard is actually wired in', () => {
  it("renderAnsweringPhase's submit button returns on a blank answer before ever calling submitAnswer", () => {
    const start = modal.indexOf('private renderAnsweringPhase(');
    const end = modal.indexOf('private renderExplanation(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(modal.slice(start, end)).toMatch(
      /if \(isBlankExplainBackAnswer\(textarea\.value\)\) return;\s*void this\.submitAnswer\(prompt, textarea\.value\);/,
    );
  });

  it('submitAnswer is the only path to the passages and to the marker, so the guard stands before both', () => {
    expect(modal.match(/this\.state = \{ phase: 'passages'/g)).toHaveLength(1);
    expect(modal.match(/this\.recordFeedbackShownBeforeDisplay\(/g)).toHaveLength(1);
    const submitBody = modal.slice(
      modal.indexOf('private async submitAnswer('),
      modal.indexOf('private async recordFeedbackShownBeforeDisplay('),
    );
    expect(submitBody).toMatch(/this\.state = \{ phase: 'passages'/);
    expect(submitBody).toMatch(/this\.recordFeedbackShownBeforeDisplay\(/);
  });

  it('the empty-submit guard is not the explicit skip action — the guard itself introduces no skip event', () => {
    const start = modal.indexOf('private renderAnsweringPhase(');
    const end = modal.indexOf('private renderExplanation(');
    const body = modal.slice(start, end);
    const guardBlockStart = body.indexOf("button.addEventListener('click', () => {");
    expect(guardBlockStart).toBeGreaterThan(-1);
    const guardBlockEnd = body.indexOf('});', guardBlockStart) + 3;
    expect(body.slice(guardBlockStart, guardBlockEnd)).not.toMatch(/skip/i);
  });
});
