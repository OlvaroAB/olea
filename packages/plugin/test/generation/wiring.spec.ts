/**
 * `buildGenerationWiring`'s own `now` threading (`ol-3ux7.64.9` [WBX-8]).
 *
 * `createDraftAcceptPort` and `runGenerationSweep` already took an
 * injectable `now` before this bead (`accept.spec.ts`/`pipeline.spec.ts`
 * cover their own default-vs-injected behaviour directly) — what this bead
 * added is `GenerationWiringDeps.now`, forwarded to both from ONE place so
 * `main.ts`'s single clock seam (`this.now`) reaches the whole generation
 * composition, not just the sites `main.ts` calls directly. This file
 * proves that one forwarding hop, not the underlying ports' own behaviour a
 * second time.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecord } from '../../src/generation/types.js';
import { buildGenerationWiring } from '../../src/generation/wiring.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE_PATH = '01 Courses/COGS214/Week 2.md';
const STUBBED_NOW = new Date('2033-11-02T08:00:00.000Z');

function baseRecord(): DraftRecord {
  return {
    draftId: 'draft-1',
    status: 'pending',
    courseCode: 'COGS214',
    conceptName: 'Working memory',
    conceptIds: ['concept-key-1'],
    sourcePath: NOTE_PATH,
    createdAt: '2026-08-25T09:00:00-07:00',
    question: {
      stem: 'What limits working memory capacity?',
      correctAnswer: 'Chunking',
      distractors: ['A', 'B', 'C', 'D'],
      feedback: 'See the lecture notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
  };
}

describe('buildGenerationWiring — now threading', () => {
  it('an injected now reaches acceptPort.reject’s resolvedAt, not real time', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a', now: () => STUBBED_NOW });
    await wiring.cache.put(baseRecord());

    await wiring.acceptPort.reject('draft-1');

    const resolved = await wiring.cache.get('draft-1');
    expect(resolved?.status).toBe('rejected');
    expect(resolved?.resolvedAt).toBe(isoWithLocalOffset(STUBBED_NOW));
  });

  it('omitted, acceptPort still defaults to the real wall clock — unchanged from before this bead', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });
    await wiring.cache.put(baseRecord());

    const before = Date.now();
    await wiring.acceptPort.reject('draft-1');
    const after = Date.now();

    const resolved = await wiring.cache.get('draft-1');
    const resolvedMs =
      resolved?.resolvedAt === undefined ? Number.NaN : Date.parse(resolved.resolvedAt);
    expect(resolvedMs).toBeGreaterThanOrEqual(before);
    expect(resolvedMs).toBeLessThanOrEqual(after + 1000);
  });
});
