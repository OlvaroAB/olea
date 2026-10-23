/**
 * F8.4b in v0.9 ([D-603], [D-614]): the registry's explain-back history lists her saved practice
 * explanations — one row each by date, her text only on expansion and only through the [D-077]
 * content store, no reading of any kind on a row. Scenarios: `features/F8-concepts-scope.md`
 * "F8.4b in v0.9", tagged `@auto:plugin/registry/explain-back-history-practice.spec`.
 *
 * The rows are projected from a real log written by the real writers over an in-memory vault, then
 * drawn by the shipped `renderExplainBackHistorySection` into a small fake DOM. Ids and text are
 * structural placeholders (INV-3).
 */
import {
  appendNonAttemptRecord,
  type PracticeExplanationHistoryEntry,
  practiceExplanationHistoryByInstrument,
  type RegistryInstrumentSummary,
  readContentRecord,
  readReviewLogHistory,
  recordPracticeExplanation,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { memoryVault } from '../review/memory-vault.js';

vi.mock('obsidian', () => ({ ItemView: class {} }));

import { renderExplainBackHistorySection } from '../../src/registry/view.js';

type HistoryRow = RegistryInstrumentSummary['explainBackHistory'][number];

class FakeEl {
  text = '';
  open = false;
  readonly children: FakeEl[] = [];
  readonly classes = new Set<string>();
  private readonly handlers = new Map<string, (() => void)[]>();
  constructor(readonly tag: string) {}
  createEl(tag: string, options?: { text?: string; cls?: string }): FakeEl {
    const child = new FakeEl(tag);
    child.text = options?.text ?? '';
    if (options?.cls !== undefined) child.classes.add(options.cls);
    this.children.push(child);
    return child;
  }
  createDiv(options?: { cls?: string }): FakeEl {
    return this.createEl('div', options);
  }
  addClass(cls: string): void {
    this.classes.add(cls);
  }
  setText(text: string): void {
    this.text = text;
  }
  addEventListener(type: string, handler: () => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  expand(): void {
    this.open = true;
    for (const handler of this.handlers.get('toggle') ?? []) handler();
  }
  find(tag: string): FakeEl[] {
    return [...(this.tag === tag ? [this] : []), ...this.children.flatMap((c) => c.find(tag))];
  }
  allText(): string {
    return [this.text, ...this.children.map((child) => child.allText())].join(' ');
  }
}

const QUESTION = 'explain-back:concept-a';

async function save(
  vault: VaultSource,
  attemptId: string,
  timestamp: string,
  answer: string,
  localCheckFlagged = false,
): Promise<void> {
  await recordPracticeExplanation(
    vault,
    {
      timestamp,
      instrumentId: QUESTION,
      attemptId,
      conceptIds: ['concept-a'],
      promptShape: 'concept',
      trigger: 'on-demand',
      durationMs: 30000,
      answer,
      passagesShownInView: [],
      ...(localCheckFlagged ? { localCheckFlagged: true as const } : {}),
    },
    { deviceId: 'desktop', generateContentId: () => `desktop.${attemptId}` },
  );
}

async function practiceRows(vault: VaultSource): Promise<HistoryRow[]> {
  const { entries } = await readReviewLogHistory(vault);
  const list: readonly PracticeExplanationHistoryEntry[] =
    practiceExplanationHistoryByInstrument(entries).get(QUESTION) ?? [];
  return list.map((entry) => ({
    kind: 'practice' as const,
    eventId: entry.eventId,
    timestamp: entry.timestamp,
    contested: false as const,
    contentRef: entry.contentRef,
  }));
}

function draw(
  rows: readonly HistoryRow[],
  readText?: (ref: string) => Promise<string | null>,
): FakeEl {
  const root = new FakeEl('div');
  renderExplainBackHistorySection(root as unknown as HTMLElement, rows, readText);
  return root;
}

describe('F8.4b in v0.9: her practice explanations in the registry history', () => {
  it('lists three explanations saved on three dates as three rows, oldest first, each showing its date alone', async () => {
    const vault = memoryVault();
    await save(vault, 'a-3', '2026-10-23T09:00:00-04:00', 'synthetic three');
    await save(vault, 'a-1', '2026-10-21T09:00:00-04:00', 'synthetic one');
    await save(vault, 'a-2', '2026-10-22T09:00:00-04:00', 'synthetic two');
    const root = draw(await practiceRows(vault));
    expect(root.find('h5')[0]?.text).toBe('Explain-back history');
    expect(root.find('summary').map((el) => el.text)).toEqual([
      '21 Oct 2026',
      '22 Oct 2026',
      '23 Oct 2026',
    ]);
  });

  it('reopening the view any number of times never adds a row', async () => {
    const vault = memoryVault();
    await save(vault, 'a-1', '2026-10-21T09:00:00-04:00', 'synthetic one');
    for (let reopen = 0; reopen < 4; reopen += 1) {
      expect(draw(await practiceRows(vault)).find('li')).toHaveLength(1);
    }
  });

  it('an answer the local check flagged is still her saved text, so it has a row', async () => {
    const vault = memoryVault();
    await save(vault, 'a-1', '2026-10-21T09:00:00-04:00', 'synthetic flagged', true);
    expect(draw(await practiceRows(vault)).find('li')).toHaveLength(1);
  });

  it('her text appears only on expansion, resolved through the content store; the collapsed row never touches it', async () => {
    const vault = memoryVault();
    await save(vault, 'a-1', '2026-10-21T09:00:00-04:00', 'synthetic words of hers');
    const reads: string[] = [];
    const readText = async (ref: string): Promise<string | null> => {
      reads.push(ref);
      const found = await readContentRecord(vault, ref);
      return found.status === 'found' ? found.record.studentAnswer : null;
    };
    const root = draw(await practiceRows(vault), readText);

    expect(reads).toEqual([]);
    expect(root.allText()).not.toContain('synthetic words of hers');

    const details = root.find('details')[0];
    details?.expand();
    await vi.waitFor(() => expect(root.allText()).toContain('synthetic words of hers'));
    expect(reads).toEqual(['desktop.a-1']);

    // Collapsing and expanding again does not read twice.
    details?.expand();
    expect(reads).toEqual(['desktop.a-1']);
  });

  it('a practice row carries no depth, grade, verdict, score, number or contested marker', async () => {
    const vault = memoryVault();
    await save(vault, 'a-1', '2026-10-21T09:00:00-04:00', 'synthetic one');
    const root = draw(await practiceRows(vault));
    const shown = root.find('li')[0]?.find('summary')[0]?.text ?? '';
    expect(shown).toBe('21 Oct 2026');
    expect(shown).not.toMatch(/re-review|depth|grade|score|verdict|%/i);
    expect(
      root.find('li').every((el) => !el.classes.has('olea-registry-explain-back-contested')),
    ).toBe(true);
  });

  it('a skipped prompt and a prompt closed without an answer have no row, and nothing says one happened', async () => {
    const vault = memoryVault();
    await appendNonAttemptRecord(
      vault,
      { timestamp: '2026-10-21T09:00:00-04:00', conceptIds: ['concept-a'], trigger: 'on-demand' },
      { deviceId: 'desktop', generateEventId: () => 'na-1' },
    );
    const rows = await practiceRows(vault);
    expect(rows).toEqual([]);
    expect(draw(rows).find('li')).toHaveLength(0);
    expect(draw(rows).allText().trim()).toBe('');
  });

  it('a graded row is its line alone, with the contested marker where live and no depth phrase', () => {
    const root = draw([
      { kind: 'graded', eventId: 'g-1', timestamp: '2026-10-20T09:00:00-04:00', contested: false },
      { kind: 'graded', eventId: 'g-2', timestamp: '2026-10-22T09:00:00-04:00', contested: true },
    ]);
    expect(root.find('li').map((el) => el.text)).toEqual([
      '20 Oct 2026',
      '22 Oct 2026 (under re-review)',
    ]);
  });
});
