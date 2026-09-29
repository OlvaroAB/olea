import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaperDemand } from '../oracle/paper-types.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  classifyInstrumentDemand,
  type InstrumentDemandReading,
  projectInstrumentDemands,
  readInstrumentDemand,
  responseFormOf,
} from './demand-reading.js';
import {
  instrumentTargetStorePath,
  type QuestionBindingBlock,
  questionBindingOf,
  writeInstrumentTarget,
} from './target-store.js';

// `[D-437]` (`ol-egov.141.89.57`), design section 3.2 and tests T11 (a hand edit that breaks the
// binding makes the instrument declare none, the record untouched) and the store-and-reader half
// of T10's no-upgrade property. T8 to T10 proper (the fold, live) are B5's.

const MCQ: QuestionBindingBlock = { type: 'mcq', stem: 'What is A?', answer: 'B' };
const QA: QuestionBindingBlock = { type: 'qa', front: 'What is A?', back: 'B' };
const CLOZE: QuestionBindingBlock = { type: 'cloze', before: 'A is ', clozeText: 'B', after: '.' };

describe('demand-reading', () => {
  let tempRoot: string;
  let vault: FolderSource;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-demand-reading-'));
    vault = new FolderSource(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function author(
    instrumentId: string,
    block: QuestionBindingBlock,
    demand: PaperDemand = 'recall-a-fact',
    origin: 'heading-cue' | 'sweep' = 'heading-cue',
  ): Promise<void> {
    await writeInstrumentTarget(vault, {
      instrumentId,
      declaredDemand: demand,
      origin,
      questionBinding: await questionBindingOf(block),
      authoredAt: '2026-09-29T10:00:00.000Z',
      generator: { taskId: 'quiz.generate.v1', promptVersion: '2.2.0' },
    });
  }

  it('declared: a record current with its block reads as the demand, its origin and its response form', async () => {
    await author('card-1', QA, 'recall-a-fact', 'sweep');
    expect(await readInstrumentDemand(vault, 'card-1', QA)).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'sweep',
      responseForm: 'free-recall',
    });
  });

  it('unspecified: no record is the permanent unspecified state — reading assigns nothing and writes nothing', async () => {
    expect(await readInstrumentDemand(vault, 'legacy-1', QA)).toEqual({ kind: 'unspecified' });
    expect(await vault.exists(instrumentTargetStorePath('legacy-1'))).toBe(false);
    // Reading again, and reading a different block, still assigns nothing.
    expect(await readInstrumentDemand(vault, 'legacy-1', MCQ)).toEqual({ kind: 'unspecified' });
    expect(await vault.exists(instrumentTargetStorePath('legacy-1'))).toBe(false);
  });

  it('unreadable: a file that is there and is not a valid record is counted apart from unspecified', async () => {
    await vault.write(instrumentTargetStorePath('broken'), '{ nope');
    expect(await readInstrumentDemand(vault, 'broken', QA)).toEqual({ kind: 'unreadable' });
  });

  it('stale (T11): a hand edit that breaks the question binding makes the instrument declare none, and the record is untouched', async () => {
    await author('mcq-1', MCQ, 'recall-a-fact');
    const path = join(tempRoot, instrumentTargetStorePath('mcq-1'));
    const before = await readFile(path, 'utf8');

    const editedStem: QuestionBindingBlock = {
      type: 'mcq',
      stem: 'What is A, exactly?',
      answer: 'B',
    };
    const editedKey: QuestionBindingBlock = { type: 'mcq', stem: 'What is A?', answer: 'C' };
    expect(await readInstrumentDemand(vault, 'mcq-1', editedStem)).toEqual({
      kind: 'stale',
      demand: 'recall-a-fact',
    });
    expect(await readInstrumentDemand(vault, 'mcq-1', editedKey)).toEqual({
      kind: 'stale',
      demand: 'recall-a-fact',
    });

    // The projection the fold reads declares none for it.
    const readings = new Map<string, InstrumentDemandReading>([
      ['mcq-1', await readInstrumentDemand(vault, 'mcq-1', editedStem)],
    ]);
    expect(projectInstrumentDemands(readings).has('mcq-1')).toBe(false);

    // The immutable record was not repaired, rewritten or deleted.
    expect(await readFile(path, 'utf8')).toBe(before);
    // And restoring the text restores the reading: staleness is a property of the pair, not of the file.
    expect(await readInstrumentDemand(vault, 'mcq-1', MCQ)).toMatchObject({ kind: 'declared' });
  });

  it('an edit to a distractor, the feedback or the fence does not stale the demand (the binding is the question and the key)', async () => {
    await author('mcq-2', MCQ);
    const fuller = { ...MCQ, distractors: ['x', 'y'], feedback: 'because', fence: '```' };
    expect(await readInstrumentDemand(vault, 'mcq-2', fuller)).toMatchObject({ kind: 'declared' });
  });

  it('no upgrade across a revision: a successor with its own id does not inherit the predecessor’s record, and the reverse', async () => {
    await author('predecessor', QA, 'recall-a-fact');
    expect(await readInstrumentDemand(vault, 'successor', QA)).toEqual({ kind: 'unspecified' });
    await author('successor2', QA, 'calculate');
    expect(await readInstrumentDemand(vault, 'predecessor', QA)).toMatchObject({
      kind: 'declared',
      demand: 'recall-a-fact',
    });
  });

  describe('free recall versus recognition is read from the block (ruling on the sweep’s demand, row 38)', () => {
    it('a multiple-choice block is recognition, a card is free recall, whatever the record says', async () => {
      expect(responseFormOf(MCQ)).toBe('recognition');
      expect(responseFormOf(QA)).toBe('free-recall');
      expect(responseFormOf(CLOZE)).toBe('free-recall');

      await author('mcq-recall', MCQ, 'recall-a-fact', 'sweep');
      await author('qa-recall', QA, 'recall-a-fact', 'sweep');
      await author('cloze-recall', CLOZE, 'recall-a-fact', 'sweep');
      expect(await readInstrumentDemand(vault, 'mcq-recall', MCQ)).toMatchObject({
        kind: 'declared',
        demand: 'recall-a-fact',
        responseForm: 'recognition',
      });
      expect(await readInstrumentDemand(vault, 'qa-recall', QA)).toMatchObject({
        responseForm: 'free-recall',
      });
      expect(await readInstrumentDemand(vault, 'cloze-recall', CLOZE)).toMatchObject({
        responseForm: 'free-recall',
      });
    });
  });

  describe('classifyInstrumentDemand (the pure half)', () => {
    const record = {
      schemaVersion: 'instrument-target.v1' as const,
      instrumentId: 'i',
      demandBasis: 'authoring-intent' as const,
      declaredDemand: 'compare-or-choose' as const,
      origin: 'planner-need' as const,
      questionBinding: 'same',
      authoredAt: '2026-09-29T10:00:00.000Z',
      generator: { taskId: 't', promptVersion: 'v' },
    };

    it('maps each store result to its reading', () => {
      expect(classifyInstrumentDemand({ kind: 'absent' }, 'same', 'free-recall')).toEqual({
        kind: 'unspecified',
      });
      expect(classifyInstrumentDemand({ kind: 'unreadable' }, 'same', 'free-recall')).toEqual({
        kind: 'unreadable',
      });
      expect(classifyInstrumentDemand({ kind: 'record', record }, 'same', 'recognition')).toEqual({
        kind: 'declared',
        demand: 'compare-or-choose',
        origin: 'planner-need',
        responseForm: 'recognition',
      });
      expect(classifyInstrumentDemand({ kind: 'record', record }, 'other', 'free-recall')).toEqual({
        kind: 'stale',
        demand: 'compare-or-choose',
      });
    });

    it('a record whose binding could not be compared is unreadable, never declared on trust', () => {
      expect(
        classifyInstrumentDemand({ kind: 'record', record }, undefined, 'free-recall'),
      ).toEqual({
        kind: 'unreadable',
      });
    });
  });

  describe('readInstrumentDemand never throws', () => {
    it('a vault that throws is an unreadable reading', async () => {
      const throwing = Object.create(vault) as FolderSource;
      throwing.exists = async () => {
        throw new Error('io');
      };
      expect(await readInstrumentDemand(throwing, 'x', QA)).toEqual({ kind: 'unreadable' });
    });
  });

  describe('projectInstrumentDemands — the attainment fold’s instrumentDemands input', () => {
    it('holds declared instruments only, one demand each; stale, unspecified and unreadable are absent', () => {
      const readings = new Map<string, InstrumentDemandReading>([
        [
          'declared-card',
          {
            kind: 'declared',
            demand: 'calculate',
            origin: 'planner-need',
            responseForm: 'free-recall',
          },
        ],
        [
          'declared-mcq',
          {
            kind: 'declared',
            demand: 'recall-a-fact',
            origin: 'sweep',
            responseForm: 'recognition',
          },
        ],
        ['stale', { kind: 'stale', demand: 'recall-a-fact' }],
        ['unspecified', { kind: 'unspecified' }],
        ['unreadable', { kind: 'unreadable' }],
      ]);
      const projected = projectInstrumentDemands(readings);
      expect([...projected.keys()].sort()).toEqual(['declared-card', 'declared-mcq']);
      expect(projected.get('declared-card')).toEqual(['calculate']);
      // Faithful to the declaration: the projection does not apply the fold's rules. The fold is
      // what keeps a recognition review from meeting a recall requirement.
      expect(projected.get('declared-mcq')).toEqual(['recall-a-fact']);
    });

    it('is empty for no readings and for a population with no declared instrument', () => {
      expect(projectInstrumentDemands(new Map()).size).toBe(0);
      expect(
        projectInstrumentDemands(
          new Map([['a', { kind: 'unspecified' } as InstrumentDemandReading]]),
        ).size,
      ).toBe(0);
    });
  });
});
