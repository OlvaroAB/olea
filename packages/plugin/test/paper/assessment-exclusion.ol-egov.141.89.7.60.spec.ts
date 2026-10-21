/**
 * `ol-egov.141.89.7.60` with `[D-562]`: the shared-passage lookup never takes a passage from a past
 * paper. Since the local grouping lets a Markdown past paper shape a structured paper, the papers
 * kept out of the lookup must include every source whose frontmatter declares `role: past-paper`,
 * of any course, beside the papers registered through her review log.
 *
 * Synthetic vault: every path, course and line here is invented.
 */

import { describe, expect, it } from 'vitest';
import { registeredPastPaperPathsForVault } from '../../src/paper/wiring.js';
import { memoryVault } from '../review/memory-vault.js';

const PAPER_A = '03 Research/COURSEA Past Paper.md';
const PAPER_B = '03 Research/COURSEB Past Paper.md';
const NOTE = '03 Research/Lever notes.md';

const paper = (course: string): string =>
  [
    '---',
    'role: past-paper',
    `course: ${course}`,
    '---',
    '',
    '## Question 1',
    '',
    'Explain a lever.',
  ].join('\n');

describe('the papers kept out of the shared-passage lookup', () => {
  it('include a Markdown past paper declared in its frontmatter, of any course, and never a plain note', async () => {
    const vault = memoryVault({
      [PAPER_A]: paper('COURSEA'),
      [PAPER_B]: paper('COURSEB'),
      [NOTE]:
        'A lever multiplies force about a pivot, and this note is long enough to read as prose.',
    });

    const kept = await registeredPastPaperPathsForVault(vault)();

    expect([...kept].sort()).toEqual([PAPER_A, PAPER_B]);
  });

  it('name each paper once', async () => {
    const vault = memoryVault({ [PAPER_A]: paper('COURSEA') });

    const kept = await registeredPastPaperPathsForVault(vault)();

    expect(kept).toEqual([PAPER_A]);
  });
});
