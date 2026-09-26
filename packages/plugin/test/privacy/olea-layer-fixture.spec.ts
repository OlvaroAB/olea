/**
 * F7.4 over a vault holding every folder Olea writes (`ol-egov.141.8.7`). F7.4: "Data export and
 * full delete, including cache purge and vault artifact removal." Before this bead the export and
 * the delete reached only `.olea/reviews/` and `.olea/misconceptions/` (plus the draft cache the
 * purge already owned), so a full delete left concept key records, relation caches, same-as links,
 * outcome records, near-match proposals, citation stores and the rest in her vault.
 *
 * The fixture is built FROM the registry (`OLEA_LAYER_FOLDERS`): one file in every registered
 * folder, so a folder registered later is covered here with no edit to this file, and
 * `olea-layer-coverage.spec.ts` is what forces every writer into the registry. Around it sit the
 * things a delete must never reach: her notes, a home note beside a source (Olea's own layer under
 * `[D-179]`, but outside `.olea/` and so outside this bead; kept, see the report), her earlier
 * export, the host's own `.obsidian/`, and two siblings whose names merely START with `.olea`.
 *
 * Three host shapes, because what a host can list decides what discovery can see:
 * - `FolderSource` over a real temporary directory (its `listUnder` walks the disk);
 * - an ObsidianSource-shaped source: `list()` is blind to dot paths, `listUnder()` is the real
 *   `listUnderViaAdapter` walk, the production composition (`main.ts` hands `new ObsidianSource`);
 * - the privacy suite's `MemoryVaultSource`, whose `list()` sees every path.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CalendarDay,
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { FolderSource, listFolder, misconceptionLogPath, reviewLogPath } from 'olea-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPrivacyExportBundle,
  PRIVACY_EXPORT_BUNDLE_VERSION,
} from '../../src/privacy/export-bundle.js';
import { runFullDelete } from '../../src/privacy/full-delete.js';
import {
  isOleaLayerPath,
  OLEA_LAYER_FOLDERS,
  OLEA_LAYER_ROOT,
} from '../../src/privacy/log-discovery.js';
import type { DeleteHttpRequestFn } from '../../src/privacy/types.js';
import { type DotFolderAdapter, listUnderViaAdapter } from '../../src/vault/dot-folder-walk.js';
import { FakeDataHost, MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-08-25';
const DEVICE_ID = 'device-1';
const OTHER_DEVICE_ID = 'device-2';

function reviewLine(eventId: string): string {
  return `${JSON.stringify({
    schemaVersion: 3,
    kind: 'review',
    eventId,
    timestamp: '2026-08-25T10:00:00-04:00',
    instrumentId: 'qa:synth-concept:1',
    instrumentType: 'qa',
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      masteryAtTime: 'sprout',
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    conceptIds: ['synth-concept'],
  })}\n`;
}

const MISCONCEPTION_LINE = `${JSON.stringify({
  schemaVersion: 1,
  kind: 'observed',
  eventId: 'mc-1',
  timestamp: '2026-08-25T10:05:00-04:00',
  originInstrumentId: 'qa:synth-concept:1',
  originReviewEventId: 'ev-1',
  misconceptionId: 'misc-1',
  conceptId: 'synth-concept',
  confusedWithConceptId: null,
  statement: 'A synthetic misconception statement.',
  correction: 'A synthetic correction.',
  citation: { path: '01 Courses/SYN101/Lecture 1.md', blockIndex: 0 },
})}\n`;

/** One file in every registered folder, the two logs as real parseable lines, plus the shapes a registry cannot list. */
function oleaLayerFixture(): Record<VaultPath, string> {
  const files: Record<VaultPath, string> = {};
  for (const { folder, role } of OLEA_LAYER_FOLDERS) {
    if (role === 'log') continue;
    files[`${folder}/synthetic-record-1.json`] = `${JSON.stringify({ synthetic: folder })}\n`;
  }
  files[reviewLogPath(TODAY, DEVICE_ID)] = reviewLine('ev-1');
  files[reviewLogPath(TODAY, OTHER_DEVICE_ID)] = reviewLine('ev-2');
  files[misconceptionLogPath(TODAY, DEVICE_ID)] = MISCONCEPTION_LINE;
  // A record one level deeper than its folder: discovery walks, it does not stop at one level.
  files['.olea/content/nested/synthetic-record-2.json'] = '{"nested":true}\n';
  // A draft the draft index never named, and the index itself: the index-driven cache purge
  // cannot see the first, so only the full delete's residue sweep removes it.
  files['.olea/drafts/index.json'] = '{"version":1,"entries":[]}\n';
  files['.olea/drafts/orphan-draft.json'] = '{"orphan":true}\n';
  // A folder no source file in this build names — another device on a newer build, say. It is
  // still Olea's layer (C6.2: the directory is Olea's), so it is exported and deleted too.
  files['.olea/unregistered-future-store/synthetic.json'] = '{"future":true}\n';
  return files;
}

/** Everything a delete must leave byte-identical. */
const HER_SIDE: Readonly<Record<VaultPath, string>> = {
  '01 Courses/SYN101/Lecture 1.md': '---\ntopic: SynthTopic\n---\n\nWhat is X?::X is Y.\n',
  '05 Zettelkasten/Synthetic concept.md': '# Synthetic concept\n\nHer own words, untouched.\r\n',
  '01 Courses/SYN101/Slides 2.md': '---\nolea-home-note: true\ntopic:\n  - SynthTopic\n---\n',
  'Olea exports/olea-export-2026-08-24T09-00-00-000Z.json': '{"version":1}\n',
  '.obsidian/app.json': '{"host":"settings"}\n',
  '.olea-harness/run.json': '{"lookalike":"sibling"}\n',
  '.oleander/notes.md': '# not Olea\n',
};

function fullFixture(): Record<VaultPath, string> {
  return { ...oleaLayerFixture(), ...HER_SIDE };
}

function isDotPath(path: VaultPath): boolean {
  return path.split('/')[0]?.startsWith('.') ?? false;
}

/** `ObsidianSource`'s listing behaviour over a flat map (see this file's module doc). */
class ObsidianShapedSource implements VaultSource {
  readonly files = new Map<VaultPath, string>();

  constructor(initial: Readonly<Record<VaultPath, string>>) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const under = options.under;
    return [...this.files.keys()]
      .filter((path) => !isDotPath(path))
      .filter((path) => under === undefined || path.startsWith(`${under}/`))
      .sort();
  }

  listUnder(
    dotPath: VaultPath,
    options: { readonly extensions?: readonly string[] } = {},
  ): Promise<readonly VaultPath[]> {
    const all = () => [...this.files.keys()];
    const adapter: DotFolderAdapter = {
      exists: async (path) =>
        this.files.has(path) || all().some((candidate) => candidate.startsWith(`${path}/`)),
      list: async (path) => {
        const prefix = `${path.replace(/\/+$/, '')}/`;
        const files = new Set<string>();
        const folders = new Set<string>();
        for (const candidate of all()) {
          if (!candidate.startsWith(prefix)) continue;
          const rest = candidate.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash === -1) files.add(prefix + rest);
          else folders.add(prefix + rest.slice(0, slash));
        }
        return { files: [...files].sort(), folders: [...folders].sort() };
      },
    };
    return listUnderViaAdapter(adapter, dotPath, options);
  }

  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  }

  async readBinary(): Promise<Uint8Array> {
    throw new Error('not needed here');
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  async delete(path: VaultPath): Promise<void> {
    this.files.delete(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

interface Host {
  readonly name: string;
  make(files: Readonly<Record<VaultPath, string>>): Promise<VaultSource>;
}

const tempRoots: string[] = [];
afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

const HOSTS: readonly Host[] = [
  {
    name: 'FolderSource over a real directory',
    async make(files) {
      const root = await mkdtemp(join(tmpdir(), 'olea-privacy-layer-'));
      tempRoots.push(root);
      const vault = new FolderSource(root);
      for (const [path, content] of Object.entries(files)) await vault.write(path, content);
      return vault;
    },
  },
  {
    name: 'an ObsidianSource-shaped host (list() blind to dot paths)',
    async make(files) {
      return new ObsidianShapedSource(files);
    },
  },
  {
    name: 'MemoryVaultSource (list() sees every path)',
    async make(files) {
      return new MemoryVaultSource(files);
    },
  },
];

const noServer: DeleteHttpRequestFn = async () => ({ status: 200 });

async function fullDelete(vault: VaultSource) {
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

/** Every file under `.olea/` as the host itself lists it (independent of the code under test's discovery). */
async function oleaPathsOnDisk(vault: VaultSource): Promise<VaultPath[]> {
  return [...(await listFolder(vault, OLEA_LAYER_ROOT))]
    .filter((path) => path.startsWith('.olea/'))
    .sort();
}

const OLEA_FIXTURE_PATHS = Object.keys(oleaLayerFixture()).sort();
const LOG_FOLDERS = OLEA_LAYER_FOLDERS.filter((entry) => entry.role === 'log').map((e) => e.folder);
const isLogPath = (path: VaultPath) => LOG_FOLDERS.some((folder) => path.startsWith(`${folder}/`));

describe('F7.4 over a vault holding every folder Olea writes (ol-egov.141.8.7)', () => {
  for (const host of HOSTS) {
    describe(host.name, () => {
      it('before: every registered folder holds a file the host can see', async () => {
        const vault = await host.make(fullFixture());
        for (const { folder } of OLEA_LAYER_FOLDERS) {
          expect((await listFolder(vault, folder)).length, folder).toBeGreaterThan(0);
        }
        for (const path of Object.keys(fullFixture()))
          expect(await vault.exists(path), path).toBe(true);
      });

      it('a full delete removes every file under .olea/, and everything else is byte-identical after', async () => {
        const vault = await host.make(fullFixture());

        const result = await fullDelete(vault);

        for (const path of OLEA_FIXTURE_PATHS) expect(await vault.exists(path), path).toBe(false);
        for (const { folder } of OLEA_LAYER_FOLDERS) {
          expect(await listFolder(vault, folder), folder).toEqual([]);
        }
        expect(await listFolder(vault, OLEA_LAYER_ROOT)).toEqual([]);
        expect(result.remainingOleaPaths).toEqual([]);
        for (const [path, content] of Object.entries(HER_SIDE)) {
          expect(await vault.read(path), path).toBe(content);
        }
      });

      it('the full delete reports every path it removed, and every one is inside .olea/', async () => {
        const vault = await host.make(fullFixture());

        const result = await fullDelete(vault);

        const reported = [
          ...result.cache.deletedDraftPaths,
          ...result.vaultArtifacts.deletedReviewLogPaths,
          ...result.vaultArtifacts.deletedMisconceptionLogPaths,
          ...result.vaultArtifacts.deletedRecordPaths,
          ...result.residualOleaPaths,
        ].sort();
        expect(reported).toEqual(OLEA_FIXTURE_PATHS);
        for (const path of reported) expect(isOleaLayerPath(path), path).toBe(true);
        // The draft the index never named is the purge's blind spot; the residue sweep takes it.
        expect(result.residualOleaPaths).toContain('.olea/drafts/orphan-draft.json');
      });

      it('the export carries every file under .olea/ and nothing outside it', async () => {
        const fixture = fullFixture();
        const vault = await host.make(fixture);

        const bundle = await buildPrivacyExportBundle({
          vault,
          deviceId: DEVICE_ID,
          today: TODAY,
          probeDays: 30,
          now: () => '2026-08-25T12:00:00.000Z',
        });

        expect(bundle.version).toBe(PRIVACY_EXPORT_BUNDLE_VERSION);
        // The two event logs travel parsed and merged (`reviewLog`, `misconceptionLog`); every
        // other file under .olea/ travels as the exact text on disk.
        expect(bundle.reviewLog.map((entry) => entry.eventId).sort()).toEqual(['ev-1', 'ev-2']);
        expect(bundle.misconceptionLog.map((event) => event.eventId)).toEqual(['mc-1']);
        expect(bundle.instruments.length).toBeGreaterThan(0);
        // [D-357] stamping mints a key record for the fixture note's concept, which has none yet;
        // the export reads .olea/ after that, so the new record travels with the instrument.
        const minted = (await oleaPathsOnDisk(vault)).filter((path) => !(path in fixture));
        expect(minted.length).toBeGreaterThan(0);
        for (const path of minted) expect(path.startsWith('.olea/concepts/'), path).toBe(true);
        expect(bundle.oleaFiles.map((file) => file.path)).toEqual(
          [...OLEA_FIXTURE_PATHS.filter((path) => !isLogPath(path)), ...minted].sort(),
        );
        for (const file of bundle.oleaFiles) {
          expect(isOleaLayerPath(file.path), file.path).toBe(true);
          expect(file.content, file.path).toBe(await vault.read(file.path));
          if (file.path in fixture) expect(file.content, file.path).toBe(fixture[file.path]);
        }
        expect(bundle.unreadableOleaPaths).toEqual([]);
        for (const { folder, role } of OLEA_LAYER_FOLDERS) {
          if (role === 'log') continue;
          expect(
            bundle.oleaFiles.some((file) => file.path.startsWith(`${folder}/`)),
            folder,
          ).toBe(true);
        }
      });

      it('building the export changes no existing file, and adds only [D-357] concept key records', async () => {
        const fixture = fullFixture();
        const vault = await host.make(fixture);
        const outsideLayer = async () =>
          (await vault.list()).filter((path) => !path.startsWith('.olea/'));
        const outsideBefore = await outsideLayer();

        await buildPrivacyExportBundle({ vault, deviceId: DEVICE_ID, today: TODAY, probeDays: 30 });

        for (const [path, content] of Object.entries(fixture)) {
          expect(await vault.read(path), path).toBe(content);
        }
        expect(await outsideLayer()).toEqual(outsideBefore);
        for (const path of await oleaPathsOnDisk(vault)) {
          if (!(path in fixture)) expect(path.startsWith('.olea/concepts/'), path).toBe(true);
        }
      });

      it('a full delete after an export also removes the key records the export minted', async () => {
        const vault = await host.make(fullFixture());
        await buildPrivacyExportBundle({ vault, deviceId: DEVICE_ID, today: TODAY, probeDays: 30 });
        expect((await oleaPathsOnDisk(vault)).length).toBeGreaterThan(OLEA_FIXTURE_PATHS.length);

        const result = await fullDelete(vault);

        expect(await oleaPathsOnDisk(vault)).toEqual([]);
        expect(result.remainingOleaPaths).toEqual([]);
      });
    });
  }
});
