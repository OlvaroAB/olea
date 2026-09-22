/**
 * `[JEV-6]` (`ol-3ux7.89`) — reconstruction tests.
 *
 * **INV-3.** Every path and every block of text below is invented. The
 * snapshot is never opened here; the resolver is a map, which is the point of
 * the port existing.
 */

import type { GroundedChunkRef } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { CapturedJudgeCase } from '../../src/retrieval/judge-case-capture.js';
import {
  type BlockLookup,
  type BlockResolver,
  drawJudgeCaseSample,
  reconstructJudgeCases,
} from '../../src/retrieval/judge-case-reconstruction.js';

class MapResolver implements BlockResolver {
  constructor(private readonly notes: Record<string, readonly string[] | undefined>) {}
  async lookup(ref: GroundedChunkRef): Promise<BlockLookup> {
    const blocks = this.notes[ref.path];
    if (blocks === undefined) return { status: 'note-missing' };
    const text = blocks[ref.blockIndex];
    if (text === undefined) return { status: 'block-missing' };
    return { status: 'ok', text };
  }
}

function capturedCase(id: string, refs: readonly GroundedChunkRef[]): CapturedJudgeCase {
  return {
    caseId: id,
    observedIndex: Number(id.slice(-4)) - 1,
    capturedAt: '2026-09-22T00:00:00.000Z',
    query: `fixture question ${id}`,
    refs,
    intendedOperation: 'explain',
  };
}

const NOTES = {
  'fixtures/alpha.md': ['alpha block zero', 'alpha block one', 'alpha block two'],
  'fixtures/beta.md': ['beta block zero'],
};

describe('reconstruction rebuilds the context the judge actually saw', () => {
  it('joins blocks in capture order with the separator the client itself uses', async () => {
    const report = await reconstructJudgeCases(
      [
        capturedCase('case-0001', [
          { path: 'fixtures/alpha.md', blockIndex: 2 },
          { path: 'fixtures/beta.md', blockIndex: 0 },
          { path: 'fixtures/alpha.md', blockIndex: 0 },
        ]),
      ],
      new MapResolver(NOTES),
    );
    expect(report.reconstructed).toHaveLength(1);
    // The separator is asserted literally: this is the one line that must not
    // drift from `resolveGroundedContext`'s own join.
    expect(report.reconstructed[0]?.context).toBe(
      'alpha block two\n\nbeta block zero\n\nalpha block zero',
    );
    expect(report.reconstructed[0]?.query).toBe('fixture question case-0001');
    expect(report.reconstructed[0]?.intendedOperation).toBe('explain');
  });

  it('carries the query through unchanged and adds nothing of its own', async () => {
    const report = await reconstructJudgeCases(
      [capturedCase('case-0002', [{ path: 'fixtures/beta.md', blockIndex: 0 }])],
      new MapResolver(NOTES),
    );
    expect(Object.keys(report.reconstructed[0] ?? {}).sort()).toEqual([
      'caseId',
      'context',
      'intendedOperation',
      'query',
    ]);
  });
});

describe('cases that postdate the snapshot are dropped and counted', () => {
  it('drops a case whose note is absent, and says why', async () => {
    const report = await reconstructJudgeCases(
      [
        capturedCase('case-0001', [{ path: 'fixtures/alpha.md', blockIndex: 0 }]),
        capturedCase('case-0002', [{ path: 'fixtures/written-later.md', blockIndex: 0 }]),
      ],
      new MapResolver(NOTES),
    );
    expect(report.reconstructed.map((c) => c.caseId)).toEqual(['case-0001']);
    expect(report.dropped).toEqual([{ caseId: 'case-0002', reason: 'note-missing' }]);
    expect(report.droppedByReason['note-missing']).toBe(1);
  });

  it('drops a case whose block index no longer exists', async () => {
    const report = await reconstructJudgeCases(
      [capturedCase('case-0003', [{ path: 'fixtures/beta.md', blockIndex: 9 }])],
      new MapResolver(NOTES),
    );
    expect(report.dropped).toEqual([{ caseId: 'case-0003', reason: 'block-missing' }]);
  });

  it('drops the WHOLE case when only one of its refs fails, never a short context', async () => {
    const report = await reconstructJudgeCases(
      [
        capturedCase('case-0004', [
          { path: 'fixtures/alpha.md', blockIndex: 0 },
          { path: 'fixtures/written-later.md', blockIndex: 0 },
        ]),
      ],
      new MapResolver(NOTES),
    );
    expect(report.reconstructed).toHaveLength(0);
    expect(report.dropped[0]?.reason).toBe('note-missing');
  });

  it('accounts for every case handed in — nothing is silently skipped', async () => {
    const cases = [
      capturedCase('case-0001', [{ path: 'fixtures/alpha.md', blockIndex: 0 }]),
      capturedCase('case-0002', [{ path: 'fixtures/gone.md', blockIndex: 0 }]),
      capturedCase('case-0003', [{ path: 'fixtures/beta.md', blockIndex: 4 }]),
      capturedCase('case-0004', []),
    ];
    const report = await reconstructJudgeCases(cases, new MapResolver(NOTES));
    expect(report.attempted).toBe(4);
    expect(report.reconstructed.length + report.dropped.length).toBe(report.attempted);
    expect(report.droppedByReason).toEqual({
      'note-missing': 1,
      'block-missing': 1,
      'no-refs': 1,
      'resolver-failed': 0,
    });
  });

  it('separates a broken resolver from vault staleness', async () => {
    const throwing: BlockResolver = {
      lookup: () => Promise.reject(new Error('read failed')),
    };
    const report = await reconstructJudgeCases(
      [capturedCase('case-0005', [{ path: 'fixtures/alpha.md', blockIndex: 0 }])],
      throwing,
    );
    expect(report.dropped).toEqual([{ caseId: 'case-0005', reason: 'resolver-failed' }]);
    expect(report.droppedByReason['note-missing']).toBe(0);
  });

  it('reconstructs an edited block without noticing — the limit stated in the module doc', async () => {
    // Asserted so the limitation is a recorded fact rather than an assumption:
    // same path, same block count, different text, and reconstruction is happy.
    const edited = { 'fixtures/beta.md': ['beta block zero, since rewritten'] };
    const report = await reconstructJudgeCases(
      [capturedCase('case-0006', [{ path: 'fixtures/beta.md', blockIndex: 0 }])],
      new MapResolver(edited),
    );
    expect(report.dropped).toHaveLength(0);
    expect(report.reconstructed[0]?.context).toBe('beta block zero, since rewritten');
  });
});

describe('the freeze-time draw', () => {
  const pool = Array.from({ length: 40 }, (_, i) =>
    capturedCase(`case-${String(i + 1).padStart(4, '0')}`, [
      { path: 'fixtures/alpha.md', blockIndex: 0 },
    ]),
  );

  it('is reproducible from the seed', () => {
    expect(drawJudgeCaseSample(pool, 10, 4242).map((c) => c.caseId)).toEqual(
      drawJudgeCaseSample(pool, 10, 4242).map((c) => c.caseId),
    );
  });

  it('draws distinct cases and honours n', () => {
    const drawn = drawJudgeCaseSample(pool, 10, 4242);
    expect(drawn).toHaveLength(10);
    expect(new Set(drawn.map((c) => c.caseId)).size).toBe(10);
  });

  it('returns everything, not an error, when n exceeds the pool', () => {
    expect(drawJudgeCaseSample(pool, 500, 1)).toHaveLength(40);
    expect(drawJudgeCaseSample([], 10, 1)).toHaveLength(0);
  });

  it('a different seed draws a different sample', () => {
    expect(drawJudgeCaseSample(pool, 10, 1).map((c) => c.caseId)).not.toEqual(
      drawJudgeCaseSample(pool, 10, 2).map((c) => c.caseId),
    );
  });

  it('does not reuse the reservoir generator, so keeping and drawing stay independent', () => {
    // Same seed, same index space: if the draw reused the capture generator
    // the two orderings would coincide. They must not.
    const bySeedOrder = drawJudgeCaseSample(pool, 40, 20260922).map((c) => c.caseId);
    expect(bySeedOrder).not.toEqual(pool.map((c) => c.caseId));
  });
});
