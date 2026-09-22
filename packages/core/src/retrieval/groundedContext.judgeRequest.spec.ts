/**
 * `[JEV-6]` (`ol-3ux7.89`) — the `onJudgeRequest` seam.
 *
 * Two properties, and the second is the one that matters in production: the
 * recorder sees exactly the requests that reach the judge, and it is
 * incapable of changing what the gate does — including by throwing.
 *
 * **INV-3.** Every string below is invented fixture text.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type GroundingJudgePort,
  type JudgeRequestRecord,
  resolveGroundedContext,
} from './groundedContext.js';
import type { HybridHit } from './hybrid.js';

const BAND = { lower: 0.4, upper: 0.8 };

function hit(path: string, blockIndex: number, cosineScore: number): HybridHit {
  return {
    path,
    blockIndex,
    text: `fixture block ${blockIndex} of ${path}`,
    cosineScore,
    lexicalScore: 1,
    source: 'both',
  } as unknown as HybridHit;
}

const IN_BAND = { top1: 0.6, lexBest: 1, marginP99: 0.5 } as never;
const ABOVE_BAND = { top1: 0.95, lexBest: 1, marginP99: 0.5 } as never;
const BELOW_BAND = { top1: 0.1, lexBest: 1, marginP99: 0.5 } as never;

const supportingJudge: GroundingJudgePort = {
  judge: async () => ({ supported: true, reason: 'fixture reason' }),
};

describe('onJudgeRequest', () => {
  it('fires once, with pointers and no passage text, for a request that reaches the judge', async () => {
    const seen: JudgeRequestRecord[] = [];
    const result = await resolveGroundedContext(
      [hit('fixtures/alpha.md', 0, 0.6), hit('fixtures/beta.md', 2, 0.55)],
      {
        band: BAND,
        compositeSignals: IN_BAND,
        judge: supportingJudge,
        query: 'fixture question',
        intendedOperation: 'define',
        onJudgeRequest: (record) => seen.push(record),
      },
    );

    expect(result.status).toBe('grounded');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.query).toBe('fixture question');
    expect(seen[0]?.intendedOperation).toBe('define');
    expect(seen[0]?.refs).toEqual([
      { path: 'fixtures/alpha.md', blockIndex: 0 },
      { path: 'fixtures/beta.md', blockIndex: 2 },
    ]);
    // The structural claim, asserted rather than asserted-in-prose: no ref
    // carries text, so no passage can have been written by a recorder.
    for (const ref of seen[0]?.refs ?? []) {
      expect(Object.keys(ref).sort()).toEqual(['blockIndex', 'path']);
    }
  });

  it('does not fire for requests the numbers decide, above or below the band', async () => {
    const onJudgeRequest = vi.fn();
    await resolveGroundedContext([hit('fixtures/alpha.md', 0, 0.95)], {
      band: BAND,
      compositeSignals: ABOVE_BAND,
      judge: supportingJudge,
      query: 'fixture question',
      onJudgeRequest,
    });
    await resolveGroundedContext([hit('fixtures/alpha.md', 0, 0.1)], {
      band: BAND,
      compositeSignals: BELOW_BAND,
      judge: supportingJudge,
      query: 'fixture question',
      onJudgeRequest,
    });
    expect(onJudgeRequest).not.toHaveBeenCalled();
  });

  it('does not fire when the request refuses as judge-unavailable, since nothing left the device', async () => {
    const onJudgeRequest = vi.fn();
    const result = await resolveGroundedContext([hit('fixtures/alpha.md', 0, 0.6)], {
      band: BAND,
      compositeSignals: IN_BAND,
      query: 'fixture question',
      onJudgeRequest,
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'judge-unavailable' });
    expect(onJudgeRequest).not.toHaveBeenCalled();
  });

  it('a throwing recorder cannot change the gate decision', async () => {
    const result = await resolveGroundedContext([hit('fixtures/alpha.md', 0, 0.6)], {
      band: BAND,
      compositeSignals: IN_BAND,
      judge: supportingJudge,
      query: 'fixture question',
      onJudgeRequest: () => {
        throw new Error('recorder is broken');
      },
    });
    expect(result.status).toBe('grounded');
  });

  it('omitting it reproduces the same decision byte for byte', async () => {
    const options = {
      band: BAND,
      compositeSignals: IN_BAND,
      judge: supportingJudge,
      query: 'fixture question',
    };
    const without = await resolveGroundedContext([hit('fixtures/alpha.md', 0, 0.6)], options);
    const with_ = await resolveGroundedContext([hit('fixtures/alpha.md', 0, 0.6)], {
      ...options,
      onJudgeRequest: () => undefined,
    });
    expect(with_).toEqual(without);
  });
});
