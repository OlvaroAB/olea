/**
 * `runDemandDriver` tests (`ol-egov.141.89.7.52`). Scenarios: F4.1, "each part of a recorded paper
 * structure is read for its demand...", "an unavailable or untrustworthy demand answer leaves the part
 * unread...", "a structure already read spends nothing again", "nothing to read sends nothing".
 * Synthetic ids and wording only.
 */

import { partDemandView } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { runDemandDriver } from '../../src/scope-reading/demand-driver.js';
import type { ExtractionRecordInput } from '../../src/scope-reading/persistence.js';
import { demandAnswer, STAMP, setup, transport, unit, unitsOf } from './drivers-kit.js';

const PAPER_REF = {
  sourcePath: 'doc-a',
  documentKind: 'past-paper',
  revisionDigest: 'r1',
} as const;

const units = [
  unit('Section heading text.', 1),
  unit('Shared stem text.', 1),
  unit('A table of invented numbers.', 1),
  unit('Find the first quantity.', 2),
  unit('Use that to find the second quantity.', 2),
  unit('Second group stem text.', 3),
  unit('Compare the two options.', 3),
];

type Structure = ExtractionRecordInput['paperStructure'];

/** The fixture paper, with `over` merged in and the `drop` keys removed (an absent key, never an undefined one). */
const paper = (
  over: Partial<Structure> = {},
  drop: readonly (keyof Structure)[] = [],
): ExtractionRecordInput => {
  const input = paperWith(over);
  const structure: Record<string, unknown> = { ...input.paperStructure };
  for (const key of drop) delete structure[key];
  return { ...input, paperStructure: structure as unknown as Structure };
};

const paperWith = (over: Partial<Structure> = {}): ExtractionRecordInput => ({
  sourcePath: 'doc-a',
  documentKind: 'past-paper',
  revisionDigest: 'r1',
  coverage: { unitsRead: 7, unitsTotal: 7 },
  declarationCount: 0,
  stamp: STAMP,
  paperStructure: {
    sections: [
      {
        label: 'One',
        questionForm: 'short answer',
        itemCount: 3,
        marks: 12,
        anchor: { blockIndex: 0 },
      },
    ],
    questionGroups: [
      {
        id: 'sec',
        kind: 'section',
        label: 'Section one',
        memberLabels: [],
        anchor: { blockIndex: 0 },
        stimulus: { status: 'none' },
      },
      {
        id: 'g1',
        kind: 'shared-stimulus',
        label: 'Q1',
        parentGroupId: 'sec',
        memberLabels: ['1a', '1b'],
        anchor: { blockIndex: 1 },
        stimulus: { status: 'identified', form: 'table', anchor: { blockIndex: 2 } },
      },
      {
        id: 'g2',
        kind: 'parent-question',
        label: 'Q2',
        parentGroupId: 'sec',
        memberLabels: ['2'],
        anchor: { blockIndex: 5 },
        stimulus: { status: 'none' },
      },
    ],
    questionParts: [
      {
        id: 'p1',
        label: '1a',
        groupId: 'g1',
        instructionAnchor: { blockIndex: 3 },
        questionForm: 'short answer',
        marks: 4,
      },
      {
        id: 'p2',
        label: '1b',
        groupId: 'g1',
        instructionAnchor: { blockIndex: 4 },
        questionForm: 'short answer',
        dependsOn: { status: 'stated', onPartIds: ['p1'] },
      },
      {
        id: 'p3',
        label: '2',
        groupId: 'g2',
        instructionAnchor: { blockIndex: 6 },
        questionForm: 'short answer',
        marks: 4,
      },
    ],
    ...over,
  },
});

async function start(input = paper()) {
  const { persistence } = setup();
  const recorded = await persistence.recordExtraction(input);
  return { persistence, recorded };
}

describe('the demand driver', () => {
  it('sends one request per part, in its full context, and stores each answer against the structure', async () => {
    const { persistence, recorded } = await start();
    const { transport: t, sent } = transport((s) => demandAnswer(s));
    const result = await runDemandDriver({
      persistence,
      ref: PAPER_REF,
      recorded,
      units,
      transport: t,
    });

    expect(result).toEqual({ sent: 3, recorded: 3, skipped: 0 });
    expect(sent.every((s) => s.taskId === 'demand.classify.v1')).toBe(true);
    const p2 = sent[1]?.payload as {
      part: { partId: string; instruction: { text: string }; marks?: number };
      section: { heading: { text: string } };
      group: { stem: { text: string }[]; stimulus: { status: string; form: string } };
      dependsOn: { partId: string; instruction: { text: string } }[];
    };
    expect(p2.part.partId).toBe('p2');
    expect(p2.part.instruction.text).toBe('Use that to find the second quantity.');
    expect(p2.part.marks).toBeUndefined();
    expect(p2.section.heading.text).toBe('Section heading text.');
    expect(p2.group.stem.map((p) => p.text)).toEqual([
      'Shared stem text.',
      'A table of invented numbers.',
    ]);
    expect(p2.group.stimulus).toMatchObject({ status: 'identified', form: 'table' });
    expect(p2.dependsOn).toEqual([
      { partId: 'p1', label: '1a', instruction: { ref: 'u3', text: 'Find the first quantity.' } },
    ]);
    expect(JSON.stringify(sent)).not.toContain('unitIndex');

    const projection = await persistence.load();
    for (const id of ['p1', 'p2', 'p3']) {
      const view = partDemandView(projection, PAPER_REF, id);
      expect(view).toMatchObject({
        status: 'current',
        demand: { status: 'decided', demand: 'calculate' },
        provenance: { task: 'demand.classify.v1', promptVersion: 'p1', modelId: 'm1' },
      });
    }
    // The refs the answer cited come back as unit ordinals.
    expect(projection.partDemands.size).toBe(3);
  });

  it('leaves a refused or unreachable part with no record, and sends nothing after the service is unreachable', async () => {
    const { persistence, recorded } = await start();
    const { transport: t, sent } = transport((s, n) => {
      if (n === 1) return demandAnswer(s);
      if (n === 2)
        return {
          ok: true,
          stamp: STAMP,
          result: { verdict: { kind: 'demand', demand: 'not-a-demand' }, refs: ['u4'] },
        };
      throw new Error('offline');
    });
    const errors: unknown[] = [];
    const spy = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    try {
      const result = await runDemandDriver({
        persistence,
        ref: PAPER_REF,
        recorded,
        units,
        transport: t,
      });
      expect(result).toEqual({ sent: 3, recorded: 1, skipped: 0 });
    } finally {
      console.error = spy;
    }
    expect(sent).toHaveLength(3);
    const projection = await persistence.load();
    expect(partDemandView(projection, PAPER_REF, 'p1').status).toBe('current');
    expect(partDemandView(projection, PAPER_REF, 'p2').status).toBe('not-yet-read');
    expect(partDemandView(projection, PAPER_REF, 'p3').status).toBe('not-yet-read');
  });

  it('stops at the first unreachable answer', async () => {
    const { persistence, recorded } = await start();
    const { transport: t, sent } = transport(() => {
      throw new Error('offline');
    });
    const spy = console.error;
    console.error = () => undefined;
    try {
      await runDemandDriver({ persistence, ref: PAPER_REF, recorded, units, transport: t });
    } finally {
      console.error = spy;
    }
    expect(sent).toHaveLength(1);
    expect((await persistence.load()).partDemands.size).toBe(0);
  });

  it('spends nothing again on a structure already read', async () => {
    const { persistence, recorded } = await start();
    const { transport: t, sent } = transport((s) => demandAnswer(s));
    await runDemandDriver({ persistence, ref: PAPER_REF, recorded, units, transport: t });
    const again = await persistence.recordExtraction(paper());
    expect(again.structure?.structureId).toBe(recorded.structure?.structureId);
    const second = await runDemandDriver({
      persistence,
      ref: PAPER_REF,
      recorded: again,
      units,
      transport: t,
    });
    expect(second).toEqual({ sent: 0, recorded: 0, skipped: 3 });
    expect(sent).toHaveLength(3);
  });

  it('skips a part whose units are not in this delivery, with no record', async () => {
    const { persistence, recorded } = await start();
    const { transport: t, sent } = transport((s) => demandAnswer(s));
    const result = await runDemandDriver({
      persistence,
      ref: PAPER_REF,
      recorded,
      units: units.slice(0, 5),
      transport: t,
    });
    expect(result).toEqual({ sent: 2, recorded: 2, skipped: 1 });
    expect(sent.map((s) => (s.payload.part as { partId: string }).partId)).toEqual(['p1', 'p2']);
  });

  it('sends nothing for an objectives document, a paper with no structure, or a structure without parts', async () => {
    const { transport: t, sent } = transport((s) => demandAnswer(s));
    const a = setup();
    const objectives = await a.persistence.recordExtraction({
      sourcePath: 'doc-o',
      documentKind: 'objectives',
      revisionDigest: 'r1',
      coverage: { unitsRead: 2, unitsTotal: 2 },
      declarationCount: 2,
      paperStructure: { sections: [] },
      stamp: STAMP,
    });
    await runDemandDriver({
      persistence: a.persistence,
      ref: { sourcePath: 'doc-o', documentKind: 'objectives', revisionDigest: 'r1' },
      recorded: objectives,
      units: unitsOf(2),
      transport: t,
    });
    const empty = await start(paper({ sections: [] }, ['questionGroups', 'questionParts']));
    expect(empty.recorded.structure).toBeUndefined();
    await runDemandDriver({
      persistence: empty.persistence,
      ref: PAPER_REF,
      recorded: empty.recorded,
      units,
      transport: t,
    });
    const noParts = await start(paper({}, ['questionParts']));
    expect(noParts.recorded.structure).toBeDefined();
    await runDemandDriver({
      persistence: noParts.persistence,
      ref: PAPER_REF,
      recorded: noParts.recorded,
      units,
      transport: t,
    });
    expect(sent).toHaveLength(0);
  });
});
