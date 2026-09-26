/**
 * D-381 (`ol-egov.141.89.5.18`; chg.md §11's cache-key audit) —
 * `runGenerationSweep`'s dedupe check now passes the embedding note's
 * current content digest into `findByKey` (`pipeline.ts`'s
 * `courseVersionExpectation`). Kept separate from `pipeline.spec.ts` so that
 * suite's existing dedupe assertions (still exercised there, unchanged)
 * stay a clean signal that a caller never supplying a changed note sees
 * byte-identical behaviour to before this bead.
 *
 * Proves: an unchanged note still dedupes (skippedDuplicate); a changed
 * note is no longer masked by the older cached record, so a fresh draft is
 * cached (lazily, only because a real sweep ran — nothing eager); and the
 * older record's own file is never rewritten by that fresh draft — even
 * when its status is already `'accepted'` (D-381's clarification).
 */
import type { ConceptRecord, ExtractedUnit } from 'olea-core';
import { hashText } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
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
      questions: [
        {
          stem: `${stem} (redrafted)`,
          correctAnswer: 'A',
          distractors: ['B', 'C', 'D'],
          feedback: 'because',
        },
      ],
    },
  },
});

describe('runGenerationSweep — D-381 version-aware dedupe', () => {
  it('an unchanged note still dedupes: a second sweep over the same content never drafts again', async () => {
    const vault = new MemoryVaultSource({ [COURSE_FOLDER_NOTE]: 'the original passage' });
    const cache = createVaultDraftCacheStore(vault);
    const deps = {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => groundedResponse('Working memory'),
    };

    const first = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], deps);
    expect(first.drafted).toBe(1);

    const second = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], deps);
    expect(second).toMatchObject({ attempted: 0, drafted: 0, skippedDuplicate: 1 });
    expect(await cache.list()).toHaveLength(1);
  });

  it('a materiality-confirmed content change is no longer masked: the old record blocks nothing, and a fresh draft is cached', async () => {
    const vault = new MemoryVaultSource({ [COURSE_FOLDER_NOTE]: 'the original passage' });
    const cache = createVaultDraftCacheStore(vault);
    const deps = {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => groundedResponse('Working memory'),
    };

    await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], deps);
    const before = await cache.list();
    expect(before).toHaveLength(1);
    const oldDraftId = before[0]?.draftId;

    // The note's content changed — a real, materiality-confirmed edit.
    await vault.write(COURSE_FOLDER_NOTE, 'a substantially revised passage');

    const secondSweep = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], deps);
    // Never eager: only this one real sweep call triggered the redo — no
    // background pass, no re-run of anything beyond what this sweep itself
    // asked for.
    expect(secondSweep).toMatchObject({ attempted: 1, drafted: 1, skippedDuplicate: 0 });

    const after = await cache.list();
    expect(after).toHaveLength(2); // the old record survives, untouched, alongside the new one
    const oldStillThere = after.find((r) => r.draftId === oldDraftId);
    expect(oldStillThere).toEqual(before[0]);

    const fresh = after.find((r) => r.draftId !== oldDraftId);
    expect(fresh?.sourceContentHash).toBe(await hashText('a substantially revised passage'));
    expect(fresh?.question?.stem).toBe('Working memory (redrafted)');
  });

  it("D-381's clarification: an ACCEPTED record is never rewritten by a redraft triggered after its source changed", async () => {
    const vault = new MemoryVaultSource({ [COURSE_FOLDER_NOTE]: 'the original passage' });
    const cache = createVaultDraftCacheStore(vault);
    const deps = {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => groundedResponse('Working memory'),
    };

    await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], deps);
    const [original] = await cache.list();
    if (original === undefined) throw new Error('expected one cached record');
    // She accepted it.
    await cache.put({ ...original, status: 'accepted' });
    const accepted = await cache.get(original.draftId);
    expect(accepted?.status).toBe('accepted');

    await vault.write(COURSE_FOLDER_NOTE, 'a substantially revised passage');
    const report = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], deps);
    expect(report.drafted).toBe(1);

    // The accepted record's own file — status AND content — is exactly as
    // she left it.
    const stillAccepted = await cache.get(original.draftId);
    expect(stillAccepted).toEqual(accepted);
  });

  it('a bare drop (no embedding note) is unaffected — version expectation is never computed for it, matching today', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const standalone: ExtractedUnit = {
      text: 'irrelevant',
      provenance: {
        sourcePath: '01 Courses/COGS214/lecture.pdf',
        location: { page: 1, charRange: { start: 0, end: 1 } },
      },
    };

    const first = await runGenerationSweep([standalone], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => groundedResponse('Working memory'),
    });
    expect(first.drafted).toBe(1);

    const second = await runGenerationSweep([standalone], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => groundedResponse('Working memory'),
    });
    expect(second).toMatchObject({ attempted: 0, drafted: 0, skippedDuplicate: 1 });
  });
});
