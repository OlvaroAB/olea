/**
 * `[D-629]`, `[D-633]` (`ol-egov.141.89.6.146`): with no Worker configured the view shows the
 * unavailable wording, never the no-passages line, because the production composition root now gives
 * the view `searchAvailable` (the previous lane left the dep optional and unwired).
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), tagged
 * `plugin/explain-back/practice-search-available.spec`. `main.ts` imports `obsidian`, so the
 * condition is the pure `explainBackSearchConfigured` it calls, and the wiring is pinned in source.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EXPLAIN_BACK_NO_PASSAGES_FOUND } from '../../src/explain-back/copy.js';
import { explainBackSearchConfigured } from '../../src/explain-back/search-available.js';
import { EXPLAIN_WHY_UNAVAILABLE } from '../../src/review/copy.js';
import { answerPassages, openPassages } from './practice-passages-open.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

const code = (path: string): string =>
  readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const CONFIGURED = { embeddingCache: {}, embeddingProvider: {}, keywordIndex: {} };

describe('the search is available only when a Worker and the index are configured', () => {
  it.each([
    [
      'no retrieval wiring at all (no Worker)',
      { ...CONFIGURED, embeddingCache: undefined, embeddingProvider: undefined },
    ],
    ['no embedding provider', { ...CONFIGURED, embeddingProvider: null }],
    ['no embedding cache', { ...CONFIGURED, embeddingCache: null }],
    ['no keyword index yet', { ...CONFIGURED, keywordIndex: null }],
  ])('%s: not available', (_l, parts) => {
    expect(explainBackSearchConfigured(parts)).toBe(false);
  });

  it('all three present: available', () => {
    expect(explainBackSearchConfigured(CONFIGURED)).toBe(true);
  });
});

describe('a no-Worker open shows the unavailable wording ([D-629])', () => {
  it('with the composition root’s condition false, the view says unavailable and not the no-passages line', async () => {
    const searchAvailable = () =>
      explainBackSearchConfigured({
        embeddingCache: undefined,
        embeddingProvider: undefined,
        keywordIndex: {},
      });
    const view = await openPassages({ retrieve: async () => [], extraDeps: { searchAvailable } });
    expect(view.retrieve).not.toHaveBeenCalled();
    await answerPassages(view, 'My explanation.');
    const texts = view.root.texts();
    expect(texts).toContain(EXPLAIN_WHY_UNAVAILABLE);
    expect(texts).not.toContain(EXPLAIN_BACK_NO_PASSAGES_FOUND);
  });

  it('with a Worker configured and a completed search that finds nothing, the no-passages line stays', async () => {
    const searchAvailable = () => explainBackSearchConfigured(CONFIGURED);
    const view = await openPassages({ retrieve: async () => [], extraDeps: { searchAvailable } });
    await answerPassages(view, 'My explanation.');
    expect(view.root.texts()).toContain(EXPLAIN_BACK_NO_PASSAGES_FOUND);
    expect(view.root.texts()).not.toContain(EXPLAIN_WHY_UNAVAILABLE);
  });

  it('the production composition root hands the view that condition', () => {
    const main = code('main.ts');
    expect(main).toMatch(/searchAvailable:\s*\(\)\s*=>\s*this\.explainBackSearchAvailable\(\)/);
    expect(main).toMatch(
      /explainBackSearchConfigured\(\{[\s\S]*?this\.retrieval\?\.embeddingCache/,
    );
    expect(main).toMatch(/sourceOriginHost:\s*this\.sourceOriginFrontmatterHost\(\)/);
  });
});
