/**
 * `listFolder` (`ol-egov.141.89.10.52`) — routing, and every `.olea/` store reader that goes
 * through it, over a host whose `list()` hides dot-prefixed paths the way `ObsidianSource.list()`
 * does (it is built on Obsidian's `vault.getFiles()`). The concept-key half of this bug has its own
 * regression file, `../concept/key-store.hidden-dot-host.spec.ts`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendEdgeDisposition,
  EDGE_DISPOSITION_FOLDER,
  listEdgeDispositionLogs,
} from '../concept/disposition.js';
import type { PaperGeneratedItem } from '../oracle/paper-items.js';
import {
  createPaper,
  listPaperRecords,
  type PaperCompositionAccount,
  recordPaperResponse,
} from '../oracle/paper-store.js';
import {
  listOutcomeConceptNearMatchRecords,
  proposeOutcomeConceptNearMatch,
} from '../outcome/near-match.js';
import { listOutcomeRecords, resolveOutcome } from '../outcome/store.js';
import { readReviewLogHistory } from '../session/history.js';
import { FolderSource } from './folder-source.js';
import { hasListUnder, isDotFolder, listFolder } from './list-folder.js';
import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from './types.js';

/** `list()` hides dot-prefixed paths as `ObsidianSource.list()` does; `listUnder()` walks them. */
class HiddenDotListSource implements VaultSource {
  constructor(private readonly inner: FolderSource) {}

  async list(options?: ListOptions): Promise<readonly VaultPath[]> {
    return (await this.inner.list(options)).filter((path) => !isDotFolder(path));
  }

  listUnder(
    dotPath: VaultPath,
    options?: { readonly extensions?: readonly string[] },
  ): Promise<readonly VaultPath[]> {
    return this.inner.listUnder(dotPath, options);
  }

  read(path: VaultPath): Promise<string> {
    return this.inner.read(path);
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.inner.readBinary(path);
  }

  write(path: VaultPath, content: string): Promise<void> {
    return this.inner.write(path, content);
  }

  exists(path: VaultPath): Promise<boolean> {
    return this.inner.exists(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

/** Records which method answered, so routing can be asserted directly. */
function recordingSource(options: { readonly withListUnder: boolean }): {
  readonly source: VaultSource;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const base: VaultSource = {
    list: async (opts?: ListOptions) => {
      calls.push(`list:${JSON.stringify(opts ?? {})}`);
      return ['from-list'];
    },
    read: async () => '',
    readBinary: async () => new Uint8Array(),
    write: async () => {},
    exists: async () => false,
    watch: () => () => {},
  };
  if (!options.withListUnder) return { source: base, calls };
  const withListUnder = Object.assign(base, {
    listUnder: async (dotPath: VaultPath, opts?: { readonly extensions?: readonly string[] }) => {
      calls.push(`listUnder:${dotPath}:${JSON.stringify(opts ?? {})}`);
      return ['from-listUnder'];
    },
  });
  return { source: withListUnder, calls };
}

describe('listFolder routing (ol-egov.141.89.10.52)', () => {
  it('a dot folder on a source with listUnder goes through listUnder, never list', async () => {
    const { source, calls } = recordingSource({ withListUnder: true });
    expect(hasListUnder(source)).toBe(true);
    expect(await listFolder(source, '.olea/concepts', { extensions: ['json'] })).toEqual([
      'from-listUnder',
    ]);
    expect(calls).toEqual(['listUnder:.olea/concepts:{"extensions":["json"]}']);
  });

  it('a dot folder on a source without listUnder falls back to list({ under })', async () => {
    const { source, calls } = recordingSource({ withListUnder: false });
    expect(hasListUnder(source)).toBe(false);
    expect(await listFolder(source, '.olea/concepts', { extensions: ['json'] })).toEqual([
      'from-list',
    ]);
    expect(calls).toEqual(['list:{"under":".olea/concepts","extensions":["json"]}']);
  });

  it('an ordinary folder always goes through list, even when listUnder exists (it refuses one)', async () => {
    const { source, calls } = recordingSource({ withListUnder: true });
    expect(await listFolder(source, 'harness/reviews')).toEqual(['from-list']);
    expect(calls).toEqual(['list:{"under":"harness/reviews"}']);
  });

  it('a listing error propagates; callers that tolerate one keep their own catch', async () => {
    const failing: VaultSource = {
      ...recordingSource({ withListUnder: false }).source,
      list: async () => {
        throw new Error('host refused');
      },
    };
    await expect(listFolder(failing, '.olea/reviews')).rejects.toThrow('host refused');
  });

  it('isDotFolder reads only the first segment', () => {
    expect(isDotFolder('.olea/concepts')).toBe(true);
    expect(isDotFolder('.olea')).toBe(true);
    expect(isDotFolder('01 Courses/.hidden')).toBe(false);
    expect(isDotFolder('harness/reviews')).toBe(false);
  });
});

const ACCOUNT: PaperCompositionAccount = {
  formatVersion: 'paper-blueprint-v1',
  course: 'COURSEA',
  asOf: '2026-09-16',
  alpha: 0.5,
  formatClass: 'recall-style',
  intendedDemand: 'recall-a-fact',
  steering: {},
  structureSummary: null,
  eligibleCount: 1,
  unbuiltDemand: null,
  partial: false,
};

const ITEM: PaperGeneratedItem = {
  slotId: 'slot-0',
  conceptKey: 'slot-0',
  conceptName: 'slot-0',
  taskId: 'quiz.generate.v1',
  promptVersion: 'v1',
  intendedDemand: 'recall-a-fact',
  groundingTier: 'T2',
  groundingLabel: 'covered-by-her-material',
  heldSourceKind: 'notes',
  heldSourceId: 's1',
  response: { stem: 'x' },
};

describe('every .olea store reader sees its folder on a host whose list() hides it', () => {
  let root: string;
  let source: HiddenDotListSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-list-folder-'));
    source = new HiddenDotListSource(new FolderSource(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('the model hides every .olea folder from list()', async () => {
    await appendEdgeDisposition(source, 'prop-1', 'declined');
    expect(await source.list({ under: EDGE_DISPOSITION_FOLDER })).toEqual([]);
  });

  it('outcome store: resolving the same source twice reuses the first record', async () => {
    const input = {
      courses: ['COURSEA'],
      source: { path: '01 Courses/COURSEA/Objectives.md', blockIndex: 2 },
      label: 'Explain basalt weathering',
      provenance: { promptVersion: 'v1', modelVersion: 'm1' },
    };
    const first = await resolveOutcome(source, input);
    const second = await resolveOutcome(source, input);
    expect(second.id).toBe(first.id);
    expect(await listOutcomeRecords(source)).toHaveLength(1);
  });

  it('relation dispositions: a written log is listed back', async () => {
    await appendEdgeDisposition(source, 'prop-1', 'declined');
    const logs = await listEdgeDispositionLogs(source);
    expect(logs.map(({ log }) => log.propositionKey)).toEqual(['prop-1']);
  });

  it('outcome near-match: a proposed record is listed back', async () => {
    await proposeOutcomeConceptNearMatch(source, 'outcome-1', 'concept-key1:a');
    expect(await listOutcomeConceptNearMatchRecords(source)).toHaveLength(1);
  });

  it('paper store: a response finds the paper it belongs to', async () => {
    const paper = await createPaper(source, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [ITEM],
      emptySlots: [],
    });
    expect(await listPaperRecords(source)).toHaveLength(1);
    const answered = await recordPaperResponse(source, paper.id, 'slot-0', 'my answer');
    expect(answered.responses).toHaveLength(1);
  });

  it('review-log history: another device file is found with no exact-path hint', async () => {
    const other = '.olea/reviews/2026-09-20.other-device.jsonl';
    await mkdir(join(root, '.olea', 'reviews'), { recursive: true });
    await writeFile(join(root, ...other.split('/')), '{}\n', 'utf8');
    const history = await readReviewLogHistory(source);
    expect(history.files).toEqual([other]);
  });
});
