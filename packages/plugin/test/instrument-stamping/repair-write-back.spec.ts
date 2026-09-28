/**
 * `writeBackRecoveredInstrumentId` (`ol-v7r5.103`): once she confirms a deleted-id repair through
 * the grouped choice (C5.3 as amended by `[D-090]`/`[D-392]`), the recovered id is written back
 * into the block she chose, through the same idempotent marker primitives `[D-030]`/`[D-177]`
 * already permit — and every doubt ends in a refusal that writes nothing (INV-6).
 *
 * The silent near-certain repair (`ol-v7r5.105`, `[D-090]` section 4) writes through the same
 * core, from `buildRepairChoice`'s `'silent'` outcome, and re-checks near-certainty itself.
 *
 * Real in-memory vault, real `olea-core` parsing and enumeration, real `buildRepairChoice` and
 * `resolveRepairChoice`.
 * INV-3: every fixture below is coined for this suite.
 */

import type { VaultInstrumentRecord, VaultPath } from 'olea-core';
import { enumerateVaultInstruments, PROVISIONAL_ID_PREFIX, removeSpans } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { stampOnFirstSight } from '../../src/instrument-stamping/port.js';
import {
  type WriteBackRecoveredIdInput,
  type WriteBackSilentRepairInput,
  writeBackRecoveredInstrumentId,
  writeBackSilentRepair,
} from '../../src/instrument-stamping/repair-write-back.js';
import {
  buildRepairChoice,
  digestOfInstrumentRecord,
  type RepairChoiceAttachedResult,
  type RepairChoiceProposal,
  resolveRepairChoice,
} from '../../src/review/repair-choice.js';
import { memoryVault } from '../review/memory-vault.js';

const FRONTMATTER = (topic: string, course = 'TEST101') =>
  ['---', `topic: ${topic}`, `course: ${course}`, '---', ''].join('\n');

const FRONTMATTER_WITH_UID = (uid: string) =>
  ['---', `olea-uid: ${uid}`, 'topic: [Alpha]', 'course: TEST101', '---', ''].join('\n');

const MCQ_BLOCK = [
  '```olea-mcq',
  'stem: Which structure is it?',
  'answer: The right one',
  'distractor: d1',
  'distractor: d2',
  'distractor: d3',
  'distractor: d4',
  '```',
].join('\n');

const MCQ_NOTE = 'Courses/TEST101/one.md';
const QA_NOTE = 'Courses/TEST101/qa.md';
const OTHER_NOTE = 'Courses/TEST101/other.md';
const CLOZE_NOTE = 'Courses/TEST101/cloze.md';

async function recordsOf(
  vault: ReturnType<typeof memoryVault>,
): Promise<readonly VaultInstrumentRecord[]> {
  return (await enumerateVaultInstruments(vault)).records;
}

function rawOf(record: VaultInstrumentRecord): string {
  return record.instrumentType === 'mcq' ? record.mcq.raw : record.card.raw;
}

function only(
  records: readonly VaultInstrumentRecord[],
  type: VaultInstrumentRecord['instrumentType'],
  notePath?: VaultPath,
): VaultInstrumentRecord {
  const found = records.filter(
    (r) => r.instrumentType === type && (notePath === undefined || r.notePath === notePath),
  );
  if (found.length !== 1) throw new Error(`fixture has ${found.length} ${type} instruments`);
  return found[0] as VaultInstrumentRecord;
}

/** Her real answer: a grouped choice built and resolved by the production decision module. */
function confirmed(
  instrumentId: string,
  chosen: VaultPath,
  others: readonly VaultPath[] = [OTHER_NOTE],
): RepairChoiceAttachedResult {
  const outcome = buildRepairChoice({
    instrumentId,
    candidates: [chosen, ...others].map((notePath) => ({ notePath, meetsCertaintyTest: false })),
    now: 1_000,
  });
  if (outcome.kind !== 'choice-needed') throw new Error('fixture expected a grouped choice');
  const resolution = resolveRepairChoice(outcome.proposal, { kind: 'candidate', notePath: chosen });
  if (resolution.kind !== 'attached') throw new Error('fixture expected an attached answer');
  return resolution;
}

/** `[D-409]`: her real answer to a grouped choice whose candidate carries a digest. */
function confirmedWithDigest(
  instrumentId: string,
  chosen: VaultPath,
  digest: string,
  others: readonly VaultPath[] = [OTHER_NOTE],
): RepairChoiceAttachedResult {
  const outcome = buildRepairChoice({
    instrumentId,
    candidates: [
      { notePath: chosen, meetsCertaintyTest: false, digest },
      ...others.map((notePath) => ({ notePath, meetsCertaintyTest: false })),
    ],
    now: 1_000,
  });
  if (outcome.kind !== 'choice-needed') throw new Error('fixture expected a grouped choice');
  const resolution = resolveRepairChoice(outcome.proposal, {
    kind: 'candidate',
    notePath: chosen,
    digest,
  });
  if (resolution.kind !== 'attached') throw new Error('fixture expected an attached answer');
  return resolution;
}

async function inputFor(
  vault: ReturnType<typeof memoryVault>,
  recoveredId: string,
  type: VaultInstrumentRecord['instrumentType'],
  notePath: VaultPath,
): Promise<WriteBackRecoveredIdInput> {
  const records = await recordsOf(vault);
  return {
    resolution: confirmed(recoveredId, notePath),
    recoveredInstrumentType: type,
    candidateRaw: rawOf(only(records, type, notePath)),
    currentRecords: records,
  };
}

describe('writeBackRecoveredInstrumentId — MCQ', () => {
  const vault = () =>
    memoryVault({ [MCQ_NOTE]: [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, ''].join('\n') });

  it('writes the recovered id into the chosen block, and a fresh walk reads it back', async () => {
    const v = vault();
    const result = await writeBackRecoveredInstrumentId(
      v,
      await inputFor(v, 'mcq-recovered1', 'mcq', MCQ_NOTE),
    );

    expect(result).toEqual({ kind: 'written', instrumentId: 'mcq-recovered1', notePath: MCQ_NOTE });
    expect(v.writes).toEqual([MCQ_NOTE]);
    expect(only(await recordsOf(v), 'mcq').instrumentId).toBe('mcq-recovered1');
  });

  it('INV-2: the only change to her note is the inserted id line', async () => {
    const v = vault();
    const before = v.contentOf(MCQ_NOTE) ?? '';
    await writeBackRecoveredInstrumentId(v, await inputFor(v, 'mcq-recovered1', 'mcq', MCQ_NOTE));
    const after = v.contentOf(MCQ_NOTE) ?? '';
    const start = after.indexOf('id: mcq-recovered1\n');
    expect(start).toBeGreaterThan(-1);
    expect(removeSpans(after, [{ start, end: start + 'id: mcq-recovered1\n'.length }])).toBe(
      before,
    );
  });

  it('is idempotent: a repeat with the same (stale) walk writes nothing more', async () => {
    const v = vault();
    const input = await inputFor(v, 'mcq-recovered1', 'mcq', MCQ_NOTE);
    await writeBackRecoveredInstrumentId(v, input);
    const again = await writeBackRecoveredInstrumentId(v, input);
    expect(again.kind).toBe('already-carried');
    expect(v.writes).toHaveLength(1);
  });

  it('is idempotent: a repeat after a fresh walk writes nothing more', async () => {
    const v = vault();
    const input = await inputFor(v, 'mcq-recovered1', 'mcq', MCQ_NOTE);
    await writeBackRecoveredInstrumentId(v, input);
    const again = await writeBackRecoveredInstrumentId(v, {
      ...input,
      currentRecords: await recordsOf(v),
    });
    expect(again).toEqual({
      kind: 'already-carried',
      instrumentId: 'mcq-recovered1',
      notePath: MCQ_NOTE,
    });
    expect(v.writes).toHaveLength(1);
  });

  it('refuses when the chosen block already carries a durable id of its own — never overwrites', async () => {
    const v = vault();
    await stampOnFirstSight(v, only(await recordsOf(v), 'mcq'), {
      generateMcqId: () => 'mcq-fresh1',
    });
    const records = await recordsOf(v);
    const before = v.contentOf(MCQ_NOTE);
    const result = await writeBackRecoveredInstrumentId(v, {
      resolution: confirmed('mcq-recovered1', MCQ_NOTE),
      recoveredInstrumentType: 'mcq',
      candidateRaw: rawOf(only(records, 'mcq')),
      currentRecords: records,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'candidate-already-identified' });
    expect(v.contentOf(MCQ_NOTE)).toBe(before);
  });

  it('refuses a recovered value that is not a plain id token', async () => {
    const v = vault();
    const result = await writeBackRecoveredInstrumentId(
      v,
      await inputFor(v, 'two words', 'mcq', MCQ_NOTE),
    );
    expect(result).toEqual({ kind: 'refused', reason: 'recovered-id-not-reproducible' });
    expect(v.writes).toHaveLength(0);
  });
});

describe('writeBackRecoveredInstrumentId — Q&A', () => {
  const qaNote = () =>
    [FRONTMATTER_WITH_UID('uid-qa'), '## Q1', '', 'The front::The back', ''].join('\n');

  it('writes the recovered block id onto the card line, reproducing the deleted id exactly', async () => {
    const v = memoryVault({ [QA_NOTE]: qaNote() });
    const recoveredId = `${PROVISIONAL_ID_PREFIX}:uid-qa#^blk1:1`;
    const result = await writeBackRecoveredInstrumentId(
      v,
      await inputFor(v, recoveredId, 'qa', QA_NOTE),
    );

    expect(result).toEqual({ kind: 'written', instrumentId: recoveredId, notePath: QA_NOTE });
    expect(v.contentOf(QA_NOTE)).toContain('The front::The back ^blk1');
    expect(only(await recordsOf(v), 'qa').instrumentId).toBe(recoveredId);
  });

  it('refuses a Q&A id rooted in a different note — it would not come back as the same id', async () => {
    const v = memoryVault({ [QA_NOTE]: qaNote() });
    const result = await writeBackRecoveredInstrumentId(
      v,
      await inputFor(v, `${PROVISIONAL_ID_PREFIX}:uid-elsewhere#^blk1:1`, 'qa', QA_NOTE),
    );
    expect(result).toEqual({ kind: 'refused', reason: 'recovered-id-not-reproducible' });
    expect(v.writes).toHaveLength(0);
  });

  it('refuses an unstamped, position-derived id — there is no marker to write', async () => {
    const v = memoryVault({ [QA_NOTE]: qaNote() });
    const result = await writeBackRecoveredInstrumentId(
      v,
      await inputFor(v, `${PROVISIONAL_ID_PREFIX}:uid-qa#hGone:1`, 'qa', QA_NOTE),
    );
    expect(result).toEqual({ kind: 'refused', reason: 'recovered-id-not-reproducible' });
    expect(v.writes).toHaveLength(0);
  });

  it('refuses when the block id is already used elsewhere in the note', async () => {
    const v = memoryVault({
      [QA_NOTE]: [
        FRONTMATTER_WITH_UID('uid-qa'),
        '## Q1',
        '',
        'The front::The back',
        '',
        'A paragraph of her own. ^blk1',
        '',
      ].join('\n'),
    });
    const result = await writeBackRecoveredInstrumentId(
      v,
      await inputFor(v, `${PROVISIONAL_ID_PREFIX}:uid-qa#^blk1:1`, 'qa', QA_NOTE),
    );
    expect(result).toEqual({ kind: 'refused', reason: 'marker-in-use' });
    expect(v.writes).toHaveLength(0);
  });
});

describe('writeBackRecoveredInstrumentId — cloze', () => {
  it('writes the recovered id into the frontmatter map, never the card line', async () => {
    const v = memoryVault({
      [CLOZE_NOTE]: [FRONTMATTER('[Alpha]'), '## Q1', '', 'A ==blank== in a sentence.', ''].join(
        '\n',
      ),
    });
    const result = await writeBackRecoveredInstrumentId(
      v,
      await inputFor(v, 'cloze-recovered1', 'cloze', CLOZE_NOTE),
    );

    expect(result).toEqual({
      kind: 'written',
      instrumentId: 'cloze-recovered1',
      notePath: CLOZE_NOTE,
    });
    const content = v.contentOf(CLOZE_NOTE) ?? '';
    expect(content).toContain('olea-cloze-ids');
    expect(content).toContain('A ==blank== in a sentence.\n');
    expect(only(await recordsOf(v), 'cloze').instrumentId).toBe('cloze-recovered1');

    const again = await writeBackRecoveredInstrumentId(
      v,
      await inputFor(v, 'cloze-recovered1', 'cloze', CLOZE_NOTE),
    );
    expect(again.kind).toBe('already-carried');
    expect(v.writes).toHaveLength(1);
  });
});

describe('writeBackRecoveredInstrumentId — refusals that write nothing', () => {
  const twoNotes = () =>
    memoryVault({
      [MCQ_NOTE]: [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, ''].join('\n'),
      [OTHER_NOTE]: [FRONTMATTER('[Alpha]'), '## Q2', '', 'Other front::Other back', ''].join('\n'),
    });

  it('refuses anything that is not her confirmed answer for this id and note', async () => {
    const v = twoNotes();
    const input = await inputFor(v, 'mcq-recovered1', 'mcq', MCQ_NOTE);
    const proposal: RepairChoiceProposal = input.resolution.proposal;
    const cases: RepairChoiceAttachedResult[] = [
      { ...input.resolution, proposal: { ...proposal, status: 'proposed' } },
      { ...input.resolution, proposal: { ...proposal, status: 'declined' } },
      { ...input.resolution, proposal: { ...proposal, resolvedNotePath: OTHER_NOTE } },
      { ...input.resolution, instrumentId: 'mcq-someone-else' },
    ];
    for (const resolution of cases) {
      const result = await writeBackRecoveredInstrumentId(v, { ...input, resolution });
      expect(result).toEqual({ kind: 'refused', reason: 'not-confirmed' });
    }
    expect(v.writes).toHaveLength(0);
  });

  it('refuses when the recovered id is live in another note — a duplication case, not a repair', async () => {
    const v = memoryVault({
      [MCQ_NOTE]: [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, ''].join('\n'),
      [OTHER_NOTE]: [
        FRONTMATTER('[Alpha]'),
        '## Q2',
        '',
        MCQ_BLOCK.replace(/\n```$/, '\nid: mcq-recovered1\n```'),
        '',
      ].join('\n'),
    });
    const records = await recordsOf(v);
    expect(records.some((r) => r.instrumentId === 'mcq-recovered1')).toBe(true);
    const result = await writeBackRecoveredInstrumentId(v, {
      resolution: confirmed('mcq-recovered1', MCQ_NOTE),
      recoveredInstrumentType: 'mcq',
      candidateRaw: rawOf(only(records, 'mcq', MCQ_NOTE)),
      currentRecords: records,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'id-live-elsewhere' });
    expect(v.writes).toHaveLength(0);
  });

  it('refuses when the block she was shown is no longer there byte for byte', async () => {
    const v = twoNotes();
    const input = await inputFor(v, 'mcq-recovered1', 'mcq', MCQ_NOTE);
    const result = await writeBackRecoveredInstrumentId(v, {
      ...input,
      candidateRaw: input.candidateRaw.replace('Which', 'What'),
    });
    expect(result).toEqual({ kind: 'refused', reason: 'candidate-not-found' });
    expect(v.writes).toHaveLength(0);
  });

  it('refuses when two identical blocks in the chosen note could each be the one she chose, and her answer carries no digest', async () => {
    const v = memoryVault({
      [MCQ_NOTE]: [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, '', MCQ_BLOCK, ''].join('\n'),
    });
    const records = await recordsOf(v);
    const result = await writeBackRecoveredInstrumentId(v, {
      resolution: confirmed('mcq-recovered1', MCQ_NOTE),
      recoveredInstrumentType: 'mcq',
      candidateRaw: rawOf(records.find((r) => r.instrumentType === 'mcq') as VaultInstrumentRecord),
      currentRecords: records,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'candidate-ambiguous' });
    expect(v.writes).toHaveLength(0);
  });

  it('[D-409] locates the chosen block among identical texts by heading path, when her answer names it by digest', async () => {
    const v = memoryVault({
      [MCQ_NOTE]: [
        FRONTMATTER('[Alpha]'),
        '## Q1',
        '',
        MCQ_BLOCK,
        '',
        '## Q2',
        '',
        MCQ_BLOCK,
        '',
      ].join('\n'),
    });
    const records = await recordsOf(v);
    const mcqRecords = records.filter((r) => r.instrumentType === 'mcq');
    expect(mcqRecords).toHaveLength(2);
    const chosen = mcqRecords.find((r) => r.headingPath?.at(-1) === 'Q2');
    if (chosen === undefined) throw new Error('fixture expected a Q2 block');
    const digest = await digestOfInstrumentRecord(chosen);
    if (digest === undefined) throw new Error('fixture expected a digest');

    const result = await writeBackRecoveredInstrumentId(v, {
      resolution: confirmedWithDigest('mcq-recovered1', MCQ_NOTE, digest),
      recoveredInstrumentType: 'mcq',
      candidateRaw: rawOf(chosen),
      currentRecords: records,
    });

    expect(result).toEqual({ kind: 'written', instrumentId: 'mcq-recovered1', notePath: MCQ_NOTE });
    const content = v.contentOf(MCQ_NOTE) ?? '';
    const q1Index = content.indexOf('## Q1');
    const q2Index = content.indexOf('## Q2');
    const idIndex = content.indexOf('id: mcq-recovered1');
    expect(q2Index).toBeGreaterThan(q1Index);
    // the recovered id landed in the Q2 block, not the Q1 one.
    expect(idIndex).toBeGreaterThan(q2Index);
  });

  it('[D-409] still refuses when two identical blocks share the same heading too — the digest cannot tell them apart either', async () => {
    const v = memoryVault({
      [MCQ_NOTE]: [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, '', MCQ_BLOCK, ''].join('\n'),
    });
    const records = await recordsOf(v);
    const mcqRecords = records.filter((r) => r.instrumentType === 'mcq');
    const digest = await digestOfInstrumentRecord(mcqRecords[0] as VaultInstrumentRecord);
    if (digest === undefined) throw new Error('fixture expected a digest');

    const result = await writeBackRecoveredInstrumentId(v, {
      resolution: confirmedWithDigest('mcq-recovered1', MCQ_NOTE, digest),
      recoveredInstrumentType: 'mcq',
      candidateRaw: rawOf(mcqRecords[0] as VaultInstrumentRecord),
      currentRecords: records,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'candidate-ambiguous' });
    expect(v.writes).toHaveLength(0);
  });

  it('refuses to carry an id onto an instrument of a different type', async () => {
    const v = twoNotes();
    const records = await recordsOf(v);
    const result = await writeBackRecoveredInstrumentId(v, {
      resolution: confirmed('cloze-recovered1', MCQ_NOTE),
      recoveredInstrumentType: 'cloze',
      candidateRaw: rawOf(only(records, 'mcq', MCQ_NOTE)),
      currentRecords: records,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'type-mismatch' });
    expect(v.writes).toHaveLength(0);
  });
});

describe('writeBackSilentRepair — the near-certain repair, no question asked', () => {
  const vault = () =>
    memoryVault({ [MCQ_NOTE]: [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, ''].join('\n') });

  /** The ruling's own silent outcome, built by the production decision module. */
  async function silentInput(
    v: ReturnType<typeof memoryVault>,
    recoveredId: string,
  ): Promise<WriteBackSilentRepairInput> {
    const records = await recordsOf(v);
    const raw = rawOf(only(records, 'mcq', MCQ_NOTE));
    const repair = buildRepairChoice({
      instrumentId: recoveredId,
      candidates: [{ notePath: MCQ_NOTE, meetsCertaintyTest: true }],
      now: 1_000,
    });
    if (repair.kind !== 'silent') throw new Error('fixture expected a silent repair');
    return {
      repair,
      deleted: { instrumentId: recoveredId, raw, notePath: MCQ_NOTE },
      recoveredInstrumentType: 'mcq',
      candidateRaw: raw,
      currentRecords: records,
    };
  }

  it('writes the recovered id into the successor, and a fresh walk reads it back', async () => {
    const v = vault();
    const before = v.contentOf(MCQ_NOTE) ?? '';
    const result = await writeBackSilentRepair(v, await silentInput(v, 'mcq-recovered1'));

    expect(result).toEqual({ kind: 'written', instrumentId: 'mcq-recovered1', notePath: MCQ_NOTE });
    expect(only(await recordsOf(v), 'mcq').instrumentId).toBe('mcq-recovered1');
    const after = v.contentOf(MCQ_NOTE) ?? '';
    const start = after.indexOf('id: mcq-recovered1\n');
    expect(removeSpans(after, [{ start, end: start + 'id: mcq-recovered1\n'.length }])).toBe(
      before,
    );
  });

  it('is idempotent', async () => {
    const v = vault();
    const input = await silentInput(v, 'mcq-recovered1');
    await writeBackSilentRepair(v, input);
    const again = await writeBackSilentRepair(v, { ...input, currentRecords: await recordsOf(v) });
    expect(again.kind).toBe('already-carried');
    expect(v.writes).toHaveLength(1);
  });

  it('re-checks near-certainty itself: changed text, another file or another id writes nothing', async () => {
    const v = vault();
    const input = await silentInput(v, 'mcq-recovered1');
    const cases: WriteBackSilentRepairInput[] = [
      { ...input, deleted: { ...input.deleted, raw: `${input.deleted.raw} (edited)` } },
      { ...input, deleted: { ...input.deleted, notePath: OTHER_NOTE } },
      { ...input, deleted: { ...input.deleted, instrumentId: 'mcq-someone-else' } },
      { ...input, candidateRaw: input.candidateRaw.replace('Which', 'What') },
    ];
    for (const c of cases) {
      expect(await writeBackSilentRepair(v, c)).toEqual({
        kind: 'refused',
        reason: 'not-near-certain',
      });
    }
    expect(v.writes).toHaveLength(0);
  });

  it('refuses when the id is live in another note — a duplication case, not a repair', async () => {
    const v = memoryVault({
      [MCQ_NOTE]: [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, ''].join('\n'),
      [OTHER_NOTE]: [
        FRONTMATTER('[Alpha]'),
        '## Q2',
        '',
        MCQ_BLOCK.replace(/\n```$/, '\nid: mcq-recovered1\n```'),
        '',
      ].join('\n'),
    });
    const result = await writeBackSilentRepair(v, await silentInput(v, 'mcq-recovered1'));
    expect(result).toEqual({ kind: 'refused', reason: 'id-live-elsewhere' });
    expect(v.writes).toHaveLength(0);
  });

  it('refuses when two identical blocks in the note could each be the successor', async () => {
    const v = memoryVault({
      [MCQ_NOTE]: [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, '', MCQ_BLOCK, ''].join('\n'),
    });
    const records = await recordsOf(v);
    const raw = rawOf(records.find((r) => r.instrumentType === 'mcq') as VaultInstrumentRecord);
    const repair = buildRepairChoice({
      instrumentId: 'mcq-recovered1',
      candidates: [{ notePath: MCQ_NOTE, meetsCertaintyTest: true }],
      now: 1_000,
    });
    if (repair.kind !== 'silent') throw new Error('fixture expected a silent repair');
    const result = await writeBackSilentRepair(v, {
      repair,
      deleted: { instrumentId: 'mcq-recovered1', raw, notePath: MCQ_NOTE },
      recoveredInstrumentType: 'mcq',
      candidateRaw: raw,
      currentRecords: records,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'candidate-ambiguous' });
    expect(v.writes).toHaveLength(0);
  });
});
