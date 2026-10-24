/**
 * `[D-633]` (`ol-egov.141.89.6.146`): the practice view's passages come from the instrument's course
 * reading set, as drafting's do (`[D-544]`), explicitly shared sources included; a relation's
 * neighbour search is scoped the same way; a free-form topic has no instrument and is unscoped.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), tagged
 * `plugin/explain-back/practice-passages-scope.spec`. Synthetic data only.
 */

import {
  EmbeddingCacheEngine,
  type EmbeddingProvider,
  type IndexedDocument,
  type PersistedKeywordIndex,
} from 'olea-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type ExplainBackRetrievalDeps,
  retrieveExplainBackSourceBlocks,
} from '../../src/explain-back/request.js';
import { answerPassages, openPassages } from './practice-passages-open.js';
import { INSTRUMENT, NEIGHBOUR_NAME, retrieveFor } from './practice-view-harness.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

const COURSE_A = 'syn:course:a';

function doc(path: string, text: string, courses: readonly string[] = []): IndexedDocument {
  return {
    path,
    courses,
    contentHash: `hash-${path}`,
    blocks: [{ blockIndex: 0, kind: 'paragraph' as const, text }],
  } as IndexedDocument;
}

/** Course A and B each hold a note on the coined wording; one source declares both courses. */
const INDEX: PersistedKeywordIndex = {
  version: 1,
  documents: [
    doc('01 Courses/syn:course:a/Week 1.md', 'Tessellite grows in interlocking habits (course A).'),
    doc('01 Courses/syn:course:b/Week 1.md', 'Tessellite is explained at length (course B).'),
    doc('Shared/Reader.md', 'Tessellite appears in the shared reader.', [COURSE_A, 'syn:course:b']),
    doc('Loose/Elsewhere.md', 'Tessellite in an unlinked note outside every course.'),
  ].sort((a, b) => (a.path < b.path ? -1 : 1)),
} as PersistedKeywordIndex;

/** Offline: retrieval degrades to the keyword leg, which is all the scope is about. */
const OFFLINE: EmbeddingProvider = {
  async embed() {
    throw new Error('offline');
  },
} as EmbeddingProvider;

async function deps(): Promise<ExplainBackRetrievalDeps> {
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: { load: async () => null, save: async () => {} },
    provider: OFFLINE,
    model: 'fake-model-v1',
  });
  return { retrieve: { keywordIndex: INDEX, embeddingCache, embeddingProvider: OFFLINE } };
}

describe('the lookup is scoped to the instrument’s course reading set ([D-633], [D-544])', () => {
  it('with a course, finds that course’s notes and the source that declares the course, never another course’s', async () => {
    const found = await retrieveExplainBackSourceBlocks(await deps(), 'tessellite', COURSE_A);
    const paths = found.map((entry) => entry.path).sort();
    expect(paths).toEqual(['01 Courses/syn:course:a/Week 1.md', 'Shared/Reader.md']);
  });

  it('with no course (a free-form topic), reads the whole index as before', async () => {
    const found = await retrieveExplainBackSourceBlocks(await deps(), 'tessellite');
    expect(found.map((entry) => entry.path).sort()).toEqual([
      '01 Courses/syn:course:a/Week 1.md',
      '01 Courses/syn:course:b/Week 1.md',
      'Loose/Elsewhere.md',
      'Shared/Reader.md',
    ]);
    const nullCourse = await retrieveExplainBackSourceBlocks(await deps(), 'tessellite', null);
    expect(nullCourse).toHaveLength(4);
  });
});

describe('the view passes the instrument’s course to every lookup it makes', () => {
  it('a concept prompt: the question’s lookup carries the instrument’s course', async () => {
    const view = await openPassages({ retrieve: retrieveFor });
    expect(view.retrieve).toHaveBeenCalledTimes(1);
    expect(view.retrieve).toHaveBeenCalledWith('What does Alpha drive?', INSTRUMENT.courseCode);
  });

  it('a relation prompt: the subject search and the neighbour search carry the same course', async () => {
    const view = await openPassages({ retrieve: retrieveFor, seed: 'relation' });
    expect(view.retrieve.mock.calls).toEqual([
      ['What does Alpha drive?', INSTRUMENT.courseCode],
      [NEIGHBOUR_NAME, INSTRUMENT.courseCode],
    ]);
    await answerPassages(view, 'My explanation.');
  });

  it('a free-form topic has no instrument: its lookup is given the topic alone', async () => {
    const view = await openPassages({ retrieve: retrieveFor, seed: 'freeform' });
    expect(view.retrieve.mock.calls).toEqual([['the coined process']]);
  });
});

describe('the production composition scopes by the instrument’s course ([D-633])', () => {
  it('main.ts hands the view’s course to the lookup and the lookup to the drafting scope', async () => {
    const { readFileSync } = await import('node:fs');
    const strip = (path: string): string =>
      readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
    const main = strip('main.ts');
    const request = strip('explain-back/request.ts');
    expect(main).toMatch(/retrieveSourceBlocks:\s*\(query,\s*courseCode\)\s*=>/);
    expect(main).toMatch(/composeExplainBackSourceBlocks\(query,\s*courseCode\)/);
    expect(main).toMatch(/frontmatterHost:\s*this\.sourceOriginFrontmatterHost\(\)/);
    expect(request).toMatch(/draftingScope\(deps\.retrieve\.keywordIndex,\s*course,/);
  });
});
