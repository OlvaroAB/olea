/**
 * `[D-378]`'s canonical lookup in the registry's two readers keyed on concept identity
 * (`ol-egov.141.89.9.56`): F8.4a's identity section (`buildSameAsIdentityProposals`) and the
 * rename/withdrawal overrides store (`ObsidianRegistryOverridesStore.load`). A same-anchor
 * duplicate's key reads as its canonical key; a pair that shares only an introducing passage stays
 * two concepts; nothing stored is rewritten.
 *
 * Every fixture string is invented (INV-3).
 */
import {
  buildConceptKeyCanonicalIndex,
  type ConceptKeyRecord,
  conceptKeyRecordPath,
  EMPTY_REGISTRY_OVERRIDES,
  type RegistryConceptEntry,
  type RegistryOverrides,
  type SameAsLinkRecord,
  type SameAsLinkStatus,
  sameAsLinkRecordPath,
  type TopicAnchor,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  ObsidianRegistryOverridesStore,
  REGISTRY_OVERRIDES_STORAGE_KEY,
} from '../../src/registry/overrides-store.js';
import {
  buildSameAsIdentityProposals,
  confirmSameAsIdentityProposal,
} from '../../src/registry/same-as-identity.js';
import { memoryVault } from '../review/memory-vault.js';

const CANONICAL = 'concept-key1:aaaa';
const DUPLICATE = 'concept-key1:bbbb';
const PASSAGE_A = 'concept-key1:eeee';
const PASSAGE_B = 'concept-key1:ffff';
const THIRD = 'concept-key1:yyyy';

const SHARED_INTRODUCING_NOTE = ['01 Courses/TESTC1/Week one.md'];

function topic(name: string, introducingPaths?: readonly string[]): TopicAnchor {
  return {
    kind: 'topic',
    course: 'TESTC1',
    name,
    aliases: [],
    ...(introducingPaths !== undefined ? { introducingPaths } : {}),
  };
}

function conceptRecord(key: string, anchor: TopicAnchor, mintedAt: string): ConceptKeyRecord {
  return { key, tier: 2, anchor, aliases: [], mintedAt, schemaVersion: 1 };
}

const CONCEPT_RECORDS: readonly ConceptKeyRecord[] = [
  conceptRecord(CANONICAL, topic('Widget theory'), '2026-09-01'),
  conceptRecord(DUPLICATE, topic('Widget theory'), '2026-09-05'),
  conceptRecord(PASSAGE_A, topic('Gadget theory', SHARED_INTRODUCING_NOTE), '2026-09-02'),
  conceptRecord(PASSAGE_B, topic('Sprocket theory', SHARED_INTRODUCING_NOTE), '2026-09-03'),
  conceptRecord(THIRD, topic('Gasket theory'), '2026-09-04'),
];

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function link(keyA: string, keyB: string, status: SameAsLinkStatus): SameAsLinkRecord {
  const [a, b] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
  return {
    keyA: a,
    keyB: b,
    status,
    reason: 'normalisation-collision',
    proposedAt: '2026-09-06T00:00:00.000Z',
    schemaVersion: 1,
  };
}

function entry(key: string, displayName: string, notePath: string): RegistryConceptEntry {
  return {
    key,
    displayName,
    originalName: displayName,
    aliases: [],
    courses: ['TESTC1'],
    tier: 2,
    pruned: false,
    instruments: [],
    explainBack: { attempted: false, attemptCount: 0 },
    sourceLocations: [{ sourcePath: notePath }],
    mastery: {
      conceptId: key,
      state: 'seed',
      evidence: {
        scoredEventCount: 0,
        scoredSuccessCount: 0,
        explainBackAttempts: 0,
        gradedExplainBackCount: 0,
        tiersPracticed: { recognition: false, recall: false, explanation: false },
        recognitionOnly: false,
        successfulScoredDays: 0,
        deepestSoloLevel: null,
        depthGateCleared: false,
        topStageQualified: false,
      },
    },
    vitality: { value: 'early', weakest: null, instrumentsRead: 0 },
    noteOffer: { eligible: false },
  };
}

/** The registry rows a load builds: one per identity, under its permanent (canonical) key. */
const ROWS: readonly RegistryConceptEntry[] = [
  entry(CANONICAL, 'Widget theory', 'Notes/widget.md'),
  entry(PASSAGE_A, 'Gadget theory', 'Notes/gadget.md'),
  entry(PASSAGE_B, 'Sprocket theory', 'Notes/sprocket.md'),
  entry(THIRD, 'Gasket theory', 'Notes/gasket.md'),
];

function vaultWith(links: readonly SameAsLinkRecord[]) {
  const files: Record<string, string> = {
    'Notes/widget.md': 'An invented paragraph introducing the widget concept.\n',
    'Notes/gadget.md': 'An invented paragraph introducing the gadget concept.\n',
    'Notes/sprocket.md': 'An invented paragraph introducing the sprocket concept.\n',
    'Notes/gasket.md': 'An invented paragraph introducing the gasket concept.\n',
  };
  for (const record of CONCEPT_RECORDS) files[conceptKeyRecordPath(record.key)] = json(record);
  for (const record of links) files[sameAsLinkRecordPath(record.keyA, record.keyB)] = json(record);
  return memoryVault(files);
}

describe('buildSameAsIdentityProposals resolves link keys through the canonical-key index ([D-378], ol-egov.141.89.9.56)', () => {
  it('shows a proposal recorded under a superseded key against the canonical row, and a shared-passage partner against its own row', async () => {
    const links = [link(DUPLICATE, THIRD, 'proposed'), link(PASSAGE_B, THIRD, 'proposed')];
    const vault = vaultWith(links);

    const proposals = await buildSameAsIdentityProposals(vault, links, ROWS);

    expect(proposals.map((p) => [p.nameA, p.nameB])).toEqual([
      ['Widget theory', 'Gasket theory'],
      ['Sprocket theory', 'Gasket theory'],
    ]);
    // The proposal carries the stored link's own keys, so accepting it confirms that record.
    expect([proposals[0]?.keyA, proposals[0]?.keyB]).toEqual([DUPLICATE, THIRD]);
    const first = proposals[0];
    if (first === undefined) throw new Error('expected a proposal');
    await confirmSameAsIdentityProposal(vault, first);
    expect(vault.contentOf(sameAsLinkRecordPath(DUPLICATE, THIRD))).toContain('"confirmed"');
  });

  it('never asks whether a same-anchor pair is one thing: it already is', async () => {
    const links = [link(CANONICAL, DUPLICATE, 'proposed')];

    expect(await buildSameAsIdentityProposals(vaultWith(links), links, ROWS)).toEqual([]);
  });

  it('a pair already decided under one key of an identity is not asked again under another', async () => {
    const links = [link(CANONICAL, THIRD, 'confirmed'), link(DUPLICATE, THIRD, 'proposed')];

    expect(await buildSameAsIdentityProposals(vaultWith(links), links, ROWS)).toEqual([]);
  });
});

class FakeDataHost {
  blob: unknown = null;
  saves = 0;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.saves += 1;
    this.blob = data;
  }
}

describe('ObsidianRegistryOverridesStore.load resolves renames and withdrawals through the canonical-key index ([D-378], ol-egov.141.89.9.56)', () => {
  const stored: RegistryOverrides = {
    ...EMPTY_REGISTRY_OVERRIDES,
    renames: {
      [DUPLICATE]: { displayName: 'Her widget name', aliases: ['Widget theory'] },
      [PASSAGE_B]: { displayName: 'Her sprocket name', aliases: ['Sprocket theory'] },
    },
    prunedConceptKeys: [DUPLICATE, PASSAGE_B].sort(),
  };

  function host(overrides: RegistryOverrides): FakeDataHost {
    const fake = new FakeDataHost();
    fake.blob = { [REGISTRY_OVERRIDES_STORAGE_KEY]: overrides, other: 'kept' };
    return fake;
  }

  it('a rename or withdrawal made under a superseded key reads under the canonical key; a shared-passage partner keeps its own', async () => {
    const fake = host(stored);
    const store = new ObsidianRegistryOverridesStore(fake);
    const canonicalKeys = buildConceptKeyCanonicalIndex(CONCEPT_RECORDS);

    const resolved = await store.load({ canonicalKeys });

    expect(resolved.renames[CANONICAL]?.displayName).toBe('Her widget name');
    expect(resolved.renames[DUPLICATE]).toBeUndefined();
    expect(resolved.renames[PASSAGE_B]?.displayName).toBe('Her sprocket name');
    expect(resolved.renames[PASSAGE_A]).toBeUndefined();
    expect(resolved.prunedConceptKeys).toEqual([CANONICAL, PASSAGE_B]);

    // Nothing stored is rewritten, and the as-stored read (the read-modify-write path) is unchanged.
    expect(fake.saves).toBe(0);
    expect(await store.load()).toEqual(stored);
  });

  it("the canonical key's own rename wins over one made under its superseded duplicate", async () => {
    const store = new ObsidianRegistryOverridesStore(
      host({
        ...stored,
        renames: {
          ...stored.renames,
          [CANONICAL]: { displayName: 'Her later widget name', aliases: ['Widget theory'] },
        },
      }),
    );

    const resolved = await store.load({
      canonicalKeys: buildConceptKeyCanonicalIndex(CONCEPT_RECORDS),
    });

    expect(resolved.renames[CANONICAL]?.displayName).toBe('Her later widget name');
  });
});
