/**
 * `[D-334]` (David, 2026-09-25, `ol-v7r5.80`): `createLocalGroveProvider`
 * reads `olea-core#enumerateVaultInstruments`'s `invalidMcqBlocks`,
 * `invalidCardBlocks` and `invalidClozeBlocks` and surfaces every one of
 * them as a `GroveWithheldItem` — before this bead, all three lists existed
 * in `olea-core` (`ol-v7r5.72`, `ol-v7r5.90`) with no production caller in
 * `packages/plugin` (both close notes name `ol-v7r5.80` as the gap), so a
 * structurally broken block vanished from what she sees, the exact C7.10
 * "never silently serve nothing" defect `ol-v7r5.72` first found.
 *
 * A distinct file from `invalid-instruments.spec.ts` in this same directory
 * on purpose: that suite is `[D-338]`'s mastery-retraction fix (suspension
 * vs. a real `rejected` verdict) and shares this bead's naming only by
 * accident of an earlier round's file-naming convention — it asserts
 * nothing about `invalidMcqBlocks`/`invalidCardBlocks`/`invalidClozeBlocks`
 * and this bead does not touch it.
 *
 * Every course code, concept name and note path below is invented (INV-3).
 */
import { enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import type { GroveViewState, GroveWithheldItem } from '../../src/grove/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-09-01T09:00:00Z');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

/**
 * One note carrying a valid Q&A card (so the vault is not otherwise empty)
 * plus three deliberately broken blocks — an MCQ below its distractor
 * floor (M2), a Q&A card whose separator matched but whose back trimmed
 * empty (M2), and a cloze delimiter that opens and never closes (M4's cloze
 * mirror) — the exact fixture shapes `packages/core/src/session/
 * enumerate.spec.ts` already uses for each list individually.
 */
function fixtureVaultWithWithheldBlocks() {
  return memoryVault({
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
      'A stray separator::', // declares a single-line card, empty back (M2)
      '',
      '```olea-mcq',
      'stem: Too few options?',
      'answer: yes',
      'distractor: only-one',
      '```',
      '',
      'the ==first term is never closed',
      '',
    ].join('\n'),
  });
}

async function loadState(vault: ReturnType<typeof fixtureVaultWithWithheldBlocks>) {
  const provider = createLocalGroveProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeDataHost(),
    now: () => NOW,
  });
  return provider.load();
}

function withheldItems(state: GroveViewState): readonly GroveWithheldItem[] {
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  return state.withheldInstruments ?? [];
}

describe('createLocalGroveProvider — [D-334]: withheld MCQ, Q&A and cloze blocks reach the view', () => {
  it('the core-side enumeration already collects all three lists (sanity check on the fixture, not this bead)', async () => {
    const found = await enumerateVaultInstruments(fixtureVaultWithWithheldBlocks());
    expect(found.invalidMcqBlocks).toHaveLength(1);
    expect(found.invalidCardBlocks).toHaveLength(1);
    expect(found.invalidClozeBlocks).toHaveLength(1);
  });

  it('merges all three withheld lists onto GroveViewState, each naming its note', async () => {
    const state = await loadState(fixtureVaultWithWithheldBlocks());
    const items = withheldItems(state);
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.notePath).toBe('Notes/one.md');
    expect(items.map((i) => i.kind).sort()).toEqual(['cloze', 'mcq', 'qa']);
  });

  it('names each kind by its real reason, read straight off the enumeration', async () => {
    const items = withheldItems(await loadState(fixtureVaultWithWithheldBlocks()));
    const mcq = items.find((i) => i.kind === 'mcq');
    const qa = items.find((i) => i.kind === 'qa');
    const cloze = items.find((i) => i.kind === 'cloze');
    expect(mcq?.reason).toBe('insufficient-distractors');
    expect(qa?.reason).toBe('missing-back');
    expect(cloze?.reason).toBe('unterminated-delimiter');
  });

  it('a vault with no broken block reads an empty list, not an absent one', async () => {
    const vault = memoryVault({
      'Notes/clean.md': [
        '---',
        'topic: [Concept A]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
    });
    const items = withheldItems(await loadState(vault));
    expect(items).toEqual([]);
  });

  it('a withheld block never keeps the valid card in the same note from still reading as a real candidate', async () => {
    const found = await enumerateVaultInstruments(fixtureVaultWithWithheldBlocks());
    expect(found.records.map((r) => r.instrumentType)).toContain('qa');
  });
});
