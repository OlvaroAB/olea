/**
 * `[D-473]` (`ol-egov.141.89.5.52`): a build that meets a withholding reason it does not recognise
 * keeps the hold, never lifts it. The store's reader keeps the string; these pin the two writers in
 * the revision pass that used to lift or erase it. Every fixture string is INVENTED.
 */
import {
  citationStorePath,
  digestPassage,
  type EnqueueInput,
  type ListOptions,
  type RevisionJudgePort,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type CitationAnchorRecord,
  ObsidianCitationHashStore,
  type PendingReason,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';

class MemoryVaultSource implements VaultSource {
  readonly files = new Map<string, string>();
  constructor(initial: Readonly<Record<string, string>>) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
  }
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...this.files.keys()]
      .filter(
        (p) =>
          extensions === undefined ||
          extensions.includes(p.slice(p.lastIndexOf('.') + 1).toLowerCase()),
      )
      .sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  async readBinary(): Promise<Uint8Array> {
    throw new Error('not needed');
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

const HOME_PATH = 'Zettel/Sample topic (Olea).md';
const SOURCE_PATH = 'Zettel/Sample topic.md';
const MCQ_ID = 'q1';
const PASSAGE = 'Sample passage one states an invented claim.\nIt has a second line.';
const FUTURE_REASON = 'passage-future-reason';

const sourceNote = (passage: string): string =>
  `# Sample topic\n\nAn opening line.\n\n${passage}\n\n`;

function homeNote(): string {
  return [
    '---',
    'topic: [Sample topic]',
    'course: SAMPLE101',
    '---',
    '',
    '```olea-mcq',
    `id: ${MCQ_ID}`,
    'stem: Which invented thing?',
    'answer: Alpha',
    'distractor: Beta',
    'distractor: Gamma',
    'distractor: Delta',
    'distractor: Epsilon',
    '```',
    '',
  ].join('\n');
}

function sidecar(passageDigest: string | undefined): string {
  return `${JSON.stringify({
    instrumentId: MCQ_ID,
    sourcePath: SOURCE_PATH,
    page: 1,
    ...(passageDigest !== undefined ? { passageDigest } : {}),
    schemaVersion: 2,
  })}\n`;
}

async function setup(passageGrain: boolean) {
  const vault = new MemoryVaultSource({
    [HOME_PATH]: homeNote(),
    [SOURCE_PATH]: sourceNote(PASSAGE),
    [citationStorePath(MCQ_ID)]: sidecar(passageGrain ? await digestPassage(PASSAGE) : undefined),
  });
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  const judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } = {
    judge: vi.fn(async () => ({ material: true, reason: 'scripted' })),
  };
  const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 } });
  const actions = () => ({
    enqueue: vi.fn(async (_input: EnqueueInput) => undefined),
    suspend: vi.fn(async () => undefined),
    onRelocationProposed: vi.fn(),
  });
  await trigger.tick(vault, actions());
  return { vault, store, trigger, actions, judge };
}

async function anchorOf(store: ObsidianCitationHashStore): Promise<CitationAnchorRecord> {
  const record = (await store.loadAll()).get(MCQ_ID);
  if (record === undefined) throw new Error('no anchor recorded');
  return record;
}

async function withhold(store: ObsidianCitationHashStore, reason: string): Promise<void> {
  await store.setPendingRevalidation(MCQ_ID, 'h-sample', 500, reason as PendingReason);
}

describe('an unrecognised withholding reason keeps its hold ([D-473])', () => {
  it('a passage-grain anchor found unchanged keeps an unrecognised reason', async () => {
    const { vault, store, trigger, actions, judge } = await setup(true);
    await withhold(store, FUTURE_REASON);
    await trigger.tick(vault, actions());
    const pending = (await anchorOf(store)).pendingRevalidation;
    expect(pending?.reason).toBe(FUTURE_REASON);
    expect(pending?.sinceContentHash).toBe('h-sample');
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('a known reason on the same anchor is still cleared when the passage stands unchanged', async () => {
    const { vault, store, trigger, actions } = await setup(true);
    await withhold(store, 'passage-missing');
    await trigger.tick(vault, actions());
    expect((await anchorOf(store)).pendingRevalidation).toBeUndefined();
  });

  it('an advance write on an anchor with no passage context carries an unrecognised reason unchanged', async () => {
    const { vault, store, trigger, actions } = await setup(false);
    await withhold(store, FUTURE_REASON);
    // A formatting-only edit: the free exit that rewrites the anchor.
    await vault.write(SOURCE_PATH, sourceNote(PASSAGE).replace('one states', 'one  states'));
    await trigger.tick(vault, actions());
    const pending = (await anchorOf(store)).pendingRevalidation;
    expect(pending?.reason).toBe(FUTURE_REASON);
    expect(pending?.sinceContentHash).toBe('h-sample');
  });

  it('an advance write on a passage anchor carries an unrecognised reason through a formatting-only edit', async () => {
    const { vault, store, trigger, actions } = await setup(true);
    await withhold(store, FUTURE_REASON);
    await vault.write(SOURCE_PATH, sourceNote(PASSAGE.replace('one states', 'one  states')));
    await trigger.tick(vault, actions());
    expect((await anchorOf(store)).pendingRevalidation?.reason).toBe(FUTURE_REASON);
  });
});
