/**
 * `ol-egov.141.89.6.39`: fixture-vault coverage for
 * `hasExplainBackSourceFingerprintChanged` — the direct per-block staleness
 * check behind `main.ts`'s `buildExplainBackObservationContextFor`. No
 * `obsidian` import anywhere in this file (INV-1): the function under test
 * takes `IntroducingPassageVaultReader`, the same narrow structural type
 * `resolve-introducing-passage.ts` declares, never `ObsidianSource`.
 */

import { parseDocument } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { hasExplainBackSourceRevisionChanged } from '../../src/explain-back/observation.js';
import type { ExplainBackSourceBlock } from '../../src/explain-back/request.js';
import type { IntroducingPassageVaultReader } from '../../src/explain-back/resolve-introducing-passage.js';
import { hasExplainBackSourceFingerprintChanged } from '../../src/explain-back/source-fingerprint-staleness.js';

/** A minimal, in-memory fixture vault — only the one capability this check needs. */
class FixtureVault implements IntroducingPassageVaultReader {
  constructor(private readonly files: ReadonlyMap<string, string>) {}
  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`FixtureVault: no such file ${path}`);
    return content;
  }
}

/** Builds the `ExplainBackSourceBlock` `retrieveExplainBackSourceBlocks` would have minted for `blockIndex` in `content` at grading time — real parsing, never a hand-picked offset or text. */
function sourceBlockFor(
  path: string,
  content: string,
  blockIndex: number,
  index = 0,
): ExplainBackSourceBlock {
  const block = parseDocument(content).blocks[blockIndex];
  if (block === undefined) throw new Error(`fixture error: no block ${blockIndex}`);
  return {
    block: { blockId: `${path}#${blockIndex}#${index}`, text: block.raw },
    path,
    blockIndex,
  };
}

describe('hasExplainBackSourceFingerprintChanged (ol-egov.141.89.6.39)', () => {
  it('reads false — not stale — when every graded block still matches its current passage', async () => {
    const content = 'Bronchitis causes coughing.\n\nCoughing can trigger vomiting.\n';
    const vault = new FixtureVault(new Map([['course/subject.md', content]]));
    const gradedAgainst = [
      sourceBlockFor('course/subject.md', content, 0),
      sourceBlockFor('course/subject.md', content, 2),
    ];

    await expect(hasExplainBackSourceFingerprintChanged(vault, gradedAgainst)).resolves.toBe(false);
  });

  it('reads false — not stale — for the vacuous case of no graded blocks', async () => {
    const vault = new FixtureVault(new Map());
    await expect(hasExplainBackSourceFingerprintChanged(vault, [])).resolves.toBe(false);
  });

  it('reads true — stale — when a graded block was edited since grading (fingerprint mismatch)', async () => {
    const path = 'course/subject.md';
    const original = 'Bronchitis causes coughing.\n';
    const graded = [sourceBlockFor(path, original, 0)];
    const edited = 'Bronchitis causes wheezing.\n'; // same note, same block, different text
    const vault = new FixtureVault(new Map([[path, edited]]));

    await expect(hasExplainBackSourceFingerprintChanged(vault, graded)).resolves.toBe(true);
  });

  it('reads true — stale — when a graded block has disappeared (note shortened, the index no longer resolves)', async () => {
    const path = 'course/subject.md';
    const original = 'Intro paragraph.\n\nBronchitis causes coughing.\n';
    const graded = [sourceBlockFor(path, original, 2)];
    const shortened = 'Intro paragraph.\n'; // block index 2 no longer exists
    const vault = new FixtureVault(new Map([[path, shortened]]));

    await expect(hasExplainBackSourceFingerprintChanged(vault, graded)).resolves.toBe(true);
  });

  it('reads true — stale — when the note itself is missing', async () => {
    const path = 'course/gone.md';
    const graded: ExplainBackSourceBlock[] = [
      { block: { blockId: `${path}#0#0`, text: 'Whatever it said.\n' }, path, blockIndex: 0 },
    ];
    const vault = new FixtureVault(new Map());

    await expect(hasExplainBackSourceFingerprintChanged(vault, graded)).resolves.toBe(true);
  });

  it("the regression this bead exists to close: a fresh retrieval's different top-K set does not, by itself, make an unchanged graded block read as stale", async () => {
    // `ol-egov.141.89.6.16`'s own follow-up named the exact defect: the old
    // comparator (`hasExplainBackSourceRevisionChanged`) compares the GRADED
    // block set against a FRESH RETRIEVAL's set. A new, more-relevant note
    // landing in the vault since grading can bump one of the originally
    // graded blocks out of a fresh top-K window even though that block's own
    // passage never changed on disk — the old comparator reads that as
    // stale (a false positive); this bead's direct check does not, because
    // it never retrieves at all.
    const pathA = 'course/a.md';
    const contentA = 'Block A, unchanged on disk.\n';
    const pathB = 'course/b.md';
    const contentB = 'Block B, unchanged on disk.\n';
    const pathC = 'course/c.md';
    const contentC = 'Block C, unchanged on disk — but a fresh retrieval no longer selects it.\n';
    const pathD = 'course/d.md';
    const contentD = 'Block D, a brand-new note that outranks C in a fresh retrieval.\n';

    const blockA = sourceBlockFor(pathA, contentA, 0, 0);
    const blockB = sourceBlockFor(pathB, contentB, 0, 1);
    const blockC = sourceBlockFor(pathC, contentC, 0, 2);
    const gradedAgainst = [blockA, blockB, blockC];

    // The old comparator's own reported verdict for this scenario — proves
    // the defect this bead's fix exists to close, rather than merely
    // asserting it in prose.
    const freshlyRetrieved = [blockA, blockB, sourceBlockFor(pathD, contentD, 0, 2)];
    expect(hasExplainBackSourceRevisionChanged(gradedAgainst, freshlyRetrieved)).toBe(true);

    // The identical scenario, through this bead's direct check: block C's
    // own passage is untouched on disk, so nothing here reads as stale.
    const vault = new FixtureVault(
      new Map([
        [pathA, contentA],
        [pathB, contentB],
        [pathC, contentC],
        [pathD, contentD],
      ]),
    );
    await expect(hasExplainBackSourceFingerprintChanged(vault, gradedAgainst)).resolves.toBe(false);
  });
});
