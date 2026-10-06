/**
 * `ol-egov.141.89.7.82` ([D-518]): the rewrite after a file changes merges the pages of one
 * version. Deliveries of the same bytes add to or replace only their own pages, never the file's
 * text; a delivery of other bytes starts that version's text afresh; and a late delivery of older
 * bytes never loses the newer version's pages. Driven through the rewrite path itself
 * (`CitationRevisionTrigger.onSourceUnitsLanded` and the pass), with the deliveries shaped as the
 * extraction runner's text-layer delivery (every text-layer page, one call) and the vision page
 * runner's delivery with its revision digest switched on (one page, one unit). Written to
 * olea-service features, the [D-518] merge group, before the code. Every string and byte is
 * invented (INV-3).
 */
import { describe, expect, it } from 'vitest';
import {
  DOC,
  digestOf,
  type Harness,
  heldIds,
  MemoryVaultSource,
  rewrites,
  seedQuestions,
  setup,
  unitsOf,
  versionBytes,
} from './source-rewrite-harness.ol-egov.141.89.7.82.js';

/** Questions on the text pages 1 and 2 and the image page 3, all built from v0. */
const QUESTIONS = [
  { id: 'qt1', page: 1 },
  { id: 'qt2', page: 2 },
  { id: 'qi3', page: 3 },
] as const;

async function baselined(): Promise<{ vault: MemoryVaultSource; harness: Harness }> {
  const vault = new MemoryVaultSource();
  vault.binaries.set(DOC, versionBytes('v0'));
  const v0 = await digestOf(versionBytes('v0'));
  seedQuestions(
    vault,
    QUESTIONS.map((q) => ({ ...q, revision: v0 })),
  );
  const harness = setup();
  await harness.trigger.tick(vault, harness.actions);
  expect(await heldIds(harness)).toEqual([]);
  return { vault, harness };
}

/** The extraction runner's text-layer delivery of `version`: pages 1 and 2. */
async function textLayer(vault: MemoryVaultSource, harness: Harness, version: string) {
  return harness.trigger.onSourceUnitsLanded(
    vault,
    harness.actions,
    unitsOf({
      1: [`${version} page 1, first paragraph.`, `${version} page 1, second paragraph.`],
      2: [`${version} page 2 text.`],
    }),
    new Map([[DOC, await digestOf(versionBytes(version))]]),
  );
}

/** The vision page runner's delivery of one page of `version`, digest on. */
async function imageReading(
  vault: MemoryVaultSource,
  harness: Harness,
  version: string,
  page: number,
  text = `${version} page ${page} image reading.`,
) {
  return harness.trigger.onSourceUnitsLanded(
    vault,
    harness.actions,
    unitsOf({ [page]: [text] }),
    new Map([[DOC, await digestOf(versionBytes(version))]]),
  );
}

async function passFinds(vault: MemoryVaultSource, harness: Harness, version: string) {
  vault.binaries.set(DOC, versionBytes(version));
  await harness.trigger.tick(vault, harness.actions);
}

const PAGE_1 = (version: string) =>
  `${version} page 1, first paragraph.\n\n${version} page 1, second paragraph.`;

function textsOf(harness: Harness): Record<string, string> {
  return Object.fromEntries([...rewrites(harness)].map(([id, r]) => [id, r.text]));
}

describe('deliveries of one version add their own pages ([D-518])', () => {
  it('a page read from its image never replaces the text pages already landed', async () => {
    const { vault, harness } = await baselined();
    await textLayer(vault, harness, 'D2');
    await imageReading(vault, harness, 'D2', 3);
    await passFinds(vault, harness, 'D2');

    expect(textsOf(harness)).toEqual({
      qt1: PAGE_1('D2'),
      qt2: 'D2 page 2 text.',
      qi3: 'D2 page 3 image reading.',
    });
    expect(await heldIds(harness)).toEqual([]);
    const d2 = await digestOf(versionBytes('D2'));
    for (const rewrite of rewrites(harness).values()) expect(rewrite.revision).toBe(d2);
    // Text for these bytes is held, so no re-extraction is asked for.
    expect(harness.requestSourceReextraction).not.toHaveBeenCalled();
  });

  it('nor do text pages landing after it replace the image page', async () => {
    const { vault, harness } = await baselined();
    await imageReading(vault, harness, 'D2', 3);
    await textLayer(vault, harness, 'D2');
    await passFinds(vault, harness, 'D2');
    expect(textsOf(harness)).toEqual({
      qt1: PAGE_1('D2'),
      qt2: 'D2 page 2 text.',
      qi3: 'D2 page 3 image reading.',
    });
  });

  it('questions held first are rewritten as each of their pages lands', async () => {
    const { vault, harness } = await baselined();
    await passFinds(vault, harness, 'D2');
    expect(await heldIds(harness)).toEqual(['qi3', 'qt1', 'qt2']);

    expect(await textLayer(vault, harness, 'D2')).toEqual({ rewritten: 2, heldNoText: 1 });
    expect(await heldIds(harness)).toEqual(['qi3']);
    expect(await imageReading(vault, harness, 'D2', 3)).toEqual({ rewritten: 1, heldNoText: 0 });
    expect(textsOf(harness)).toEqual({
      qt1: PAGE_1('D2'),
      qt2: 'D2 page 2 text.',
      qi3: 'D2 page 3 image reading.',
    });
    expect(await heldIds(harness)).toEqual([]);
  });
});

describe('a page read both from its text layer and from its image keeps both readings', () => {
  for (const order of ['text layer first', 'image first'] as const) {
    it(`whichever lands first (${order})`, async () => {
      const { vault, harness } = await baselined();
      if (order === 'text layer first') {
        await textLayer(vault, harness, 'D2');
        await imageReading(vault, harness, 'D2', 2);
      } else {
        await imageReading(vault, harness, 'D2', 2);
        await textLayer(vault, harness, 'D2');
      }
      await passFinds(vault, harness, 'D2');
      expect(textsOf(harness).qt2).toBe('D2 page 2 text.\n\nD2 page 2 image reading.');
    });
  }

  it('a repeat of either delivery replaces its own earlier text, never doubling it', async () => {
    const { vault, harness } = await baselined();
    await textLayer(vault, harness, 'D2');
    await imageReading(vault, harness, 'D2', 2);
    await textLayer(vault, harness, 'D2');
    await imageReading(vault, harness, 'D2', 2, 'D2 page 2 image reading, read again.');
    await passFinds(vault, harness, 'D2');
    expect(textsOf(harness)).toEqual({
      qt1: PAGE_1('D2'),
      qt2: 'D2 page 2 text.\n\nD2 page 2 image reading, read again.',
    });
    expect(await heldIds(harness)).toEqual(['qi3']);
  });
});

describe('a delivery of other bytes starts that version afresh', () => {
  it('no text of an older version is used for a question held for the newer one', async () => {
    const { vault, harness } = await baselined();
    await textLayer(vault, harness, 'D1');
    await imageReading(vault, harness, 'D1', 3);
    await imageReading(vault, harness, 'D2', 3);
    await passFinds(vault, harness, 'D2');

    expect(textsOf(harness)).toEqual({ qi3: 'D2 page 3 image reading.' });
    expect(await heldIds(harness)).toEqual(['qt1', 'qt2']);

    expect(await textLayer(vault, harness, 'D2')).toEqual({ rewritten: 2, heldNoText: 0 });
    expect(textsOf(harness)).toEqual({
      qt1: PAGE_1('D2'),
      qt2: 'D2 page 2 text.',
      qi3: 'D2 page 3 image reading.',
    });
    for (const text of Object.values(textsOf(harness))) expect(text).not.toContain('D1');
  });
});

describe('a late delivery of an older version never loses the newer version’s pages', () => {
  it('the newer version’s next delivery brings its earlier pages back with it', async () => {
    const { vault, harness } = await baselined();
    await textLayer(vault, harness, 'D2');
    await imageReading(vault, harness, 'D1', 3); // read before the file changed, landing late
    await imageReading(vault, harness, 'D2', 3);
    await passFinds(vault, harness, 'D2');

    expect(textsOf(harness)).toEqual({
      qt1: PAGE_1('D2'),
      qt2: 'D2 page 2 text.',
      qi3: 'D2 page 3 image reading.',
    });
    for (const text of Object.values(textsOf(harness))) expect(text).not.toContain('D1');
    expect(await heldIds(harness)).toEqual([]);
  });

  it('questions held for the newer version are never rewritten from the late delivery', async () => {
    const { vault, harness } = await baselined();
    await passFinds(vault, harness, 'D2');
    expect(await textLayer(vault, harness, 'D2')).toEqual({ rewritten: 2, heldNoText: 1 });
    expect(await imageReading(vault, harness, 'D1', 3)).toEqual({ rewritten: 0, heldNoText: 0 });
    expect(await imageReading(vault, harness, 'D2', 3)).toEqual({ rewritten: 1, heldNoText: 0 });
    expect(textsOf(harness)).toEqual({
      qt1: PAGE_1('D2'),
      qt2: 'D2 page 2 text.',
      qi3: 'D2 page 3 image reading.',
    });
  });
});
