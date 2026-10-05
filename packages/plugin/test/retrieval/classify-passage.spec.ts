/**
 * `buildClassifyPassageHook` tests (`ol-2zfj.36`, `[D-101]`) — the
 * production `DraftQuizCardsDeps.classifyPassage` hook, proving it threads
 * `olea-core`'s `classifyMateriality` cascade correctly for the three cues
 * this plugin can actually supply today: format (from the path alone),
 * frontmatter-declared role (via the narrow `FrontmatterRoleHost` port),
 * and the folder prior (also from the path alone). No `obsidian` import
 * anywhere in this file, matching `wiring.spec.ts`'s own discipline.
 */
import { describe, expect, it } from 'vitest';
import type { FrontmatterRoleHost } from '../../src/retrieval/classify-passage.js';
import { buildClassifyPassageHook } from '../../src/retrieval/classify-passage.js';

class FakeFrontmatterHost implements FrontmatterRoleHost {
  constructor(private readonly byPath: Record<string, Record<string, unknown>> = {}) {}
  frontmatterFor(path: string): Record<string, unknown> | undefined {
    return this.byPath[path];
  }
}

describe('buildClassifyPassageHook', () => {
  it('defaults to unknown/unknown for a plain markdown chunk with no cue at all', () => {
    const hook = buildClassifyPassageHook({ frontmatterHost: new FakeFrontmatterHost() });

    const result = hook({ path: '01 Courses/COURSE101/WEEK 2/loose-note.md', text: 'plain prose' });

    expect(result).toEqual({ authorship: 'unknown', curationAuthority: 'unknown' });
  });

  it('classifies a PDF chunk as not-hers/instructor from the path extension alone', () => {
    const hook = buildClassifyPassageHook({ frontmatterHost: new FakeFrontmatterHost() });

    const result = hook({
      path: '01 Courses/COURSE101/WEEK 2/Lecture Slides/deck.pdf',
      text: 'anything',
    });

    expect(result).toEqual({ authorship: 'not-hers', curationAuthority: 'instructor' });
  });

  it("honours a note's declared role frontmatter, tolerant of casing/separators", () => {
    const hook = buildClassifyPassageHook({
      frontmatterHost: new FakeFrontmatterHost({
        '03 Research/exam-2024.md': { role: 'Past Paper' },
      }),
    });

    const result = hook({ path: '03 Research/exam-2024.md', text: 'exam question text' });

    expect(result).toEqual({ authorship: 'not-hers', curationAuthority: 'instructor' });
  });

  it('ignores an unrecognised role value — F1.5 honoured, never required', () => {
    const hook = buildClassifyPassageHook({
      frontmatterHost: new FakeFrontmatterHost({
        '03 Research/lit-note.md': { role: 'journal-article' },
      }),
    });

    const result = hook({ path: '03 Research/lit-note.md', text: 'a citation note' });

    // No recognised role and no folder-prior match on "Research" alone
    // (`/research/i` DOES match — this note lands in the published-prior
    // branch, authorship stays unknown).
    expect(result).toEqual({ authorship: 'unknown', curationAuthority: 'published' });
  });

  it('applies the folder prior for a Zettelkasten note: curation hers, authorship stays unknown (D-490)', () => {
    const hook = buildClassifyPassageHook({ frontmatterHost: new FakeFrontmatterHost() });

    const result = hook({ path: '05 Zettelkasten/atomic-note.md', text: 'a short synthesis' });

    expect(result).toEqual({ authorship: 'unknown', curationAuthority: 'hers' });
  });

  it('reads her made-by declaration from cached frontmatter (D-490)', () => {
    const me = '01 Courses/ISLD130/Logbook/Mooring Rudiments.md';
    const assistant = '01 Courses/ISLD130/Logbook/Tideline Slippage Digest.md';
    const mixed = '01 Courses/ISLD130/Logbook/Mixed.md';
    const bad = '01 Courses/ISLD130/Zettelkasten/Bad value.md';
    const undeclared = '01 Courses/ISLD130/Zettelkasten/Undeclared.md';
    const hook = buildClassifyPassageHook({
      frontmatterHost: new FakeFrontmatterHost({
        [me]: { 'made-by': 'me' },
        // An assistant note she later edited still says assistant.
        [assistant]: { 'made-by': 'assistant', 'made-from': ['[[Lecture - Skerry Accretion]]'] },
        [mixed]: { 'made-by': 'mixed' },
        [bad]: { 'made-by': 'robot' },
      }),
    });

    expect(hook({ path: me, text: 'My own working notes.' })?.authorship).toBe('hers');
    expect(hook({ path: assistant, text: 'Last Tuesday I watched the line move.' })).toEqual({
      authorship: 'not-hers',
      curationAuthority: 'unknown',
    });
    expect(hook({ path: mixed, text: 'x' })?.authorship).toBe('unknown');
    // Invalid value ignored: reads as undeclared (folder prior, never hers).
    expect(hook({ path: bad, text: 'x' })).toEqual(hook({ path: undeclared, text: 'x' }));
    expect(hook({ path: undeclared, text: 'x' })?.authorship).toBe('unknown');
  });

  it('applies a passage-grain override per chunk, not per document', () => {
    const hook = buildClassifyPassageHook({ frontmatterHost: new FakeFrontmatterHost() });
    const path = '05 Zettelkasten/mixed-note.md';

    const plainChunk = hook({ path, text: 'my own argument, no embed' });
    const embeddedFragmentChunk = hook({ path, text: '![[deck.pdf#page=3]] slide 3 said this' });

    expect(plainChunk).toEqual({ authorship: 'unknown', curationAuthority: 'hers' });
    expect(embeddedFragmentChunk).toEqual({
      authorship: 'not-hers',
      curationAuthority: 'instructor',
    });
  });
});
