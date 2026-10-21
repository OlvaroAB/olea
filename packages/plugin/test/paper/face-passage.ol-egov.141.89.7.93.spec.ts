/**
 * A group's held passage on the paper's face (`[D-562]`, `ol-egov.141.89.7.93`; F4.11): above the
 * group's parts, her text exactly as held and its source's path, the way the partial banner lists
 * its pointer paths, with no label or sentence of Olea's. Composes through the real journal, then
 * renders through the real `PaperView` with a fake DOM (`fake-dom.helper.ts`).
 *
 * Scenario: olea-service/features/F4-oracle.md, "a group that shares material is requested with one
 * passage from her held material" ("the group carries that one passage with its source"). Course A,
 * synthetic notes and paths only (INV-3).
 */
import {
  buildPaperBlueprint,
  type ConceptRecord,
  extentSlotCountTarget,
  type PaperItemGenerationRequest,
  type PaperStructureTemplate,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: unknown;
    constructor(_leaf: unknown) {
      this.contentEl = (globalThis as { __rootFactory?: () => unknown }).__rootFactory?.();
    }
  },
}));

import type { PaperItemPortOutcome } from '../../src/oracle/paper-item-port.js';
import { buildBlueprintInputForCourse } from '../../src/paper/assemble.js';
import {
  composePaperThroughJournal,
  type PaperStimulusLookup,
} from '../../src/paper/journal-composition.js';
import {
  buildReadyStateFromRecord,
  facePassagesBeforeItems,
  type PracticePaperFacePassage,
  type PracticePaperReadyState,
} from '../../src/paper/provider.js';
import { PAPER_HANDOFF_BUTTON_LABEL, PaperView } from '../../src/paper/view.js';
import { memoryVault } from '../review/memory-vault.js';
import { FakeEl } from './fake-dom.helper.js';

const COURSE = 'COURSEA';
const PASSAGE = '| Year | Units |\n| --- | --- |\n| 2020 | 10 |\n';
const SOURCE = '01 Courses/COURSEA/Topic 1.md';

function concept(index: number): ConceptRecord {
  return {
    key: `concept-${index}`,
    name: `Topic ${String.fromCharCode(65 + index)}`,
    tier: 1,
    courses: [COURSE],
    sourcePaths: [`01 Courses/${COURSE}/Topic ${index}.md`],
    boundNotePath: `01 Courses/${COURSE}/Topic ${index}.md`,
    definition: `her own note on topic ${index}`,
  };
}

/** Question 1 (1(a), 1(b) on 1(a)) and question 2 on a shared table (2(a), 2(b)). */
const TEMPLATE: PaperStructureTemplate = {
  groups: [
    {
      id: 'q1',
      kind: 'parent-question',
      label: 'Question 1',
      memberLabels: ['1(a)', '1(b)'],
      anchor: null,
      stimulus: { status: 'none' },
    },
    {
      id: 'q2',
      kind: 'shared-stimulus',
      label: 'Use the table',
      memberLabels: ['2(a)', '2(b)'],
      anchor: null,
      stimulus: { status: 'identified', form: 'table', anchor: null },
    },
  ],
  parts: [
    {
      id: 'p1a',
      label: '1(a)',
      groupId: 'q1',
      questionForm: 'short answer',
      marks: { status: 'unknown' },
      dependsOn: { status: 'unknown' },
    },
    {
      id: 'p1b',
      label: '1(b)',
      groupId: 'q1',
      questionForm: 'short answer',
      marks: { status: 'unknown' },
      dependsOn: { status: 'stated', onPartIds: ['p1a'] },
    },
    {
      id: 'p2a',
      label: '2(a)',
      groupId: 'q2',
      questionForm: 'short answer',
      marks: { status: 'unknown' },
      dependsOn: { status: 'unknown' },
    },
    {
      id: 'p2b',
      label: '2(b)',
      groupId: 'q2',
      questionForm: 'short answer',
      marks: { status: 'unknown' },
      dependsOn: { status: 'unknown' },
    },
  ],
  totalMarks: { status: 'unknown' },
  timeAllowance: { status: 'unknown' },
};

const generated = (request: PaperItemGenerationRequest): PaperItemPortOutcome => ({
  status: 'generated',
  taskId: request.taskId,
  promptVersion: 'v1',
  response: {
    ok: true,
    stamp: { promptVersion: 'v1' },
    result: {
      questions: [{ stem: 'q', correctAnswer: 'a', distractors: ['x', 'y', 'z'], feedback: 'f' }],
      cards: [{ front: 'q', back: 'a' }],
    },
  },
});

const held: PaperStimulusLookup = async () => ({
  status: 'held',
  stimulus: { form: 'table', sourceId: SOURCE, chunkIndex: 0 },
  text: PASSAGE,
});

let nonce = 0;
async function composedState(
  port: (request: PaperItemGenerationRequest) => Promise<PaperItemPortOutcome>,
): Promise<PracticePaperReadyState> {
  const concepts = Array.from({ length: 4 }, (_, index) => concept(index));
  const input = await buildBlueprintInputForCourse(
    memoryVault(),
    concepts,
    [{ course: COURSE, type: 'exam', due: '2026-09-22' }],
    COURSE,
    '2026-09-19',
    [],
    {
      sittingCount: 1,
      currentCount: 0,
      historicalCount: 0,
      sittings: [
        {
          regime: 'unknown',
          sections: [{ label: 'A', questionForm: 'x', itemCount: 4, marks: { status: 'unknown' } }],
        },
      ],
      template: TEMPLATE,
    },
  );
  const result = await composePaperThroughJournal({
    vault: memoryVault(),
    blueprint: buildPaperBlueprint(input),
    scope: { eligibleConceptKeys: concepts.map((c) => c.key), outcomes: [] },
    port,
    options: { generateId: () => `face-${++nonce}`, now: () => '2026-09-19T00:00:00.000Z' },
    extent: {
      slotCount: extentSlotCountTarget(input.steering?.extent, input.structure),
      planAt: (slotCount) => buildPaperBlueprint({ ...input, slotCount }),
    },
    template: TEMPLATE,
    stimulusLookup: held,
  });
  if (result.kind !== 'finished') throw new Error('expected a finished paper');
  return buildReadyStateFromRecord(COURSE, result.record, { passages: result.passages });
}

async function render(state: PracticePaperReadyState): Promise<FakeEl> {
  const root = new FakeEl('root');
  (globalThis as { __rootFactory?: () => unknown }).__rootFactory = () => root;
  const view = new PaperView(
    {} as never,
    {
      load: async () => state,
      requestPaper: async () => state,
      handOffItem: async () => ({}) as never,
    },
    COURSE,
  );
  await view.refresh();
  return root;
}

/** The rows of the items list: an item row starts with its concept name, a passage row with her text. */
function itemsList(root: FakeEl): FakeEl {
  const list = root.children.find((child) => child.tag === 'ul');
  if (list === undefined) throw new Error('no items list');
  return list;
}

describe('a group’s held passage on the paper’s face', () => {
  it('sits above the group’s first part: her text exactly as held, then its source’s path, and nothing else', async () => {
    const state = await composedState(async (request) => generated(request));
    const rows = itemsList(await render(state)).children;
    // 1(a), 1(b), the passage, 2(a), 2(b).
    expect(rows.map((row) => row.children[0]?.tag)).toEqual([
      'strong',
      'strong',
      'p',
      'strong',
      'strong',
    ]);
    const passage = rows[2] as FakeEl;
    expect(passage.children.map((child) => child.tag)).toEqual(['p', 'ul']);
    expect(passage.children[0]?.text).toBe(PASSAGE);
    expect(passage.children[1]?.children.map((li) => [li.tag, li.text])).toEqual([['li', SOURCE]]);
    // No word of Olea's: the passage row's text is her text and the path, exactly.
    expect(passage.allText()).toBe(`${PASSAGE}\n${SOURCE}`);
    expect(rows[3]?.children[0]?.text).toBe('Topic B');
    expect(rows[3]?.allText()).toContain(PAPER_HANDOFF_BUTTON_LABEL);
  });

  it('shows nothing for a group none of whose parts was written, and nothing at all with no passage', async () => {
    const refusedTable = await composedState(async (request) =>
      request.sharedPassage !== undefined
        ? { status: 'refused', reason: 'empty-result' }
        : generated(request),
    );
    expect(refusedTable.passages).toHaveLength(1);
    expect(facePassagesBeforeItems(refusedTable).size).toBe(0);
    const rows = itemsList(await render(refusedTable)).children;
    expect(rows.every((row) => row.children[0]?.tag === 'strong')).toBe(true);
    expect((await render(refusedTable)).allText()).not.toContain(PASSAGE);
  });

  it('an outer group’s passage comes before an inner one’s, each once, before the first of its parts', () => {
    const outer: PracticePaperFacePassage = {
      groupId: 'outer',
      text: 'outer text',
      sourceId: 'Notes/outer.md',
      slotIds: ['slot-0', 'slot-1', 'slot-2'],
    };
    const inner: PracticePaperFacePassage = {
      groupId: 'inner',
      text: 'inner text',
      sourceId: 'Notes/inner.md',
      slotIds: ['slot-1', 'slot-2'],
    };
    const item = (slotId: string) => ({
      slotId,
      conceptName: 'Topic A',
      intendedDemand: 'recall-a-fact' as const,
      groundingLabel: 'covered-by-her-material' as const,
      response: {},
    });
    const before = facePassagesBeforeItems({
      items: [item('slot-1'), item('slot-2')],
      passages: [outer, inner],
    });
    expect(
      [...before].map(([slotId, passages]) => [slotId, passages.map((p) => p.groupId)]),
    ).toEqual([['slot-1', ['outer', 'inner']]]);
  });
});
