/**
 * `[D-633]` (`ol-egov.141.89.6.146`): a passage found more than once is shown once, keeping its
 * source and position and the ways it was found (that it is also one of the link's own passages
 * is context that matters to her reading of it); the material F5.2a names is unchanged.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), tagged
 * `plugin/explain-back/practice-passages-dedupe.spec`. Synthetic data only.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExplainBackSourceBlock } from '../../src/explain-back/request.js';
import { answerPassages, openPassages, shownPassages } from './practice-passages-open.js';
import { NEIGHBOUR_NAME, passage } from './practice-view-harness.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

/** The same block (notes/alpha.md, position 0) as a retrieval ranks it in two different searches. */
const ALPHA_0_AS_SUBJECT = passage('notes/alpha.md', 0, 'Alpha drives the first coined process.');
const ALPHA_0_AS_NEIGHBOUR: ExplainBackSourceBlock = {
  ...ALPHA_0_AS_SUBJECT,
  block: { ...ALPHA_0_AS_SUBJECT.block, blockId: 'notes/alpha.md#0#1' },
};
const ALPHA_1 = passage('notes/alpha.md', 1, 'Alpha is measured by the coined rate.');
const BETA_0 = passage('notes/beta.md', 0, 'Beta follows from a raised coined rate.');

async function retrieve(query: string): Promise<readonly ExplainBackSourceBlock[]> {
  return query === NEIGHBOUR_NAME ? [ALPHA_0_AS_NEIGHBOUR, BETA_0] : [ALPHA_0_AS_SUBJECT, ALPHA_1];
}

/** The link's own passages: the first is also the block both searches found; the second is only the link's. */
async function introducing(provenance: { readonly location: unknown }) {
  const index = (provenance.location as { index: number }).index;
  return index === 0
    ? { ...ALPHA_0_AS_SUBJECT }
    : passage('notes/link.md', 1, 'Beta is the outcome the coined rate leads to.');
}

describe('a passage found more than once is shown once ([D-633])', () => {
  it('shows the doubly found block once, with its place and every way it was found', async () => {
    const view = await openPassages({
      retrieve,
      seed: 'relation',
      extraDeps: { resolveIntroducingPassage: introducing },
    });
    await answerPassages(view, 'My explanation.');
    const texts = shownPassages(view.root).map((p) => p.text);
    expect(texts.filter((t) => t === ALPHA_0_AS_SUBJECT.block.text)).toHaveLength(1);
    expect(texts).toEqual([
      'Alpha drives the first coined process.',
      'Alpha is measured by the coined rate.',
      'Beta is the outcome the coined rate leads to.',
      'Beta follows from a raised coined rate.',
    ]);
    const { state } = view.modal as unknown as {
      state: { prompt: { passages: readonly ExplainBackSourceBlock[] } };
    };
    const [first, second, third, fourth] = state.prompt.passages;
    expect(first).toMatchObject({ path: 'notes/alpha.md', blockIndex: 0 });
    expect(first?.foundAs).toEqual(['subject', 'link', 'neighbour']);
    expect(second?.foundAs).toEqual(['subject']);
    expect(third?.foundAs).toEqual(['link']);
    expect(fourth?.foundAs).toEqual(['neighbour']);
  });

  it('a concept prompt’s passages are unchanged, with no role recorded', async () => {
    const view = await openPassages({ retrieve });
    await answerPassages(view, 'My explanation.');
    expect(shownPassages(view.root).map((p) => p.text)).toEqual([
      'Alpha drives the first coined process.',
      'Alpha is measured by the coined rate.',
    ]);
    const { state } = view.modal as unknown as {
      state: { prompt: { passages: readonly ExplainBackSourceBlock[] } };
    };
    expect(state.prompt.passages.every((p) => p.foundAs === undefined)).toBe(true);
  });

  it('the material the comparison is built from is the same set as before, only without the repeat', async () => {
    const { resolveGradingSourceBlocks } = await import('../../src/explain-back/modal.js');
    const { relationPartner, SUBJECT_KEY } = await import('./practice-view-harness.js');
    const deps = {
      retrieveSourceBlocks: retrieve,
      resolveCausesPartner: (subject: string) =>
        subject === SUBJECT_KEY ? relationPartner() : undefined,
      resolveIntroducingPassage: introducing,
    };
    const result = await resolveGradingSourceBlocks(deps, SUBJECT_KEY, await retrieve('q'), 'c');
    const material = result.sourceMaterial?.sourceBlocks.map((b) => b.blockId) ?? [];
    const shownIds = new Set(result.sourceBlocks.map((entry) => entry.block.blockId));
    // Every block of the material is still represented in the shown list by its place and position.
    const places = new Set(result.sourceBlocks.map((e) => `${e.path}#${e.blockIndex}`));
    for (const id of material) expect(places.has(id.split('#').slice(0, 2).join('#'))).toBe(true);
    expect(shownIds.size).toBe(result.sourceBlocks.length);
    expect(material.length).toBeGreaterThanOrEqual(result.sourceBlocks.length);
  });
});
