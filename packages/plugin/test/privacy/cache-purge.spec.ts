/**
 * `purgeCache` tests (F7.4, `ol-p6t01`). See `features/F7-plugin-surface.md`
 * for the scenarios this asserts (`plugin/privacy/cache-purge.spec`).
 */
import { describe, expect, it } from 'vitest';
import { CACHE_DATA_JSON_KEYS, purgeCache } from '../../src/privacy/cache-purge.js';
import { FakeDataHost, MemoryVaultSource } from './fakes.js';

describe('purgeCache (F7.4, ol-p6t01)', () => {
  it('removes exactly the five D-006 cache keys and leaves everything else untouched', async () => {
    const dataHost = new FakeDataHost();
    dataHost.blob = {
      studyPlan: { some: 'plan' },
      keywordIndex: { some: 'index' },
      ingestionQueue: { some: 'queue' },
      corpusRelationState: { knownConceptNames: ['x'] },
      embeddingCache: { some: 'cache' },
      // Must survive: settings, identity, and the usage log (a log, not a cache).
      workerConfig: { version: 1, baseUrl: 'https://example.com', token: 'secret' },
      deviceId: 'device-abc',
      usageLog: { version: 1, entries: [{ taskId: 'x' }] },
    };
    const vault = new MemoryVaultSource();

    const result = await purgeCache({ dataHost, vault });

    expect(result.clearedDataJsonKeys.slice().sort()).toEqual([...CACHE_DATA_JSON_KEYS].sort());
    const blob = dataHost.blob as Record<string, unknown>;
    for (const key of CACHE_DATA_JSON_KEYS) {
      expect(key in blob).toBe(false);
    }
    // Untouched.
    expect(blob.workerConfig).toEqual({
      version: 1,
      baseUrl: 'https://example.com',
      token: 'secret',
    });
    expect(blob.deviceId).toBe('device-abc');
    expect(blob.usageLog).toEqual({ version: 1, entries: [{ taskId: 'x' }] });
  });

  it('reports an empty clear list on a fresh install — no cache key present is not an error', async () => {
    const dataHost = new FakeDataHost();
    dataHost.blob = { workerConfig: { version: 1, baseUrl: '', token: '' } };
    const vault = new MemoryVaultSource();

    const result = await purgeCache({ dataHost, vault });

    expect(result.clearedDataJsonKeys).toEqual([]);
    expect(result.deletedDraftPaths).toEqual([]);
  });

  it('deletes every draft record and the index under .olea/drafts/, discovered via the index rather than a folder listing', async () => {
    const dataHost = new FakeDataHost();
    const draftRecord = (draftId: string, conceptName: string) => ({
      draftId,
      status: 'pending' as const,
      courseCode: 'SYN101',
      conceptName,
      conceptIds: ['concept-1'],
      sourcePath: '01 Courses/SYN101/Lecture 1.md',
      createdAt: '2026-08-25T10:00:00+00:00',
      question: { stem: 'Q?', correctAnswer: 'A', distractors: ['B', 'C'], feedback: 'because' },
      provenance: { taskId: 'cards.generate.v1', promptVersion: '1.0.0', modelId: 'synthetic' },
      firstServedAt: null,
    });
    const vault = new MemoryVaultSource({
      '.olea/drafts/index.json': JSON.stringify({
        version: 1,
        entries: [
          { draftId: 'd1', courseCode: 'SYN101', conceptName: 'Alpha', status: 'pending' },
          { draftId: 'd2', courseCode: 'SYN101', conceptName: 'Beta', status: 'pending' },
        ],
      }),
      '.olea/drafts/d1.json': JSON.stringify(draftRecord('d1', 'Alpha')),
      '.olea/drafts/d2.json': JSON.stringify(draftRecord('d2', 'Beta')),
    });

    const result = await purgeCache({ dataHost, vault });

    expect(result.deletedDraftPaths.slice().sort()).toEqual(
      ['.olea/drafts/d1.json', '.olea/drafts/d2.json', '.olea/drafts/index.json'].sort(),
    );
    expect(vault.paths()).toEqual([]);
  });

  it('never touches .olea/reviews/ or .olea/misconceptions/ — those are handled by vault-artifact-delete, not a cache purge', async () => {
    const dataHost = new FakeDataHost();
    const vault = new MemoryVaultSource({
      '.olea/reviews/2026-01-01.device-1.jsonl': 'not-really-jsonl-but-irrelevant-here\n',
      '.olea/misconceptions/2026-01-01.device-1.jsonl': 'also-irrelevant\n',
    });

    await purgeCache({ dataHost, vault });

    expect(vault.paths()).toEqual([
      '.olea/misconceptions/2026-01-01.device-1.jsonl',
      '.olea/reviews/2026-01-01.device-1.jsonl',
    ]);
  });

  it('is idempotent — calling it twice in a row is safe and the second call clears nothing new', async () => {
    const dataHost = new FakeDataHost();
    dataHost.blob = { keywordIndex: { some: 'index' } };
    const vault = new MemoryVaultSource();

    const first = await purgeCache({ dataHost, vault });
    const second = await purgeCache({ dataHost, vault });

    expect(first.clearedDataJsonKeys).toEqual(['keywordIndex']);
    expect(second.clearedDataJsonKeys).toEqual([]);
  });
});
