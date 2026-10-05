/**
 * `ol-egov.141.89.5.79` ([D-508]): a successor drafted by the revision job carries a source
 * citation whose passage digest is sealed over the current passage text the job carries, so it is
 * watched at passage grain from the day it is accepted. Synthetic text only.
 */

import {
  digestPassage,
  hashContent,
  readInstrumentCitation,
  writeInstrumentCitation,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import { runInstrumentRevisionJob } from '../../src/generation/revision-job-runner.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE_PATH = 'Courses/GEO101/Week 3.md';
const SOURCE = 'Courses/GEO101/Source.md';
const PDF = 'Lectures/deck.pdf';
const PREDECESSOR_ID = 'mcq-old-1';
const NOTE = [
  '---',
  'topic: [Sediment layering]',
  'course: GEO101',
  '---',
  '',
  '## What preserves the storm record?',
  '',
  '```olea-mcq',
  `id: ${PREDECESSOR_ID}`,
  'stem: Which structure preserves the storm record?',
  'answer: Hummocky stratification',
  'distractor: a',
  'distractor: b',
  'distractor: c',
  'distractor: d',
  '```',
  '',
].join('\n');

const OLD_PARAGRAPH = 'Synthetic old passage: layers thin toward the basin centre.';
const PASSAGE = 'Synthetic changed passage: layers thicken toward the basin centre.';
const OTHER = 'Synthetic unrelated paragraph about ripple marks.';
const SOURCE_NOW = `# Topic\n\n${OTHER}\n\n${PASSAGE}\n`;

const goodResponse = {
  ok: true,
  stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
  result: {
    questions: [{ stem: 'S', correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'f' }],
  },
};
const drafted = (): DraftQuizCardsResult => ({
  status: 'drafted',
  // Retrieval supplied several chunks, so the sweep's own sole-chunk rule would name nothing here.
  request: {
    courseCode: 'GEO101',
    conceptName: 'Sediment layering',
    sourceChunks: ['retrieved one', 'retrieved two'],
  },
  response: goodResponse,
});

/** A vault whose files can also be read as bytes, as a real vault reads a PDF. */
class ByteVault extends MemoryVaultSource {
  override async readBinary(path?: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(path ?? ''));
  }
}

async function run(vault: MemoryVaultSource, passage = PASSAGE) {
  const cache = createVaultDraftCacheStore(vault);
  await runInstrumentRevisionJob(
    {
      vault,
      cache,
      draftDeps: () =>
        ({ transport: { send: async () => goodResponse } }) as unknown as DraftQuizCardsDeps,
      draftForConcept: async () => drafted(),
    },
    {
      kind: 'instrument-revision',
      predecessorInstrumentId: PREDECESSOR_ID,
      newPassageText: passage,
    },
  );
  return cache.listPending();
}

describe('a rewritten question carries a citation with a passage digest (ol-egov.141.89.5.79)', () => {
  it('names the cited note and a digest equal to sealing the current passage; accept anchors at passage grain', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE, [SOURCE]: SOURCE_NOW });
    await writeInstrumentCitation(vault, PREDECESSOR_ID, {
      sourcePath: SOURCE,
      page: 1,
      passageDigest: await digestPassage(OLD_PARAGRAPH),
    });
    const [record] = await run(vault);
    expect(record?.sourceCitation?.sourcePath).toBe(SOURCE);
    expect(record?.sourceCitation?.passageDigest).toBe(await digestPassage(PASSAGE));
    expect(record?.sourceCitation?.passageDigest).not.toBe(await digestPassage(OLD_PARAGRAPH));

    const { instrumentId } = await materializeAcceptedDraft(vault, {
      sourcePath: NOTE_PATH,
      question: record?.question as never,
      draftId: record?.draftId ?? '',
      ...(record?.sourceCitation === undefined ? {} : { sourceCitation: record.sourceCitation }),
    });
    expect((await readInstrumentCitation(vault, instrumentId))?.passageDigest).toBe(
      await digestPassage(PASSAGE),
    );
  });

  it('omits the digest when the passage is not a single passage of the note (never a guess)', async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: NOTE,
      [SOURCE]: `# Topic\n\n${OTHER}\n\n${PASSAGE}\n\n${PASSAGE}\n`,
    });
    await writeInstrumentCitation(vault, PREDECESSOR_ID, { sourcePath: SOURCE, page: 1 });
    const [record] = await run(vault);
    expect(record?.sourceCitation?.sourcePath).toBe(SOURCE);
    expect(record?.sourceCitation?.passageDigest).toBeUndefined();
  });

  it('a non-markdown source keeps its path and page, and a sourceRevision only while it is the file hash now', async () => {
    const current = await hashContent(new TextEncoder().encode('synthetic pdf bytes'));
    for (const [stored, expected] of [
      [current, current],
      ['stale-revision', undefined],
    ] as const) {
      const vault = new ByteVault({ [NOTE_PATH]: NOTE, [PDF]: 'synthetic pdf bytes' });
      await writeInstrumentCitation(vault, PREDECESSOR_ID, {
        sourcePath: PDF,
        page: 3,
        sourceRevision: stored,
      });
      const [record] = await run(vault, 'Synthetic changed slide text.');
      expect(record?.sourceCitation?.sourcePath).toBe(PDF);
      expect(record?.sourceCitation?.page).toBe(3);
      expect(record?.sourceCitation?.passageDigest).toBeUndefined();
      expect(record?.sourceCitation?.sourceRevision).toBe(expected);
    }
  });

  it('a self-referential or absent predecessor citation yields no citation', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
    const [record] = await run(vault);
    expect(record?.sourceCitation).toBeUndefined();
  });
});
