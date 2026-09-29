import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readInstrumentDemand } from '../instrument/demand-reading.js';
import { insertMcqBlock, parseMcqBlocks } from '../instrument/mcq-format.js';
import { acceptGeneratedMcq } from '../instrument/mcq-generated.js';
import {
  instrumentTargetStorePath,
  questionBindingOf,
  readInstrumentTarget,
} from '../instrument/target-store.js';
import { FolderSource } from '../vault/folder-source.js';
import { type PaperGeneratedItem, paperItemMcqCandidate } from './paper-items.js';
import type { PaperCompositionAccount, PaperRecord } from './paper-store.js';
import {
  applyPaperEvent,
  createPaper,
  handOffPaperItem,
  isAnswerRevealed,
  isPaperRecord,
  listPaperRecords,
  OPAQUE_PAPER_ID_PREFIX,
  PAPER_STORE_FOLDER,
  paperItemInstrumentId,
  paperRecordPath,
  recordPaperExplanationResult,
  recordPaperResponse,
  retirePaper,
} from './paper-store.js';
import {
  PAPER_STRUCTURE_FORMAT_VERSION,
  type PaperPartDemandReading,
  type PaperStructuredShape,
} from './paper-types.js';

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
// vault-object lifecycle block, tagged `@auto:core/oracle/paper-store.spec`.

// `intendedDemand`/`unbuiltDemand`/`partial` (`[D-262]`, owned by `./paper-blueprint.ts`) are
// mechanically required here because `PaperCompositionAccount` restates `PaperBlueprint`'s shape
// minus `slots`/`emptySlots` — this fixture is not exercising the demand ruling itself (see
// `./paper-blueprint.spec.ts` for that), just keeping this file's own type-checked fixture in
// sync with the shared shape it restates.
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

function item(overrides: Partial<PaperGeneratedItem> & { slotId: string }): PaperGeneratedItem {
  return {
    conceptKey: overrides.slotId,
    conceptName: overrides.slotId,
    taskId: 'quiz.generate.v1',
    promptVersion: 'v1',
    intendedDemand: 'recall-a-fact',
    groundingTier: 'T2',
    groundingLabel: 'covered-by-her-material',
    heldSourceKind: 'notes',
    heldSourceId: 's1',
    response: QUIZ_RESPONSE,
    ...overrides,
  };
}

// The Worker body `createWorkerPaperItemGenerationPort` stores verbatim: the success envelope,
// with `quiz.generate.v1`'s questions under `result`. Synthetic content only.
const QUIZ_RESPONSE = {
  ok: true,
  stamp: { contractVersion: 2, promptVersion: 'v1', modelId: 'stub' },
  result: {
    questions: [
      {
        stem: 'Which synthetic layer sits lowest?',
        correctAnswer: 'Layer A',
        distractors: ['Layer B', 'Layer C', 'Layer D'],
        feedback: 'Layer A is deposited first.',
      },
      {
        stem: 'Which synthetic process comes second?',
        correctAnswer: 'Process B',
        distractors: ['Process A', 'Process C'],
        feedback: 'Process B follows A.',
      },
    ],
  },
};

const NOTE_PATH = 'Course A/Topic one.md';
const NOTE =
  '---\ntopic: Topic one\ncourse: COURSEA\n---\n\n# Topic one\n\nHer own prose stays put.\n';
const TARGET = { notePath: NOTE_PATH, questionIndex: 0 };

describe('createPaper — always mints, never a lookup (ruling 5)', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-store-'));
    vault = new FolderSource(root);
    await vault.write(NOTE_PATH, NOTE);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('mints a fresh, immutable record', async () => {
    const record = await createPaper(
      vault,
      {
        course: 'COURSEA',
        asOf: '2026-09-16',
        compositionAccount: ACCOUNT,
        items: [item({ slotId: 'slot-0' })],
        emptySlots: [],
      },
      { now: () => '2026-09-16T00:00:00.000Z' },
    );
    expect(record.id.startsWith(`${OPAQUE_PAPER_ID_PREFIX}:`)).toBe(true);
    expect(record.status).toBe('active');
    expect(record.items).toHaveLength(1);
    expect(record.responses).toEqual([]);

    const records = await listPaperRecords(vault);
    expect(records).toHaveLength(1);
    expect(records[0]?.path).toBe(paperRecordPath(record.id));
  });

  it('two calls with identical inputs mint two distinct papers, never one', async () => {
    const input = {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' })],
      emptySlots: [],
    };
    const first = await createPaper(vault, input);
    const second = await createPaper(vault, input);
    expect(first.id).not.toBe(second.id);
    expect(await listPaperRecords(vault)).toHaveLength(2);
  });

  it('a response reveals a determinate answer and stays revealed (ruling 2)', async () => {
    const created = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' })],
      emptySlots: [],
    });
    expect(isAnswerRevealed(created, 'slot-0')).toBe(false);

    const answered = await recordPaperResponse(vault, created.id, 'slot-0', 'my answer');
    expect(isAnswerRevealed(answered, 'slot-0')).toBe(true);
    expect(answered.responses).toHaveLength(1);

    // "Keeps it revealed whenever she reopens the paper" — re-reading from disk still shows it.
    const reread = (await listPaperRecords(vault)).find((r) => r.record.id === created.id);
    expect(reread && isAnswerRevealed(reread.record, 'slot-0')).toBe(true);
  });

  it('responding to an unknown slot is a caller error, never silently accepted', async () => {
    const created = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' })],
      emptySlots: [],
    });
    await expect(
      recordPaperResponse(vault, created.id, 'slot-does-not-exist', 'x'),
    ).rejects.toThrow();
  });

  it('hands off exactly one item, and is idempotent on a repeat', async () => {
    const created = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' }), item({ slotId: 'slot-1' })],
      emptySlots: [],
    });
    const { record: handedOff } = await handOffPaperItem(vault, created.id, 'slot-0', TARGET, {
      now: () => '2026-09-17T00:00:00.000Z',
    });
    expect(handedOff.handoffs).toEqual([
      {
        slotId: 'slot-0',
        elicitingContextLabel: 'from a practice paper',
        handedOffAt: '2026-09-17T00:00:00.000Z',
      },
    ]);
    // slot-1 was never touched — "never the whole paper as one gesture".
    expect(handedOff.handoffs.some((h) => h.slotId === 'slot-1')).toBe(false);

    const { record: repeated } = await handOffPaperItem(vault, created.id, 'slot-0', TARGET);
    expect(repeated.handoffs).toHaveLength(1);
  });

  it('records a free-response explanation result as a depth reading, never a mark', async () => {
    const created = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' })],
      emptySlots: [],
    });
    const explained = await recordPaperExplanationResult(vault, created.id, 'slot-0', 'connected');
    expect(explained.explanationResults).toEqual([
      expect.objectContaining({ slotId: 'slot-0', depthReading: 'connected' }),
    ]);
  });

  it('retiring never deletes the record (F8.5)', async () => {
    const created = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' })],
      emptySlots: [],
    });
    const retired = await retirePaper(vault, created.id);
    expect(retired.status).toBe('retired');
    expect(await listPaperRecords(vault)).toHaveLength(1);
  });

  it('the items array is never recomposed by any event (ruling 6)', async () => {
    const created = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' })],
      emptySlots: [],
    });
    const afterResponse = await recordPaperResponse(vault, created.id, 'slot-0', 'x');
    const { record: afterHandoff } = await handOffPaperItem(vault, created.id, 'slot-0', TARGET);
    expect(afterResponse.items).toEqual(created.items);
    expect(afterHandoff.items).toEqual(created.items);
  });
});

// `[D-391]` / `[D-407]` (ol-0r92.118): the hand-off enters the item as a real instrument whose own
// block names its paper and slot, so the link survives the paper file's removal.
describe('handOffPaperItem — enters the item as an instrument naming its paper and slot', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-handoff-entry-'));
    vault = new FolderSource(root);
    await vault.write(NOTE_PATH, NOTE);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function twoItemPaper() {
    return createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' }), item({ slotId: 'slot-1' })],
      emptySlots: [],
    });
  }

  async function noteInstruments() {
    return parseMcqBlocks(await vault.read(NOTE_PATH)).instruments;
  }

  it('writes exactly one quiz block for that item, after the frontmatter, leaving every other byte', async () => {
    const paper = await twoItemPaper();

    const result = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);

    const content = await vault.read(NOTE_PATH);
    const instruments = parseMcqBlocks(content).instruments;
    expect(instruments).toHaveLength(1);
    const [entered] = instruments;
    expect(entered?.id).toBe(await paperItemInstrumentId(paper.id, 'slot-0'));
    expect(entered?.id).toBe(result.instrumentId);
    expect(entered?.paperOrigin).toEqual({ paperId: paper.id, slotId: 'slot-0' });
    expect(entered?.stem).toBe('Which synthetic layer sits lowest?');
    expect(entered?.answer).toBe('Layer A');
    expect(entered?.distractors).toEqual(['Layer B', 'Layer C', 'Layer D']);
    expect(entered?.feedback).toBe('Layer A is deposited first.');
    expect(result.instrumentWritten).toBe(true);
    // Frontmatter still opens the note, and removing the block recovers her note exactly.
    expect(content.startsWith('---\ntopic: Topic one\n')).toBe(true);
    expect(content.replace(`${entered?.raw}\n`, '')).toBe(NOTE);
  });

  it('enters the question the caller names, not a default one', async () => {
    const paper = await twoItemPaper();
    await handOffPaperItem(vault, paper.id, 'slot-1', { notePath: NOTE_PATH, questionIndex: 1 });
    const [entered] = await noteInstruments();
    expect(entered?.stem).toBe('Which synthetic process comes second?');
    expect(entered?.paperOrigin).toEqual({ paperId: paper.id, slotId: 'slot-1' });
  });

  it('[D-391] 1: paper, slot and instrument are each found from the others', async () => {
    const paper = await twoItemPaper();
    const { instrumentId } = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);

    // instrument -> paper and slot: the block's own field.
    const entered = (await noteInstruments()).find((i) => i.id === instrumentId);
    expect(entered?.paperOrigin).toEqual({ paperId: paper.id, slotId: 'slot-0' });
    // paper and slot -> instrument: derived from those two ids alone.
    expect(await paperItemInstrumentId(paper.id, 'slot-0')).toBe(instrumentId);
    // paper -> slot: the paper's own hand-off list.
    const stored = (await listPaperRecords(vault)).find((r) => r.record.id === paper.id)?.record;
    expect(stored?.handoffs.map((h) => h.slotId)).toEqual(['slot-0']);
    // Distinct slots and distinct papers never share an instrument id.
    expect(await paperItemInstrumentId(paper.id, 'slot-1')).not.toBe(instrumentId);
    expect(await paperItemInstrumentId('paper-key1:other', 'slot-0')).not.toBe(instrumentId);
  });

  it('[D-391] 2: a double press yields one hand-off and one instrument, the note untouched the second time', async () => {
    const paper = await twoItemPaper();
    await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);
    const afterFirst = await vault.read(NOTE_PATH);

    const second = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);

    expect(second.instrumentWritten).toBe(false);
    expect(await vault.read(NOTE_PATH)).toBe(afterFirst);
    expect(await noteInstruments()).toHaveLength(1);
    expect(second.record.handoffs).toHaveLength(1);
  });

  it('[D-391] 2: a retry after the paper write was interrupted converges on one hand-off and one instrument', async () => {
    const paper = await twoItemPaper();
    const realWrite = vault.write.bind(vault);
    let interrupt = true;
    vault.write = async (path, content) => {
      if (interrupt && path === paperRecordPath(paper.id)) {
        interrupt = false;
        throw new Error('simulated restart');
      }
      return realWrite(path, content);
    };

    await expect(handOffPaperItem(vault, paper.id, 'slot-0', TARGET)).rejects.toThrow(
      'simulated restart',
    );
    expect(await noteInstruments()).toHaveLength(1);
    const midway = (await listPaperRecords(vault)).find((r) => r.record.id === paper.id)?.record;
    expect(midway?.handoffs).toEqual([]);
    const afterFirst = await vault.read(NOTE_PATH);

    const retry = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);

    expect(retry.instrumentWritten).toBe(false);
    expect(await vault.read(NOTE_PATH)).toBe(afterFirst);
    expect(retry.record.handoffs.map((h) => h.slotId)).toEqual(['slot-0']);
  });

  it('a repeat after she moved or removed the entered block writes nothing to the note', async () => {
    const paper = await twoItemPaper();
    await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);
    await vault.write(NOTE_PATH, NOTE);

    const repeat = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);

    expect(repeat.instrumentWritten).toBe(false);
    expect(await vault.read(NOTE_PATH)).toBe(NOTE);
    expect(repeat.record.handoffs).toHaveLength(1);
  });

  it('a repeat restores only a missing paper-origin line on the entered block, once', async () => {
    const paper = await twoItemPaper();
    await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);
    const withOrigin = await vault.read(NOTE_PATH);
    const originLine = `paper-origin: ${paper.id} slot-0\n`;
    expect(withOrigin).toContain(originLine);
    await vault.write(NOTE_PATH, withOrigin.replace(originLine, ''));

    const repair = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);
    expect(repair.instrumentWritten).toBe(true);
    expect(await vault.read(NOTE_PATH)).toBe(withOrigin);

    const again = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);
    expect(again.instrumentWritten).toBe(false);
    expect(await vault.read(NOTE_PATH)).toBe(withOrigin);
  });

  it('[D-391] 3: with the paper retired, then its file removed, the item still names its paper and slot', async () => {
    const paper = await twoItemPaper();
    const { instrumentId } = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);

    await retirePaper(vault, paper.id);
    const afterRetire = (await noteInstruments()).find((i) => i.id === instrumentId);
    expect(afterRetire?.paperOrigin).toEqual({ paperId: paper.id, slotId: 'slot-0' });

    await rm(join(root, paperRecordPath(paper.id)));
    expect(await listPaperRecords(vault)).toEqual([]);
    const afterRemoval = (await noteInstruments()).find((i) => i.id === instrumentId);
    expect(afterRemoval?.paperOrigin).toEqual({ paperId: paper.id, slotId: 'slot-0' });
  });

  it('refuses, writing nothing, a card item, a missing question, a malformed body or an unknown slot', async () => {
    const paper = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [
        item({ slotId: 'slot-card', taskId: 'cards.generate.v1' }),
        item({ slotId: 'slot-quiz' }),
        item({ slotId: 'slot-bad', response: { ok: true, result: { questions: [{ stem: 1 }] } } }),
      ],
      emptySlots: [],
    });
    const paperBefore = await readFile(join(root, paperRecordPath(paper.id)), 'utf8');

    await expect(handOffPaperItem(vault, paper.id, 'slot-card', TARGET)).rejects.toThrow(
      /cards\.generate\.v1/,
    );
    await expect(
      handOffPaperItem(vault, paper.id, 'slot-quiz', { notePath: NOTE_PATH, questionIndex: 2 }),
    ).rejects.toThrow(/no question at index 2/);
    await expect(handOffPaperItem(vault, paper.id, 'slot-bad', TARGET)).rejects.toThrow(
      /not a well-formed/,
    );
    await expect(handOffPaperItem(vault, paper.id, 'slot-nope', TARGET)).rejects.toThrow(
      /not an item/,
    );

    expect(await vault.read(NOTE_PATH)).toBe(NOTE);
    expect(await readFile(join(root, paperRecordPath(paper.id)), 'utf8')).toBe(paperBefore);
  });
});

describe('applyPaperEvent — the pure fold', () => {
  it('drops a non-generated event against no existing record, never inventing one', () => {
    const result = applyPaperEvent(undefined, {
      kind: 'response-recorded',
      schemaVersion: 1,
      eventId: 'e1',
      timestamp: '2026-09-16T00:00:00.000Z',
      paperId: 'paper-key1:x',
      slotId: 'slot-0',
      responseText: 'x',
    });
    expect(result).toBeUndefined();
  });
});

describe('isPaperRecord', () => {
  it('rejects a value missing required fields', () => {
    expect(isPaperRecord({})).toBe(false);
    expect(isPaperRecord(null)).toBe(false);
  });
});

describe('PAPER_STORE_FOLDER', () => {
  it('is the dot-prefixed Olea layer, sibling to .olea/outcomes', () => {
    expect(PAPER_STORE_FOLDER).toBe('.olea/papers');
  });
});

// ---- [D-430]: the structured shape and completion ride on the record, beside the flat account ----

const STRUCTURE: PaperStructuredShape = {
  formatVersion: PAPER_STRUCTURE_FORMAT_VERSION,
  structureBasis: 'current-or-transitional',
  structureSlotCount: 2,
  sections: [
    { sectionId: 's1', label: 'Section one', marks: { status: 'unknown' }, groupIds: ['g1'] },
  ],
  groups: [
    {
      groupId: 'g1',
      kind: 'parent-question',
      sectionId: 's1',
      label: 'Question one',
      slotIds: ['slot-0', 'slot-1'],
      stimulusNeed: { status: 'not-needed' },
      heldStimulus: null,
    },
  ],
  parts: [
    {
      slotId: 'slot-0',
      groupId: 'g1',
      label: '1(a)',
      questionForm: 'short answer',
      marks: { status: 'stated', value: 2 },
      dependsOn: { status: 'unknown' },
      demand: { status: 'read', demand: 'recall-a-fact' },
    },
    {
      slotId: 'slot-1',
      groupId: 'g1',
      label: '1(b)',
      questionForm: 'short answer',
      marks: { status: 'unknown' },
      dependsOn: { status: 'stated', onSlotIds: ['slot-0'] },
      demand: { status: 'unsupported', commandWord: 'discuss' },
    },
  ],
  totalMarks: { status: 'unknown' },
  timeAllowance: { status: 'unknown' },
};

describe('a structured paper record ([D-430])', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-store-structured-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps a flat paper exactly as it was: schema version 1, no structure, no completion', async () => {
    const record = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' })],
      emptySlots: [],
    });
    expect(record.schemaVersion).toBe(1);
    expect('structure' in record).toBe(false);
    expect('completion' in record).toBe(false);
    expect('journalId' in record).toBe(false);
  });

  it('carries the structure, the completion and the journal link, as schema version 2, and reads them back', async () => {
    const record = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [item({ slotId: 'slot-0' })],
      emptySlots: [
        {
          slotId: 'slot-1',
          conceptKey: 'k1',
          conceptName: 'c1',
          reasonCode: 'demand-unsupported',
          reason: 'no generator serves the demand',
        },
      ],
      structure: STRUCTURE,
      completion: { status: 'qualified-partial', gaps: ['capability'] },
      journalId: 'paper-journal-key1:j1',
    });
    expect(record.schemaVersion).toBe(2);
    expect(record.structure).toEqual(STRUCTURE);
    expect(record.completion).toEqual({ status: 'qualified-partial', gaps: ['capability'] });
    expect(record.journalId).toBe('paper-journal-key1:j1');

    const [listed] = await listPaperRecords(vault);
    expect(listed?.record).toEqual(record);
  });

  it('keeps an unsupported part demand and its command word on the record, never replaced with recall (D-438 condition 3)', async () => {
    const record = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [],
      emptySlots: [],
      structure: STRUCTURE,
    });
    expect(record.structure?.parts[1]?.demand).toEqual({
      status: 'unsupported',
      commandWord: 'discuss',
    });
  });

  it('still accepts every flat record written before this shape existed (version 1 validates and folds)', () => {
    const legacy = {
      id: 'paper-key1:legacy',
      course: 'COURSEA',
      generatedAt: '2026-09-16T00:00:00.000Z',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [],
      emptySlots: [],
      responses: [],
      handoffs: [],
      explanationResults: [],
      status: 'active',
      schemaVersion: 1,
    };
    expect(isPaperRecord(legacy)).toBe(true);
  });

  it('refuses a record whose structure or completion is not the shape it claims', () => {
    const base = {
      id: 'paper-key1:x',
      course: 'COURSEA',
      generatedAt: '2026-09-16T00:00:00.000Z',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [],
      emptySlots: [],
      responses: [],
      handoffs: [],
      explanationResults: [],
      status: 'active',
      schemaVersion: 2,
    };
    expect(isPaperRecord({ ...base, structure: STRUCTURE })).toBe(true);
    expect(isPaperRecord({ ...base, structure: { ...STRUCTURE, formatVersion: 'other' } })).toBe(
      false,
    );
    expect(isPaperRecord({ ...base, structure: { ...STRUCTURE, parts: 'nope' } })).toBe(false);
    expect(isPaperRecord({ ...base, completion: { status: 'complete' } })).toBe(true);
    expect(isPaperRecord({ ...base, completion: { status: 'outage' } })).toBe(false);
    expect(
      isPaperRecord({ ...base, completion: { status: 'qualified-partial', gaps: ['weather'] } }),
    ).toBe(false);
    expect(isPaperRecord({ ...base, journalId: '' })).toBe(false);
  });

  it('a duplicate generated event changes nothing, structure included (never recomposes)', () => {
    const generated = {
      kind: 'generated' as const,
      schemaVersion: 1 as const,
      eventId: 'e1',
      timestamp: '2026-09-16T00:00:00.000Z',
      paperId: 'paper-key1:p',
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: ACCOUNT,
      items: [],
      emptySlots: [],
      structure: STRUCTURE,
    };
    const first = applyPaperEvent(undefined, generated);
    const second = applyPaperEvent(first, {
      ...generated,
      structure: { ...STRUCTURE, structureSlotCount: 9 },
    });
    expect(second).toBe(first);
    expect(second?.structure?.structureSlotCount).toBe(2);
  });
});

// ---- [D-437] / [D-407] / T17: the hand-off writes the target record for a demand it read ----
//
// Scenarios: olea-service/docs/dev/intelligence-build/demand-carriage.md, sections 4.1 (the paper
// hand-off row), 5.1 (P1, the demand basis) and 6 (T17); rows 36 and 38 of
// docs/direction/20260929_decision_sheet_responses.md.
//
// The paper's flat composition account carries `intendedDemandBasis` (P1, added to the blueprint by
// ol-egov.141.89.2.23); a structured paper carries the reading on each part. These fixtures set the
// account field through a spread so this file keeps type-checking whether or not the shared type
// has grown it yet, and a paper written before P1 has no basis at all (the legacy case below).
const READ_ACCOUNT = { ...ACCOUNT, intendedDemandBasis: 'read' as const };
const DEFAULT_ACCOUNT = { ...ACCOUNT, intendedDemandBasis: 'default-no-reading' as const };
const HANDOFF_NOW = '2026-09-17T08:30:00.000Z';

describe('handOffPaperItem — writes the instrument target record for a demand it read (T17)', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-handoff-demand-'));
    vault = new FolderSource(root);
    await vault.write(NOTE_PATH, NOTE);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function paperWith(
    account: object,
    extra: {
      readonly items?: readonly PaperGeneratedItem[];
      readonly structure?: PaperStructuredShape;
    } = {},
  ): Promise<PaperRecord> {
    return createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: account as PaperCompositionAccount,
      items: extra.items ?? [item({ slotId: 'slot-0' }), item({ slotId: 'slot-1' })],
      emptySlots: [],
      ...(extra.structure === undefined ? {} : { structure: extra.structure }),
    });
  }

  async function targetFiles(): Promise<string[]> {
    try {
      return (await readdir(join(root, '.olea/instrument-targets'))).sort();
    } catch {
      return [];
    }
  }

  async function enteredBlock() {
    const [entered] = parseMcqBlocks(await vault.read(NOTE_PATH)).instruments;
    if (entered === undefined) throw new Error('no block was entered into the note');
    return entered;
  }

  function spyOnWrites(): string[] {
    const writes: string[] = [];
    const realWrite = vault.write.bind(vault);
    vault.write = async (path, content) => {
      writes.push(path);
      return realWrite(path, content);
    };
    return writes;
  }

  /** A hand-off as the code before this bead did it: the block and the paper's own event, no target record. */
  async function handOffAsBeforeTheRecordExisted(
    paper: PaperRecord,
    keepBlock: boolean,
  ): Promise<void> {
    const first = paper.items[0];
    if (first === undefined) throw new Error('fixture paper has no item');
    const instrumentId = await paperItemInstrumentId(paper.id, first.slotId);
    if (keepBlock) {
      const { content } = insertMcqBlock({
        source: NOTE,
        afterBlockIndex: 0,
        fields: {
          ...acceptGeneratedMcq(paperItemMcqCandidate(first, 0), instrumentId),
          paperOrigin: { paperId: paper.id, slotId: first.slotId },
        },
      });
      await vault.write(NOTE_PATH, content);
    }
    const handed = applyPaperEvent(paper, {
      kind: 'item-handed-off',
      schemaVersion: 1,
      eventId: 'e-legacy',
      timestamp: '2026-09-16T00:00:00.000Z',
      paperId: paper.id,
      slotId: first.slotId,
    });
    await vault.write(paperRecordPath(paper.id), `${JSON.stringify(handed, null, 2)}\n`);
  }

  it('a read demand writes exactly one record, with origin paper-handoff, bound to the block as entered', async () => {
    const paper = await paperWith(READ_ACCOUNT);

    const result = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET, {
      now: () => HANDOFF_NOW,
    });

    expect(await targetFiles()).toEqual([
      instrumentTargetStorePath(result.instrumentId).split('/').pop(),
    ]);
    const read = await readInstrumentTarget(vault, result.instrumentId);
    expect(read.kind).toBe('record');
    if (read.kind !== 'record') return;
    expect(read.record).toEqual({
      schemaVersion: 'instrument-target.v1',
      instrumentId: result.instrumentId,
      demandBasis: 'authoring-intent',
      declaredDemand: 'recall-a-fact',
      origin: 'paper-handoff',
      questionBinding: await questionBindingOf(await enteredBlock()),
      authoredAt: HANDOFF_NOW,
      generator: { taskId: 'quiz.generate.v1', promptVersion: 'v1' },
    });
    // The one reader agrees: a declared demand, and a multiple-choice block reads recognition.
    expect(await readInstrumentDemand(vault, result.instrumentId, await enteredBlock())).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'paper-handoff',
      responseForm: 'recognition',
    });
  });

  it('records the demand the item was authored for, one record per handed-off slot', async () => {
    const paper = await paperWith(READ_ACCOUNT, {
      items: [
        item({ slotId: 'slot-0', intendedDemand: 'calculate' }),
        item({ slotId: 'slot-1', intendedDemand: 'compare-or-choose' }),
      ],
    });

    const a = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);
    const b = await handOffPaperItem(vault, paper.id, 'slot-1', { ...TARGET, questionIndex: 1 });

    expect(await targetFiles()).toHaveLength(2);
    const [readA, readB] = await Promise.all([
      readInstrumentTarget(vault, a.instrumentId),
      readInstrumentTarget(vault, b.instrumentId),
    ]);
    expect(readA.kind === 'record' && readA.record.declaredDemand).toBe('calculate');
    expect(readB.kind === 'record' && readB.record.declaredDemand).toBe('compare-or-choose');
  });

  it('a second hand-off writes nothing: the record, the note and the paper stay byte-identical', async () => {
    const paper = await paperWith(READ_ACCOUNT);
    const first = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET, {
      now: () => HANDOFF_NOW,
    });
    const targetPath = join(root, instrumentTargetStorePath(first.instrumentId));
    const recordBefore = await readFile(targetPath, 'utf8');
    const noteBefore = await vault.read(NOTE_PATH);
    const paperBefore = await readFile(join(root, paperRecordPath(paper.id)), 'utf8');
    const writes = spyOnWrites();

    const second = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET, {
      now: () => '2026-09-18T09:00:00.000Z',
    });

    expect(second.instrumentWritten).toBe(false);
    expect(writes).toEqual([]);
    expect(await readFile(targetPath, 'utf8')).toBe(recordBefore);
    expect(await vault.read(NOTE_PATH)).toBe(noteBefore);
    expect(await readFile(join(root, paperRecordPath(paper.id)), 'utf8')).toBe(paperBefore);
    expect(await targetFiles()).toHaveLength(1);
  });

  it('a hand-off that was interrupted before the note was written converges on one record, bound to the block that lands', async () => {
    const paper = await paperWith(READ_ACCOUNT);
    const realWrite = vault.write.bind(vault);
    let interrupt = true;
    vault.write = async (path, content) => {
      if (interrupt && path === NOTE_PATH) {
        interrupt = false;
        throw new Error('simulated restart');
      }
      return realWrite(path, content);
    };

    await expect(
      handOffPaperItem(vault, paper.id, 'slot-0', TARGET, { now: () => HANDOFF_NOW }),
    ).rejects.toThrow('simulated restart');
    expect(await vault.read(NOTE_PATH)).toBe(NOTE);
    const [midway] = await targetFiles();
    const midwayBytes = await readFile(
      join(root, '.olea/instrument-targets', midway ?? ''),
      'utf8',
    );

    const retry = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET, {
      now: () => '2026-09-18T09:00:00.000Z',
    });

    expect(retry.instrumentWritten).toBe(true);
    expect(await targetFiles()).toEqual([midway]);
    expect(await readFile(join(root, instrumentTargetStorePath(retry.instrumentId)), 'utf8')).toBe(
      midwayBytes,
    );
    expect(
      await readInstrumentDemand(vault, retry.instrumentId, await enteredBlock()),
    ).toMatchObject({ kind: 'declared', origin: 'paper-handoff' });
  });

  it('a hand edit to the entered question makes the reading stale and leaves the record untouched (the record is immutable)', async () => {
    const paper = await paperWith(READ_ACCOUNT);
    const { instrumentId } = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);
    const recordPath = join(root, instrumentTargetStorePath(instrumentId));
    const before = await readFile(recordPath, 'utf8');
    const note = await vault.read(NOTE_PATH);
    await vault.write(
      NOTE_PATH,
      note.replace('Which synthetic layer sits lowest?', 'A changed stem?'),
    );

    expect(await readInstrumentDemand(vault, instrumentId, await enteredBlock())).toEqual({
      kind: 'stale',
      demand: 'recall-a-fact',
    });
    expect(await readFile(recordPath, 'utf8')).toBe(before);
  });

  it('a defaulted demand hands off unspecified: the block is entered, no record is written', async () => {
    const paper = await paperWith(DEFAULT_ACCOUNT);

    const result = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);

    expect(result.instrumentWritten).toBe(true);
    expect(await targetFiles()).toEqual([]);
    expect((await readInstrumentTarget(vault, result.instrumentId)).kind).toBe('absent');
    expect(await readInstrumentDemand(vault, result.instrumentId, await enteredBlock())).toEqual({
      kind: 'unspecified',
    });
  });

  it('a paper written before the demand basis existed stays unspecified: no basis is never read as read', async () => {
    const paper = await paperWith(ACCOUNT);
    expect('intendedDemandBasis' in paper.compositionAccount).toBe(false);

    const result = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);

    expect(result.instrumentWritten).toBe(true);
    expect(await targetFiles()).toEqual([]);
  });

  it('a basis that is neither of the two words is not a reading', async () => {
    const paper = await paperWith({ ...ACCOUNT, intendedDemandBasis: 'Read' });
    await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);
    expect(await targetFiles()).toEqual([]);
  });

  it('legacy items stay unspecified: a repeat never backfills an item handed off before the record existed', async () => {
    const withBlock = await paperWith(READ_ACCOUNT);
    await handOffAsBeforeTheRecordExisted(withBlock, true);
    const noteWithBlock = await vault.read(NOTE_PATH);

    const repeat = await handOffPaperItem(vault, withBlock.id, 'slot-0', TARGET);

    expect(repeat.instrumentWritten).toBe(false);
    expect(await vault.read(NOTE_PATH)).toBe(noteWithBlock);
    expect(await targetFiles()).toEqual([]);

    // The same when she has since moved or removed the block: still nothing to backfill.
    await vault.write(NOTE_PATH, NOTE);
    const removed = await paperWith(READ_ACCOUNT);
    await handOffAsBeforeTheRecordExisted(removed, false);
    await handOffPaperItem(vault, removed.id, 'slot-0', TARGET);
    expect(await vault.read(NOTE_PATH)).toBe(NOTE);
    expect(await targetFiles()).toEqual([]);
  });

  it('a repair of a missing paper-origin line on an entered block writes no record either', async () => {
    const paper = await paperWith(DEFAULT_ACCOUNT);
    await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);
    const withOrigin = await vault.read(NOTE_PATH);
    await vault.write(NOTE_PATH, withOrigin.replace(`paper-origin: ${paper.id} slot-0\n`, ''));

    const repair = await handOffPaperItem(vault, paper.id, 'slot-0', TARGET);

    expect(repair.instrumentWritten).toBe(true);
    expect(await targetFiles()).toEqual([]);
  });

  it('a refused hand-off (a card item, an unknown slot) writes no record', async () => {
    const paper = await paperWith(READ_ACCOUNT, {
      items: [item({ slotId: 'slot-card', taskId: 'cards.generate.v1' })],
    });
    await expect(handOffPaperItem(vault, paper.id, 'slot-card', TARGET)).rejects.toThrow(
      /cards\.generate\.v1/,
    );
    await expect(handOffPaperItem(vault, paper.id, 'slot-nope', TARGET)).rejects.toThrow(
      /not an item/,
    );
    expect(await targetFiles()).toEqual([]);
    expect(await vault.read(NOTE_PATH)).toBe(NOTE);
  });

  it('nothing lands in her note because a demand was carried: the block is the same with and without one', async () => {
    const read = await paperWith(READ_ACCOUNT);
    const readResult = await handOffPaperItem(vault, read.id, 'slot-0', TARGET);
    const noteWithRecord = await vault.read(NOTE_PATH);

    await vault.write(NOTE_PATH, NOTE);
    const defaulted = await paperWith(DEFAULT_ACCOUNT);
    const defaultResult = await handOffPaperItem(vault, defaulted.id, 'slot-0', TARGET);
    const noteWithout = await vault.read(NOTE_PATH);

    const normalise = (text: string, paperId: string, instrumentId: string) =>
      text.replaceAll(paperId, 'PAPER').replaceAll(instrumentId, 'INSTRUMENT');
    expect(normalise(noteWithRecord, read.id, readResult.instrumentId)).toBe(
      normalise(noteWithout, defaulted.id, defaultResult.instrumentId),
    );
    expect(await targetFiles()).toEqual([
      instrumentTargetStorePath(readResult.instrumentId).split('/').pop(),
    ]);
  });
});

describe('handOffPaperItem — a structured paper ([D-430]) reads the demand on the part, not the account', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-handoff-structured-demand-'));
    vault = new FolderSource(root);
    await vault.write(NOTE_PATH, NOTE);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function structureWith(demand: PaperPartDemandReading): PaperStructuredShape {
    return {
      ...STRUCTURE,
      parts: STRUCTURE.parts.map((part) => (part.slotId === 'slot-0' ? { ...part, demand } : part)),
    };
  }

  async function handOffSlot0(
    account: object,
    structure: PaperStructuredShape,
    demandOfItem: PaperGeneratedItem['intendedDemand'] = 'recall-a-fact',
    slotId = 'slot-0',
  ) {
    const paper = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: account as PaperCompositionAccount,
      items: [item({ slotId: 'slot-0', intendedDemand: demandOfItem })],
      emptySlots: [],
      structure,
    });
    const result = await handOffPaperItem(vault, paper.id, slotId, TARGET);
    return { paper, result, read: await readInstrumentTarget(vault, result.instrumentId) };
  }

  it('a part whose demand was read writes the record, whatever the flat account says (the basis moved to the part)', async () => {
    const { read } = await handOffSlot0(
      ACCOUNT,
      structureWith({ status: 'read', demand: 'recall-a-fact' }),
    );
    expect(read.kind === 'record' && read.record.origin).toBe('paper-handoff');
    expect(read.kind === 'record' && read.record.declaredDemand).toBe('recall-a-fact');

    const second = await handOffSlot0(
      DEFAULT_ACCOUNT,
      structureWith({ status: 'read', demand: 'recall-a-fact' }),
    );
    expect(second.read.kind).toBe('record');
  });

  it.each([
    ['not-read', { status: 'not-read' }],
    ['cannot-tell', { status: 'cannot-tell' }],
    ['unsupported', { status: 'unsupported', commandWord: 'discuss' }],
  ] as const)(
    'a part reading of %s writes no record, even when the flat account says read',
    async (_name, demand) => {
      const { read } = await handOffSlot0(READ_ACCOUNT, structureWith(demand));
      expect(read.kind).toBe('absent');
    },
  );

  it('a part that reads a different demand than the item was authored for is not certified: no record', async () => {
    const { read } = await handOffSlot0(
      READ_ACCOUNT,
      structureWith({ status: 'read', demand: 'calculate' }),
      'recall-a-fact',
    );
    expect(read.kind).toBe('absent');
  });

  it('a slot with no part in the structure is not read: no record', async () => {
    const paper = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-16',
      compositionAccount: READ_ACCOUNT as PaperCompositionAccount,
      items: [item({ slotId: 'slot-9' })],
      emptySlots: [],
      structure: STRUCTURE,
    });
    const result = await handOffPaperItem(vault, paper.id, 'slot-9', TARGET);
    expect(result.instrumentWritten).toBe(true);
    expect((await readInstrumentTarget(vault, result.instrumentId)).kind).toBe('absent');
  });
});
