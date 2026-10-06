/**
 * T13a and T13b, plugin side (`ol-egov.141.89.104.2`).
 *
 * T13a: a write queued before a delete of the same record never recreates it. The privacy
 * deletes (`deleteVaultPath`, under the cache purge and the full delete) join the record file's
 * queue, so the write lands first and the delete then removes it. The vault below lands writes a
 * macrotask late and deletes at once, the interleaving in which an unqueued delete runs first and
 * the write puts the record back.
 *
 * T13b: a full delete racing queued writes — no write lands after the full delete, in any store.
 * The seals (`OleaLayerWriteSeal`, `FullDeleteWriteSeal`) drop every write issued after the seal;
 * the queue orders each delete after the writes queued before it.
 *
 * Every course, concept and id here is invented.
 */

import type { VaultPath } from 'olea-core';
import {
  appendEdgeDisposition,
  edgeDispositionLogPath,
  propositionKey,
  withPathQueue,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  createVaultDraftCacheStore,
  DRAFT_CACHE_FOLDER,
} from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { purgeCache } from '../../src/privacy/cache-purge.js';
import { runFullDelete } from '../../src/privacy/full-delete.js';
import { OleaLayerWriteSeal } from '../../src/privacy/olea-layer-write-seal.js';
import { deleteVaultPath } from '../../src/privacy/types.js';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';
import { FakeDataHost, MemoryVaultSource } from '../privacy/fakes.js';

class LateWriteVault extends MemoryVaultSource {
  override async write(path: VaultPath, content: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await super.write(path, content);
  }
}

function draft(draftId: string, status: DraftRecord['status']): DraftRecord {
  return {
    draftId,
    status,
    courseCode: 'COURSEA',
    conceptName: 'Widget',
    conceptIds: ['Widget'],
    sourcePath: '01 Courses/COURSEA/Week 1.md',
    createdAt: '2026-10-01T10:00:00+10:00',
    question: {
      stem: 'Which part turns the widget?',
      correctAnswer: 'The crank',
      distractors: ['The lid', 'The base', 'The spring'],
      feedback: 'See week one.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
  };
}

const KEY = propositionKey('prerequisite', 'concept-key1:a', 'concept-key1:b');

describe('T13a: a write queued before a delete of the same record', () => {
  it('the privacy delete waits for a disposition append, and the record stays deleted', async () => {
    const vault = new LateWriteVault();
    const path = edgeDispositionLogPath(KEY);
    const append = appendEdgeDisposition(vault, KEY, 'declined');
    const remove = deleteVaultPath(vault, path);
    await Promise.all([append, remove]);
    expect(vault.raw(path)).toBeUndefined();
  });

  it('the cache purge waits for a draft update queued before it, and the draft stays deleted', async () => {
    const vault = new LateWriteVault();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(draft('a', 'pending'));
    const update = cache.put(draft('a', 'rejected'));
    const purge = purgeCache({ dataHost: new FakeDataHost(), vault });
    await Promise.all([update, purge]);
    expect(vault.raw(`${DRAFT_CACHE_FOLDER}/a.json`)).toBeUndefined();
  });
});

describe('T13b: a full delete racing queued writes', () => {
  it('no store write lands after the full delete, whether queued before it or issued during it', async () => {
    const path = edgeDispositionLogPath(KEY);
    const inner = new LateWriteVault({
      [path]: `${JSON.stringify({ propositionKey: KEY, events: [{ kind: 'accepted', at: '2026-10-01T00:00:00Z' }], schemaVersion: 1 }, null, 2)}\n`,
    });
    const vault = new OleaLayerWriteSeal(inner);
    const file = new FakeDataHost();
    file.blob = { usageLog: { entries: [] } };
    const settings = new SerializingDataHost(file);

    // An earlier task holds the record's queue; a disposition is queued behind it.
    let releaseEarlier = () => {};
    const earlier = withPathQueue(
      path,
      () =>
        new Promise<void>((resolve) => {
          releaseEarlier = resolve;
        }),
    );
    const queuedAppend = appendEdgeDisposition(vault, KEY, 'declined');
    const queuedSettings = settings.readModifyWrite((current) => ({
      ...(current as Record<string, unknown>),
      usageLog: { entries: [{ task: 'late' }] },
    }));

    const sealed = await vault.seal();
    const deleting = runFullDelete({
      dataHost: settings,
      vault: sealed.vault,
      deviceId: 'device-1',
      today: '2026-10-05',
      workerConfig: { baseUrl: '', token: '' },
      httpRequest: async () => ({ status: 200 }),
    });
    // A write issued while the delete runs.
    const during = appendEdgeDisposition(vault, KEY, 'expired');
    releaseEarlier();
    await Promise.all([earlier, queuedAppend, queuedSettings, deleting, during]);

    expect(inner.paths().filter((p) => p.startsWith('.olea/'))).toEqual([]);
    expect(file.blob).not.toHaveProperty('usageLog');
  });
});
