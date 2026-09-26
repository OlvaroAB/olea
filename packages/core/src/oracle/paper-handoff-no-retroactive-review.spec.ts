// `[D-367]` (ol-0r92.118), the ruling's binding clarification: handing an item
// from a practice paper to ordinary review must never turn her earlier paper
// activity (attempts made before the act) into scored ordinary reviews. Only
// the one deliberate act is affected, going forward from it.
//
// This pins the paper's own half of that: `handOffPaperItem` records the act on
// the paper's sidecar and nothing else. It writes nothing into her review log
// (no review record, with or without an origin, is built from a response she
// gave on the paper), and it leaves the paper's earlier responses exactly as
// they were: still on the paper, still exam-simulation evidence (F4.11). The
// review record that carries `origin: 'practice-paper'` is written later, by
// the ordinary review path, for a review that happens after the act.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REVIEW_LOG_FOLDER } from '../review-log/path.js';
import { FolderSource } from '../vault/folder-source.js';
import type { PaperGeneratedItem } from './paper-items.js';
import {
  createPaper,
  handOffPaperItem,
  type PaperCompositionAccount,
  paperRecordPath,
  recordPaperResponse,
} from './paper-store.js';

const ACCOUNT: PaperCompositionAccount = {
  formatVersion: 'paper-blueprint-v1',
  course: 'COURSEA',
  asOf: '2026-09-26',
  alpha: 0.5,
  formatClass: 'recall-style',
  intendedDemand: 'recall-a-fact',
  steering: {},
  structureSummary: null,
  eligibleCount: 2,
  unbuiltDemand: null,
  partial: false,
};

function item(slotId: string): PaperGeneratedItem {
  return {
    slotId,
    conceptKey: slotId,
    conceptName: slotId,
    taskId: 'quiz.generate.v1',
    promptVersion: 'v1',
    intendedDemand: 'recall-a-fact',
    groundingTier: 'T2',
    groundingLabel: 'covered-by-her-material',
    heldSourceKind: 'notes',
    heldSourceId: 's1',
    response: { stem: 'x' },
  };
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();
}

describe('handOffPaperItem — never converts earlier paper activity into review evidence ([D-367])', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-handoff-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes only the paper’s own record: no review-log file exists after attempts and a hand-off', async () => {
    const paper = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-26',
      compositionAccount: ACCOUNT,
      items: [item('slot-1'), item('slot-2')],
      emptySlots: [],
    });
    await recordPaperResponse(vault, paper.id, 'slot-1', 'first attempt');
    await recordPaperResponse(vault, paper.id, 'slot-1', 'second attempt');
    await recordPaperResponse(vault, paper.id, 'slot-2', 'other item');

    await handOffPaperItem(vault, paper.id, 'slot-1');

    expect(await filesUnder(root)).toEqual([paperRecordPath(paper.id)]);
    expect((await filesUnder(root)).some((path) => path.startsWith(REVIEW_LOG_FOLDER))).toBe(false);
  });

  it('leaves the earlier responses on the paper exactly as recorded, and records only the one act', async () => {
    const paper = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-26',
      compositionAccount: ACCOUNT,
      items: [item('slot-1'), item('slot-2')],
      emptySlots: [],
    });
    await recordPaperResponse(vault, paper.id, 'slot-1', 'first attempt', {
      now: () => '2026-09-26T09:00:00-04:00',
    });
    await recordPaperResponse(vault, paper.id, 'slot-2', 'other item', {
      now: () => '2026-09-26T09:05:00-04:00',
    });
    const before = JSON.parse(await readFile(join(root, paperRecordPath(paper.id)), 'utf8'));

    const after = await handOffPaperItem(vault, paper.id, 'slot-1', {
      now: () => '2026-09-26T09:30:00-04:00',
    });

    expect(after.responses).toEqual(before.responses);
    expect(after.items).toEqual(before.items);
    expect(after.handoffs).toEqual([
      {
        slotId: 'slot-1',
        elicitingContextLabel: 'from a practice paper',
        handedOffAt: '2026-09-26T09:30:00-04:00',
      },
    ]);
  });
});
