import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bindConceptKeyToNote,
  type ConceptKeyRecord,
  listConceptKeyRecords,
  resolveConceptKey,
} from '../concept/key-store.js';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { listOutcomeConceptNearMatchRecords } from './near-match.js';
import {
  classifyOutcomeConceptMatch,
  conceptRegistryEntryFromRecord,
  type OutcomeConceptRegistryEntry,
  reconcileOutcomeConcepts,
} from './reconcile.js';
import { listOutcomeRecords, resolveOutcome, retireOutcome } from './store.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — "F8.6/F4.1 [OUT-3] — Outcome-to-concept
// containment: exact and alias attach, containment proposes" and "[OUT-4] Outcome-to-concept near
// match: its own proposal record, never a same-as link ([D-256])", tagged
// `@auto:core/outcome/reconcile.spec`.

const PROVENANCE = { promptVersion: 'v1', modelVersion: 'model-a' };

function source(path: string, blockIndex = 0) {
  return { path: path as VaultPath, blockIndex };
}

/** The one concept record a test just minted — throws if the listing came back empty. */
async function onlyConceptRecord(vault: VaultSource): Promise<ConceptKeyRecord> {
  const [hit] = await listConceptKeyRecords(vault);
  if (hit === undefined) throw new Error('expected exactly one concept key record');
  return hit.record;
}

describe('classifyOutcomeConceptMatch — pure, no I/O', () => {
  it('exact-name: a normalised whole-string match against the concept name', () => {
    const concept: OutcomeConceptRegistryEntry = {
      key: 'concept-key1:a',
      name: 'Cell Biology',
      aliases: [],
    };
    expect(classifyOutcomeConceptMatch('cell biology', concept)).toBe('exact-name');
  });

  it('accepted-alias: a normalised whole-string match against an alias, never checked against name first', () => {
    const concept: OutcomeConceptRegistryEntry = {
      key: 'concept-key1:a',
      name: 'Cell Biology',
      aliases: ['Cellular Biology'],
    };
    expect(classifyOutcomeConceptMatch('cellular biology', concept)).toBe('accepted-alias');
  });

  it('near-token-containment: a smaller token set contained in a larger one, in either direction', () => {
    const wide: OutcomeConceptRegistryEntry = {
      key: 'concept-key1:a',
      name: 'Cell Biology',
      aliases: [],
    };
    expect(classifyOutcomeConceptMatch('Cell', wide)).toBe('near-token-containment');

    const narrow: OutcomeConceptRegistryEntry = {
      key: 'concept-key1:b',
      name: 'Cell',
      aliases: [],
    };
    expect(classifyOutcomeConceptMatch('Cell Biology', narrow)).toBe('near-token-containment');
  });

  it('none: disjoint token sets never match', () => {
    const concept: OutcomeConceptRegistryEntry = {
      key: 'concept-key1:a',
      name: 'Cell Biology',
      aliases: [],
    };
    expect(classifyOutcomeConceptMatch('Osmosis', concept)).toBe('none');
  });

  it('a note-anchored concept (name: null) matches only on its aliases, never fabricates a name match', () => {
    const concept: OutcomeConceptRegistryEntry = {
      key: 'concept-key1:a',
      name: null,
      aliases: ['Apoptosis'],
    };
    expect(classifyOutcomeConceptMatch('Apoptosis', concept)).toBe('accepted-alias');
    expect(classifyOutcomeConceptMatch('Cell Death', concept)).toBe('none');
  });

  it('the naive plural fold means a trailing "s" does not defeat an exact match', () => {
    const concept: OutcomeConceptRegistryEntry = {
      key: 'concept-key1:a',
      name: 'Organelle',
      aliases: [],
    };
    expect(classifyOutcomeConceptMatch('Organelles', concept)).toBe('exact-name');
  });

  it('an empty label or empty wordings never produce a spurious containment match', () => {
    const concept: OutcomeConceptRegistryEntry = { key: 'concept-key1:a', name: '', aliases: [] };
    expect(classifyOutcomeConceptMatch('Cell Biology', concept)).toBe('none');
  });
});

describe('conceptRegistryEntryFromRecord', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-reconcile-registry-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a topic-anchored record contributes its own name and aliases', async () => {
    await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Cell Biology',
      aliases: ['Cellular Biology'],
    });
    const record = await onlyConceptRecord(vault);
    const entry = conceptRegistryEntryFromRecord(record);
    expect(entry.name).toBe('Cell Biology');
    expect(entry.aliases).toEqual(['Cellular Biology']);
  });

  it('a note-anchored record carries no name at this layer, only whatever aliases a rebind folded in', async () => {
    const key = await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Cell Death',
      aliases: [],
    });
    await bindConceptKeyToNote(vault, key, {
      kind: 'note',
      noteUid: 'uid-1',
      notePath: 'notes/Apoptosis.md' as VaultPath,
    });
    const record = await onlyConceptRecord(vault);
    const entry = conceptRegistryEntryFromRecord(record);
    expect(entry.name).toBeNull();
    expect(entry.aliases).toEqual(['Cell Death']);
  });
});

describe('reconcileOutcomeConcepts', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-reconcile-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('attaches an exact match, proposes a near match, and counts a total miss as unattached', async () => {
    await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Cell Biology',
      aliases: [],
    });
    const conceptRecord = await onlyConceptRecord(vault);
    const concepts = [conceptRegistryEntryFromRecord(conceptRecord)];

    const exactOutcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: source('Objectives.md', 1),
      label: 'Cell Biology',
      provenance: PROVENANCE,
    });
    const nearOutcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: source('Objectives.md', 2),
      label: 'Cell',
      provenance: PROVENANCE,
    });
    const missOutcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: source('Objectives.md', 3),
      label: 'Osmosis',
      provenance: PROVENANCE,
    });

    const report = await reconcileOutcomeConcepts(
      vault,
      [exactOutcome, nearOutcome, missOutcome],
      concepts,
      { now: () => '2026-09-16T00:00:00Z' },
    );

    expect(report.attached).toEqual([
      { outcomeId: exactOutcome.id, conceptKey: conceptRecord.key, kind: 'exact-name' },
    ]);
    expect(report.proposed).toEqual([
      { outcomeId: nearOutcome.id, conceptKey: conceptRecord.key, status: 'proposed' },
    ]);
    expect(report.unattachedOutcomeIds).toEqual([missOutcome.id]);
    expect(report.unattachedCount).toBe(1);

    const persisted = await listOutcomeRecords(vault);
    const byId = new Map(persisted.map(({ record }) => [record.id, record]));
    expect(byId.get(exactOutcome.id)?.conceptKeys).toEqual([conceptRecord.key]);
    // The near match is NOT attached until a confirmed near-match record (out of this module's scope).
    expect(byId.get(nearOutcome.id)?.conceptKeys).toEqual([]);
    expect(byId.get(missOutcome.id)?.conceptKeys).toEqual([]);

    const nearMatches = await listOutcomeConceptNearMatchRecords(vault);
    expect(nearMatches).toHaveLength(1);
    expect(nearMatches[0]?.record.status).toBe('proposed');
    expect(nearMatches[0]?.record.reason).toBe('token-set-containment');
    expect(nearMatches[0]?.record.outcomeId).toBe(nearOutcome.id);
    expect(nearMatches[0]?.record.conceptKey).toBe(conceptRecord.key);
  });

  it('is idempotent: re-running against an already-reconciled course writes nothing new', async () => {
    await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Cell Biology',
      aliases: [],
    });
    const conceptRecord = await onlyConceptRecord(vault);
    const concepts = [conceptRegistryEntryFromRecord(conceptRecord)];

    const outcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: source('Objectives.md'),
      label: 'Cell Biology',
      provenance: PROVENANCE,
    });

    await reconcileOutcomeConcepts(vault, [outcome], concepts);
    const first = await listOutcomeRecords(vault);

    const second = await reconcileOutcomeConcepts(vault, [outcome], concepts);
    const after = await listOutcomeRecords(vault);

    expect(second.attached).toHaveLength(1);
    expect(after[0]?.record.conceptKeys).toEqual(first[0]?.record.conceptKeys);
  });

  it('skips a retired outcome entirely — no attach, no proposal, and it is not counted as unattached', async () => {
    await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Cell Biology',
      aliases: [],
    });
    const conceptRecord = await onlyConceptRecord(vault);
    const concepts = [conceptRegistryEntryFromRecord(conceptRecord)];

    const outcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: source('Objectives.md'),
      label: 'Cell Biology',
      provenance: PROVENANCE,
    });
    await retireOutcome(vault, outcome.id);
    const retired = (await listOutcomeRecords(vault))[0]?.record;
    if (retired === undefined) throw new Error('expected the retired record to exist');

    const report = await reconcileOutcomeConcepts(vault, [retired], concepts);

    expect(report.attached).toEqual([]);
    expect(report.proposed).toEqual([]);
    expect(report.unattachedOutcomeIds).toEqual([]);
    expect(report.unattachedCount).toBe(0);
  });

  it('INV-2: an attached OutcomeRecord round-trips byte-identically on read-back', async () => {
    await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Cell Biology',
      aliases: [],
    });
    const conceptRecord = await onlyConceptRecord(vault);
    const concepts = [conceptRegistryEntryFromRecord(conceptRecord)];

    const outcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: source('Objectives.md'),
      label: 'Cell Biology',
      provenance: PROVENANCE,
    });
    await reconcileOutcomeConcepts(vault, [outcome], concepts);

    const [outcomeOnDisk] = await listOutcomeRecords(vault);
    if (outcomeOnDisk === undefined) throw new Error('expected the outcome record to exist');
    const bytesOnce = await vault.read(outcomeOnDisk.path);
    const bytesTwice = await vault.read(outcomeOnDisk.path);
    expect(bytesTwice).toBe(bytesOnce);
  });
});
