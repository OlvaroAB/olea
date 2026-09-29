/**
 * The authoring half of `[D-446]` option (a) (`ol-egov.141.89.5.32`): at the moment a generated
 * instrument's citation sidecar is written, `materializeAcceptedDraft` and
 * `materializeAcceptedCardDraft` seal the passage digest by the shared segmentation rule
 * (`olea-core`'s `sealCitationPassage`), so the batch pass can find the cited passage again.
 *
 * A digest the draft carries that resolves to exactly one passage is kept; one that does not (the
 * same text stands twice, or it is no longer there) is dropped and never written; a source note
 * with exactly one body passage is given that passage's digest; anything else keeps the
 * whole-note grain, because which passage grounded a question is not something authoring can
 * guess. The last test closes the loop through the real reader: what authoring writes, the
 * citation batch pass baselines at the passage.
 */
import { digestPassage, readInstrumentCitation } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { materializeAcceptedCardDraft } from '../../src/generation/materialize-card.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../src/ingestion/materiality/citation-revision-wiring.js';
import { MemoryVaultSource } from './fakes.js';

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

const HOME = 'Zettel/Topic (Olea).md';
const SOURCE = 'Zettel/Topic.md';
const ONE_PARAGRAPH =
  'Granite resists weathering far better than basalt does.\nIt is dominated by quartz.';
const HOME_TEXT = '---\ntopic: [Topic]\ncourse: GEO101\n---\n\nHome note prose.\n';

const QUESTION = {
  stem: 'Which mineral dominates granite?',
  correctAnswer: 'Quartz',
  distractors: ['Olivine', 'Calcite', 'Biotite', 'Gypsum'],
  feedback: 'See the note.',
};
const CARD = { front: 'What dominates granite?', back: 'Quartz' };

// `page` is present on every real citation (`pipeline.ts`'s `citationFromUnit`); a citation without
// one reads as no citation at all to `enumerateVaultInstruments`, so the fixtures carry it too.
async function mcqCitation(
  vault: MemoryVaultSource,
  citation: { sourcePath: string; passageDigest?: string },
) {
  const sourceCitation = { ...citation, page: 1 };
  const { instrumentId } = await materializeAcceptedDraft(vault, {
    sourcePath: HOME,
    question: QUESTION,
    draftId: 'draft-1',
    sourceCitation,
  });
  return readInstrumentCitation(vault, instrumentId);
}

describe('materializeAcceptedDraft seals the passage digest', () => {
  it("gives a source note with exactly one body passage that passage's digest", async () => {
    const vault = new MemoryVaultSource({
      [HOME]: HOME_TEXT,
      [SOURCE]: `# Topic\n\n${ONE_PARAGRAPH}\n`,
    });
    const citation = await mcqCitation(vault, { sourcePath: SOURCE });
    expect(citation?.sourcePath).toBe(SOURCE);
    expect(citation?.passageDigest).toBe(await digestPassage(ONE_PARAGRAPH));
  });

  it('leaves a source with several passages without a digest: which one grounded the draft is not guessed', async () => {
    const vault = new MemoryVaultSource({
      [HOME]: HOME_TEXT,
      [SOURCE]: `# Topic\n\n${ONE_PARAGRAPH}\n\nA second paragraph.\n`,
    });
    const citation = await mcqCitation(vault, { sourcePath: SOURCE });
    expect(citation?.passageDigest).toBeUndefined();
  });

  it('keeps a digest the draft carried when it resolves to exactly one passage', async () => {
    const digest = await digestPassage('A second paragraph.');
    const vault = new MemoryVaultSource({
      [HOME]: HOME_TEXT,
      [SOURCE]: `# Topic\n\n${ONE_PARAGRAPH}\n\nA second paragraph.\n`,
    });
    const citation = await mcqCitation(vault, { sourcePath: SOURCE, passageDigest: digest });
    expect(citation?.passageDigest).toBe(digest);
  });

  it('drops a digest that names a passage standing twice, or no longer there — never written', async () => {
    const twice = await digestPassage('Same words.');
    const gone = await digestPassage('A passage that was removed.');
    for (const [source, digest] of [
      [`# Topic\n\nSame words.\n\nOther.\n\nSame words.\n`, twice],
      [`# Topic\n\nOther.\n`, gone],
    ] as const) {
      const vault = new MemoryVaultSource({ [HOME]: HOME_TEXT, [SOURCE]: source });
      const citation = await mcqCitation(vault, { sourcePath: SOURCE, passageDigest: digest });
      expect(citation?.sourcePath).toBe(SOURCE);
      expect(citation?.passageDigest).toBeUndefined();
    }
  });

  it('a PDF source, and the self-referential fallback, are written exactly as before', async () => {
    const vault = new MemoryVaultSource({ [HOME]: HOME_TEXT });
    const pdf = await mcqCitation(vault, { sourcePath: 'Lectures/deck.pdf' });
    expect(pdf).toEqual({ sourcePath: 'Lectures/deck.pdf', page: 1 });

    const other = new MemoryVaultSource({ [HOME]: HOME_TEXT });
    const { instrumentId } = await materializeAcceptedDraft(other, {
      sourcePath: HOME,
      question: QUESTION,
      draftId: 'draft-2',
    });
    expect(await readInstrumentCitation(other, instrumentId)).toEqual({ sourcePath: HOME });
  });
});

describe('materializeAcceptedCardDraft seals the passage digest the same way', () => {
  it('mints for a one-passage source and keeps the self-referential fallback digest-free', async () => {
    const vault = new MemoryVaultSource({
      [HOME]: HOME_TEXT,
      [SOURCE]: `# Topic\n\n${ONE_PARAGRAPH}\n`,
    });
    const { instrumentId } = await materializeAcceptedCardDraft(vault, {
      sourcePath: HOME,
      card: CARD,
      draftId: 'card-1',
      sourceCitation: { sourcePath: SOURCE, page: 1 },
    });
    expect((await readInstrumentCitation(vault, instrumentId))?.passageDigest).toBe(
      await digestPassage(ONE_PARAGRAPH),
    );

    const fallback = new MemoryVaultSource({ [HOME]: HOME_TEXT });
    const result = await materializeAcceptedCardDraft(fallback, {
      sourcePath: HOME,
      card: CARD,
      draftId: 'card-2',
    });
    expect(await readInstrumentCitation(fallback, result.instrumentId)).toEqual({
      sourcePath: HOME,
    });
  });
});

describe('authoring and reading share the rule, end to end', () => {
  it('a passage sealed at authoring is what the batch pass baselines at, and survives an edit elsewhere in the note', async () => {
    const vault = new MemoryVaultSource({
      [HOME]: HOME_TEXT,
      [SOURCE]: `# Topic\n\n${ONE_PARAGRAPH}\n`,
    });
    await mcqCitation(vault, { sourcePath: SOURCE });

    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const calls: unknown[] = [];
    const trigger = new CitationRevisionTrigger({
      store,
      judge: {
        judge: async (input) => {
          calls.push(input);
          return { material: true, reason: 'scripted' };
        },
      },
      clock: { now: () => 0 },
    });
    const actions = { enqueue: async () => undefined, suspend: async () => undefined };
    await trigger.tick(vault, actions);
    const [anchor] = [...(await store.loadAll()).values()];
    expect(anchor?.text).toBe(ONE_PARAGRAPH);
    expect(anchor?.passageDigest).toBe(await digestPassage(ONE_PARAGRAPH));

    // A paragraph added ABOVE the cited one: the note changed, the cited passage did not.
    await vault.write(SOURCE, `# Topic\n\nA new opening paragraph.\n\n${ONE_PARAGRAPH}\n`);
    const report = await trigger.tick(vault, actions);
    expect(calls).toEqual([]);
    expect(report.revised + report.refreshed + report.stranded + report.passageAmbiguous).toBe(0);
  });
});
