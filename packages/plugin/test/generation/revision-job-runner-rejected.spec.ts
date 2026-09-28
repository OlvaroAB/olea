/**
 * `ol-egov.141.89.2.14` — a source edit never drafts a successor to an instrument she rejected.
 *
 * C5.3 as amended by `[D-396]`: "A rejection follows the item once it is fixed: no edit or repair
 * silently undoes it, and only her own deliberate restore returns it to circulation." A successor
 * is the rejected item returned to circulation through a change path, which the cross-moment
 * recovery bar (`[D-339]`) counts as a failure. The rejection here is written by the production
 * writer for an instrument in her vault — `registry/provider.ts`'s `rejectWithheldItem` — on an
 * item withheld by a structural check (an embed that does not resolve), which she then fixes.
 *
 * Every fixture string is invented (INV-3).
 */

import { enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { runInstrumentRevisionJob } from '../../src/generation/revision-job-runner.js';
import type { ObsidianDataHost } from '../../src/registry/overrides-store.js';
import { createLocalRegistryProvider } from '../../src/registry/provider.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const NOTE_PATH = 'Courses/GEO101/Week 3.md';

function note(asset: string): string {
  return [
    '---',
    'topic: [Sediment layering]',
    'course: GEO101',
    '---',
    '',
    'Front::Back',
    '',
    '```olea-mcq',
    `stem: Which figure shows the storm record? ![[${asset}]]`,
    'answer: Hummocky stratification',
    'distractor: a',
    'distractor: b',
    '```',
    '',
  ].join('\n');
}

class FakeDataHost implements ObsidianDataHost {
  private blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function registry(vault: ReturnType<typeof memoryVault>, now: Date) {
  return createLocalRegistryProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeDataHost(),
    now: () => now,
    editPort: {
      async edit() {
        /* unused */
      },
    },
  });
}

async function withheldMcq(vault: ReturnType<typeof memoryVault>, now: Date) {
  const state = await registry(vault, now).load();
  if (state.kind !== 'model') throw new Error(`expected a registry model, got ${state.kind}`);
  const item = state.withheldInstruments.find((candidate) => candidate.kind === 'mcq');
  if (item?.identity === undefined) throw new Error('expected a withheld MCQ with an identity');
  return item;
}

/** Rejects the withheld MCQ from the registry, optionally restores it, then fixes its embed. */
async function rejectedThenFixed(restore: boolean) {
  const vault = memoryVault({ [NOTE_PATH]: note('gone.png'), 'storm.png': 'figure' });
  const item = await withheldMcq(vault, NOW);
  await registry(vault, NOW).rejectWithheldItem(item);
  if (restore) {
    const later = new Date(NOW.getTime() + 60_000);
    await registry(vault, later).restoreWithheldItem(await withheldMcq(vault, later));
  }
  await vault.write(NOTE_PATH, note('storm.png'));
  const instrumentId = item.identity?.instrumentId;
  if (instrumentId === undefined) throw new Error('unreachable: checked above');
  const enumeration = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  expect(enumeration.records.map((record) => record.instrumentId)).toContain(instrumentId);
  return { vault, instrumentId };
}

const grounded: DraftQuizCardsResult = {
  status: 'drafted',
  request: { courseCode: 'GEO101', conceptName: 'Sediment layering', sourceChunks: ['chunk'] },
  response: {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: {
      questions: [
        {
          stem: 'Which structure preserves it?',
          correctAnswer: 'A',
          distractors: ['B', 'C', 'D'],
          feedback: 'because',
        },
      ],
    },
  },
};

async function runRevision(vault: ReturnType<typeof memoryVault>, predecessorInstrumentId: string) {
  const cache = createVaultDraftCacheStore(vault);
  const draftForConcept = vi.fn(async () => grounded);
  const outcome = await runInstrumentRevisionJob(
    { vault, cache, draftDeps: () => ({}) as never, draftForConcept },
    { kind: 'instrument-revision', predecessorInstrumentId, newPassageText: 'the edited passage' },
  );
  return { outcome, draftForConcept, pending: await cache.listPending() };
}

describe('ol-egov.141.89.2.14 — successor drafting honours her rejection', () => {
  it('drafts no successor for a predecessor that stands rejected, makes no drafting call, and ends the job', async () => {
    const { vault, instrumentId } = await rejectedThenFixed(false);
    const { outcome, draftForConcept, pending } = await runRevision(vault, instrumentId);
    expect(outcome).toEqual({ ok: true });
    expect(draftForConcept).not.toHaveBeenCalled();
    expect(pending).toHaveLength(0);
  });

  it('control: after her deliberate restore, the same edit drafts a successor as usual', async () => {
    const { vault, instrumentId } = await rejectedThenFixed(true);
    const { outcome, draftForConcept, pending } = await runRevision(vault, instrumentId);
    expect(outcome).toEqual({ ok: true });
    expect(draftForConcept).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.predecessorInstrumentId).toBe(instrumentId);
  });
});
