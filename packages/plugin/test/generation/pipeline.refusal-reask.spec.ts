/**
 * `runGenerationSweep` — a refused concept is not re-asked on every later sweep
 * (`ol-egov.141.89.2.17`; `[D-289]` refusal kinds, `[D-400]`/`[D-420]`'s bounded-retry
 * shape, decision-sheet row 15's "not assessed, not insufficient" reading of threshold
 * refusals).
 *
 * Before this bead a concept refused for a reason a later sweep cannot change (a judge
 * that already read the material and rejected it; a judge that was unavailable) was
 * re-asked on EVERY later sweep. Each ask re-ran retrieval and, when it reached the
 * judge, spent a model call; and because the per-sweep cap counts every ask, the same
 * first few refused concepts (name order) took the whole cap every time, so the
 * concepts after them were never reached.
 *
 * Every test below drives the SAME cache through several sweeps, because the memory
 * that suppresses a re-ask is scoped to the draft cache the production wiring holds
 * for the whole plugin session (`refusalMemoryFor`).
 *
 * Content-free: concept names here are synthetic placeholders (INV-3).
 */
import type { ConceptRecord, ExtractedUnit, GroundingRefusalReason } from 'olea-core';
import { DEFAULT_COURSES_FOLDER, EmbeddingCacheEngine } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { MAX_CONCEPTS_PER_SWEEP } from '../../src/generation/constants.js';
import type { GenerationSweepReport } from '../../src/generation/pipeline.js';
import {
  GenerationRefusalMemory,
  MAX_JUDGE_UNAVAILABLE_ATTEMPTS,
  refusalMemoryFor,
  runGenerationSweep,
} from '../../src/generation/pipeline.js';
import { buildGenerationWiring } from '../../src/generation/wiring.js';
import { describeRefusal } from '../../src/retrieval/draft-cards-copy.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const COURSE_NOTE = '01 Courses/COGS214/Week 2.md';

function concept(name: string, sourcePaths: readonly string[] = [COURSE_NOTE]): ConceptRecord {
  return { key: `key-${name}`, name, tier: 2, courses: ['COGS214'], sourcePaths };
}

function unit(text = 'lecture text v1'): ExtractedUnit {
  return {
    text,
    provenance: {
      sourcePath: 'some-lecture.pdf',
      location: { page: 1, charRange: { start: 0, end: 1 } },
      embeddedIn: { notePath: COURSE_NOTE, blockStart: 0, blockEnd: 10 },
    },
  };
}

const drafted = (stem: string): DraftQuizCardsResult => ({
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

const refusal = (reason: GroundingRefusalReason): DraftQuizCardsResult => ({
  status: 'refused',
  reason,
});

interface Harness {
  readonly vault: MemoryVaultSource;
  readonly cache: ReturnType<typeof createVaultDraftCacheStore>;
  /** Names asked, in order, across every sweep so far. */
  readonly asked: string[];
  sweep(options?: {
    readonly units?: readonly ExtractedUnit[];
    readonly concepts?: readonly ConceptRecord[];
    readonly answer?: (name: string, ordinal: number) => DraftQuizCardsResult;
    readonly formatMatch?: () => { registerHint?: { terminology: string[] } } | undefined;
  }): Promise<GenerationSweepReport>;
}

function harness(
  defaultConcepts: readonly ConceptRecord[],
  defaultAnswer: (name: string, ordinal: number) => DraftQuizCardsResult,
): Harness {
  const vault = new MemoryVaultSource({ [COURSE_NOTE]: '# Week 2\nnote text v1' });
  const cache = createVaultDraftCacheStore(vault);
  const asked: string[] = [];
  const perName = new Map<string, number>();
  return {
    vault,
    cache,
    asked,
    sweep: async (options = {}) =>
      runGenerationSweep(options.units ?? [unit()], {
        vault,
        cache,
        draftDeps: {} as never,
        listConceptsForCourse: async () => options.concepts ?? defaultConcepts,
        ...(options.formatMatch !== undefined ? { formatMatch: options.formatMatch as never } : {}),
        draftForConcept: async (_deps, request) => {
          asked.push(request.conceptName);
          const ordinal = (perName.get(request.conceptName) ?? 0) + 1;
          perName.set(request.conceptName, ordinal);
          return (options.answer ?? defaultAnswer)(request.conceptName, ordinal);
        },
      }),
  };
}

const countOf = (asked: readonly string[], name: string): number =>
  asked.filter((n) => n === name).length;

describe('a checked refusal on unchanged evidence is not re-asked (judge-rejected)', () => {
  it('asks a judge-rejected concept once across five sweeps, not five times', async () => {
    const h = harness([concept('Alpha')], () => refusal('judge-rejected'));

    for (let i = 0; i < 5; i += 1) await h.sweep();

    expect(countOf(h.asked, 'Alpha')).toBe(1);
  });

  it('still reports the standing refusal to the caller, so what she sees does not change', async () => {
    const h = harness([concept('Alpha')], () => refusal('judge-rejected'));

    const first = await h.sweep();
    const second = await h.sweep();

    const notice = {
      courseCode: 'COGS214',
      conceptName: 'Alpha',
      reason: 'judge-rejected',
      copy: describeRefusal('judge-rejected'),
    };
    expect(first.refusals).toEqual([notice]);
    // Carried from memory, not re-asked: same notice, same copy.
    expect(second.refusals).toEqual([notice]);
    expect(second.attempted).toBe(0);
    expect(second.refused).toBe(0);
  });

  it('one terminal outcome per concept per sweep: attempted + held + duplicate account for every candidate', async () => {
    const h = harness([concept('Alpha'), concept('Bravo')], (name) =>
      name === 'Alpha' ? refusal('judge-rejected') : drafted(name),
    );

    const first = await h.sweep();
    expect(first).toMatchObject({ attempted: 2, drafted: 1, refused: 1 });

    const second = await h.sweep();
    // Alpha held on its standing refusal; Bravo has a cached draft.
    expect(second).toMatchObject({ attempted: 0, drafted: 0, refused: 0, skippedDuplicate: 1 });
    expect(second.refusals.map((r) => r.conceptName)).toEqual(['Alpha']);
  });
});

describe('the standing refusal lifts when something relevant changes', () => {
  it('re-asks after the embedding note is edited', async () => {
    const h = harness([concept('Alpha')], () => refusal('judge-rejected'));
    await h.sweep();
    await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(1);

    await h.vault.write(COURSE_NOTE, '# Week 2\nnote text v2');
    await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(2);

    // ... and the new state is itself remembered.
    await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(2);
  });

  it("re-asks after the concept's own source note is edited", async () => {
    const source = '01 Courses/COGS214/Concepts/Alpha.md';
    const h = harness([concept('Alpha', [source])], () => refusal('judge-rejected'));
    await h.vault.write(source, 'concept text v1');
    await h.sweep();
    await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(1);

    await h.vault.write(source, 'concept text v2');
    await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(2);
  });

  it('re-asks when NEW material lands, but not when the same material lands again', async () => {
    const h = harness([concept('Alpha')], () => refusal('judge-rejected'));
    await h.sweep({ units: [unit('lecture text v1')] });
    await h.sweep({ units: [unit('lecture text v1')] });
    expect(countOf(h.asked, 'Alpha')).toBe(1);

    await h.sweep({ units: [unit('a second lecture')] });
    expect(countOf(h.asked, 'Alpha')).toBe(2);

    // The first lecture arriving again is not new evidence: both have now been seen.
    await h.sweep({ units: [unit('lecture text v1')] });
    await h.sweep({ units: [unit('a second lecture')] });
    expect(countOf(h.asked, 'Alpha')).toBe(2);
  });

  it('re-asks when the demand changes (the course becomes format-matched)', async () => {
    const h = harness([concept('Alpha')], () => refusal('judge-rejected'));
    await h.sweep();
    await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(1);

    await h.sweep({ formatMatch: () => ({}) });
    expect(countOf(h.asked, 'Alpha')).toBe(2);
    await h.sweep({ formatMatch: () => ({}) });
    expect(countOf(h.asked, 'Alpha')).toBe(2);
  });
});

describe('refusals that are not a completed judgment stay retryable, sweep after sweep', () => {
  // No judge was consulted for any of these (nothing was dispatched), so a re-ask costs a
  // local retrieval, and each can be cured without any source edit (index catching up,
  // connection back).
  for (const reason of [
    'no-hits',
    'below-relevance-threshold',
    'below-composite-threshold',
    'below-band',
    'composite-check-unavailable',
  ] as const) {
    it(`${reason} is asked again on every sweep`, async () => {
      const h = harness([concept('Alpha')], () => refusal(reason));

      for (let i = 0; i < 4; i += 1) await h.sweep();

      expect(countOf(h.asked, 'Alpha')).toBe(4);
    });
  }

  it('a thrown drafting call is asked again on the next sweep', async () => {
    const h = harness([concept('Alpha')], () => {
      throw new Error('transport down');
    });
    await h.sweep();
    await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(2);
  });

  it('a retryable refusal followed by a success drafts normally', async () => {
    const h = harness([concept('Alpha')], (_name, ordinal) =>
      ordinal === 1 ? refusal('no-hits') : drafted('Alpha'),
    );
    await h.sweep();
    const second = await h.sweep();
    expect(second.drafted).toBe(1);
    expect(await h.cache.listPending()).toHaveLength(1);
  });
});

describe('a refused concept no longer takes the per-sweep cap from the concepts after it', () => {
  const eight = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'].map(
    (n) => concept(n),
  );

  it('the three first-named concepts refused by the judge are asked once; the rest are all reached', async () => {
    const rejected = new Set(['Alpha', 'Bravo', 'Charlie']);
    const h = harness(eight, (name) =>
      rejected.has(name) ? refusal('judge-rejected') : drafted(name),
    );

    const reports: GenerationSweepReport[] = [];
    for (let i = 0; i < 6; i += 1) reports.push(await h.sweep());

    for (const name of rejected) expect(countOf(h.asked, name)).toBe(1);
    // Every concept the judge did not reject was reached and drafted.
    expect((await h.cache.listPending()).length).toBe(5);
    // 3 refused asks + 5 drafted asks in total, not 6 sweeps x 3 asks.
    expect(h.asked.length).toBe(8);
    expect(reports.reduce((n, r) => n + r.attempted, 0)).toBe(8);
    expect(reports.reduce((n, r) => n + r.refused, 0)).toBe(3);
    expect(reports.every((r) => r.attempted <= MAX_CONCEPTS_PER_SWEEP)).toBe(true);
  });

  it('retryable refusals rotate: concepts after them are reached instead of starved', async () => {
    const stuck = new Set(['Alpha', 'Bravo', 'Charlie']);
    const h = harness(eight, (name) => (stuck.has(name) ? refusal('no-hits') : drafted(name)));

    for (let i = 0; i < 4; i += 1) await h.sweep();

    // The five that can be drafted all were, within four sweeps.
    expect((await h.cache.listPending()).length).toBe(5);
  });
});

describe('judge-unavailable follows a bounded retry, not every sweep', () => {
  it('is asked twice on unchanged evidence (the original and one retry), then held', async () => {
    const h = harness([concept('Alpha')], () => refusal('judge-unavailable'));

    const reports: GenerationSweepReport[] = [];
    for (let i = 0; i < 6; i += 1) reports.push(await h.sweep());

    expect(countOf(h.asked, 'Alpha')).toBe(MAX_JUDGE_UNAVAILABLE_ATTEMPTS);
    expect(MAX_JUDGE_UNAVAILABLE_ATTEMPTS).toBe(2);
    // Held sweeps still report it, with the transient ("could not check") copy, never the
    // "not enough in your notes" copy (`[D-089]`).
    const last = reports[5];
    expect(last?.skippedRefused).toBe(1);
    expect(last?.refusals[0]?.reason).toBe('judge-unavailable');
    expect(last?.refusals[0]?.copy).toEqual(describeRefusal('judge-unavailable'));
    expect(last?.refusals[0]?.copy.transient).toBe(true);
  });

  it('lifts on changed evidence, with a fresh bounded allowance', async () => {
    const h = harness([concept('Alpha')], () => refusal('judge-unavailable'));
    for (let i = 0; i < 4; i += 1) await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(2);

    await h.vault.write(COURSE_NOTE, '# Week 2\nnote text v2');
    for (let i = 0; i < 4; i += 1) await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(4);
  });

  it('gets one more retry when the judge is seen answering for another concept', async () => {
    // Alpha's judge call keeps failing; Bravo's is answered (a verdict) on its first ask.
    const answer = (name: string): DraftQuizCardsResult =>
      name === 'Alpha' ? refusal('judge-unavailable') : refusal('judge-rejected');
    const h = harness([concept('Alpha')], answer);
    for (let i = 0; i < 4; i += 1) await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(2);

    // A new concept appears and the judge answers it: the judge is evidently back.
    await h.sweep({ concepts: [concept('Alpha'), concept('Bravo')] });
    expect(countOf(h.asked, 'Bravo')).toBe(1);
    // Alpha was held this sweep (the answer came after its check); the next sweep retries it once.
    await h.sweep({ concepts: [concept('Alpha'), concept('Bravo')] });
    expect(countOf(h.asked, 'Alpha')).toBe(3);
    // ... and, still failing, it is held again.
    await h.sweep({ concepts: [concept('Alpha'), concept('Bravo')] });
    await h.sweep({ concepts: [concept('Alpha'), concept('Bravo')] });
    expect(countOf(h.asked, 'Alpha')).toBe(3);
  });

  it('a judge that comes back clears the hold: the next ask drafts and nothing stays held', async () => {
    const h = harness([concept('Alpha')], (_name, ordinal) =>
      ordinal <= 2 ? refusal('judge-unavailable') : drafted('Alpha'),
    );
    for (let i = 0; i < 3; i += 1) await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(2);
    expect((await h.cache.listPending()).length).toBe(0);

    await h.vault.write(COURSE_NOTE, '# Week 2\nnote text v2');
    const report = await h.sweep();
    expect(report.drafted).toBe(1);
    expect(report.skippedRefused).toBe(0);
  });
});

describe('the held refusals stay visible whichever concepts the cap reaches', () => {
  it('reports every held concept even when other concepts use the whole cap', async () => {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
    const rejected = new Set(['Alpha', 'Bravo', 'Charlie']);
    const h = harness(
      names.map((n) => concept(n)),
      (name) => (rejected.has(name) ? refusal('judge-rejected') : refusal('no-hits')),
    );
    await h.sweep(); // asks Alpha, Bravo, Charlie: all judge-rejected

    // Later sweeps: Delta..Hotel are retryable (no-hits) and use the whole cap every time.
    const second = await h.sweep();
    expect(second.attempted).toBe(MAX_CONCEPTS_PER_SWEEP);
    expect(second.skippedRefused).toBe(3);
    // 3 carried notices + 3 new ones.
    expect(second.refusals.map((r) => r.conceptName).sort()).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
      'Foxtrot',
    ]);
  });

  it('a held concept that gained a cached draft by another route is a duplicate, not a held refusal', async () => {
    const h = harness([concept('Alpha')], () => refusal('judge-rejected'));
    await h.sweep();

    // Drafted by some other route since (e.g. the heading offer): the cache now has a record.
    await h.sweep({ answer: () => drafted('Alpha'), units: [unit('new lecture')] });
    expect((await h.cache.listPending()).length).toBe(1);

    const later = await h.sweep();
    expect(later).toMatchObject({ attempted: 0, skippedDuplicate: 1, skippedRefused: 0 });
    expect(later.refusals).toEqual([]);
  });
});

describe('explicit retry and the scope of the memory', () => {
  it('release() lifts a standing refusal so the next sweep asks again, once', async () => {
    const h = harness([concept('Alpha'), concept('Bravo')], () => refusal('judge-rejected'));
    await h.sweep();
    await h.sweep();
    expect(h.asked).toEqual(['Alpha', 'Bravo']);

    const memory = refusalMemoryFor(h.cache);
    expect(memory.release({ courseCode: 'COGS214', conceptKey: 'key-Alpha' })).toBe(1);
    await h.sweep();
    await h.sweep();
    expect(h.asked).toEqual(['Alpha', 'Bravo', 'Alpha']);

    expect(memory.release()).toBe(2);
    expect(memory.release()).toBe(0);
    await h.sweep();
    expect(h.asked.slice(3).sort()).toEqual(['Alpha', 'Bravo']);
  });

  it('is scoped to the draft cache: a different cache (a different session) starts fresh', async () => {
    const a = harness([concept('Alpha')], () => refusal('judge-rejected'));
    const b = harness([concept('Alpha')], () => refusal('judge-rejected'));
    await a.sweep();
    await a.sweep();
    await b.sweep();
    expect(countOf(a.asked, 'Alpha')).toBe(1);
    expect(countOf(b.asked, 'Alpha')).toBe(1);
    expect(refusalMemoryFor(a.cache)).not.toBe(refusalMemoryFor(b.cache));
    expect(refusalMemoryFor(a.cache)).toBe(refusalMemoryFor(a.cache));
  });

  it('an injected memory is used instead of the per-cache default (a restart is a new memory)', async () => {
    const h = harness([concept('Alpha')], () => refusal('judge-rejected'));
    await h.sweep();
    await h.sweep();
    expect(countOf(h.asked, 'Alpha')).toBe(1);

    const restarted = new GenerationRefusalMemory();
    let calls = 0;
    await runGenerationSweep([unit()], {
      vault: h.vault,
      cache: h.cache,
      draftDeps: {} as never,
      listConceptsForCourse: async () => [concept('Alpha')],
      refusalMemory: restarted,
      draftForConcept: async () => {
        calls += 1;
        return refusal('judge-rejected');
      },
    });
    // One re-ask after a restart, then held again: bounded, not every sweep.
    expect(calls).toBe(1);
  });

  it('holds only opaque digests, never a concept name or note text (INV-3)', async () => {
    // The permanent concept key is opaque in production (`[D-357]`); the synthetic
    // `key-<name>` used elsewhere in this suite would put the name in the memory's key.
    const opaque: ConceptRecord = { ...concept('Alpha'), key: 'k-0001' };
    const h = harness([opaque], () => refusal('judge-rejected'));
    await h.sweep({ units: [unit('distinctive lecture sentence')] });
    const serialised = JSON.stringify(
      [...(refusalMemoryFor(h.cache) as unknown as { standing: Map<string, unknown> }).standing],
      (_key, value) => (value instanceof Set ? [...value] : value),
    );
    expect(serialised).not.toContain('distinctive lecture sentence');
    expect(serialised).not.toContain('note text v1');
    expect(serialised).not.toContain('Alpha');
    expect(serialised).not.toContain('Week 2');
  });
});

/**
 * The production path, not the pipeline function alone: `main.ts`'s `onUnitsLanded`
 * calls `GenerationWiring.sweep` (`wiring.ts`), which builds ONE draft cache per plugin
 * session and passes it to every `runGenerationSweep`. These tests drive that real
 * wiring and the real `draftQuizCardsForConcept` over an in-band retrieval fixture, and
 * count the `grounding.judge.v1` calls that reach a fake transport — the spend the bead
 * is about.
 */
describe('through buildGenerationWiring and the real drafting path (the production composition)', () => {
  const FILLER = 100;
  const DIM = 2 + FILLER;
  const QUERY = 'mitochondria';
  const TARGET = 'Mitochondria is the powerhouse of the cell and drives cellular respiration.';
  const IN_BAND_COSINE = 0.65; // clears the composite veto and the band's lower bar, below its upper bar
  const NOTE = `${DEFAULT_COURSES_FOLDER}/COGS214/Week 2.md`;
  const NOTE_TEXT = `---\ntopic: [${QUERY}]\ncourse: COGS214\n---\n\n# Week 2\n\nSynthetic fixture text.\n`;

  const axis = (i: number): number[] => {
    const v = new Array(DIM).fill(0);
    v[i] = 1;
    return v;
  };

  async function draftDepsWith(judge: () => unknown): Promise<{
    readonly deps: DraftQuizCardsDeps;
    readonly judgeCalls: () => number;
  }> {
    const vectors = new Map<string, readonly number[]>();
    const residual = Math.sqrt(1 - IN_BAND_COSINE * IN_BAND_COSINE);
    vectors.set(TARGET, axis(0));
    vectors.set(
      QUERY,
      axis(0).map((c, i) => c * IN_BAND_COSINE + (i === 1 ? residual : 0)),
    );
    const docs: { path: string; courses: string[]; contentHash: string; blocks: unknown[] }[] = [
      {
        path: 'course/lecture.md',
        courses: [],
        contentHash: 'unused',
        blocks: [{ blockIndex: 0, kind: 'paragraph', text: TARGET }],
      },
    ];
    for (let i = 0; i < FILLER; i += 1) {
      const text = `unrelated filler passage number ${i} about an unrelated topic`;
      vectors.set(text, axis(2 + i));
      docs.push({
        path: `filler/${i}.md`,
        courses: [],
        contentHash: 'unused',
        blocks: [{ blockIndex: 0, kind: 'paragraph', text }],
      });
    }
    const provider = {
      embed: async (request: { texts: readonly string[] }) => ({
        vectors: request.texts.map((text) => {
          const vector = vectors.get(text);
          if (vector === undefined) throw new Error('fixture gap');
          return vector;
        }),
      }),
    };
    const embeddingCache = await EmbeddingCacheEngine.create({
      store: {
        load: async () => null,
        save: async () => {},
      },
      provider: provider as never,
      model: 'fake-model-v1',
    });
    let judgeCalls = 0;
    const transport = {
      send: async (request: { taskId: string }): Promise<unknown> => {
        if (request.taskId === 'grounding.judge.v1') {
          judgeCalls += 1;
          return judge();
        }
        return {
          ok: true,
          stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
          result: {
            questions: [
              { stem: 's', correctAnswer: 'a', distractors: ['b', 'c', 'd'], feedback: 'f' },
            ],
          },
        };
      },
    };
    return {
      deps: {
        retrieve: {
          keywordIndex: { version: 1, documents: docs } as never,
          embeddingCache,
          embeddingProvider: provider as never,
        },
        transport: transport as never,
      },
      judgeCalls: () => judgeCalls,
    };
  }

  const verdict = (supported: boolean) => () => ({
    ok: true,
    stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
    result: { supported, reason: 'stated verdict' },
  });

  it('a judge-rejected concept costs one judge call across four landings of the same material, not four', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: NOTE_TEXT });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });
    const { deps, judgeCalls } = await draftDepsWith(verdict(false));

    const reports = [];
    for (let i = 0; i < 4; i += 1) reports.push(await wiring.sweep([unit()], deps));

    expect(reports.map((r) => r?.refused)).toEqual([1, 0, 0, 0]);
    expect(reports.map((r) => r?.skippedRefused)).toEqual([0, 1, 1, 1]);
    expect(reports.every((r) => r?.refusals[0]?.reason === 'judge-rejected')).toBe(true);
    expect(judgeCalls()).toBe(1);
  });

  it('an unavailable judge is retried once, then held: two judge calls across six landings', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: NOTE_TEXT });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });
    const { deps, judgeCalls } = await draftDepsWith(() => {
      throw new Error('judge unreachable');
    });

    for (let i = 0; i < 6; i += 1) await wiring.sweep([unit()], deps);

    expect(judgeCalls()).toBe(2);
  });

  it('a supported verdict drafts, and a later landing does not ask again (the cache dedupes)', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: NOTE_TEXT });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });
    const { deps, judgeCalls } = await draftDepsWith(verdict(true));

    const first = await wiring.sweep([unit()], deps);
    const second = await wiring.sweep([unit()], deps);

    expect(first).toMatchObject({ attempted: 1, drafted: 1 });
    expect(second).toMatchObject({ attempted: 0, skippedDuplicate: 1, skippedRefused: 0 });
    expect(judgeCalls()).toBe(1);
  });
});
