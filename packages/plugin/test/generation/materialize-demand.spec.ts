/**
 * `[D-437]` demand carriage, B4 (`ol-egov.141.89.2.26`), tests T6 (the materialisers' half: the
 * target record is written once, with the literal authoring-intent basis, and an unspecified item
 * writes nothing) and T20 (the sweep's recall intent on a multiple-choice block is recorded as
 * intent and reads as recognition), for BOTH materialisers.
 *
 * Design: `olea-service/docs/dev/intelligence-build/demand-carriage.md` sections 2, 3, 4.4 and 6.
 * Rulings: rows 36 (declared intent does not certify delivered demand; legacy stays unspecified)
 * and 38 (validate the produced instrument, and tell free recall from recognition by answer
 * options). Every fixture is invented, so INV-3 does not apply to this file.
 */
import {
  enumerateVaultInstruments,
  INSTRUMENT_TARGET_STORE_FOLDER,
  instrumentTargetStorePath,
  parseCards,
  parseMcqBlocks,
  questionBindingOf,
  REVIEW_LOG_FOLDER,
  readInstrumentDemand,
  readInstrumentTarget,
  type VaultPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ensureHomeNoteForConcept } from '../../src/generation/home-note.js';
import { materializeAcceptedCardDraft } from '../../src/generation/materialize-card.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import type { DraftDemandCarriage } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE: VaultPath = '01 Courses/COURSE-A/Week 2.md';
const ORIGINAL = '# Week 2\n\nSome of her own prose about an invented concept.\n';
const NOW = new Date('2026-09-29T10:15:00.000Z');
const GENERATOR = { taskId: 'quiz.generate.v1', promptVersion: '2.4.0' } as const;
const CARD_GENERATOR = { taskId: 'cards.generate.v1', promptVersion: '1.8.0' } as const;

const QUESTION = {
  stem: 'Which invented term names the limit?',
  correctAnswer: 'Invented limit',
  distractors: ['Other one', 'Other two', 'Other three'],
  feedback: 'See the lecture notes.',
};
const CARD = { front: 'Which invented term names the limit?', back: 'Invented limit' };

/** An acknowledged, agreeing carriage: what a new Worker returns for a served recall ask. */
function agreeing(origin: DraftDemandCarriage['origin'] = 'heading-cue'): DraftDemandCarriage {
  return {
    origin,
    intendedDemand: 'recall-a-fact',
    acknowledgedDemand: 'recall-a-fact',
    declaredDemand: 'recall-a-fact',
  };
}

function targetFiles(vault: MemoryVaultSource): Promise<readonly VaultPath[]> {
  return vault.list({ under: INSTRUMENT_TARGET_STORE_FOLDER });
}

/** Every review-log line the vault holds, as text: the succession record is one of them. */
async function reviewLogText(vault: MemoryVaultSource): Promise<string> {
  const files = await vault.list({ under: REVIEW_LOG_FOLDER });
  return files.map((path) => vault.raw(path) ?? '').join('\n');
}

async function mcqBlock(vault: MemoryVaultSource) {
  const { instruments } = parseMcqBlocks(vault.raw(NOTE) ?? '');
  const block = instruments[0];
  if (block === undefined) throw new Error('no mcq block was written');
  return block;
}

describe('materializeAcceptedDraft: the target record for a multiple-choice draft (T6, T20)', () => {
  it('writes one record for an acknowledged, agreeing demand: intent only, keyed by the frozen id, bound to the block as written', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const result = await materializeAcceptedDraft(
      vault,
      {
        sourcePath: NOTE,
        question: QUESTION,
        draftId: 'draft-1',
        demand: { carriage: agreeing('heading-cue'), generator: GENERATOR },
      },
      { now: () => NOW },
    );

    expect(await targetFiles(vault)).toEqual([instrumentTargetStorePath(result.instrumentId)]);
    const read = await readInstrumentTarget(vault, result.instrumentId);
    expect(read.kind).toBe('record');
    if (read.kind !== 'record') throw new Error('unreachable');
    expect(read.record).toEqual({
      schemaVersion: 'instrument-target.v1',
      instrumentId: result.instrumentId,
      // The literal: nothing here says the item was checked to deliver the demand (row 36).
      demandBasis: 'authoring-intent',
      declaredDemand: 'recall-a-fact',
      origin: 'heading-cue',
      questionBinding: await questionBindingOf(await mcqBlock(vault)),
      authoredAt: '2026-09-29T10:15:00.000Z',
      generator: GENERATOR,
    });
    expect(result.demand).toEqual({
      kind: 'recorded',
      demand: 'recall-a-fact',
      origin: 'heading-cue',
      responseForm: 'recognition',
    });
  });

  it('T20: the sweep’s recall intent on a multiple-choice block is recorded as intent and reads recognition, never free recall', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const { instrumentId } = await materializeAcceptedDraft(vault, {
      sourcePath: NOTE,
      question: QUESTION,
      draftId: 'draft-sweep',
      demand: { carriage: agreeing('sweep'), generator: GENERATOR },
    });

    // The reader's own reading of the instrument as it now sits in her vault.
    expect(await readInstrumentDemand(vault, instrumentId, await mcqBlock(vault))).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'sweep',
      responseForm: 'recognition',
    });
    // And the record stores the intent under the literal basis, with no response form at all: the
    // form is read from the block's answer options, never stored (design 3.2).
    const read = await readInstrumentTarget(vault, instrumentId);
    if (read.kind !== 'record') throw new Error('expected a record');
    expect(read.record.demandBasis).toBe('authoring-intent');
    expect(Object.keys(read.record)).not.toContain('responseForm');
  });

  it('the origin recorded is the one the draft carried: the materialiser never assigns sweep to another origin', async () => {
    for (const origin of ['heading-cue', 'revision', 'planner-need'] as const) {
      const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
      const { instrumentId } = await materializeAcceptedDraft(vault, {
        sourcePath: NOTE,
        question: QUESTION,
        draftId: `draft-${origin}`,
        demand: { carriage: agreeing(origin), generator: GENERATOR },
      });
      const read = await readInstrumentTarget(vault, instrumentId);
      if (read.kind !== 'record') throw new Error('expected a record');
      expect(read.record.origin).toBe(origin);
    }
  });

  it('a legacy draft (no demand carried) writes no record and reads unspecified for ever', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const result = await materializeAcceptedDraft(vault, {
      sourcePath: NOTE,
      question: QUESTION,
      draftId: 'draft-legacy',
    });
    expect(await targetFiles(vault)).toEqual([]);
    expect('demand' in result).toBe(false);
    expect(await readInstrumentDemand(vault, result.instrumentId, await mcqBlock(vault))).toEqual({
      kind: 'unspecified',
    });
  });

  it('a response with no acknowledgement (an older Worker) materialises the item unspecified and writes no record', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const result = await materializeAcceptedDraft(vault, {
      sourcePath: NOTE,
      question: QUESTION,
      draftId: 'draft-skew',
      demand: {
        carriage: { origin: 'sweep', intendedDemand: 'recall-a-fact' },
        generator: GENERATOR,
      },
    });
    expect(await targetFiles(vault)).toEqual([]);
    // The instrument itself is materialised as ever: a skew is not a defect in the item.
    expect((await mcqBlock(vault)).id).toBe(result.instrumentId);
    expect(result.demand).toEqual({ kind: 'unspecified', reason: 'not-acknowledged' });
  });

  it('a question declaring a different demand than asked is never recorded as the one asked: no record, and the refusal is reported', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const result = await materializeAcceptedDraft(vault, {
      sourcePath: NOTE,
      question: QUESTION,
      draftId: 'draft-mismatch',
      demand: {
        carriage: { ...agreeing('sweep'), declaredDemand: 'calculate' },
        generator: GENERATOR,
      },
    });
    expect(await targetFiles(vault)).toEqual([]);
    expect(result.demand?.kind).toBe('refused');
    expect(result.demand).toMatchObject({ defect: { kind: 'demand-mismatch' } });
    expect(await readInstrumentDemand(vault, result.instrumentId, await mcqBlock(vault))).toEqual({
      kind: 'unspecified',
    });
  });

  it('is written once: an interrupted attempt’s record is left as it was, and the retry completes', async () => {
    const input = {
      sourcePath: NOTE,
      question: QUESTION,
      draftId: 'draft-retry',
      demand: { carriage: agreeing('sweep'), generator: GENERATOR },
    } as const;
    const first = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const { instrumentId } = await materializeAcceptedDraft(first, input, { now: () => NOW });
    const recordPath = instrumentTargetStorePath(instrumentId);
    const kept = first.raw(recordPath);
    expect(kept).toBeDefined();

    // The retry after an interruption: the note is unchanged, the record already there, and the
    // clock has moved. The derived id converges, so the record is found and left alone.
    const retry = new MemoryVaultSource({ [NOTE]: ORIGINAL, [recordPath]: kept as string });
    const again = await materializeAcceptedDraft(retry, input, {
      now: () => new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(again.instrumentId).toBe(instrumentId);
    expect(retry.raw(recordPath)).toBe(kept);
  });

  it('carrying a demand changes nothing in her note or in any other file: the record is the one extra file', async () => {
    const base = { sourcePath: NOTE, question: QUESTION, draftId: 'draft-invariant' } as const;
    const without = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const withDemand = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const a = await materializeAcceptedDraft(without, base);
    const b = await materializeAcceptedDraft(withDemand, {
      ...base,
      demand: { carriage: agreeing('heading-cue'), generator: GENERATOR },
    });

    expect(b.instrumentId).toBe(a.instrumentId);
    // INV-6: her note is byte-identical, and holds no trace of the demand.
    expect(withDemand.raw(NOTE)).toBe(without.raw(NOTE));
    expect(withDemand.raw(NOTE)).not.toContain('recall-a-fact');
    const extra = (await withDemand.list()).filter((path) => !without.raw(path));
    expect(extra).toEqual([instrumentTargetStorePath(b.instrumentId)]);
  });

  it('a hand edit to the question after the record was written makes the instrument read stale, and leaves the record untouched', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const { instrumentId } = await materializeAcceptedDraft(vault, {
      sourcePath: NOTE,
      question: QUESTION,
      draftId: 'draft-edit',
      demand: { carriage: agreeing('heading-cue'), generator: GENERATOR },
    });
    const recordPath = instrumentTargetStorePath(instrumentId);
    const before = vault.raw(recordPath);

    const edited = (vault.raw(NOTE) ?? '').replace(QUESTION.stem, 'A different invented question?');
    await vault.write(NOTE, edited);
    expect(await readInstrumentDemand(vault, instrumentId, await mcqBlock(vault))).toEqual({
      kind: 'stale',
      demand: 'recall-a-fact',
    });
    expect(vault.raw(recordPath)).toBe(before);
  });

  it('a revision successor gains a record under its own id only; the predecessor never does', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const { instrumentId } = await materializeAcceptedDraft(
      vault,
      {
        sourcePath: NOTE,
        question: QUESTION,
        draftId: 'draft-successor',
        predecessorInstrumentId: 'mcq-predecessor-0001',
        demand: { carriage: agreeing('revision'), generator: GENERATOR },
      },
      { deviceId: 'device-a', now: () => NOW },
    );
    expect(await targetFiles(vault)).toEqual([instrumentTargetStorePath(instrumentId)]);
    expect(await readInstrumentTarget(vault, 'mcq-predecessor-0001')).toEqual({ kind: 'absent' });
    // The succession record is still appended, as before this bead.
    expect(await reviewLogText(vault)).toContain('mcq-predecessor-0001');
  });

  it('a stale-source refusal writes no record: nothing is written on that path at all', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    await expect(
      materializeAcceptedDraft(vault, {
        sourcePath: NOTE,
        question: QUESTION,
        draftId: 'draft-stale',
        expectedSourceContentHash: 'not-the-hash',
        demand: { carriage: agreeing('sweep'), generator: GENERATOR },
      }),
    ).rejects.toThrow();
    expect(await targetFiles(vault)).toEqual([]);
    expect(vault.raw(NOTE)).toBe(ORIGINAL);
  });
});

describe('materializeAcceptedCardDraft: the target record for a card draft (T6)', () => {
  async function qaBlock(vault: MemoryVaultSource) {
    const card = parseCards(vault.raw(NOTE) ?? '').find((c) => c.type === 'qa');
    if (card === undefined || card.type !== 'qa') throw new Error('no qa card was written');
    return card;
  }

  it('writes one record for an acknowledged, agreeing demand, and the card reads free recall', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const result = await materializeAcceptedCardDraft(
      vault,
      {
        sourcePath: NOTE,
        card: CARD,
        draftId: 'card-1',
        demand: { carriage: agreeing('heading-cue'), generator: CARD_GENERATOR },
      },
      { now: () => NOW },
    );

    expect(await targetFiles(vault)).toEqual([instrumentTargetStorePath(result.instrumentId)]);
    const read = await readInstrumentTarget(vault, result.instrumentId);
    if (read.kind !== 'record') throw new Error('expected a record');
    expect(read.record).toMatchObject({
      instrumentId: result.instrumentId,
      demandBasis: 'authoring-intent',
      declaredDemand: 'recall-a-fact',
      origin: 'heading-cue',
      authoredAt: '2026-09-29T10:15:00.000Z',
      generator: CARD_GENERATOR,
    });
    expect(read.record.questionBinding).toBe(await questionBindingOf(await qaBlock(vault)));
    expect(result.demand).toEqual({
      kind: 'recorded',
      demand: 'recall-a-fact',
      origin: 'heading-cue',
      responseForm: 'free-recall',
    });
  });

  it('the reader, walking the vault as a later session does, finds the card declared against the id it enumerates', async () => {
    const vault = new MemoryVaultSource();
    // A bound home note, so the walk binds the card to a concept instead of leaving it unbound.
    const homeNote = await ensureHomeNoteForConcept(
      vault,
      '01 Courses/COURSE-A/Lecture 4.pdf',
      'An invented concept',
    );
    if (homeNote === null) throw new Error('test setup: expected a home note path');
    const { instrumentId } = await materializeAcceptedCardDraft(vault, {
      sourcePath: homeNote,
      card: CARD,
      draftId: 'card-enumerated',
      demand: { carriage: agreeing('sweep'), generator: CARD_GENERATOR },
    });

    // The id a later walk derives must be the id the record is keyed by, or the reader would find
    // nothing (design: "keyed by the frozen instrument id").
    const walked = await enumerateVaultInstruments(vault);
    const record = walked.records.find((r) => r.instrumentId === instrumentId);
    if (record?.instrumentType !== 'qa') throw new Error('the walk did not enumerate the card');
    expect(await readInstrumentDemand(vault, instrumentId, record.card)).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'sweep',
      responseForm: 'free-recall',
    });
  });

  it('a legacy card draft writes no record and reads unspecified for ever', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const result = await materializeAcceptedCardDraft(vault, {
      sourcePath: NOTE,
      card: CARD,
      draftId: 'card-legacy',
    });
    expect(await targetFiles(vault)).toEqual([]);
    expect('demand' in result).toBe(false);
    expect(await readInstrumentDemand(vault, result.instrumentId, await qaBlock(vault))).toEqual({
      kind: 'unspecified',
    });
  });

  it('an unacknowledged demand (skew) and a mismatching declaration each write no record and still materialise the card', async () => {
    const skew = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const skewed = await materializeAcceptedCardDraft(skew, {
      sourcePath: NOTE,
      card: CARD,
      draftId: 'card-skew',
      demand: {
        carriage: { origin: 'sweep', intendedDemand: 'recall-a-fact' },
        generator: CARD_GENERATOR,
      },
    });
    expect(await targetFiles(skew)).toEqual([]);
    expect(skewed.demand).toEqual({ kind: 'unspecified', reason: 'not-acknowledged' });
    expect(parseCards(skew.raw(NOTE) ?? '')).toHaveLength(1);

    const mismatch = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const refused = await materializeAcceptedCardDraft(mismatch, {
      sourcePath: NOTE,
      card: CARD,
      draftId: 'card-mismatch',
      demand: {
        carriage: { ...agreeing('heading-cue'), declaredDemand: 'compare-or-choose' },
        generator: CARD_GENERATOR,
      },
    });
    expect(await targetFiles(mismatch)).toEqual([]);
    expect(refused.demand).toMatchObject({ kind: 'refused', defect: { kind: 'demand-mismatch' } });
    expect(parseCards(mismatch.raw(NOTE) ?? '')).toHaveLength(1);
  });

  it('is written once, and carrying a demand changes nothing in her note', async () => {
    const base = { sourcePath: NOTE, card: CARD, draftId: 'card-invariant' } as const;
    const without = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const withDemand = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const a = await materializeAcceptedCardDraft(without, base);
    const input = {
      ...base,
      demand: { carriage: agreeing('sweep'), generator: CARD_GENERATOR },
    } as const;
    const b = await materializeAcceptedCardDraft(withDemand, input, { now: () => NOW });
    expect(b.instrumentId).toBe(a.instrumentId);
    expect(withDemand.raw(NOTE)).toBe(without.raw(NOTE));

    const recordPath = instrumentTargetStorePath(b.instrumentId);
    const kept = withDemand.raw(recordPath);
    const retry = new MemoryVaultSource({ [NOTE]: ORIGINAL, [recordPath]: kept as string });
    await materializeAcceptedCardDraft(retry, input, {
      now: () => new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(retry.raw(recordPath)).toBe(kept);
  });

  it('a successor card gains a record under its own id only, and the succession record is still appended', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: ORIGINAL });
    const { instrumentId } = await materializeAcceptedCardDraft(
      vault,
      {
        sourcePath: NOTE,
        card: CARD,
        draftId: 'card-successor',
        predecessorInstrumentId: 'prov1:predecessor-card',
        demand: { carriage: agreeing('revision'), generator: CARD_GENERATOR },
      },
      { deviceId: 'device-a', now: () => NOW },
    );
    expect(await targetFiles(vault)).toEqual([instrumentTargetStorePath(instrumentId)]);
    expect(await readInstrumentTarget(vault, 'prov1:predecessor-card')).toEqual({
      kind: 'absent',
    });
    expect(await reviewLogText(vault)).toContain('prov1:predecessor-card');
  });
});
