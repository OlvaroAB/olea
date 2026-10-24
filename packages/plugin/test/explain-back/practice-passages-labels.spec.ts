/**
 * `[D-633]` (`ol-egov.141.89.6.146`): each passage's label carries the page, slide, part or time its
 * source has, through core's one citation formatter (`formatSourceCitation`), and a transcript is
 * never given a page. Also the carry-through in retrieval: `retrieveExplainBackSourceBlocks` keeps
 * the chunk's `part` and `location`.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), tagged
 * `plugin/explain-back/practice-passages-labels.spec`. Synthetic data only.
 */

import {
  EmbeddingCacheEngine,
  type EmbeddingProvider,
  type PersistedKeywordIndex,
} from 'olea-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExplainBackSourceBlock } from '../../src/explain-back/request.js';
import { retrieveExplainBackSourceBlocks } from '../../src/explain-back/request.js';
import { answerPassages, openPassages, shownPassages } from './practice-passages-open.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

function block(path: string, text: string, grain: Partial<ExplainBackSourceBlock> = {}) {
  return { block: { blockId: `${path}#0#0`, text }, path, blockIndex: 0, ...grain };
}

const PASSAGES: readonly ExplainBackSourceBlock[] = [
  block('Course/Plain note.md', 'A plain statement about the coined process.'),
  block('Course/Deck.pptx', 'A slide statement about the coined process.', {
    location: { page: 5 },
  }),
  block('Course/Paper.pdf', 'A page statement about the coined process.', {
    location: { page: 3 },
  }),
  block('Course/Lecture 2.txt', 'An untimed part about the coined process.', { part: 2 }),
  block('Course/Lecture 3.txt', 'A timed part about the coined process.', {
    part: 4,
    location: { page: 4, transcriptPart: { startSeconds: 724 } },
  }),
];

describe('a passage’s label carries page, part or time where its source has one ([D-633])', () => {
  it('shows each label as the existing formatter gives it, and a transcript never gets a page', async () => {
    const view = await openPassages({ retrieve: async () => PASSAGES });
    await answerPassages(view, 'My explanation.');
    const labels = shownPassages(view.root).map((p) => p.label);
    expect(labels).toEqual([
      'Plain note',
      'Deck (slide 5)',
      'Paper (p. 3)',
      'Lecture 2 (part 2)',
      'Lecture 3 (at 12:04)',
    ]);
    expect(labels.filter((l) => l?.startsWith('Lecture')).join(' ')).not.toMatch(/p\. /);
  });
});

describe('retrieval carries the chunk’s part and location to the passage ([D-633])', () => {
  it('keeps a transcript part and a deck page, and nothing on a plain note', async () => {
    const index = {
      version: 1,
      documents: [
        {
          path: 'Course/Lecture 2.txt',
          courses: [],
          contentHash: 'a',
          blocks: [{ blockIndex: 0, kind: 'paragraph', text: 'Tessellite in a part.', part: 2 }],
        },
        {
          path: 'Course/Deck.pptx',
          courses: [],
          contentHash: 'b',
          blocks: [
            {
              blockIndex: 0,
              kind: 'paragraph',
              text: 'Tessellite on a slide.',
              location: { page: 5, section: 'Habits' },
            },
          ],
        },
        {
          path: 'Course/Plain note.md',
          courses: [],
          contentHash: 'c',
          blocks: [{ blockIndex: 0, kind: 'paragraph', text: 'A plain tessellite note.' }],
        },
      ],
    } as unknown as PersistedKeywordIndex;
    const offline = {
      async embed() {
        throw new Error('offline');
      },
    } as EmbeddingProvider;
    const embeddingCache = await EmbeddingCacheEngine.create({
      store: { load: async () => null, save: async () => {} },
      provider: offline,
      model: 'fake-model-v1',
    });
    const found = await retrieveExplainBackSourceBlocks(
      { retrieve: { keywordIndex: index, embeddingCache, embeddingProvider: offline } },
      'tessellite',
    );
    const by = new Map(found.map((entry) => [entry.path, entry]));
    expect(by.get('Course/Lecture 2.txt')?.part).toBe(2);
    expect(by.get('Course/Deck.pptx')?.location).toEqual({ page: 5, section: 'Habits' });
    const plain = by.get('Course/Plain note.md');
    expect(plain).toBeDefined();
    expect(plain !== undefined && ('part' in plain || 'location' in plain)).toBe(false);
  });
});
