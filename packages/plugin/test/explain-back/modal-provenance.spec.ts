/**
 * `[D-483]`: the modal supplies the provenance of the request it built. `modal.ts` extends
 * Obsidian's `Modal` and cannot load under Vitest (the same constraint `modal-duration.spec.ts`
 * documents), so this has two halves: the value the modal passes is built by the pure
 * `buildExplainBackGradingProvenance` (behavioural), and the modal's accept path actually passes
 * it into `recordSoloGradeAndReview` (source-level, comments stripped).
 *
 * **v0.9 (`[D-603]`, `ol-egov.141.89.6.129`):** no request is built and no review is written, so
 * the view supplies no grading provenance; the builder stays, tested below, for when grading
 * returns. What the practice explanation carries of the passages is their digests, in the same
 * digest space (`digestPassage`), and never their text (D7.1, `[D-614]`).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { explainBackGradingProvenance } from 'olea-contracts';
import { digestPassage, EXPLAIN_BACK_JUDGE_CONTRACT_VERSION } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { practiceExplanationInput } from '../../src/explain-back/practice-record.js';
import { buildExplainBackGradingProvenance } from '../../src/explain-back/request.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const modal = readFileSync(`${srcDir}explain-back/modal.ts`, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

const blocks = [
  { blockId: 'a#0#0', text: 'First passage sent to the judge.' },
  { blockId: 'b#1#1', text: 'Second passage sent to the judge.' },
];

describe('the grading provenance the modal supplies', () => {
  it('takes the request version and each passage digest from the request itself', async () => {
    const provenance = await buildExplainBackGradingProvenance({ sourceBlocks: blocks });
    expect(provenance.requestVersion).toBe(String(EXPLAIN_BACK_JUDGE_CONTRACT_VERSION));
    expect(provenance.passageFingerprints).toEqual([
      await digestPassage(blocks[0]?.text ?? ''),
      await digestPassage(blocks[1]?.text ?? ''),
    ]);
    expect(() => explainBackGradingProvenance.parse(provenance)).not.toThrow();
  });

  it('omits fields with no real source rather than inventing them', async () => {
    const provenance = await buildExplainBackGradingProvenance({ sourceBlocks: [] });
    expect(Object.keys(provenance)).toEqual(['requestVersion']);
    const full = await buildExplainBackGradingProvenance({ sourceBlocks: blocks });
    expect(full).not.toHaveProperty('instrumentVersion');
    expect(full).not.toHaveProperty('targetVersion');
  });

  it('carries digests and a version label only, never passage text', async () => {
    const provenance = await buildExplainBackGradingProvenance({ sourceBlocks: blocks });
    const serialised = JSON.stringify(provenance);
    for (const block of blocks) expect(serialised).not.toContain(block.text);
  });
});

describe('v0.9: the view builds no grading provenance, and names passages only by digest', () => {
  it('no request is built, so no provenance is built or sent', () => {
    expect(modal).not.toMatch(/buildExplainBackGradingProvenance|gradingProvenance,/);
  });

  it('the practice explanation’s passages are digested with the same digestPassage, and their text goes nowhere', async () => {
    const input = await practiceExplanationInput({
      instrumentId: 'q-1',
      attemptId: 'attempt-2',
      conceptIds: ['concept-1'],
      promptShape: 'concept',
      durationMs: 1000,
      answer: 'an answer',
      leftAt: new Date('2026-10-20T14:00:00Z'),
      earlierAttemptIds: ['attempt-1'],
      passageTexts: blocks.map((block) => block.text),
    });
    expect(input.passagesShownInView).toEqual([
      {
        attemptId: 'attempt-1',
        passageFingerprints: [
          await digestPassage(blocks[0]?.text ?? ''),
          await digestPassage(blocks[1]?.text ?? ''),
        ],
      },
    ]);
    const serialised = JSON.stringify(input.passagesShownInView);
    for (const block of blocks) expect(serialised).not.toContain(block.text);
  });
});
