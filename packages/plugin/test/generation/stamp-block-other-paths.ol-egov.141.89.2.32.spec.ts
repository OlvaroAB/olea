/**
 * `ol-egov.141.89.2.32`: Olea's own `olea-*` frontmatter stamp never reaches a model request on
 * the paths other than routing. One test per path; each says leak or no leak. Synthetic text only.
 */

import {
  chunksFromIndex,
  gatherPassages,
  indexDocument,
  isRegisterableDocument,
  type PersistedKeywordIndex,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { runInstrumentRevisionJob } from '../../src/generation/revision-job-runner.js';
import { stripOleaFrontmatter } from '../../src/generation/strip-olea-frontmatter.js';
import type { DraftQuizCardsDeps } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const STAMPED = [
  '---',
  'topic: [Tides]',
  'olea-cloze-ids:',
  '  block-a1: cloze-1',
  'olea-uid: uid-77',
  'course: OCEAN101',
  '---',
  '',
  'Spring tides follow the new and full moon.',
  '',
].join('\n');
const CLEAN = STAMPED.replace('olea-cloze-ids:\n  block-a1: cloze-1\nolea-uid: uid-77\n', '');
const MCQ_NOTE = [
  '---',
  'topic: [Tides]',
  'course: OCEAN101',
  '---',
  '',
  '```olea-mcq',
  'id: mcq-x',
  'stem: What drives spring tides?',
  'answer: Alignment of sun and moon',
  'distractor: a',
  'distractor: b',
  'distractor: c',
  'distractor: d',
  '```',
  '',
].join('\n');
const LEAK = /olea-cloze-ids|olea-uid|cloze-1|uid-77/;

describe('the shared strip', () => {
  it('removes only olea-* keys and leaves her note byte-for-byte otherwise', () => {
    expect(stripOleaFrontmatter(STAMPED)).toBe(CLEAN);
    expect(stripOleaFrontmatter(CLEAN)).toBe(CLEAN);
    expect(stripOleaFrontmatter('Plain passage, no frontmatter.')).toBe(
      'Plain passage, no frontmatter.',
    );
  });
});

describe('path 3: revision-job-runner passage (whole-note grain carries the note text)', () => {
  it('a stamped whole-note passage reaches sourceChunks without the stamp', async () => {
    const vault = new MemoryVaultSource({ 'Courses/OCEAN101/Tides.md': MCQ_NOTE });
    const sent: Record<string, unknown>[] = [];
    const transport = {
      send: async (req: { payload: unknown }) => {
        sent.push(req.payload as Record<string, unknown>);
        return { ok: true };
      },
    };
    await runInstrumentRevisionJob(
      {
        vault,
        cache: createVaultDraftCacheStore(vault),
        draftDeps: () => ({ transport }) as unknown as DraftQuizCardsDeps,
        draftForConcept: async (deps) => {
          await deps.transport.send({
            contractVersion: 1,
            taskId: 'quiz.generate.v1',
            payload: { sourceChunks: ['retrieved'], sourceChunkOrigins: [null] },
          });
          await deps.transport.send({
            contractVersion: 1,
            taskId: 'grounding.judge.v1',
            payload: { context: 'retrieved' },
          });
          return { status: 'refused', reason: 'no-evidence' } as never;
        },
      },
      {
        kind: 'instrument-revision',
        predecessorInstrumentId: 'mcq-x',
        newPassageText: STAMPED,
      },
    );
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent)).not.toMatch(LEAK);
    expect((sent[0]?.sourceChunks as string[] | undefined)?.[0]).toBe(CLEAN);
    expect(String(sent[1]?.context).startsWith(CLEAN)).toBe(true);
  });
});

describe('path 2: draft-cards sourceChunks come from retrieval chunks', () => {
  it('no leak: the keyword index the chunker reads drops the frontmatter block', async () => {
    const vault = new MemoryVaultSource({ 'Tides.md': STAMPED });
    const doc = await indexDocument(vault, 'Tides.md');
    const index = { documents: [doc] } as unknown as PersistedKeywordIndex;
    const chunks = await chunksFromIndex(index);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((c) => c.text).join('\n')).not.toMatch(LEAK);
  });
});

describe('path 4: concept reader and outcomes extract', () => {
  it('no leak: gatherPassages (the concept reader input) skips the frontmatter block', async () => {
    const vault = new MemoryVaultSource({ 'Tides.md': STAMPED });
    const passages = await gatherPassages(vault);
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.map((p) => p.text).join('\n')).not.toMatch(LEAK);
  });

  it('no leak: outcomes extract is only fed non-markdown documents, which carry no frontmatter', () => {
    expect(isRegisterableDocument('Courses/OCEAN101/Tides.md')).toBe(false);
    expect(isRegisterableDocument('Courses/OCEAN101/Paper.pdf')).toBe(true);
  });
});
