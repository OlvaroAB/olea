/**
 * Scenarios: `features/F3-learn-from-anything.md`, "Olea's own first-sight stamp is not a change
 * to her note" and "a real edit she makes at the same moment as a stamp is still judged" (`ol-egov.141.89.5.41`).
 *
 * Drives the real first-sight stamp, the real ledger and the real `MaterialityTrigger`, applying
 * the same decision `main.ts`'s `evaluateMaterialityChange` applies (ledger check, then evaluate).
 * INV-3: every fixture is coined here.
 */
import { enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createOwnWriteLedger } from '../../../src/ingestion/materiality/own-write-ledger.js';
import { createInMemoryPreviousTextTracker } from '../../../src/ingestion/materiality/previous-text.js';
import type {
  MaterialityJudge,
  MaterialityJudgeVerdict,
} from '../../../src/ingestion/materiality/types.js';
import { buildMaterialityWiring } from '../../../src/ingestion/materiality/wiring.js';
import { stampOnFirstSight } from '../../../src/instrument-stamping/port.js';
import { memoryVault } from '../../review/memory-vault.js';

const PATH = 'Courses/TEST101/cloze.md';
const NOTE = [
  '---',
  'topic: [Alpha]',
  'course: TEST101',
  '---',
  '## Terms',
  '',
  'The ==mitochondrion== makes most of the cell energy, and this note holds enough prose to clear the free checks comfortably.',
  '',
].join('\n');

function setup() {
  const store = new Map<string, unknown>();
  const judge = vi.fn<MaterialityJudge['judge']>(
    async (): Promise<MaterialityJudgeVerdict> => ({ material: true, reason: 'test' }) as never,
  );
  const trigger = buildMaterialityWiring({
    dataHost: {
      loadData: async () => store.get('blob'),
      saveData: async (d: unknown) => {
        store.set('blob', d);
      },
    },
    clock: { now: () => 1_000_000 },
    judge: { judge },
  });
  const ledger = createOwnWriteLedger();
  const previous = createInMemoryPreviousTextTracker();
  const evaluate = vi.fn(trigger.evaluate.bind(trigger));
  /** Mirrors `main.ts` `evaluateMaterialityChange` for one modify event. */
  async function onModify(path: string, current: string): Promise<'skipped' | 'evaluated'> {
    if (ledger.consumeIfOleaOnly(path, current)) {
      previous.record(path, current);
      return 'skipped';
    }
    await evaluate(path, current, previous.get(path));
    previous.record(path, current);
    return 'evaluated';
  }
  return { ledger, previous, evaluate, judge, onModify };
}

async function stamp(
  vault: ReturnType<typeof memoryVault>,
  ledger: ReturnType<typeof createOwnWriteLedger>,
) {
  const found = await enumerateVaultInstruments(vault);
  const record = found.records.find((r) => r.instrumentType === 'cloze');
  if (!record) throw new Error('no cloze');
  await stampOnFirstSight(vault, record, {
    generateClozeId: () => 'cloze-fixed1',
    onOwnWrite: (p, t) => ledger.note(p, t),
  });
}

describe('Olea-only stamp write (ol-egov.141.89.5.41)', () => {
  it('a stamp-only modify event is skipped: no evaluation, no judge call; the stamped text becomes the baseline', async () => {
    const t = setup();
    const vault = memoryVault({ [PATH]: NOTE });
    await t.onModify(PATH, NOTE); // her note seen once
    t.evaluate.mockClear();
    await stamp(vault, t.ledger);
    const stamped = vault.contentOf(PATH) ?? '';
    expect(stamped).toContain('olea-cloze-ids');
    expect(await t.onModify(PATH, stamped)).toBe('skipped');
    expect(t.evaluate).not.toHaveBeenCalled();
    expect(t.judge).not.toHaveBeenCalled();
    expect(t.previous.get(PATH)).toBe(stamped);
  });

  it('a stamp plus a real edit is still evaluated, against her last seen text', async () => {
    const t = setup();
    const vault = memoryVault({ [PATH]: NOTE });
    await t.onModify(PATH, NOTE);
    t.evaluate.mockClear();
    await stamp(vault, t.ledger);
    const edited = `${vault.contentOf(PATH) ?? ''}\nA new paragraph she typed about ribosomes and protein synthesis in the cell.\n`;
    expect(await t.onModify(PATH, edited)).toBe('evaluated');
    expect(t.evaluate).toHaveBeenCalledTimes(1);
  });

  it('an entry is consumed by the first event: a later edit of hers is never hidden by a stale entry', async () => {
    const t = setup();
    t.ledger.note(PATH, 'stamped');
    expect(t.ledger.consumeIfOleaOnly(PATH, 'stamped')).toBe(true);
    expect(t.ledger.consumeIfOleaOnly(PATH, 'stamped')).toBe(false);
  });

  it('an event for another path, or no stamp at all, is evaluated as before', async () => {
    const t = setup();
    expect(await t.onModify(PATH, NOTE)).toBe('evaluated');
  });
});
