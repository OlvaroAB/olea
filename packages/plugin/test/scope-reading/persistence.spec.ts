/**
 * `persistence.ts` tests — the plugin module that persists the examiner-scope reading (`[D-429]`).
 *
 * Scenarios: olea-service/features/F8-concepts-scope.md, F8.1 / F4.1, filed as owed on the D-429
 * build bead (the features file is outside this lane's paths). Synthetic ids and labels only.
 */

import { describe, expect, it } from 'vitest';
import { discoverOleaLayerPaths, isInOleaLayerRole } from '../../src/privacy/log-discovery.js';
import {
  createScopeReadingPersistence,
  type ExtractionRecordInput,
  scopePaperStructureFrom,
} from '../../src/scope-reading/persistence.js';
import { memoryVault } from '../review/memory-vault.js';

const STAMP = { promptVersion: '1.1.0', modelId: 'model-a' };
const NO_STRUCTURE = { sections: [] } as const;
const PAPER_REF = {
  sourcePath: 'doc-a',
  documentKind: 'past-paper',
  revisionDigest: 'r1',
} as const;
const OBJ_REF = { sourcePath: 'doc-o', documentKind: 'objectives', revisionDigest: 'r1' } as const;

let tick = 0;
const now = () => `2026-09-29T00:00:${String(tick++ % 60).padStart(2, '0')}.000Z`;

function make(deviceId = 'olea-dev1', vault = memoryVault()) {
  return { vault, persistence: createScopeReadingPersistence({ vault, deviceId, now }) };
}

const objectives = (over: Partial<ExtractionRecordInput> = {}): ExtractionRecordInput => ({
  sourcePath: 'doc-o',
  documentKind: 'objectives',
  revisionDigest: 'r1',
  coverage: { unitsRead: 4, unitsTotal: 4 },
  declarationCount: 3,
  paperStructure: NO_STRUCTURE,
  stamp: STAMP,
  ...over,
});

const paper = (over: Partial<ExtractionRecordInput> = {}): ExtractionRecordInput => ({
  sourcePath: 'doc-a',
  documentKind: 'past-paper',
  revisionDigest: 'r1',
  coverage: { unitsRead: 6, unitsTotal: 6 },
  declarationCount: 0,
  paperStructure: {
    sections: [
      {
        label: 'Section one',
        questionForm: 'short answer',
        itemCount: 3,
        marks: 20,
        anchor: { blockIndex: 1 },
      },
    ],
    questionGroups: [
      {
        id: 'g1',
        kind: 'shared-stimulus',
        label: 'A table',
        memberLabels: ['1', '2'],
        anchor: { blockIndex: 2 },
        stimulus: { status: 'identified', form: 'table', anchor: { blockIndex: 3 } },
      },
      {
        id: 'g2',
        kind: 'choice',
        label: 'Answer one',
        parentGroupId: 'g1',
        memberLabels: ['3', '4'],
        choose: 1,
        anchor: { blockIndex: 4 },
        stimulus: { status: 'not-identified', reason: 'no-cue' },
      },
    ],
  },
  stamp: STAMP,
  ...over,
});

describe('which state an extraction is: recorded, read-states-nothing, or partly read', () => {
  it('records declarations found over a fully read objectives document as recorded, with the reader provenance', async () => {
    const { persistence } = make();
    expect(await persistence.recordExtraction(objectives())).toMatchObject({
      state: 'recorded',
      stamp: STAMP,
    });
    const reading = await persistence.readDocument(OBJ_REF);
    expect(reading.state).toMatchObject({
      status: 'known',
      state: { kind: 'recorded' },
      provenance: { task: 'outcomes.extract.v1', promptVersion: '1.1.0', modelId: 'model-a' },
    });
  });

  it('records nothing found over a document read IN FULL as read-states-nothing: an empty result', async () => {
    const { persistence } = make();
    expect(await persistence.recordExtraction(objectives({ declarationCount: 0 }))).toMatchObject({
      state: 'read-states-nothing',
    });
    expect((await persistence.readDocument(OBJ_REF)).state).toMatchObject({
      state: { kind: 'read-states-nothing' },
    });
  });

  it('never calls nothing found over a document read only in part empty: it is partly read', async () => {
    const { persistence } = make();
    const result = await persistence.recordExtraction(
      objectives({ declarationCount: 0, coverage: { unitsRead: 2, unitsTotal: 5 } }),
    );
    expect(result).toMatchObject({ state: 'partly-read' });
    expect((await persistence.readDocument(OBJ_REF)).state).toMatchObject({
      state: { kind: 'partly-read', unitsRead: 2, unitsTotal: 5 },
    });
  });

  it('keeps pending, empty and not-yet-known as three different answers', async () => {
    const { persistence } = make();
    await persistence.recordPending(PAPER_REF, 'unavailable');
    await persistence.recordExtraction(objectives({ declarationCount: 0 }));
    const pending = await persistence.readDocument(PAPER_REF);
    const empty = await persistence.readDocument(OBJ_REF);
    const unknown = await persistence.readDocument({ ...OBJ_REF, sourcePath: 'never-seen' });
    expect(pending.state).toMatchObject({ state: { kind: 'pending', reason: 'unavailable' } });
    expect(empty.state).toMatchObject({ state: { kind: 'read-states-nothing' } });
    expect(unknown.state.status).toBe('unknown');
    expect(pending.structure.status).toBe('absent');
  });

  it('lets a later extraction supersede an owed one for the same revision', async () => {
    const { persistence } = make();
    await persistence.recordPending(OBJ_REF, 'over-budget');
    await persistence.recordExtraction(objectives());
    expect((await persistence.readDocument(OBJ_REF)).state).toMatchObject({
      state: { kind: 'recorded' },
    });
  });

  it('an extraction that finds no structure in a fully read paper is read-states-nothing and writes no structure', async () => {
    const { persistence } = make();
    expect(
      await persistence.recordExtraction(paper({ paperStructure: NO_STRUCTURE })),
    ).toMatchObject({
      state: 'read-states-nothing',
    });
    expect((await persistence.readDocument(PAPER_REF)).structure.status).toBe('absent');
  });
});

describe('the paper-structure reading', () => {
  it('persists the reading behind a recorded state and reads it back current, groups and stimulus anchors mapped to unit ordinals', async () => {
    const { persistence } = make();
    await persistence.recordExtraction(paper());
    const reading = await persistence.readDocument(PAPER_REF);
    expect(reading.state).toMatchObject({ state: { kind: 'recorded' } });
    expect(reading.structure.status).toBe('current');
    if (reading.structure.status !== 'current') return;
    const structure = reading.structure.reading;
    expect(structure.sections[0]).toMatchObject({
      marks: { status: 'stated', value: 20 },
      anchor: { unitIndex: 1 },
    });
    expect(structure.groups?.[0]).toMatchObject({
      anchor: { unitIndex: 2 },
      stimulus: { status: 'identified', form: 'table', anchor: { unitIndex: 3 } },
    });
    expect(structure.groups?.[1]).toMatchObject({
      parentGroupId: 'g1',
      choose: 1,
      stimulus: { status: 'not-identified' },
    });
    // No parts were carried by this reader: absent, which is not the same as none.
    expect('parts' in structure).toBe(false);
    expect(structure.totalMarks).toEqual({ status: 'unknown' });
    expect(structure.timeAllowance).toEqual({ status: 'unknown' });
    expect(reading.structure.provenance).toMatchObject({ promptVersion: '1.1.0' });
  });

  it('writes the structure reading BEFORE the state that says it exists', async () => {
    const { persistence, vault } = make();
    await persistence.recordExtraction(paper());
    const order = vault.writes.filter((path) => path.includes('.jsonl'));
    expect(order[0]).toContain('paper-structure.');
    expect(order[1]).toContain('document-state.');
  });

  it('keeps unknown marks unknown, and carries parts, a total and a time allowance when the reader supplies them', () => {
    const mapped = scopePaperStructureFrom({
      sections: [{ label: 'S', questionForm: 'essay', itemCount: 1, anchor: { blockIndex: 0 } }],
      questionParts: [
        {
          id: 'p1',
          label: '1(a)',
          groupId: 'g1',
          instructionAnchor: { blockIndex: 5 },
          questionForm: 'short answer',
        },
        {
          id: 'p2',
          label: '1(b)',
          groupId: 'g1',
          instructionAnchor: { blockIndex: 6 },
          questionForm: 'short answer',
          marks: 4,
          dependsOn: { status: 'stated', onPartIds: ['p1'] },
        },
      ],
      totalMarks: 50,
      timeAllowanceMinutes: 90,
    });
    expect(mapped.sections[0]?.marks).toEqual({ status: 'unknown' });
    expect(mapped.parts?.[0]).toMatchObject({
      marks: { status: 'unknown' },
      dependsOn: { status: 'unknown' },
    });
    expect(mapped.parts?.[1]).toMatchObject({
      marks: { status: 'stated', value: 4 },
      dependsOn: { status: 'stated', onPartIds: ['p1'] },
      instructionAnchor: { unitIndex: 6 },
    });
    expect(mapped.totalMarks).toEqual({ status: 'stated', value: 50 });
    expect(mapped.timeAllowance).toEqual({ status: 'stated', minutes: 90 });
  });
});

describe('stale readings are invalidated on read', () => {
  it('a changed document finds nothing current: state unknown, structure stale-revision and not handed out', async () => {
    const { persistence } = make();
    await persistence.recordExtraction(paper());
    const next = await persistence.readDocument({ ...PAPER_REF, revisionDigest: 'r2' });
    expect(next.state).toEqual({ status: 'unknown', otherRevisionsRecorded: true });
    expect(next.structure).toEqual({ status: 'stale-revision' });
  });

  it('a reader version the caller no longer accepts reads stale-reader, kept and never current', async () => {
    const { persistence } = make();
    await persistence.recordExtraction(paper());
    const view = await persistence.readDocument(PAPER_REF, { acceptedReaderVersions: ['1.2.0'] });
    expect(view.structure.status).toBe('stale-reader');
  });
});

describe('two installs on one vault', () => {
  it('fold to one projection, the later write (which saw the earlier) winning', async () => {
    const vault = memoryVault();
    const a = make('olea-a', vault).persistence;
    const b = make('olea-b', vault).persistence;
    await a.recordPending(OBJ_REF, 'unavailable');
    await b.recordExtraction(objectives());
    expect((await a.readDocument(OBJ_REF)).state).toEqual((await b.readDocument(OBJ_REF)).state);
    expect((await a.readDocument(OBJ_REF)).state).toMatchObject({ state: { kind: 'recorded' } });
  });
});

describe('F7.4: the files are Olea layer records the export and the full delete already carry', () => {
  it('are found by the layer discovery and sit in a registered record folder', async () => {
    const { persistence, vault } = make('olea-dev1');
    await persistence.recordExtraction(paper());
    const found = await discoverOleaLayerPaths(vault, {
      deviceId: 'olea-dev1',
      today: '2026-09-29',
      probeDays: 3,
    });
    const mine = found.filter((path) => path.includes('/readings/'));
    expect(mine.length).toBe(2);
    for (const path of mine) expect(isInOleaLayerRole(path, 'record')).toBe(true);
  });
});

describe('the structure id, the part-demand writer and the alignment writer (ol-egov.141.89.7.52)', () => {
  it('returns the structure record id and the stored reading, and the same id for an unchanged structure', async () => {
    const { persistence } = make();
    const first = await persistence.recordExtraction(paper());
    expect(first.structure?.structureId).toEqual(expect.any(String));
    expect(first.structure?.reading.parts).toBeUndefined();
    const again = await persistence.recordExtraction(paper());
    expect(again.structure?.structureId).toBe(first.structure?.structureId);
    expect((await persistence.recordExtraction(objectives())).structure).toBeUndefined();
  });

  it('writes a part demand with the task and the answer stamp as provenance, against the structure id', async () => {
    const { persistence } = make();
    const { structure } = await persistence.recordExtraction(paper());
    const demand = { status: 'decided', demand: 'calculate', refs: [1] } as const;
    const first = await persistence.recordPartDemand({
      ref: PAPER_REF,
      structureId: structure?.structureId as string,
      partId: 'p1',
      demand,
      stamp: STAMP,
    });
    expect(first.appended).toBe(true);
    const held = [...(await persistence.load()).partDemands.values()][0];
    expect(held?.payload).toMatchObject({
      partId: 'p1',
      structureId: structure?.structureId,
      provenance: { task: 'demand.classify.v1', promptVersion: '1.1.0', modelId: 'model-a' },
    });
  });

  it("writes a course's alignment results in one batch, a pending one without provenance", async () => {
    const { persistence } = make();
    const digests = {
      closedList: 'sha256:a',
      coverage: 'sha256:b',
      batchPlan: 'sha256:c',
      frozenConfiguration: 'sha256:d',
    };
    const coverage = { unitsNotRead: [], pairsNotSent: [] };
    const out = await persistence.recordAlignmentResults({
      ref: OBJ_REF,
      courseId: 'TESTC1',
      digests,
      results: [
        {
          conceptKey: 'concept-key1:a',
          result: { kind: 'aligned', recordIds: ['o1'], refs: [1] },
          coverage,
          provenance: { task: 'outcomes.align.v1', ...STAMP },
        },
        {
          conceptKey: 'concept-key1:b',
          result: { kind: 'pending', reason: 'unavailable' },
          coverage,
        },
      ],
    });
    expect(out).toEqual({ appended: 2, unchanged: 0 });
    const held = [...(await persistence.load()).alignments.values()].map((e) => e.payload);
    expect(held.find((p) => p.conceptKey === 'concept-key1:a')?.provenance).toEqual({
      task: 'outcomes.align.v1',
      promptVersion: '1.1.0',
      modelId: 'model-a',
    });
    expect(held.find((p) => p.conceptKey === 'concept-key1:b')?.provenance).toBeUndefined();
    await expect(
      persistence.recordAlignmentResults({
        ref: OBJ_REF,
        courseId: 'TESTC1',
        digests,
        results: [
          {
            conceptKey: 'concept-key1:c',
            result: { kind: 'not-aligned', reason: 'searched' },
            coverage,
          },
        ],
      }),
    ).rejects.toThrow(/provenance/);
  });
});
