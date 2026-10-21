/**
 * `[D-368]` / F3.7 (`ol-egov.141.89.105.21`): the sweep spends its per-sweep cap in the drain-order
 * key's order (current need, then expected yield, the rotation as the tie-break) when a reading is
 * composed, and in exactly today's order when it is not. Scenarios: `features/F3-learn-from-anything.md`,
 * "the sweep asks a course's concepts in the drain-order key's order". Every fixture is invented.
 */
import type { ConceptRecord, ExtractedUnit } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const COURSE = 'COURSE-A';
const NOTE = `01 Courses/${COURSE}/Concepts.md`;
const unit: ExtractedUnit = {
  text: 'unused by the sweep',
  provenance: {
    sourcePath: 'some-lecture.pdf',
    location: { page: 1, charRange: { start: 0, end: 1 } },
    embeddedIn: { notePath: NOTE, blockStart: 0, blockEnd: 10 },
  },
};
const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];

const concept = (name: string): ConceptRecord => ({
  key: `key-${name}`,
  name,
  tier: 2,
  courses: [COURSE],
  sourcePaths: [NOTE],
});

const quizResult = (name: string): DraftQuizCardsResult => ({
  status: 'drafted',
  request: { courseCode: COURSE, conceptName: name, sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: {
      questions: [{ stem: name, correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'x' }],
    },
  },
});

type Reading = { need: number; expectedYield: number };

async function sweepOnce(
  readings: Readonly<Record<string, Reading>> | null,
  nullFor?: string,
): Promise<string[]> {
  const vault = new MemoryVaultSource({
    [NOTE]: '---\ncourse: COURSE-A\n---\n\nSome prose.\n',
  });
  const asks: string[] = [];
  await runGenerationSweep([unit], {
    vault,
    cache: createVaultDraftCacheStore(vault),
    draftDeps: {} as never,
    listConceptsForCourse: async () => NAMES.map(concept),
    draftForConcept: async (_deps, request) => {
      asks.push(request.conceptName);
      return quizResult(request.conceptName);
    },
    ...(readings === null
      ? {}
      : {
          drainOrderFor: (payload) =>
            payload.conceptName === nullFor ? null : (readings[payload.conceptName] ?? null),
        }),
  });
  return asks;
}

describe('[D-368] the sweep orders its first calls by the drain-order key (ol-egov.141.89.105.21)', () => {
  it('without a reading the order is the name order, as before', async () => {
    expect(await sweepOnce(null)).toEqual(['Alpha', 'Beta', 'Delta']);
  });

  it('a higher-need concept is drafted before an alphabetically earlier one under the cap', async () => {
    const asks = await sweepOnce({
      Alpha: { need: 0.1, expectedYield: 3 },
      Beta: { need: 0.2, expectedYield: 3 },
      Gamma: { need: 0.9, expectedYield: 3 },
      Delta: { need: 0.1, expectedYield: 3 },
      Epsilon: { need: 0.5, expectedYield: 3 },
    });
    expect(asks).toEqual(['Gamma', 'Epsilon', 'Beta']);
  });

  it('equal need falls to the higher expected yield, and a full tie keeps the rotation', async () => {
    const asks = await sweepOnce({
      Alpha: { need: 0.5, expectedYield: 3 },
      Beta: { need: 0.5, expectedYield: 3 },
      Gamma: { need: 0.5, expectedYield: 5 },
      Delta: { need: 0.5, expectedYield: 3 },
      Epsilon: { need: 0.5, expectedYield: 3 },
    });
    expect(asks).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('a reading missing for any candidate leaves the rotation untouched', async () => {
    const asks = await sweepOnce(
      Object.fromEntries(NAMES.map((n) => [n, { need: n === 'Gamma' ? 1 : 0, expectedYield: 3 }])),
      'Epsilon',
    );
    expect(asks).toEqual(['Alpha', 'Beta', 'Delta']);
  });

  it('no concept is skipped: the ones the cap did not reach are asked on the next sweep', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: '---\ncourse: COURSE-A\n---\n\nSome prose.\n' });
    const cache = createVaultDraftCacheStore(vault);
    const asks: string[] = [];
    const need: Record<string, number> = { Alpha: 0, Beta: 0, Gamma: 1, Delta: 0, Epsilon: 1 };
    const run = () =>
      runGenerationSweep([unit], {
        vault,
        cache,
        draftDeps: {} as never,
        listConceptsForCourse: async () => NAMES.map(concept),
        draftForConcept: async (_deps, request) => {
          asks.push(request.conceptName);
          return quizResult(request.conceptName);
        },
        drainOrderFor: (p) => ({ need: need[p.conceptName] ?? 0, expectedYield: 3 }),
      });
    await run();
    expect(asks).toEqual(['Epsilon', 'Gamma', 'Alpha']);
    asks.length = 0;
    await run();
    expect(asks).toEqual(['Beta', 'Delta']);
  });
});
