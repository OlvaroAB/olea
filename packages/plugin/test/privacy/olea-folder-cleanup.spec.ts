/**
 * `runFullDelete`'s folder cleanup (`ol-egov.141.8.9`, found by `ol-egov.141.8.7`,
 * S/lanes/ol-egov.141.8.7-report.md): before this bead, `VaultSource` could remove every file
 * under `.olea/` but had no way to remove the folders those files left behind, so a full delete
 * emptied every store without ever taking the (now-empty) directory tree down.
 *
 * Modelled on `test/privacy/olea-layer-fixture.spec.ts`'s host shapes and fixture-building
 * pattern (that file is a different bead's; this one is new, dedicated to the folder-cleanup step
 * — see `LANE-RULES-r2.md`). Uses `FolderSource` over a real temporary directory, so an emptied
 * folder's absence can be checked directly on disk rather than through the code under test's own
 * discovery.
 */

import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CalendarDay, VaultPath, VaultSource } from 'olea-core';
import { FolderSource, misconceptionLogPath, reviewLogPath } from 'olea-core';
import { afterEach, describe, expect, it } from 'vitest';
import { runFullDelete } from '../../src/privacy/full-delete.js';
import { OLEA_LAYER_FOLDERS } from '../../src/privacy/log-discovery.js';
import type { DeleteHttpRequestFn } from '../../src/privacy/types.js';
import { FakeDataHost, MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-08-25';
const DEVICE_ID = 'device-1';
const noServer: DeleteHttpRequestFn = async () => ({ status: 200 });

/** Everything a delete must leave byte-identical, including two look-alike `.olea` siblings. */
const HER_SIDE: Readonly<Record<VaultPath, string>> = {
  '01 Courses/SYN101/Lecture 1.md': '---\ntopic: SynthTopic\n---\n\nWhat is X?::X is Y.\n',
  '05 Zettelkasten/Synthetic concept.md': '# Synthetic concept\n\nHer own words, untouched.\r\n',
  'Olea exports/olea-export-2026-08-24T09-00-00-000Z.json': '{"version":1}\n',
  '.obsidian/app.json': '{"host":"settings"}\n',
  '.olea-harness/run.json': '{"lookalike":"sibling"}\n',
  '.oleander/notes.md': '# not Olea\n',
};

/** One file in every non-log registered folder, plus the two event logs, plus an unindexed draft. */
function oleaLayerFixture(): Record<VaultPath, string> {
  const files: Record<VaultPath, string> = {};
  for (const { folder, role } of OLEA_LAYER_FOLDERS) {
    if (role === 'log') continue;
    files[`${folder}/synthetic-record-1.json`] = `${JSON.stringify({ synthetic: folder })}\n`;
  }
  files[reviewLogPath(TODAY, DEVICE_ID)] =
    `${JSON.stringify({ schemaVersion: 3, kind: 'review', eventId: 'ev-1', timestamp: '2026-08-25T10:00:00-04:00', instrumentId: 'qa:synth-concept:1', instrumentType: 'qa', rating: 'good', wasUnsure: false, durationMs: 1200, selectionContext: { dueState: 'due', examProximity: null, yieldRank: null, masteryAtTime: 'sprout', instrumentTypesOffered: ['qa'], planVersion: null }, conceptIds: ['synth-concept'] })}\n`;
  files[misconceptionLogPath(TODAY, DEVICE_ID)] =
    `${JSON.stringify({ schemaVersion: 1, kind: 'observed', eventId: 'mc-1', timestamp: '2026-08-25T10:05:00-04:00', originInstrumentId: 'qa:synth-concept:1', originReviewEventId: 'ev-1', misconceptionId: 'misc-1', conceptId: 'synth-concept', confusedWithConceptId: null, statement: 'A synthetic misconception statement.', correction: 'A synthetic correction.', citation: { path: '01 Courses/SYN101/Lecture 1.md', blockIndex: 0 } })}\n`;
  files['.olea/drafts/index.json'] = '{"version":1,"entries":[]}\n';
  files['.olea/drafts/orphan-draft.json'] = '{"orphan":true}\n';
  return files;
}

const tempRoots: string[] = [];
afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function realFolderVault(files: Readonly<Record<VaultPath, string>>): Promise<{
  vault: FolderSource;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'olea-folder-cleanup-'));
  tempRoots.push(root);
  const vault = new FolderSource(root);
  for (const [path, content] of Object.entries(files)) await vault.write(path, content);
  return { vault, root };
}

async function fullDelete(vault: Parameters<typeof runFullDelete>[0]['vault']) {
  return runFullDelete({
    dataHost: new FakeDataHost(),
    vault,
    deviceId: DEVICE_ID,
    today: TODAY,
    probeDays: 30,
    workerConfig: { baseUrl: '', token: '' },
    httpRequest: noServer,
  });
}

describe('runFullDelete: emptied .olea/ folders (ol-egov.141.8.9)', () => {
  it('leaves no folder anywhere under .olea/ on a real disk, and .olea/ itself is gone', async () => {
    const { vault, root } = await realFolderVault({ ...oleaLayerFixture(), ...HER_SIDE });

    const result = await fullDelete(vault);

    expect(result.remainingOleaPaths).toEqual([]);
    expect(result.unremovableOleaFolders).toEqual([]);
    await expect(readdir(root)).resolves.not.toContain('.olea');
    for (const [path, content] of Object.entries(HER_SIDE)) {
      expect(await vault.read(path), path).toBe(content);
    }
  });

  it('refuses a folder a file-based discovery cannot see is non-empty, reports it, never throws, and still finishes', async () => {
    const { vault, root } = await realFolderVault(oleaLayerFixture());
    // An empty subfolder with no file inside it at all: invisible to any file-listing discovery,
    // so nothing ever deletes it, and it is still there when the cleanup tries its parent.
    await mkdir(join(root, '.olea', 'concepts', 'legacy-subfolder'), { recursive: true });

    const outcome = await fullDelete(vault);

    expect(outcome.unremovableOleaFolders).toContain('.olea/concepts');
    expect(outcome.unremovableOleaFolders).toContain('.olea');
    await expect(readdir(join(root, '.olea', 'concepts'))).resolves.toEqual(['legacy-subfolder']);
  });

  it('a host with no removeEmptyFolder primitive attempts nothing and reports nothing as unremovable', async () => {
    const vault: VaultSource = new MemoryVaultSource(oleaLayerFixture());
    expect(vault.removeEmptyFolder).toBeUndefined();

    const result = await fullDelete(vault);

    expect(result.removedOleaFolders).toEqual([]);
    expect(result.unremovableOleaFolders).toEqual([]);
    expect(result.remainingOleaPaths).toEqual([]);
  });
});
