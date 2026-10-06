/**
 * A draft written between the purge's listing and its index delete (`ol-egov.141.89.104.53`,
 * race 3).
 *
 * The cache purge reads `.olea/drafts/index.json` to learn which drafts exist, deletes each one it
 * found, and then deletes the index. `put()` writes a draft's own file and then adds its entry to
 * the index. Each of those steps took one file's queue at a time, so a `put()` landing after the
 * purge's listing and before its index delete wrote its file and its entry, and the purge then
 * deleted the index under it: the draft's file stayed on disk with no index entry. `list()` and
 * `listPending()` read the index alone (a dot folder is not listable on Obsidian), so that draft
 * can never be found again, and only a `sequence: 0` id is still reachable through `findByKey`'s
 * path probe.
 *
 * Whichever side wins, a draft must end the race either purged with its entry or kept with it.
 * The vault below starts a `put()` at a chosen point inside the purge and lands each delete one
 * macrotask late, so the `put()` runs to completion inside the gap. Every course, concept and id
 * here is invented.
 */

import type { VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  createVaultDraftCacheStore,
  DRAFT_CACHE_FOLDER,
} from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { purgeCache } from '../../src/privacy/cache-purge.js';
import { FakeDataHost, MemoryVaultSource } from '../privacy/fakes.js';

const INDEX = `${DRAFT_CACHE_FOLDER}/index.json`;

/** Fires `hook` once, at the first call that matches, and lands every delete a macrotask late. */
class PurgeGapVault extends MemoryVaultSource {
  private hook:
    | { readonly on: 'read' | 'delete'; readonly path: VaultPath; readonly run: () => void }
    | undefined;

  arm(on: 'read' | 'delete', path: VaultPath, run: () => void): void {
    this.hook = { on, path, run };
  }

  private fire(on: 'read' | 'delete', path: VaultPath): void {
    const hook = this.hook;
    if (hook === undefined || hook.on !== on || hook.path !== path) return;
    this.hook = undefined;
    hook.run();
  }

  override async read(path: VaultPath): Promise<string> {
    this.fire('read', path);
    return super.read(path);
  }

  override async delete(path: VaultPath): Promise<void> {
    this.fire('delete', path);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await super.delete(path);
  }
}

function draft(draftId: string, conceptName: string): DraftRecord {
  return {
    draftId,
    status: 'pending',
    courseCode: 'COURSEA',
    conceptName,
    conceptIds: [conceptName],
    sourcePath: '01 Courses/COURSEA/Week 1.md',
    createdAt: '2026-10-05T10:00:00+10:00',
    question: {
      stem: `Which part turns the ${conceptName}?`,
      correctAnswer: 'The crank',
      distractors: ['The lid', 'The base', 'The spring'],
      feedback: 'See week one.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
  };
}

/** The draft ids whose own file is on disk (the index excluded). */
function draftFilesOnDisk(vault: MemoryVaultSource): readonly string[] {
  return vault
    .paths()
    .filter((path) => path.startsWith(`${DRAFT_CACHE_FOLDER}/`) && path !== INDEX)
    .map((path) => path.slice(DRAFT_CACHE_FOLDER.length + 1, -'.json'.length))
    .sort();
}

async function listedDraftIds(vault: MemoryVaultSource): Promise<readonly string[]> {
  const records = await createVaultDraftCacheStore(vault).list();
  return records.map((record) => record.draftId).sort();
}

describe('race 3: a draft written between the purge’s listing and its index delete', () => {
  it('a draft put while the purge reads the index is either purged with its entry or kept with it', async () => {
    const vault = new PurgeGapVault();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(draft('draft-a', 'Widget'));

    let late: Promise<void> = Promise.resolve();
    vault.arm('read', INDEX, () => {
      late = cache.put(draft('draft-b', 'Gadget'));
    });
    await purgeCache({ dataHost: new FakeDataHost(), vault });
    await late;

    // Today: draft-b's file is on disk and the index that named it is gone.
    expect(await listedDraftIds(vault)).toEqual(draftFilesOnDisk(vault));
    expect(draftFilesOnDisk(vault)).not.toContain('draft-a');
  });

  it('a draft put while the purge deletes the drafts it listed is either purged with its entry or kept with it', async () => {
    const vault = new PurgeGapVault();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(draft('draft-a', 'Widget'));

    let late: Promise<void> = Promise.resolve();
    vault.arm('delete', `${DRAFT_CACHE_FOLDER}/draft-a.json`, () => {
      late = cache.put(draft('draft-b', 'Gadget'));
    });
    await purgeCache({ dataHost: new FakeDataHost(), vault });
    await late;

    expect(await listedDraftIds(vault)).toEqual(draftFilesOnDisk(vault));
    expect(draftFilesOnDisk(vault)).not.toContain('draft-a');
  });

  it('a draft put just before the purge starts is purged, file and entry', async () => {
    const vault = new PurgeGapVault();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(draft('draft-a', 'Widget'));

    const early = cache.put(draft('draft-b', 'Gadget'));
    const purge = purgeCache({ dataHost: new FakeDataHost(), vault });
    const [, result] = await Promise.all([early, purge]);

    expect(vault.paths().filter((path) => path.startsWith(`${DRAFT_CACHE_FOLDER}/`))).toEqual([]);
    expect([...result.deletedDraftPaths].sort()).toEqual(
      [`${DRAFT_CACHE_FOLDER}/draft-a.json`, `${DRAFT_CACHE_FOLDER}/draft-b.json`, INDEX].sort(),
    );
  });

  it('a purge with no race reports and removes exactly what it did before', async () => {
    const vault = new PurgeGapVault();
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(draft('draft-a', 'Widget'));
    await cache.put(draft('draft-b', 'Gadget'));

    const result = await purgeCache({ dataHost: new FakeDataHost(), vault });

    expect(result.deletedDraftPaths).toEqual([
      `${DRAFT_CACHE_FOLDER}/draft-a.json`,
      `${DRAFT_CACHE_FOLDER}/draft-b.json`,
      INDEX,
    ]);
    expect(vault.paths()).toEqual([]);
  });
});
