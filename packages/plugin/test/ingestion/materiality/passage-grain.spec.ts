/**
 * `resolveAnchoredPassage` — the ladder's order, pinned directly (`[D-446]`, `ol-egov.141.89.5.32`).
 * The tick-level behaviours (withholding, judge calls, healing) are in
 * `citation-revision-passage-grain.spec.ts`; these prove which rung answers when several could.
 */
import { digestPassage, type VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type PassageNotes,
  resolveAnchoredPassage,
} from '../../../src/ingestion/materiality/passage-grain.js';

function notesOf(files: Record<string, string>): PassageNotes {
  return {
    exists: async (path: VaultPath) => files[path] !== undefined,
    material: async (path: VaultPath) => {
      const text = files[path];
      if (text === undefined) throw new Error('not found');
      return text;
    },
    markdownPaths: async () =>
      Object.keys(files)
        .filter((p) => p.endsWith('.md'))
        .sort(),
  };
}

const HERE = 'A.md';
const ELSEWHERE = 'B.md';
const PASSAGE = 'The centrifuge must be balanced before every run above two thousand rpm.';

async function anchored(text = PASSAGE) {
  return {
    text,
    passageDigest: await digestPassage(text),
    anchorPath: HERE,
    citedPath: HERE,
  };
}

describe('resolveAnchoredPassage ladder', () => {
  it('exact in place wins over everything else, including a copy elsewhere', async () => {
    const notes = notesOf({ [HERE]: `Intro.\n\n${PASSAGE}\n`, [ELSEWHERE]: `${PASSAGE}\n` });
    const resolved = await resolveAnchoredPassage(await anchored(), notes);
    expect(resolved).toMatchObject({ kind: 'present', via: 'exact', sourcePath: HERE });
  });

  it('an exact copy elsewhere is a relocation, and beats a merely resembling segment left in place', async () => {
    const resembling = 'The centrifuge must be balanced.';
    const notes = notesOf({ [HERE]: `${resembling}\n`, [ELSEWHERE]: `Other.\n\n${PASSAGE}\n` });
    const resolved = await resolveAnchoredPassage(await anchored(), notes);
    expect(resolved).toMatchObject({ kind: 'relocated', sourcePath: ELSEWHERE, text: PASSAGE });
  });

  it('a markup-only variant in place is present via the canonical rung, before any search elsewhere', async () => {
    const notes = notesOf({ [HERE]: `- **${PASSAGE}**\n`, [ELSEWHERE]: `${PASSAGE}\n` });
    const resolved = await resolveAnchoredPassage(await anchored(), notes);
    expect(resolved).toMatchObject({ kind: 'present', via: 'canonical', sourcePath: HERE });
  });

  it('an edited passage is identified only when exactly one segment of its shape resembles it', async () => {
    const edited = 'The centrifuge must be balanced before every run above three thousand rpm.';
    const one = await resolveAnchoredPassage(
      await anchored(),
      notesOf({ [HERE]: `Intro line.\n\n${edited}\n` }),
    );
    expect(one).toMatchObject({ kind: 'present', via: 'resembling', text: edited });

    const two = await resolveAnchoredPassage(
      await anchored(),
      notesOf({
        [HERE]: `${edited}\n\nThe centrifuge must be balanced before every run above four thousand rpm.\n`,
      }),
    );
    expect(two).toEqual({ kind: 'unresolved', reason: 'ambiguous' });
  });

  it('a single-line passage is never matched to the multi-line block that merely contains its words', async () => {
    const block = `${PASSAGE.replace('above two', 'above one')}\nAnd a long, unrelated second line about pipettes and racks.`;
    const resolved = await resolveAnchoredPassage(
      await anchored(),
      notesOf({ [HERE]: `${block}\n` }),
    );
    // Its own line resembles it (one candidate), the enclosing block is not a candidate for a line.
    expect(resolved).toMatchObject({ kind: 'present', via: 'resembling' });
    if (resolved.kind === 'present')
      expect(resolved.text).toBe(PASSAGE.replace('above two', 'above one'));
  });

  it('resemblance in another note is a proposal, never a relocation', async () => {
    const edited = 'The centrifuge must be balanced before every run above three thousand rpm.';
    const resolved = await resolveAnchoredPassage(
      await anchored(),
      notesOf({ [HERE]: 'Nothing relevant.\n', [ELSEWHERE]: `${edited}\n` }),
    );
    expect(resolved.kind).toBe('proposal');
  });

  it('nothing anywhere is missing; a note that has vanished is missing too', async () => {
    expect(
      await resolveAnchoredPassage(await anchored(), notesOf({ [HERE]: 'Unrelated.\n' })),
    ).toEqual({
      kind: 'unresolved',
      reason: 'missing',
    });
    expect(await resolveAnchoredPassage(await anchored(), notesOf({}))).toEqual({
      kind: 'unresolved',
      reason: 'missing',
    });
  });

  it('an anchor whose digest is unreadable is treated as a retired rule: clean answers only', async () => {
    const base = await anchored();
    const clean = await resolveAnchoredPassage(
      { ...base, passageDigest: 'p9:abc' },
      notesOf({ [HERE]: `${PASSAGE}\n` }),
    );
    expect(clean).toMatchObject({ kind: 'present', via: 'exact' });
    const edited = 'The centrifuge must be balanced before every run above three thousand rpm.';
    const unclean = await resolveAnchoredPassage(
      { ...base, passageDigest: 'p9:abc' },
      notesOf({ [HERE]: `${edited}\n` }),
    );
    expect(unclean).toEqual({ kind: 'unresolved', reason: 'rule-unsupported' });
  });
});
