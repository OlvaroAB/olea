/**
 * `runGenerationSweep` tests (F3.3, `ol-p3t07a`).
 *
 * Proves: only embedded-source units trigger anything; dedupe against an
 * existing cache record of any status; the per-sweep cap bounds a burst;
 * a refusal caches nothing (retry-eligible next sweep); a drafted response
 * becomes a pending cache record keyed on (course, concept), with
 * `conceptIds` carrying the opaque `ConceptRecord.key` (`ol-63e1`'s
 * coordinated flip — `session/enumerate.ts` keys the same field the same
 * way), never the display name.
 */
import type { ConceptRecord, ExtractedUnit } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { MAX_CONCEPTS_PER_SWEEP } from '../../src/generation/constants.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const COURSE_FOLDER_NOTE = '01 Courses/COGS214/Week 2.md';

function concept(name: string, key = `key-${name}`): ConceptRecord {
  return { key, name, tier: 2, courses: ['COGS214'], sourcePaths: [COURSE_FOLDER_NOTE] };
}

function embeddedUnit(notePath: string): ExtractedUnit {
  return {
    text: 'irrelevant to this suite — the pipeline never reads unit text directly',
    provenance: {
      sourcePath: 'some-lecture.pdf',
      location: { page: 1, charRange: { start: 0, end: 1 } },
      embeddedIn: { notePath, blockStart: 0, blockEnd: 10 },
    },
  };
}

const groundedResponse = (stem: string): DraftQuizCardsResult => ({
  status: 'drafted',
  request: { courseCode: 'COGS214', conceptName: stem, sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: {
      questions: [{ stem, correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'because' }],
    },
  },
});

const refusedResponse: DraftQuizCardsResult = { status: 'refused', reason: 'no-hits' };

describe('runGenerationSweep', () => {
  it("does nothing for units with no embedding note (F3.1's bare-drop case, disclosed scope limit)", async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const unit: ExtractedUnit = {
      text: 'x',
      provenance: {
        sourcePath: 'loose.pdf',
        location: { page: 1, charRange: { start: 0, end: 1 } },
      },
    };

    const report = await runGenerationSweep([unit], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => {
        throw new Error('should never be called — no course was derivable');
      },
    });

    expect(report).toEqual({ attempted: 0, drafted: 0, refused: 0, skippedDuplicate: 0 });
  });

  it('drafts a new concept, caching one pending record keyed on the opaque concept key', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);

    const report = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => groundedResponse('Working memory'),
    });

    expect(report).toEqual({ attempted: 1, drafted: 1, refused: 0, skippedDuplicate: 0 });

    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      status: 'pending',
      courseCode: 'COGS214',
      conceptName: 'Working memory',
      // The opaque key, not the display name (`ol-63e1`'s flip).
      conceptIds: ['concept-key-1'],
      sourcePath: COURSE_FOLDER_NOTE,
    });
    expect(pending[0]?.provenance).toEqual({
      taskId: 'quiz.generate.v1',
      promptVersion: '1.0.0',
      modelId: 'test-model',
    });
  });

  it('INV-6: drafting never writes into her authored note — only the cache is touched', async () => {
    const herProse = '# Week 2\n\nHer own words about working memory, untouched.\n';
    const vault = new MemoryVaultSource({ [COURSE_FOLDER_NOTE]: herProse });
    const cache = createVaultDraftCacheStore(vault);

    await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => groundedResponse('Working memory'),
    });

    // Her note is byte-identical — nothing about drafting (as opposed to
    // accepting, `accept.spec.ts`'s job) ever writes into it.
    expect(await vault.read(COURSE_FOLDER_NOTE)).toBe(herProse);
    // Every write this sweep made landed under the cache folder only.
    const allPaths = await vault.list();
    const nonCachePaths = allPaths.filter((p) => !p.startsWith('.olea/drafts/'));
    expect(nonCachePaths).toEqual([COURSE_FOLDER_NOTE]);
  });

  it('never drafts a concept the cache already has a record for, whatever its status', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put({
      draftId: 'existing',
      status: 'rejected',
      courseCode: 'COGS214',
      conceptName: 'Working memory',
      conceptIds: ['Working memory'],
      sourcePath: COURSE_FOLDER_NOTE,
      createdAt: '2026-08-24T00:00:00-07:00',
      question: { stem: 's', correctAnswer: 'a', distractors: ['b', 'c', 'd'], feedback: 'f' },
      provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'm' },
      firstServedAt: null,
    });

    let calls = 0;
    const report = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => {
        calls += 1;
        return groundedResponse('Working memory');
      },
    });

    expect(calls).toBe(0);
    expect(report).toEqual({ attempted: 0, drafted: 0, refused: 0, skippedDuplicate: 1 });
  });

  it('bounds one sweep to MAX_CONCEPTS_PER_SWEEP attempts, leaving the rest for later', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const many = Array.from({ length: MAX_CONCEPTS_PER_SWEEP + 5 }, (_, i) =>
      concept(`Concept ${i}`, `key-${i}`),
    );

    let calls = 0;
    const report = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => many,
      draftForConcept: async (_deps, request) => {
        calls += 1;
        return groundedResponse(request.conceptName);
      },
    });

    expect(calls).toBe(MAX_CONCEPTS_PER_SWEEP);
    expect(report.attempted).toBe(MAX_CONCEPTS_PER_SWEEP);
    const pending = await cache.listPending();
    expect(pending).toHaveLength(MAX_CONCEPTS_PER_SWEEP);
  });

  it('a refused concept caches nothing, and is therefore eligible to be retried next sweep', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);

    const report = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory')],
      draftForConcept: async () => refusedResponse,
    });

    expect(report).toEqual({ attempted: 1, drafted: 0, refused: 1, skippedDuplicate: 0 });
    expect(await cache.list()).toEqual([]);

    // Retried, since nothing was cached — a second sweep attempts it again.
    let secondCalls = 0;
    await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory')],
      draftForConcept: async () => {
        secondCalls += 1;
        return refusedResponse;
      },
    });
    expect(secondCalls).toBe(1);
  });

  it('a concept the course listing does not name for THIS course is skipped', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);

    let calls = 0;
    const report = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [
        { key: 'k', name: 'Other course concept', tier: 2, courses: ['NEURO210'], sourcePaths: [] },
      ],
      draftForConcept: async () => {
        calls += 1;
        return groundedResponse('x');
      },
    });

    expect(calls).toBe(0);
    expect(report).toEqual({ attempted: 0, drafted: 0, refused: 0, skippedDuplicate: 0 });
  });
});
