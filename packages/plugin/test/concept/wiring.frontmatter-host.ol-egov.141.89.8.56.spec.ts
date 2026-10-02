/**
 * `ol-egov.141.89.8.56` (D-465): the production factories hand the request builders the cached
 * frontmatter source, so a Markdown file declaring a transcript role reaches `sourceChunkOrigins`.
 * Synthetic fixtures only (INV-3); no `obsidian` import.
 */
import type { WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildConceptWiring,
  buildCorpusRelationWiring,
  buildKnowledgeKindWiring,
} from '../../src/concept/wiring.js';
import { buildClassifyPassageHook } from '../../src/retrieval/classify-passage.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';

const TRANSCRIPT = { kind: 'transcript', speakerRole: 'unknown' } as const;
const LOC = { page: 1, charRange: { start: 0, end: 10 } };

const dataHost = {
  async loadData(): Promise<unknown> {
    return {
      [WORKER_CONFIG_STORAGE_KEY]: { version: 1, baseUrl: 'https://worker.example', token: 't' },
    };
  },
  async saveData(): Promise<void> {},
};

function recording(reply: unknown) {
  const sent: WorkerTaskRequest[] = [];
  return {
    sent,
    transport: {
      async send(request: WorkerTaskRequest): Promise<unknown> {
        sent.push(request);
        return reply;
      },
    },
  };
}

const declaredTranscript = (declared: boolean) => ({
  frontmatterFor: () => (declared ? { role: 'lecture-transcript' } : undefined),
});

describe('buildConceptWiring passes the frontmatter host to the concept reader', () => {
  const run = async (declared: boolean) => {
    const { sent, transport } = recording({ ok: true, stamp: {}, result: { concepts: [] } });
    const wiring = await buildConceptWiring({
      dataHost,
      createTransport: () => transport,
      frontmatterHost: declaredTranscript(declared),
    });
    await wiring.conceptReader?.read({
      passages: [
        {
          text: 'Spoken words.',
          anchor: { sourcePath: 'Talks/week1.md', location: LOC },
          course: undefined,
        },
      ],
    });
    return sent[0]?.payload as Record<string, unknown>;
  };

  it('a Markdown file declaring the transcript role yields its origin', async () => {
    expect((await run(true)).sourceChunkOrigins).toEqual([TRANSCRIPT]);
  });

  it('an undeclared Markdown file sends no origins field', async () => {
    expect(await run(false)).not.toHaveProperty('sourceChunkOrigins');
  });
});

describe('buildKnowledgeKindWiring passes the frontmatter host to the classifier', () => {
  it('a Markdown file declaring the transcript role yields its origin', async () => {
    const { sent, transport } = recording({
      ok: true,
      stamp: {},
      result: { kind: 'fact', confidence: 0.9 },
    });
    const wiring = await buildKnowledgeKindWiring({
      dataHost,
      createTransport: () => transport,
      frontmatterHost: declaredTranscript(true),
    });
    expect(wiring.classifier).not.toBeNull();
    await wiring.classifier
      ?.classify({
        conceptName: 'Concept X',
        sourceMaterial: [
          { text: 'Spoken words.', anchor: { sourcePath: 'Talks/week1.md', location: LOC } },
        ],
      } as never)
      .catch(() => undefined);
    const payload = sent[0]?.payload as Record<string, unknown>;
    expect(payload.sourceChunkOrigins).toEqual([TRANSCRIPT]);
  });
});

describe('buildCorpusRelationWiring accepts the frontmatter host', () => {
  it('builds a verdict port when configured', async () => {
    const { transport } = recording({ ok: true, stamp: {}, result: {} });
    const wiring = await buildCorpusRelationWiring({
      dataHost,
      createTransport: () => transport,
      frontmatterHost: declaredTranscript(true),
    });
    expect(wiring.verdictPort).not.toBeNull();
  });
});

describe('the classify hook shares the one transcript test', () => {
  const hook = (declared: boolean) =>
    buildClassifyPassageHook({ frontmatterHost: declaredTranscript(declared) });
  const chunk = (path: string) => ({ path, text: 'Spoken words.' }) as never;

  it('a .txt is a transcript, never hers', () => {
    expect(hook(false)(chunk('Talks/week1.txt'))).toEqual(hook(true)(chunk('Talks/week1.txt')));
  });

  it('a declared .md is classified as a transcript and an undeclared one is not', () => {
    expect(hook(true)(chunk('Talks/week1.md'))).not.toEqual(hook(false)(chunk('Talks/week1.md')));
    expect(hook(true)(chunk('Talks/week1.md'))).toEqual(hook(false)(chunk('Talks/week1.txt')));
  });
});
