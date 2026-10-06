/**
 * `runAlignmentDriver` tests (`ol-egov.141.89.7.52`). Scenarios: F4.1, "alignment runs per registered
 * course over the closed list...", "an outage or an untrustworthy answer leaves that call's concepts
 * pending...", "past-paper parts travel inside their groups...", "a document read and found to state
 * nothing reads not aligned...", "a delivery that is not the whole revision is not aligned yet",
 * "unchanged inputs spend nothing again". Synthetic ids and wording only.
 */

import {
  ALIGN_CONCEPT_BUDGET,
  ALIGN_DESCRIPTION_CAP,
  ALIGN_PASSAGE_BUDGET,
  ALIGN_RUN_CALL_CAP,
  alignFrozenConfigurationDigest,
  alignmentResultsForDocument,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentReadingBasis } from '../../src/scope-reading/basis.js';
import {
  CLOSED_LIST_MEMBERSHIP,
  type ClosedListConcept,
} from '../../src/scope-reading/closed-list.js';
import type { DocumentRef, ExtractionRecordInput } from '../../src/scope-reading/persistence.js';
import {
  alignAll,
  alignNone,
  COURSE,
  conceptNotes,
  outcome,
  type Sent,
  STAMP,
  setup,
  transport,
  unit,
  unitsOf,
} from './drivers-kit.js';

const hoisted = vi.hoisted(() => ({
  extra: [] as unknown[],
  replace: undefined as unknown[] | undefined,
}));

vi.mock('../../src/scope-reading/closed-list.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/scope-reading/closed-list.js')>();
  return {
    ...actual,
    buildClosedList: async (...args: Parameters<typeof actual.buildClosedList>) =>
      hoisted.replace ?? [...(await actual.buildClosedList(...args)), ...hoisted.extra],
  };
});

const { runAlignmentDriver, isWholeRevision } = await import(
  '../../src/scope-reading/alignment-driver.js'
);

const OBJ_REF: DocumentRef = {
  sourcePath: 'doc-o',
  documentKind: 'objectives',
  revisionDigest: 'r1',
};
const PAPER_REF: DocumentRef = {
  sourcePath: 'doc-a',
  documentKind: 'past-paper',
  revisionDigest: 'r1',
};

const basisFor = (n: number): DocumentReadingBasis => ({
  revisionDigest: 'r1',
  unitsRead: n,
  unitsTotal: n,
  pages: Array.from({ length: n }, (_, i) => i + 1),
});

const keyed = (n: number): ClosedListConcept[] =>
  Array.from({ length: n }, (_, i) => ({
    conceptId: `concept-key1:k${String(i).padStart(3, '0')}`,
    key: `concept-key1:k${String(i).padStart(3, '0')}`,
    stableKey: true,
    name: `Idea ${i}`,
    attribution: { courseId: COURSE, courseName: COURSE },
    source: {},
  }));

const objectivesInput = (over: Partial<ExtractionRecordInput> = {}): ExtractionRecordInput => ({
  sourcePath: 'doc-o',
  documentKind: 'objectives',
  revisionDigest: 'r1',
  coverage: { unitsRead: 4, unitsTotal: 4 },
  declarationCount: 2,
  paperStructure: { sections: [] },
  stamp: STAMP,
  ...over,
});

async function objectivesRun(
  answer: (s: Sent, n: number) => unknown,
  opts: { files?: Record<string, string>; extraction?: Partial<ExtractionRecordInput> } = {},
) {
  const { vault, persistence } = setup(
    opts.files ?? conceptNotes(['Alpha idea', 'Beta idea', 'Gamma idea']),
  );
  const recorded = await persistence.recordExtraction(objectivesInput(opts.extraction));
  const t = transport(answer);
  const run = () =>
    runAlignmentDriver({
      persistence,
      ref: OBJ_REF,
      basis: basisFor(4),
      recorded,
      units: unitsOf(4),
      deliveryRevisionDigest: 'r1',
      courses: [COURSE],
      declarations: [outcome('outcome-key1:b', 2), outcome('outcome-key1:a', 1)],
      transport: t.transport,
      vault,
    });
  const results = async () =>
    alignmentResultsForDocument(await persistence.load(), COURSE, OBJ_REF, {});
  return { persistence, run, results, ...t };
}

describe('AT-1: when a delivery is the whole revision', () => {
  const base = {
    basis: basisFor(2),
    units: [unit('a', 1), unit('b', 2)],
    deliveryRevisionDigest: 'r1',
  };
  it('holds only with the revision digest, the same digest, and exactly the manifest pages', () => {
    expect(isWholeRevision(base)).toBe(true);
    expect(isWholeRevision({ basis: base.basis, units: base.units })).toBe(false);
    expect(isWholeRevision({ ...base, deliveryRevisionDigest: 'other' })).toBe(false);
    expect(isWholeRevision({ ...base, units: [unit('a', 1)] })).toBe(false);
    expect(isWholeRevision({ ...base, basis: basisFor(3) })).toBe(false);
    expect(
      isWholeRevision({ ...base, basis: { revisionDigest: 'r1', unitsRead: 2, unitsTotal: 2 } }),
    ).toBe(false);
    expect(isWholeRevision({ ...base, units: [] })).toBe(false);
  });
});

describe('the alignment driver, objectives', () => {
  it('sends the records and the keyed concepts, and stores one result per concept with digests and coverage', async () => {
    hoisted.extra = [
      {
        conceptId: 'concept-prov1:z',
        key: 'concept-prov1:z',
        stableKey: false,
        name: 'Zeta idea',
        attribution: { courseId: COURSE, courseName: COURSE },
        source: {},
      },
    ];
    try {
      const r = await objectivesRun((s) => alignAll(s));
      const out = await r.run();
      expect(out).toMatchObject({ outcome: 'ran', calls: 1, written: 4 });
      expect(r.sent).toHaveLength(1);
      const payload = r.sent[0]?.payload as {
        batchId: string;
        records: {
          recordId: string;
          kind: string;
          anchorRef: string;
          passages: { ref: string; role: string }[];
        }[];
        concepts: { handle: string; name: string; descriptionNone?: string }[];
        courseContext: { courseId: string };
      };
      expect(payload.batchId).toBe('b1');
      expect(payload.records.map((x) => [x.recordId, x.kind, x.anchorRef])).toEqual([
        ['r1', 'declaration', 'u1'],
        ['r2', 'declaration', 'u2'],
      ]);
      expect(payload.concepts.map((c) => c.handle)).toEqual(['c001', 'c002', 'c003']);
      expect(payload.concepts.every((c) => c.descriptionNone === 'no-source-recorded')).toBe(true);
      expect(JSON.stringify(r.sent)).not.toContain('unitIndex');
      expect(JSON.stringify(r.sent)).not.toContain('outcome-key1');

      const results = await r.results();
      expect(results).toHaveLength(4);
      const aligned = results.filter((v) => v.result.kind === 'aligned');
      expect(aligned).toHaveLength(3);
      for (const v of aligned) {
        expect(v.result).toEqual({
          kind: 'aligned',
          recordIds: ['outcome-key1:a', 'outcome-key1:b'],
          refs: [1, 2],
        });
        expect(v.provenance).toEqual({
          task: 'outcomes.align.v1',
          promptVersion: 'p1',
          modelId: 'm1',
        });
        expect(v.digests.closedList).toMatch(/^sha256:/);
        expect(v.digests.coverage).toMatch(/^sha256:/);
        expect(v.digests.batchPlan).toMatch(/^sha256:/);
        expect(v.digests.frozenConfiguration).toMatch(/^sha256:/);
        expect(v.coverage).toEqual({ unitsNotRead: [], pairsNotSent: [] });
      }
      const pending = results.find((v) => v.result.kind === 'pending');
      expect(pending?.conceptKey).toBe('concept-prov1:z');
      expect(pending?.result).toEqual({ kind: 'pending', reason: 'no-stable-key' });
      expect(pending?.provenance).toBeUndefined();
      expect(pending?.coverage.pairsNotSent).toEqual([{ reason: 'no-stable-key', count: 2 }]);
    } finally {
      hoisted.extra = [];
    }
  });

  it('the configuration digest uses the answering stamp and the settings as run ([D-534] FC-2)', async () => {
    const expected = (stamp: { promptVersion: string; modelId: string }) =>
      alignFrozenConfigurationDigest({
        documentKind: 'objectives',
        descriptionCap: ALIGN_DESCRIPTION_CAP,
        conceptBudget: ALIGN_CONCEPT_BUDGET,
        passageBudget: ALIGN_PASSAGE_BUDGET,
        runCallCap: ALIGN_RUN_CALL_CAP,
        promptVersion: stamp.promptVersion,
        modelId: stamp.modelId,
        membership: CLOSED_LIST_MEMBERSHIP,
      });
    const digestFor = async (stamp: { promptVersion: string; modelId: string }) => {
      const r = await objectivesRun((s) => alignAll(s, stamp));
      await r.run();
      return (await r.results())[0]?.digests.frozenConfiguration;
    };
    const other = { promptVersion: 'p9', modelId: 'm9' };
    expect(await digestFor(STAMP)).toBe(await expected(STAMP));
    expect(await digestFor(other)).toBe(await expected(other));
    expect(await expected(other)).not.toBe(await expected(STAMP));
  });

  it('reads not aligned, searched, when every pair was decided and none attests', async () => {
    const r = await objectivesRun((s) => alignNone(s));
    await r.run();
    expect((await r.results()).map((v) => v.result)).toEqual([
      { kind: 'not-aligned', reason: 'searched' },
      { kind: 'not-aligned', reason: 'searched' },
      { kind: 'not-aligned', reason: 'searched' },
    ]);
  });

  it('spends nothing again on unchanged inputs, but retries what was left pending', async () => {
    const r = await objectivesRun((s) => alignAll(s));
    await r.run();
    expect(r.sent).toHaveLength(1);
    expect(await r.run()).toMatchObject({ calls: 0, written: 0 });
    expect(r.sent).toHaveLength(1);
  });

  it('stores nothing and sends nothing when the delivery is not the whole revision', async () => {
    const { vault, persistence } = setup(conceptNotes(['Alpha idea']));
    const recorded = await persistence.recordExtraction(objectivesInput());
    const t = transport((s) => alignAll(s));
    const common = {
      persistence,
      ref: OBJ_REF,
      recorded,
      units: unitsOf(4),
      courses: [COURSE],
      declarations: [outcome('o', 1)],
      transport: t.transport,
      vault,
    };
    expect(
      await runAlignmentDriver({ ...common, basis: basisFor(5), deliveryRevisionDigest: 'r1' }),
    ).toMatchObject({ outcome: 'not-whole-revision' });
    expect(await runAlignmentDriver({ ...common, basis: basisFor(4) })).toMatchObject({
      outcome: 'not-whole-revision',
    });
    expect(t.sent).toHaveLength(0);
    expect((await persistence.load()).alignments.size).toBe(0);
  });

  it('writes states-no-scope for every keyed concept with no call when the document states nothing', async () => {
    const r = await objectivesRun((s) => alignAll(s), { extraction: { declarationCount: 0 } });
    const out = await r.run();
    expect(out).toMatchObject({ calls: 0, written: 3 });
    expect(r.sent).toHaveLength(0);
    for (const v of await r.results()) {
      expect(v.result).toEqual({ kind: 'not-aligned', reason: 'states-no-scope' });
      expect(v.provenance).toEqual({
        task: 'outcomes.extract.v1',
        promptVersion: 'p1',
        modelId: 'm1',
      });
    }
  });

  it('sends nothing when a partly read extraction was recorded', async () => {
    const { vault, persistence } = setup(conceptNotes(['Alpha idea']));
    const recorded = await persistence.recordExtraction(
      objectivesInput({ coverage: { unitsRead: 2, unitsTotal: 4 } }),
    );
    const t = transport((s) => alignAll(s));
    const out = await runAlignmentDriver({
      persistence,
      ref: OBJ_REF,
      basis: basisFor(4),
      recorded,
      units: unitsOf(4),
      deliveryRevisionDigest: 'r1',
      courses: [COURSE],
      declarations: [],
      transport: t.transport,
      vault,
    });
    expect(out.outcome).toBe('no-reading');
    expect(t.sent).toHaveLength(0);
  });
});

describe('the alignment driver, outages and refusals', () => {
  const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
    const spy = console.error;
    console.error = () => undefined;
    try {
      return await f();
    } finally {
      console.error = spy;
    }
  };

  it('leaves the concepts of an unreachable call pending (unavailable), never not aligned', async () => {
    hoisted.replace = keyed(40);
    try {
      const r = await objectivesRun((s, n) => {
        if (n === 1) return alignAll(s);
        throw new Error('offline');
      });
      await quiet(() => r.run());
      expect(r.sent).toHaveLength(2);
      const results = await r.results();
      const first = results.filter((v) => v.result.kind === 'aligned');
      const rest = results.filter((v) => v.result.kind === 'pending');
      expect(first).toHaveLength(34);
      expect(rest).toHaveLength(6);
      for (const v of rest) {
        expect(v.result).toEqual({ kind: 'pending', reason: 'unavailable' });
        expect(v.provenance).toBeUndefined();
      }
      expect(results.some((v) => v.result.kind === 'not-aligned')).toBe(false);
    } finally {
      hoisted.replace = undefined;
    }
  });

  it('leaves the concepts of a refused answer pending (failed-alignment)', async () => {
    hoisted.replace = keyed(40);
    try {
      const r = await objectivesRun((s, n) => {
        if (n === 1) return alignAll(s);
        return {
          ok: true,
          stamp: STAMP,
          result: { batchId: 'wrong', coverageDigest: 'wrong', decisions: [] },
        };
      });
      await quiet(() => r.run());
      const rest = (await r.results()).filter((v) => v.result.kind === 'pending');
      expect(rest).toHaveLength(6);
      expect(
        rest.every((v) => v.result.kind === 'pending' && v.result.reason === 'failed-alignment'),
      ).toBe(true);
    } finally {
      hoisted.replace = undefined;
    }
  });

  it('never mixes configurations in one run: a call under another stamp is a failed alignment', async () => {
    hoisted.replace = keyed(40);
    try {
      const r = await objectivesRun((s, n) =>
        n === 1 ? alignAll(s) : alignAll(s, { promptVersion: 'p2', modelId: 'm1' }),
      );
      await quiet(() => r.run());
      const rest = (await r.results()).filter((v) => v.result.kind === 'pending');
      expect(rest).toHaveLength(6);
      expect(
        rest.every((v) => v.result.kind === 'pending' && v.result.reason === 'failed-alignment'),
      ).toBe(true);
    } finally {
      hoisted.replace = undefined;
    }
  });

  it('makes the calls past the run cap as omissions: run-cap pending, counted in the coverage note', async () => {
    hoisted.replace = keyed(34 * 9);
    try {
      const r = await objectivesRun((s) => alignAll(s));
      await r.run();
      expect(r.sent).toHaveLength(8);
      const pending = (await r.results()).filter((v) => v.result.kind === 'pending');
      expect(pending).toHaveLength(34);
      expect(
        pending.every((v) => v.result.kind === 'pending' && v.result.reason === 'run-cap'),
      ).toBe(true);
      expect(pending[0]?.coverage.pairsNotSent).toEqual([{ reason: 'run-cap', count: 2 }]);
    } finally {
      hoisted.replace = undefined;
    }
  });

  it('retries pending results on the next delivery', async () => {
    hoisted.replace = keyed(2);
    try {
      let fail = true;
      const r = await objectivesRun((s) => {
        if (fail) throw new Error('offline');
        return alignAll(s);
      });
      await quiet(() => r.run());
      expect((await r.results()).every((v) => v.result.kind === 'pending')).toBe(true);
      fail = false;
      await r.run();
      expect(r.sent).toHaveLength(2);
      expect((await r.results()).every((v) => v.result.kind === 'aligned')).toBe(true);
    } finally {
      hoisted.replace = undefined;
    }
  });
});

describe('the alignment driver, past papers', () => {
  const units = [
    unit('Section heading text.', 1),
    unit('Shared stem text.', 1),
    unit('A table of invented numbers.', 1),
    unit('Find the first quantity.', 2),
    unit('Find the second quantity.', 2),
    unit('Find the third quantity.', 2),
  ];
  const paper = (): ExtractionRecordInput => ({
    sourcePath: 'doc-a',
    documentKind: 'past-paper',
    revisionDigest: 'r1',
    coverage: { unitsRead: 6, unitsTotal: 6 },
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
          memberLabels: ['1a', '1b', '1c'],
          anchor: { blockIndex: 1 },
          stimulus: { status: 'identified', form: 'table', anchor: { blockIndex: 2 } },
        },
      ],
      questionParts: ['p1', 'p2', 'p3'].map((id, i) => ({
        id,
        label: `1${'abc'[i]}`,
        groupId: 'g1',
        instructionAnchor: { blockIndex: 3 + i },
        questionForm: 'short answer',
      })),
    },
  });

  it('sends each part inside its group with stem and stimulus passages, and names the part ids in an aligned result', async () => {
    const { vault, persistence } = setup(conceptNotes(['Alpha idea']));
    const recorded = await persistence.recordExtraction(paper());
    const t = transport((s) => alignAll(s));
    const out = await runAlignmentDriver({
      persistence,
      ref: PAPER_REF,
      basis: basisFor(6),
      recorded,
      units,
      deliveryRevisionDigest: 'r1',
      courses: [COURSE],
      declarations: [],
      transport: t.transport,
      vault,
    });
    // Pages in `units` are 1, 1, 1, 2, 2, 2: the manifest names pages 1 and 2.
    expect(out.outcome).toBe('not-whole-revision');
    const ok = await runAlignmentDriver({
      persistence,
      ref: PAPER_REF,
      basis: { ...basisFor(6), pages: [1, 2] },
      recorded,
      units,
      deliveryRevisionDigest: 'r1',
      courses: [COURSE],
      declarations: [],
      transport: t.transport,
      vault,
    });
    expect(ok).toMatchObject({ outcome: 'ran', calls: 1, written: 1 });
    const records = (
      (t.sent[0] as Sent).payload as {
        records: {
          recordId: string;
          kind: string;
          group: { groupId: string; stimulus: { status: string; ref: string } };
          passages: { ref: string; role: string }[];
          headingPath: string[];
        }[];
      }
    ).records;
    expect(records.map((r) => r.recordId)).toEqual(['p1', 'p2', 'p3']);
    expect(records.every((r) => r.kind === 'question-part' && r.group.groupId === 'g1')).toBe(true);
    expect(records[0]?.group.stimulus).toMatchObject({ status: 'identified', ref: 'u2' });
    expect(records[0]?.passages).toEqual([
      { ref: 'u3', text: 'Find the first quantity.', role: 'record' },
      { ref: 'u1', text: 'Shared stem text.', role: 'group-stem' },
      { ref: 'u2', text: 'A table of invented numbers.', role: 'group-stimulus' },
    ]);
    expect(records[0]?.headingPath).toEqual(['Section one', 'Q1']);
    const [result] = alignmentResultsForDocument(await persistence.load(), COURSE, PAPER_REF, {});
    expect(result?.result).toMatchObject({ kind: 'aligned', recordIds: ['p1', 'p2', 'p3'] });
    // [D-534] 2-ii: the result names the structure its part ids came from.
    expect(result).toMatchObject({
      status: 'current',
      structureId: recorded.structure?.structureId,
    });
  });

  it('calls nothing and writes nothing for a past paper with no recorded structure to name ([D-534])', async () => {
    const { vault, persistence } = setup(conceptNotes(['Alpha idea']));
    const recorded = await persistence.recordExtraction({
      ...paper(),
      paperStructure: { sections: [] },
    });
    expect(recorded.structure).toBeUndefined();
    const t = transport((s) => alignAll(s));
    const out = await runAlignmentDriver({
      persistence,
      ref: PAPER_REF,
      basis: { ...basisFor(6), pages: [1, 2] },
      recorded,
      units,
      deliveryRevisionDigest: 'r1',
      courses: [COURSE],
      declarations: [],
      transport: t.transport,
      vault,
    });
    expect(out).toMatchObject({ calls: 0, written: 0 });
    expect(t.sent).toHaveLength(0);
    expect((await persistence.load()).alignments.size).toBe(0);
  });

  it('a replaced structure spends again, and the earlier result no longer reads current', async () => {
    const { vault, persistence } = setup(conceptNotes(['Alpha idea']));
    const first = await persistence.recordExtraction(paper());
    const t = transport((s) => alignAll(s));
    const basis = { ...basisFor(6), pages: [1, 2] };
    const common = {
      persistence,
      ref: PAPER_REF,
      basis,
      units,
      deliveryRevisionDigest: 'r1',
      courses: [COURSE],
      declarations: [],
      transport: t.transport,
      vault,
    };
    await runAlignmentDriver({ ...common, recorded: first });
    const changed = paper();
    const second = await persistence.recordExtraction({
      ...changed,
      paperStructure: { ...changed.paperStructure, timeAllowanceMinutes: 30 },
    });
    expect(second.structure?.structureId).not.toBe(first.structure?.structureId);
    await runAlignmentDriver({ ...common, recorded: second });
    expect(t.sent).toHaveLength(2);
    const [latest] = alignmentResultsForDocument(await persistence.load(), COURSE, PAPER_REF, {});
    expect(latest).toMatchObject({ status: 'current', structureId: second.structure?.structureId });
  });
});
