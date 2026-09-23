import { describe, expect, it } from 'vitest';
import { buildEvidencePackage } from './evidencePackage.js';
import type { GroundedChunk } from './groundedContext.js';

/** A trivial, deterministic fake — length-prefixed text, never real crypto. */
async function fakeHash(text: string): Promise<string> {
  return `digest:${text.length}:${text}`;
}

function chunk(path: string, blockIndex: number, text: string): GroundedChunk {
  return { path, blockIndex, text };
}

describe('buildEvidencePackage (`[ILB-EVD-4]`, evd.md §2/§3)', () => {
  it('produces one passage per chunk, aliased p1, p2, … in input order', async () => {
    const chunks = [
      chunk('01 Courses/COURSEA/lecture-1.md', 0, 'first passage text'),
      chunk('01 Courses/COURSEA/lecture-2.md', 3, 'second passage text'),
      chunk('03 Research/notes.md', 1, 'third passage text'),
    ];

    const pkg = await buildEvidencePackage(chunks, { hash: fakeHash });

    expect(pkg.passages.map((p) => p.alias)).toEqual(['p1', 'p2', 'p3']);
    expect(pkg.passages[0]).toMatchObject({
      sourcePath: '01 Courses/COURSEA/lecture-1.md',
      blockIndex: 0,
      text: 'first passage text',
    });
  });

  it('aliases follow input order, not path or blockIndex order', async () => {
    const chunks = [
      chunk('z.md', 9, 'z text'),
      chunk('a.md', 0, 'a text'),
      chunk('m.md', 4, 'm text'),
    ];

    const pkg = await buildEvidencePackage(chunks, { hash: fakeHash });

    expect(pkg.passages.map((p) => p.sourcePath)).toEqual(['z.md', 'a.md', 'm.md']);
  });

  it('computes passageDigest via the injected hasher, keyed on the passage text', async () => {
    const chunks = [chunk('a.md', 0, 'same text'), chunk('b.md', 0, 'same text')];

    const pkg = await buildEvidencePackage(chunks, { hash: fakeHash });

    expect(pkg.passages[0]?.passageDigest).toBe(await fakeHash('same text'));
    // Identical text, identical digest — even across different sources.
    expect(pkg.passages[0]?.passageDigest).toBe(pkg.passages[1]?.passageDigest);
  });

  it('gives different text a different digest', async () => {
    const chunks = [chunk('a.md', 0, 'text one'), chunk('a.md', 1, 'text two')];

    const pkg = await buildEvidencePackage(chunks, { hash: fakeHash });

    expect(pkg.passages[0]?.passageDigest).not.toBe(pkg.passages[1]?.passageDigest);
  });

  it('never touches the network or platform crypto — a hasher that just counts calls is enough to build a package', async () => {
    let calls = 0;
    const countingHash = async (text: string): Promise<string> => {
      calls += 1;
      return `h${calls}:${text.length}`;
    };
    const chunks = [chunk('a.md', 0, 'x'), chunk('b.md', 0, 'yy')];

    await buildEvidencePackage(chunks, { hash: countingHash });

    expect(calls).toBe(2);
  });

  it('records sourceRevisions from the injected resolver, keyed by sourcePath', async () => {
    const chunks = [chunk('a.md', 0, 'text'), chunk('b.md', 0, 'text')];
    const revisionOf = (path: string): string | undefined =>
      path === 'a.md' ? 'rev-1' : undefined;

    const pkg = await buildEvidencePackage(chunks, { hash: fakeHash, revisionOf });

    expect(pkg.sourceRevisions).toEqual({ 'a.md': 'rev-1', 'b.md': undefined });
  });

  it('leaves every sourceRevisions entry undefined when no resolver is supplied', async () => {
    const chunks = [chunk('a.md', 0, 'text'), chunk('b.md', 1, 'other text')];

    const pkg = await buildEvidencePackage(chunks, { hash: fakeHash });

    expect(pkg.sourceRevisions).toEqual({ 'a.md': undefined, 'b.md': undefined });
  });

  it('records one sourceRevisions entry per distinct source, even when several passages share a source', async () => {
    const chunks = [
      chunk('a.md', 0, 'first'),
      chunk('a.md', 1, 'second'),
      chunk('b.md', 0, 'third'),
    ];
    let calls = 0;
    const revisionOf = (): string => {
      calls += 1;
      return `rev-${calls}`;
    };

    const pkg = await buildEvidencePackage(chunks, { hash: fakeHash, revisionOf });

    // Resolved once per distinct path, not once per passage.
    expect(calls).toBe(2);
    expect(Object.keys(pkg.sourceRevisions)).toEqual(['a.md', 'b.md']);
  });

  it('always returns an empty conflicts list — detection is a later stage', async () => {
    const chunks = [chunk('a.md', 0, 'x'), chunk('b.md', 0, 'y')];

    const pkg = await buildEvidencePackage(chunks, { hash: fakeHash });

    expect(pkg.conflicts).toEqual([]);
  });

  it('produces an empty package from an empty chunk list', async () => {
    const pkg = await buildEvidencePackage([], { hash: fakeHash });

    expect(pkg).toEqual({ passages: [], sourceRevisions: {}, conflicts: [] });
  });

  it('is side-effect free on its input: calling it twice with the same chunks yields the same package', async () => {
    const chunks = [chunk('a.md', 0, 'text')];

    const first = await buildEvidencePackage(chunks, { hash: fakeHash });
    const second = await buildEvidencePackage(chunks, { hash: fakeHash });

    expect(first).toEqual(second);
  });
});
