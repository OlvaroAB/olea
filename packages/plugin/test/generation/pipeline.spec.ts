/**
 * `runGenerationSweep` tests (F3.3, `ol-p3t07a`; bare-drop home note
 * `[D-179]` / `[SRC-2]`, `ol-ho93`).
 *
 * Proves: dedupe against an existing cache record of any status; the
 * per-sweep cap bounds a burst; a refusal caches nothing (retry-eligible
 * next sweep); a drafted response becomes a pending cache record keyed on
 * (course, concept), with `conceptIds` carrying the opaque
 * `ConceptRecord.key` (`ol-63e1`'s coordinated flip — `session/enumerate.ts`
 * keys the same field the same way), never the display name.
 *
 * The `describe('a bare drop with no embedding note …')` block covers
 * `[D-179]`: course derivation from the source's own folder, home-note
 * creation and reuse across sweeps (idempotency), and the INV-6 naming-
 * collision guard.
 *
 * The `describe('routing consultation …')` block at the bottom is `ol-tz7v`
 * / `[WIRE-7]`'s own suite: component 2.2's routing, opted into via
 * `deps.routing`, gating this sweep's one generation capability (quiz
 * drafting) against a real classification and a real per-concept instrument
 * inventory. Every test above this block never supplies `routing`, and every
 * `toEqual` above carries `skippedRouting: 0` for exactly that reason —
 * proving the new field is inert, not just present, when routing is not
 * asked for.
 */
import type { ConceptRecord, ExtractedUnit, KnowledgeKindClassifierPort } from 'olea-core';
import { provisionalConceptKey } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { MAX_CONCEPTS_PER_SWEEP } from '../../src/generation/constants.js';
import { HOME_NOTE_MARKER_KEY, homeNotePathForSource } from '../../src/generation/home-note.js';
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

/** A bare drop (F3.1's other case): no `embeddedIn` at all. */
function standaloneUnit(sourcePath: string): ExtractedUnit {
  return {
    text: 'irrelevant to this suite — the pipeline never reads unit text directly',
    provenance: {
      sourcePath,
      location: { page: 1, charRange: { start: 0, end: 1 } },
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
  it('does nothing for a bare drop outside every course folder — no course is derivable from the source path either', async () => {
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

    expect(report).toEqual({
      attempted: 0,
      drafted: 0,
      refused: 0,
      skippedDuplicate: 0,
      skippedRouting: 0,
    });
    // Nothing was created — the folder-less path never reaches the home-note step.
    expect(await vault.list()).toEqual([]);
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

    expect(report).toEqual({
      attempted: 1,
      drafted: 1,
      refused: 0,
      skippedDuplicate: 0,
      skippedRouting: 0,
    });

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
    expect(report).toEqual({
      attempted: 0,
      drafted: 0,
      refused: 0,
      skippedDuplicate: 1,
      skippedRouting: 0,
    });
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

    expect(report).toEqual({
      attempted: 1,
      drafted: 0,
      refused: 1,
      skippedDuplicate: 0,
      skippedRouting: 0,
    });
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
    expect(report).toEqual({
      attempted: 0,
      drafted: 0,
      refused: 0,
      skippedDuplicate: 0,
      skippedRouting: 0,
    });
  });
});

describe("a bare drop with no embedding note — Olea's own home note (`[D-179]` / `[SRC-2]`)", () => {
  const SOURCE_PATH = '01 Courses/COGS214/Lecture 4.pdf';
  const HOME_NOTE_PATH = homeNotePathForSource(SOURCE_PATH);

  it('derives the course from the source path itself and materializes into a created home note beside it', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);

    const report = await runGenerationSweep([standaloneUnit(SOURCE_PATH)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async (courseCode) => {
        // F3.1/F3.3 as amended by `[D-179]`: course from the file's folder,
        // never from the (not-yet-existing) home note's content.
        expect(courseCode).toBe('COGS214');
        return [concept('Working memory', 'concept-key-1')];
      },
      draftForConcept: async () => groundedResponse('Working memory'),
    });

    expect(report).toEqual({
      attempted: 1,
      drafted: 1,
      refused: 0,
      skippedDuplicate: 0,
      skippedRouting: 0,
    });

    const pending = await cache.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sourcePath).toBe(HOME_NOTE_PATH);

    const noteContent = vault.raw(HOME_NOTE_PATH);
    expect(noteContent).toBeDefined();
    expect(noteContent).toContain(`${HOME_NOTE_MARKER_KEY}: true`);
    expect(noteContent).toContain('- Working memory');
  });

  it('is idempotent: a later sweep drafting a second concept reuses the same note and grows its topic list', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);

    await runGenerationSweep([standaloneUnit(SOURCE_PATH)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => groundedResponse('Working memory'),
    });
    const firstWrite = vault.raw(HOME_NOTE_PATH);

    await runGenerationSweep([standaloneUnit(SOURCE_PATH)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [
        concept('Working memory', 'concept-key-1'),
        concept('Long-term potentiation', 'concept-key-2'),
      ],
      draftForConcept: async (_deps, request) => groundedResponse(request.conceptName),
    });

    // Still exactly one file at that path — the second sweep reused it.
    const allPaths = await vault.list();
    expect(allPaths.filter((p) => p === HOME_NOTE_PATH)).toHaveLength(1);

    const secondWrite = vault.raw(HOME_NOTE_PATH);
    expect(secondWrite).toContain('- Working memory');
    expect(secondWrite).toContain('- Long-term potentiation');
    expect(secondWrite).not.toBe(firstWrite); // grown, but the same note

    const pending = await cache.listPending();
    expect(pending.map((p) => p.sourcePath)).toEqual([HOME_NOTE_PATH, HOME_NOTE_PATH]);
  });

  it('INV-6: a file already at the derived path with no Olea marker is never written into (naming collision, not a guess)', async () => {
    const herNote = '# Lecture 4\n\nHer own typed-up notes, unrelated to anything Olea does.\n';
    const vault = new MemoryVaultSource({ [HOME_NOTE_PATH]: herNote });
    const cache = createVaultDraftCacheStore(vault);

    const report = await runGenerationSweep([standaloneUnit(SOURCE_PATH)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
      draftForConcept: async () => groundedResponse('Working memory'),
    });

    // The drafting call still happened (attempted), but there was nowhere
    // safe to land it, so nothing was cached and her note is untouched.
    expect(report.attempted).toBe(1);
    expect(report.drafted).toBe(0);
    expect(await cache.list()).toEqual([]);
    expect(vault.raw(HOME_NOTE_PATH)).toBe(herNote);
  });

  it('an existing embedding note for the course wins — no home note is created alongside it', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    const extraSourcePath = '01 Courses/COGS214/Extra reading.pdf';

    const report = await runGenerationSweep(
      [embeddedUnit(COURSE_FOLDER_NOTE), standaloneUnit(extraSourcePath)],
      {
        vault,
        cache,
        draftDeps: {} as never,
        listConceptsForCourse: async () => [concept('Working memory', 'concept-key-1')],
        draftForConcept: async () => groundedResponse('Working memory'),
      },
    );

    expect(report.drafted).toBe(1);
    const pending = await cache.listPending();
    expect(pending[0]?.sourcePath).toBe(COURSE_FOLDER_NOTE);
    expect(await vault.exists(homeNotePathForSource(extraSourcePath))).toBe(false);
  });
});

describe('routing consultation (`ol-tz7v` / `[WIRE-7]`, opt-in via `deps.routing`)', () => {
  const CONCEPT_NOTE = '01 Courses/COGS214/Working memory.md';

  function frontmatter(topic: string, course = 'COGS214'): string {
    return ['---', `topic: [${topic}]`, `course: ${course}`, '---', ''].join('\n');
  }

  const MCQ_BLOCK = [
    '```olea-mcq',
    'stem: Which structure is it?',
    'answer: The right one',
    'distractor: d1',
    'distractor: d2',
    'distractor: d3',
    'distractor: d4',
    'feedback: Because of the thing.',
    '```',
  ].join('\n');

  // The real derivation `extractConcepts`/`enumerateVaultInstruments` use
  // internally (`ol-63e1`) for an unbound (tier-2) concept — matching it here
  // is what lets `buildConceptInstrumentInventory`'s real vault walk find the
  // same key the fake `listConceptsForCourse` candidate carries, the same way
  // production's `listConceptsForCourseFactory` (`wiring.ts`) does by calling
  // the real `extractConcepts` itself.
  const conceptKey = provisionalConceptKey({ name: 'Working memory', boundNotePath: null });

  it('classifier unavailable (`classifier: null`) routes to the retrieval baseline and skips quiz drafting', async () => {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);

    let calls = 0;
    const report = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Working memory', conceptKey)],
      draftForConcept: async () => {
        calls += 1;
        return groundedResponse('Working memory');
      },
      routing: { classifier: null },
    });

    expect(calls).toBe(0);
    expect(report).toEqual({
      attempted: 0,
      drafted: 0,
      refused: 0,
      skippedDuplicate: 0,
      skippedRouting: 1,
    });
    expect(await cache.list()).toEqual([]);
  });

  it('a classified concept whose mix warrants quiz drafts normally, against a real (empty) inventory', async () => {
    const vault = new MemoryVaultSource({
      [CONCEPT_NOTE]: `${frontmatter('Working memory')}## What is it?\n\nA short-term store.\n`,
    });
    const cache = createVaultDraftCacheStore(vault);

    let classifyCalls = 0;
    const classifier: KnowledgeKindClassifierPort = {
      async classify(request) {
        classifyCalls += 1;
        expect(request.sourceMaterial.length).toBeGreaterThan(0); // real note text was actually read and sent
        return { kind: 'category', confidence: 0.9 }; // quiz-weighted (target 2) vs an empty real inventory
      },
    };

    const report = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [
        {
          key: conceptKey,
          name: 'Working memory',
          tier: 2,
          courses: ['COGS214'],
          sourcePaths: [CONCEPT_NOTE],
        },
      ],
      draftForConcept: async () => groundedResponse('Working memory'),
      routing: { classifier },
    });

    expect(classifyCalls).toBe(1);
    expect(report).toEqual({
      attempted: 1,
      drafted: 1,
      refused: 0,
      skippedDuplicate: 0,
      skippedRouting: 0,
    });
  });

  it('a concept whose real inventory already meets the routed quiz target is skipped without a drafting call', async () => {
    const vault = new MemoryVaultSource({
      [CONCEPT_NOTE]: [
        frontmatter('Working memory'),
        '## What is it?',
        '',
        'A short-term store.',
        '',
        MCQ_BLOCK,
        '',
      ].join('\n'),
    });
    const cache = createVaultDraftCacheStore(vault);

    const classifier: KnowledgeKindClassifierPort = {
      // `fact` -> retrieval-dominant, quiz **floor** (target 1) — the
      // existing MCQ block above already meets it (existing = 1).
      async classify() {
        return { kind: 'fact', confidence: 0.9 };
      },
    };

    let draftCalls = 0;
    const report = await runGenerationSweep([embeddedUnit(COURSE_FOLDER_NOTE)], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [
        {
          key: conceptKey,
          name: 'Working memory',
          tier: 2,
          courses: ['COGS214'],
          sourcePaths: [CONCEPT_NOTE],
        },
      ],
      draftForConcept: async () => {
        draftCalls += 1;
        return groundedResponse('Working memory');
      },
      routing: { classifier },
    });

    expect(draftCalls).toBe(0);
    expect(report).toEqual({
      attempted: 0,
      drafted: 0,
      refused: 0,
      skippedDuplicate: 0,
      skippedRouting: 1,
    });
  });
});
