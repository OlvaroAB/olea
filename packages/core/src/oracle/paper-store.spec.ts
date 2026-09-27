import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMcqBlocks } from '../instrument/mcq-format.js';
import { FolderSource } from '../vault/folder-source.js';
import type { PaperGeneratedItem } from './paper-items.js';
import type { PaperCompositionAccount } from './paper-store.js';
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
