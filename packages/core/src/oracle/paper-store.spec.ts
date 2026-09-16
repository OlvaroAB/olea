import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  paperRecordPath,
  recordPaperExplanationResult,
  recordPaperResponse,
  retirePaper,
} from './paper-store.js';

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
// vault-object lifecycle block, tagged `@auto:core/oracle/paper-store.spec`.

const ACCOUNT: PaperCompositionAccount = {
  formatVersion: 'paper-blueprint-v1',
  course: 'COURSEA',
  asOf: '2026-09-16',
  alpha: 0.5,
  formatClass: 'recall-style',
  steering: {},
  structureSummary: null,
  eligibleCount: 1,
};

function item(overrides: Partial<PaperGeneratedItem> & { slotId: string }): PaperGeneratedItem {
  return {
    conceptKey: overrides.slotId,
    conceptName: overrides.slotId,
    taskId: 'quiz.generate.v1',
    promptVersion: 'v1',
    groundingTier: 'T2',
    groundingLabel: 'covered-by-her-material',
    heldSourceKind: 'notes',
    heldSourceId: 's1',
    response: { stem: 'x' },
    ...overrides,
  };
}

describe('createPaper — always mints, never a lookup (ruling 5)', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-store-'));
    vault = new FolderSource(root);
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
    const handedOff = await handOffPaperItem(vault, created.id, 'slot-0', {
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

    const repeated = await handOffPaperItem(vault, created.id, 'slot-0');
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
    const afterHandoff = await handOffPaperItem(vault, created.id, 'slot-0');
    expect(afterResponse.items).toEqual(created.items);
    expect(afterHandoff.items).toEqual(created.items);
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
