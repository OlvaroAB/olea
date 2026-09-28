/**
 * `[D-409]` (`ol-v7r5.105`): each repair candidate in the grouped choice is identified by a digest
 * of its block text plus its heading path; a stale digest re-proposes rather than applies.
 *
 * Held here, over a real (in-memory) vault and the real walk (`olea-core`'s
 * `enumerateVaultInstruments`, which now records each instrument's heading path):
 *
 *  - the digest itself — deterministic, one-way, and different whenever the block text or any
 *    heading above it differs;
 *  - pairing a matcher's candidates with the walk's records, so two same-text blocks in one note
 *    get distinct digests;
 *  - note-path-then-digest ordering, in the pure proposal and in the store;
 *  - the confirmation store's version 2 shape and its migration posture from version 1;
 *  - saving her answer, and the apply-time re-check: stale re-proposes, never applies — and a
 *    fresh answer reaches the real write-back.
 *
 * Synthetic fixtures only.
 */

import type { VaultInstrumentRecord, VaultPath } from 'olea-core';
import { enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { writeBackRecoveredInstrumentId } from '../../src/instrument-stamping/repair-write-back.js';
import {
  applyConfirmedRepairChoice,
  isRepairChoiceConfirmationRecord,
  listRepairChoiceConfirmationRecords,
  proposeRepairChoiceConfirmations,
  REPAIR_CHOICE_CONFIRMATION_REASON,
  REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION,
  REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION_V1,
  type RepairChoiceConfirmationCandidateRecord,
  saveRepairChoiceAnswer,
} from '../../src/review/duplication-confirmation-store.js';
import {
  buildRepairChoice,
  compareRepairChoiceCandidates,
  digestOfInstrumentRecord,
  rawOfInstrumentRecord,
  repairCandidateDigest,
  repairCandidateDigests,
  resolveRepairChoice,
} from '../../src/review/repair-choice.js';
import { type MemoryVault, memoryVault } from './memory-vault.js';

const T0 = Date.parse('2026-08-10T18:00:00.000Z');
const T1 = Date.parse('2026-08-11T18:00:00.000Z');
const DELETED = 'mcq-deleted1';
const NOTE: VaultPath = 'Courses/TEST101/one.md';
const OTHER: VaultPath = 'Courses/TEST101/other.md';

const FRONTMATTER = ['---', 'topic: [Alpha]', 'course: TEST101', '---', ''].join('\n');

function mcq(stem: string): string {
  return [
    '```olea-mcq',
    `stem: ${stem}`,
    'answer: The right one',
    'distractor: d1',
    'distractor: d2',
    'distractor: d3',
    'distractor: d4',
    '```',
  ].join('\n');
}

/** Two orphan MCQs in one note, under two headings — the case `[D-409]` exists for. */
function twoInOneNote(firstStem = 'First stem?', secondStem = 'Second stem?'): string {
  return [
    FRONTMATTER,
    '# Part',
    '',
    '## Heading one',
    '',
    mcq(firstStem),
    '',
    '## Heading two',
    '',
    mcq(secondStem),
    '',
  ].join('\n');
}

async function recordsOf(vault: MemoryVault): Promise<readonly VaultInstrumentRecord[]> {
  return (await enumerateVaultInstruments(vault)).records;
}

async function digestAt(
  records: readonly VaultInstrumentRecord[],
  headingPath: readonly string[],
): Promise<{ readonly record: VaultInstrumentRecord; readonly digest: string }> {
  const record = records.find((r) => JSON.stringify(r.headingPath) === JSON.stringify(headingPath));
  if (record === undefined) throw new Error('fixture has no record under that heading path');
  const digest = await digestOfInstrumentRecord(record);
  if (digest === undefined) throw new Error('walk record carries no heading path');
  return { record, digest };
}

/** Proposes the two same-note candidates, digested, as the open path will once it passes digests. */
async function proposeTwo(vault: MemoryVault) {
  const records = await recordsOf(vault);
  const first = await digestAt(records, ['Part', 'Heading one']);
  const second = await digestAt(records, ['Part', 'Heading two']);
  await proposeRepairChoiceConfirmations(vault, [
    {
      instrumentId: DELETED,
      candidates: [
        { notePath: NOTE, meetsCertaintyTest: false, digest: second.digest },
        { notePath: NOTE, meetsCertaintyTest: false, digest: first.digest },
      ],
      proposedAt: T0,
    },
  ]);
  return { records, first, second };
}

async function onlyRecord(vault: MemoryVault) {
  const listed = await listRepairChoiceConfirmationRecords(vault);
  expect(listed).toHaveLength(1);
  const [stored] = listed;
  if (stored === undefined) throw new Error('expected one record');
  return stored;
}

describe('repairCandidateDigest', () => {
  it('is deterministic, one-way lowercase hex, and carries none of the block text', async () => {
    const input = { raw: 'Some block text', headingPath: ['A', 'B'] };
    const digest = await repairCandidateDigest(input);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await repairCandidateDigest({ raw: 'Some block text', headingPath: ['A', 'B'] })).toBe(
      digest,
    );
    expect(digest).not.toContain('block');
  });

  it('changes when the block text changes, or when any heading above it changes', async () => {
    const base = await repairCandidateDigest({ raw: 'x', headingPath: ['A', 'B'] });
    expect(await repairCandidateDigest({ raw: 'y', headingPath: ['A', 'B'] })).not.toBe(base);
    expect(await repairCandidateDigest({ raw: 'x', headingPath: ['A', 'C'] })).not.toBe(base);
    expect(await repairCandidateDigest({ raw: 'x', headingPath: ['Z', 'B'] })).not.toBe(base);
    expect(await repairCandidateDigest({ raw: 'x', headingPath: ['B'] })).not.toBe(base);
    // The encoding is unambiguous: moving a boundary between headings is a different path.
    expect(await repairCandidateDigest({ raw: 'x', headingPath: ['AB'] })).not.toBe(
      await repairCandidateDigest({ raw: 'x', headingPath: ['A', 'B'] }),
    );
  });

  it('a record without a heading path has no digest — never one guessed from the nearest heading', async () => {
    const [record] = await recordsOf(memoryVault({ [NOTE]: twoInOneNote() }));
    if (record === undefined) throw new Error('fixture has no record');
    const { headingPath: _headingPath, ...withoutPath } = record;
    expect(await digestOfInstrumentRecord(withoutPath as VaultInstrumentRecord)).toBeUndefined();
  });
});

describe('repairCandidateDigests: pairing a matcher’s candidates with the walk', () => {
  it('two blocks with the same text in one note, under different headings, get distinct digests in source order', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote('Same stem?', 'Same stem?') });
    const records = await recordsOf(vault);
    const raw = rawOfInstrumentRecord(records[0] as VaultInstrumentRecord);
    expect(records.map(rawOfInstrumentRecord)).toEqual([raw, raw]);

    const digests = await repairCandidateDigests(
      [
        { notePath: NOTE, raw },
        { notePath: NOTE, raw },
      ],
      records,
      new Set(),
    );
    expect(digests[0]).toBe((await digestAt(records, ['Part', 'Heading one'])).digest);
    expect(digests[1]).toBe((await digestAt(records, ['Part', 'Heading two'])).digest);
    expect(digests[0]).not.toBe(digests[1]);
  });

  it('skips records the previous walk already knew (never a candidate), and leaves an unpairable candidate undigested', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote('Same stem?', 'Same stem?') });
    const records = await recordsOf(vault);
    const raw = rawOfInstrumentRecord(records[0] as VaultInstrumentRecord);
    const known = new Set([records[0]?.instrumentId ?? '']);

    const digests = await repairCandidateDigests(
      [
        { notePath: NOTE, raw },
        { notePath: NOTE, raw },
      ],
      records,
      known,
    );
    expect(digests[0]).toBe((await digestAt(records, ['Part', 'Heading two'])).digest);
    expect(digests[1]).toBeUndefined();
  });
});

describe('ordering: note path, then digest', () => {
  it('the pure proposal and the stored record list candidates the same way, whatever order they came in', async () => {
    const candidates = [
      { notePath: OTHER, meetsCertaintyTest: false, digest: 'aa' },
      { notePath: NOTE, meetsCertaintyTest: false, digest: 'cc' },
      { notePath: NOTE, meetsCertaintyTest: false, digest: 'bb' },
    ];
    const outcome = buildRepairChoice({ instrumentId: DELETED, candidates, now: T0 });
    if (outcome.kind !== 'choice-needed') throw new Error('expected a grouped choice');
    const expected = [
      [NOTE, 'bb'],
      [NOTE, 'cc'],
      [OTHER, 'aa'],
    ];
    expect(outcome.proposal.candidates.map((c) => [c.notePath, c.digest])).toEqual(expected);

    const vault = memoryVault();
    await proposeRepairChoiceConfirmations(vault, [
      { instrumentId: DELETED, candidates, proposedAt: T0 },
    ]);
    const stored = await onlyRecord(vault);
    expect(stored.record.candidates.map((c) => [c.notePath, c.digest])).toEqual(expected);
    expect([...candidates].sort(compareRepairChoiceCandidates).map((c) => c.digest)).toEqual([
      'bb',
      'cc',
      'aa',
    ]);
  });
});

describe('resolveRepairChoice names a candidate by note path and digest', () => {
  const proposal = () => {
    const outcome = buildRepairChoice({
      instrumentId: DELETED,
      candidates: [
        { notePath: NOTE, meetsCertaintyTest: false, digest: 'd-one' },
        { notePath: NOTE, meetsCertaintyTest: false, digest: 'd-two' },
      ],
      now: T0,
    });
    if (outcome.kind !== 'choice-needed') throw new Error('expected a grouped choice');
    return outcome.proposal;
  };

  it('attaches exactly the block whose digest she chose, recording the digest', () => {
    const result = resolveRepairChoice(proposal(), {
      kind: 'candidate',
      notePath: NOTE,
      digest: 'd-two',
    });
    expect(result.kind).toBe('attached');
    if (result.kind !== 'attached') throw new Error('unreachable');
    expect(result.digest).toBe('d-two');
    expect(result.proposal.resolvedDigest).toBe('d-two');
    expect(result.proposal.resolvedNotePath).toBe(NOTE);
  });

  it('a note path alone cannot pick between two candidates in one note', () => {
    expect(resolveRepairChoice(proposal(), { kind: 'candidate', notePath: NOTE })).toEqual({
      kind: 'ambiguous-candidate',
      notePath: NOTE,
    });
  });

  it('a digest this proposal never offered is refused', () => {
    expect(
      resolveRepairChoice(proposal(), { kind: 'candidate', notePath: NOTE, digest: 'd-other' }),
    ).toEqual({ kind: 'unknown-candidate', notePath: NOTE });
  });
});

describe('the store: version 2 shape', () => {
  it('a digested entry is written as version 2 — the persisted shape, exactly', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    const { first, second } = await proposeTwo(vault);
    const stored = await onlyRecord(vault);
    const [lo, hi] = [first.digest, second.digest].sort();

    expect(JSON.parse(vault.contentOf(stored.path) ?? '')).toEqual({
      instrumentId: DELETED,
      candidates: [
        { notePath: NOTE, meetsCertaintyTest: false, digest: lo },
        { notePath: NOTE, meetsCertaintyTest: false, digest: hi },
      ],
      status: 'proposed',
      reason: REPAIR_CHOICE_CONFIRMATION_REASON,
      proposedAt: '2026-08-10T18:00:00.000Z',
      schemaVersion: 2,
    });
    expect(REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION).toBe(2);
  });

  it('an entry with any undigested candidate is written as version 1, exactly as before', async () => {
    const vault = memoryVault();
    await proposeRepairChoiceConfirmations(vault, [
      {
        instrumentId: DELETED,
        candidates: [
          { notePath: NOTE, meetsCertaintyTest: false, digest: 'd-one' },
          { notePath: OTHER, meetsCertaintyTest: false },
        ],
        proposedAt: T0,
      },
    ]);
    const stored = await onlyRecord(vault);
    expect(stored.record.schemaVersion).toBe(REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION_V1);
  });

  it('the validator requires a digest on every version 2 candidate, and both resolved fields on a confirmed one', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    await proposeTwo(vault);
    const { record } = await onlyRecord(vault);
    expect(isRepairChoiceConfirmationRecord(record)).toBe(true);

    const [c0, c1] = record.candidates as readonly RepairChoiceConfirmationCandidateRecord[];
    const { digest: _digest, ...undigested } = c0 as RepairChoiceConfirmationCandidateRecord;
    expect(isRepairChoiceConfirmationRecord({ ...record, candidates: [undigested, c1] })).toBe(
      false,
    );
    expect(
      isRepairChoiceConfirmationRecord({
        ...record,
        status: 'confirmed',
        resolvedNotePath: NOTE,
      }),
    ).toBe(false);
    // Version 1 never carried digests and is still read.
    expect(
      isRepairChoiceConfirmationRecord({
        ...record,
        candidates: [undigested],
        schemaVersion: REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION_V1,
      }),
    ).toBe(true);
  });
});

describe('the store: migration posture from version 1', () => {
  const V1_FILE = '.olea/duplication-confirmation/legacy.json';
  const v1Record = (status: 'proposed' | 'confirmed' = 'proposed') => ({
    instrumentId: DELETED,
    candidates: [{ notePath: NOTE, meetsCertaintyTest: false }],
    status,
    reason: REPAIR_CHOICE_CONFIRMATION_REASON,
    proposedAt: '2026-08-01T00:00:00.000Z',
    ...(status === 'confirmed'
      ? { confirmedAt: '2026-08-02T00:00:00.000Z', resolvedNotePath: NOTE }
      : {}),
    schemaVersion: 1,
  });
  const fileOf = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

  it('reading a version 1 file never writes it', async () => {
    const vault = memoryVault({ [V1_FILE]: fileOf(v1Record()) });
    const stored = await onlyRecord(vault);
    expect(stored.record.schemaVersion).toBe(1);
    expect(vault.writes).toEqual([]);
    expect(vault.contentOf(V1_FILE)).toBe(fileOf(v1Record()));
  });

  it('a still-proposed version 1 record is upgraded in place only when a walk hands it digested candidates', async () => {
    const vault = memoryVault({ [V1_FILE]: fileOf(v1Record()), [NOTE]: twoInOneNote() });

    // An undigested walk: same shape as on disk, so nothing is written.
    await proposeRepairChoiceConfirmations(vault, [
      {
        instrumentId: DELETED,
        candidates: [{ notePath: NOTE, meetsCertaintyTest: false }],
        proposedAt: T1,
      },
    ]);
    expect(vault.writes).toEqual([]);

    await proposeTwo(vault);
    const stored = await onlyRecord(vault);
    expect(stored.path).toBe(V1_FILE);
    expect(stored.record.schemaVersion).toBe(2);
    expect(stored.record.proposedAt).toBe('2026-08-01T00:00:00.000Z'); // never moved.
    expect(stored.record.candidates.every((c) => typeof c.digest === 'string')).toBe(true);
  });

  it('a version 2 record is never downgraded by an undigested walk', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    await proposeTwo(vault);
    const writes = vault.writes.length;
    await proposeRepairChoiceConfirmations(vault, [
      {
        instrumentId: DELETED,
        candidates: [{ notePath: NOTE, meetsCertaintyTest: false }],
        proposedAt: T1,
      },
    ]);
    expect(vault.writes.length).toBe(writes);
    expect((await onlyRecord(vault)).record.schemaVersion).toBe(2);
  });

  it('a resolved version 1 record is never rewritten by a walk', async () => {
    const vault = memoryVault({ [V1_FILE]: fileOf(v1Record('confirmed')), [NOTE]: twoInOneNote() });
    await proposeTwo(vault);
    expect(vault.writes).toEqual([]);
    expect(vault.contentOf(V1_FILE)).toBe(fileOf(v1Record('confirmed')));
  });

  it('an answer naming a version 1 candidate is stale, and nothing is written', async () => {
    const vault = memoryVault({ [V1_FILE]: fileOf(v1Record()), [NOTE]: twoInOneNote() });
    const records = await recordsOf(vault);
    const result = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'candidate', notePath: NOTE, digest: 'anything' },
      currentRecords: records,
      now: T1,
    });
    expect(result.kind).toBe('stale');
    expect(vault.writes).toEqual([]);
  });

  it('a version 1 confirmed record (no digest) is re-proposed at apply, never guessed onto a block', async () => {
    const vault = memoryVault({ [V1_FILE]: fileOf(v1Record('confirmed')), [NOTE]: twoInOneNote() });
    const result = await applyConfirmedRepairChoice(vault, {
      instrumentId: DELETED,
      currentRecords: await recordsOf(vault),
    });
    expect(result.kind).toBe('reproposed');
    const stored = await onlyRecord(vault);
    expect(stored.record.status).toBe('proposed');
    expect(stored.record.resolvedNotePath).toBeUndefined();
    expect(stored.record.confirmedAt).toBeUndefined();
    expect(vault.writes).toEqual([V1_FILE]);
  });

  it('a record of a version this module does not know is never answered or rewritten', async () => {
    const future = { ...v1Record(), schemaVersion: 3 };
    const vault = memoryVault({ [V1_FILE]: fileOf(future) });
    const result = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'none-of-these' },
      currentRecords: [],
      now: T1,
    });
    expect(result.kind).toBe('unsupported-version');
    expect(vault.writes).toEqual([]);
  });
});

describe('saving her answer', () => {
  it('a fresh candidate is saved as confirmed, with its note path and digest', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    const { records, second } = await proposeTwo(vault);

    const result = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'candidate', notePath: NOTE, digest: second.digest },
      currentRecords: records,
      now: T1,
    });

    expect(result.kind).toBe('saved');
    const stored = await onlyRecord(vault);
    expect(stored.record).toMatchObject({
      status: 'confirmed',
      confirmedAt: '2026-08-11T18:00:00.000Z',
      resolvedNotePath: NOTE,
      resolvedDigest: second.digest,
      schemaVersion: 2,
    });
    expect(isRepairChoiceConfirmationRecord(JSON.parse(vault.contentOf(stored.path) ?? ''))).toBe(
      true,
    );
    // Only the record was written — never her note (INV-6).
    expect(vault.writes.every((path) => path.startsWith('.olea/'))).toBe(true);
  });

  it('none of these is saved as declined', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    const { records } = await proposeTwo(vault);
    const result = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'none-of-these' },
      currentRecords: records,
      now: T1,
    });
    expect(result.kind).toBe('saved');
    const stored = await onlyRecord(vault);
    expect(stored.record.status).toBe('declined');
    expect(stored.record.declinedAt).toBe('2026-08-11T18:00:00.000Z');
    expect(stored.record.resolvedDigest).toBeUndefined();
  });

  it('an edited block is stale: nothing is saved and the proposal stands', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    const { second } = await proposeTwo(vault);
    await vault.write(NOTE, twoInOneNote('First stem?', 'Second stem, edited?'));
    const writes = vault.writes.length;

    const result = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'candidate', notePath: NOTE, digest: second.digest },
      currentRecords: await recordsOf(vault),
      now: T1,
    });

    expect(result.kind).toBe('stale');
    expect(vault.writes.length).toBe(writes);
    expect((await onlyRecord(vault)).record.status).toBe('proposed');
  });

  it('a renamed heading above the block is stale too', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    const { second } = await proposeTwo(vault);
    await vault.write(NOTE, twoInOneNote().replace('## Heading two', '## Heading renamed'));

    const result = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'candidate', notePath: NOTE, digest: second.digest },
      currentRecords: await recordsOf(vault),
      now: T1,
    });
    expect(result.kind).toBe('stale');
  });

  it('an answer is saved once; a digest never offered, or a live id, writes nothing', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    const { records, first, second } = await proposeTwo(vault);

    const unknown = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'candidate', notePath: OTHER, digest: first.digest },
      currentRecords: records,
      now: T1,
    });
    expect(unknown.kind).toBe('unknown-candidate');

    const live = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'none-of-these' },
      currentRecords: [...records, { ...first.record, instrumentId: DELETED }],
      now: T1,
    });
    expect(live.kind).toBe('id-live');

    await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'candidate', notePath: NOTE, digest: first.digest },
      currentRecords: records,
      now: T1,
    });
    const writes = vault.writes.length;
    const again = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'candidate', notePath: NOTE, digest: second.digest },
      currentRecords: records,
      now: T1,
    });
    expect(again.kind).toBe('already-resolved');
    expect(vault.writes.length).toBe(writes);
    expect((await onlyRecord(vault)).record.resolvedDigest).toBe(first.digest);

    expect(
      (
        await saveRepairChoiceAnswer(vault, {
          instrumentId: 'mcq-never-proposed',
          answer: { kind: 'none-of-these' },
          currentRecords: records,
          now: T1,
        })
      ).kind,
    ).toBe('not-found');
  });
});

describe('applying a confirmed answer re-checks the digest', () => {
  async function confirmSecond(vault: MemoryVault) {
    const { records, second } = await proposeTwo(vault);
    const saved = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED,
      answer: { kind: 'candidate', notePath: NOTE, digest: second.digest },
      currentRecords: records,
      now: T1,
    });
    if (saved.kind !== 'saved') throw new Error(`fixture expected a saved answer: ${saved.kind}`);
    return second;
  }

  it('a fresh digest applies, and the real write-back puts the id on exactly that block', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    const second = await confirmSecond(vault);
    const current = await recordsOf(vault);

    const applied = await applyConfirmedRepairChoice(vault, {
      instrumentId: DELETED,
      currentRecords: current,
    });
    if (applied.kind !== 'apply') throw new Error(`expected apply: ${applied.kind}`);
    expect(applied.target.instrumentId).toBe(second.record.instrumentId);
    expect(applied.resolution.digest).toBe(second.digest);

    const written = await writeBackRecoveredInstrumentId(vault, {
      resolution: applied.resolution,
      recoveredInstrumentType: 'mcq',
      candidateRaw: applied.candidateRaw,
      currentRecords: current,
    });
    expect(written).toEqual({ kind: 'written', instrumentId: DELETED, notePath: NOTE });

    const after = await recordsOf(vault);
    expect(after.find((r) => r.instrumentId === DELETED)?.headingPath).toEqual([
      'Part',
      'Heading two',
    ]);

    // Once the id is live again, a second apply has nothing to do and writes nothing.
    const writes = vault.writes.length;
    const again = await applyConfirmedRepairChoice(vault, {
      instrumentId: DELETED,
      currentRecords: after,
    });
    expect(again.kind).toBe('id-live');
    expect(vault.writes.length).toBe(writes);
  });

  it('a block edited after she answered re-proposes, and never applies', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    await confirmSecond(vault);
    await vault.write(NOTE, twoInOneNote('First stem?', 'Second stem, edited?'));
    const noteBefore = vault.contentOf(NOTE);

    const result = await applyConfirmedRepairChoice(vault, {
      instrumentId: DELETED,
      currentRecords: await recordsOf(vault),
    });

    expect(result.kind).toBe('reproposed');
    const stored = await onlyRecord(vault);
    expect(stored.record.status).toBe('proposed');
    expect(stored.record.resolvedDigest).toBeUndefined();
    expect(stored.record.resolvedNotePath).toBeUndefined();
    expect(stored.record.confirmedAt).toBeUndefined();
    expect(stored.record.schemaVersion).toBe(2);
    expect(isRepairChoiceConfirmationRecord(stored.record)).toBe(true);
    expect(vault.contentOf(NOTE)).toBe(noteBefore); // her note untouched.
  });

  it('a block moved to another note is stale: the digest pins a candidate only in its own note', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    await confirmSecond(vault);
    // The same block, under the same headings, now in another note only.
    await vault.write(OTHER, twoInOneNote());
    await vault.write(NOTE, [FRONTMATTER, '# Part', ''].join('\n'));

    const result = await applyConfirmedRepairChoice(vault, {
      instrumentId: DELETED,
      currentRecords: await recordsOf(vault),
    });
    expect(result.kind).toBe('reproposed');
  });

  it('a record she has not confirmed is not applied', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote() });
    const { records } = await proposeTwo(vault);
    const result = await applyConfirmedRepairChoice(vault, {
      instrumentId: DELETED,
      currentRecords: records,
    });
    expect(result.kind).toBe('not-confirmed');
  });

  it('two identical blocks under different headings: the digest pins one, and the write-back still refuses (it pins by text alone)', async () => {
    const vault = memoryVault({ [NOTE]: twoInOneNote('Same stem?', 'Same stem?') });
    const second = await confirmSecond(vault);
    const current = await recordsOf(vault);

    const applied = await applyConfirmedRepairChoice(vault, {
      instrumentId: DELETED,
      currentRecords: current,
    });
    if (applied.kind !== 'apply') throw new Error(`expected apply: ${applied.kind}`);
    expect(applied.target.instrumentId).toBe(second.record.instrumentId);

    const noteBefore = vault.contentOf(NOTE);
    const written = await writeBackRecoveredInstrumentId(vault, {
      resolution: applied.resolution,
      recoveredInstrumentType: 'mcq',
      candidateRaw: applied.candidateRaw,
      currentRecords: current,
    });
    expect(written).toEqual({ kind: 'refused', reason: 'candidate-ambiguous' });
    expect(vault.contentOf(NOTE)).toBe(noteBefore);
  });
});
